import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { chromium, request, type APIRequestContext } from "playwright";
import { apiLogin, fillCaptcha } from "./fixtures/auth";
import type { Role, User } from "../shared/auth";

const output = resolve("output", "verification-roles", String(Date.now()));
mkdirSync(output, { recursive: true });
process.env.STUDIO_DATA_DIR = resolve(output, "data");
const { put, get } = await import("../server/store");
const now = new Date().toISOString();
function legacyUser(id: string, role: string) {
  const salt = randomBytes(16).toString("hex");
  return put("user", {
    id,
    username: id,
    displayName: role === "admin" ? "原有管理员" : "原有测试员",
    role,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    credentialVersion: 1,
    passwordHash: `${salt}:${scryptSync("LegacyTest2026", salt, 64).toString("hex")}`,
  });
}
legacyUser("legacy-admin", "admin");
legacyUser("legacy-user", "user");
const base = "http://127.0.0.1:14348";
const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  env: { ...process.env, PORT: "14348" },
  stdio: "pipe",
  windowsHide: true,
});
let logs = "";
server.stdout.on("data", (chunk) => {
  logs += chunk;
});
server.stderr.on("data", (chunk) => {
  logs += chunk;
});
const browser = await chromium.launch({ headless: true });
const contexts: APIRequestContext[] = [];
const headers = { "X-Studio-Request": "1" };
const results: { name: string; pass: boolean }[] = [];
const test = async (name: string, fn: () => Promise<void>) => {
  await fn();
  results.push({ name, pass: true });
  console.log(`PASS: ${name}`);
};
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    ready = await fetch(`${base}/api/health`)
      .then((response) => response.ok)
      .catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, logs);
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const dialog = () => page.getByRole("dialog");
  let admin: APIRequestContext;
  let custom: Role;
  await test("兼容原有账号，自动建立内置角色与权限", async () => {
    await page.goto(`${base}/#roles`);
    await page.getByLabel("账号", { exact: true }).fill("legacy-admin");
    await page.getByLabel("密码", { exact: true }).fill("LegacyTest2026");
    await fillCaptcha(page);
    await page
      .getByRole("button", { name: "登录工作空间", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "角色管理", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "查看角色 管理员", exact: true })
      .waitFor();
    assert.equal(await page.locator(".role-list-card tbody tr").count(), 2);
    const state = await (
      await page.request.get(`${base}/api/auth/session`)
    ).json();
    assert.equal(state.user.roleName, "管理员");
    assert.equal(state.user.permissions.length, 3);
    admin = await request.newContext({
      storageState: await page.context().storageState(),
      extraHTTPHeaders: headers,
    });
    contexts.push(admin);
    assert.equal(get<{ role: string }>("user", "legacy-user")!.role, "user");
  });
  await test("系统管理二级菜单、自动展开、高亮、面包屑和模型入口", async () => {
    const parent = page
      .locator(".sidebar")
      .getByRole("button", { name: "系统管理", exact: true });
    const submenu = page.getByRole("navigation", {
      name: "系统管理子菜单",
      exact: true,
    });
    assert.equal(await parent.getAttribute("aria-expanded"), "true");
    assert.equal(
      await submenu
        .getByRole("button", { name: "角色管理", exact: true })
        .getAttribute("aria-current"),
      "page",
    );
    assert(
      await page
        .getByRole("navigation", { name: "面包屑", exact: true })
        .getByRole("link", { name: "系统管理", exact: true })
        .isVisible(),
    );
    await parent.click();
    assert.equal(await parent.getAttribute("aria-expanded"), "false");
    assert.equal(
      await page
        .getByRole("navigation", { name: "系统管理子菜单", exact: true })
        .count(),
      0,
    );
    await parent.click();
    await submenu
      .getByRole("button", { name: "模型与设置", exact: true })
      .click();
    await page.waitForURL(`${base}/#settings`);
    await submenu
      .getByRole("button", { name: "模型与设置", exact: true })
      .and(page.locator('[aria-current="page"]'))
      .waitFor();
    assert.equal(
      await submenu
        .getByRole("button", { name: "模型与设置", exact: true })
        .getAttribute("aria-current"),
      "page",
    );
    await page.goto(`${base}/#roles`);
    await page
      .getByRole("button", { name: "查看角色 管理员", exact: true })
      .waitFor();
  });
  await test("角色新增、重复校验、详情查看、编辑与搜索", async () => {
    await page.getByRole("button", { name: "新增角色", exact: true }).click();
    await dialog().getByLabel("角色名称", { exact: true }).fill("测试主管");
    await dialog().getByLabel("角色标识", { exact: true }).fill("qa_lead");
    await dialog()
      .getByLabel("角色说明", { exact: true })
      .fill("负责业务体检和团队账号维护");
    await dialog()
      .getByRole("checkbox", { name: "用户管理", exact: true })
      .check();
    await dialog()
      .getByRole("button", { name: "创建角色", exact: true })
      .click();
    await dialog().waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "查看角色 测试主管", exact: true })
      .waitFor();
    custom = (await (await admin.get(`${base}/api/roles`)).json()).find(
      (role: Role) => role.code === "qa_lead",
    );
    assert(custom);
    assert.equal(
      (
        await admin.post(`${base}/api/roles`, {
          data: {
            name: "重复",
            code: "QA_LEAD",
            permissions: ["workspace.use"],
          },
        })
      ).status(),
      409,
    );
    await page
      .getByRole("button", { name: "查看角色 测试主管", exact: true })
      .click();
    await dialog()
      .getByRole("heading", { name: "角色详情", exact: true })
      .waitFor();
    await dialog()
      .getByRole("button", { name: "编辑角色", exact: true })
      .click();
    await dialog().getByLabel("角色名称", { exact: true }).fill("回归主管");
    assert(
      (await dialog()
        .getByLabel("角色标识", { exact: true })
        .getAttribute("readonly")) !== null,
    );
    await dialog()
      .getByRole("button", { name: "保存角色", exact: true })
      .click();
    await dialog().waitFor({ state: "hidden" });
    await page.getByLabel("搜索角色", { exact: true }).fill("回归");
    assert.equal(await page.locator(".role-list-card tbody tr").count(), 1);
    await page.getByLabel("搜索角色", { exact: true }).fill("无匹配角色");
    await page.getByText("没有匹配的角色", { exact: true }).waitFor();
    await page.getByRole("button", { name: "清除搜索", exact: true }).click();
    await page.waitForFunction(
      () =>
        Number(
          getComputedStyle(document.querySelector(".page-content")!).opacity,
        ) > 0.99,
    );
    await page.screenshot({
      path: resolve(output, "roles-desktop.png"),
      fullPage: true,
    });
    custom = await (await admin.get(`${base}/api/roles/${custom.id}`)).json();
  });
  await test("用户分配自定义角色，角色成员计数与关联用户跳转", async () => {
    await page.goto(`${base}/#users`);
    await page
      .getByRole("button", { name: "查看用户 legacy-user", exact: true })
      .waitFor();
    await page
      .locator("tbody tr")
      .filter({ hasText: "legacy-user" })
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    await dialog().getByLabel("角色", { exact: true }).click();
    await page.getByRole("option", { name: "回归主管", exact: true }).click();
    await dialog()
      .getByRole("button", { name: "保存用户", exact: true })
      .click();
    await dialog().waitFor({ state: "hidden" });
    assert.equal(get<{ role: string }>("user", "legacy-user")!.role, custom.id);
    await page.goto(`${base}/#roles`);
    await page
      .getByRole("button", { name: "查看 回归主管 的关联用户", exact: true })
      .click();
    await dialog().getByText("legacy-user", { exact: true }).waitFor();
    await dialog()
      .getByRole("button", { name: "管理关联用户", exact: true })
      .click();
    await page.waitForURL(`${base}/#users/role/${custom.id}`);
    await page
      .getByRole("button", { name: "查看用户 legacy-user", exact: true })
      .waitFor();
    assert.equal(await page.locator("tbody tr").count(), 1);
    await page.reload();
    await page
      .getByRole("button", { name: "查看用户 legacy-user", exact: true })
      .waitFor();
    assert.equal(await page.locator("tbody tr").count(), 1);
  });
  await test("自定义权限生效，不能分配更高权限或操作更高权限账号", async () => {
    const limited = await request.newContext({ extraHTTPHeaders: headers });
    contexts.push(limited);
    const user: User = await apiLogin(
      limited,
      base,
      "legacy-user",
      "LegacyTest2026",
    );
    assert.equal(user.roleName, "回归主管");
    assert.equal((await limited.get(`${base}/api/users`)).status(), 200);
    assert.equal((await limited.get(`${base}/api/roles`)).status(), 403);
    assert.equal(
      (
        await limited.post(`${base}/api/users`, {
          data: {
            username: "escalate",
            displayName: "越权",
            role: "admin",
            enabled: true,
            password: "Test2026abc",
          },
        })
      ).status(),
      403,
    );
    assert.equal(
      (
        await limited.post(`${base}/api/users/legacy-admin/reset-password`, {
          data: { password: "Test2026abc" },
        })
      ).status(),
      403,
    );
    assert.equal(
      (await limited.delete(`${base}/api/users/legacy-admin`)).status(),
      403,
    );
    const context = await browser.newContext({
      storageState: await limited.storageState(),
    });
    const limitedPage = await context.newPage();
    await limitedPage.goto(`${base}/#users`);
    await limitedPage
      .getByRole("heading", { name: "用户管理", exact: true })
      .waitFor();
    assert.equal(
      await limitedPage
        .locator(".sidebar")
        .getByRole("button", { name: "角色管理", exact: true })
        .count(),
      0,
    );
    await limitedPage.goto(`${base}/#roles`);
    await limitedPage.getByText("暂无访问权限", { exact: true }).waitFor();
    await context.close();
    assert.equal(
      (await admin.delete(`${base}/api/roles/${custom.id}`)).status(),
      409,
    );
    assert.equal((await admin.delete(`${base}/api/roles/admin`)).status(), 409);
    assert.equal(
      (
        await admin.put(`${base}/api/roles/admin`, {
          data: {
            code: "admin",
            name: "管理员",
            description: "",
            permissions: ["workspace.use"],
          },
        })
      ).status(),
      409,
    );
    // Change effective permissions, then prove the old session is revoked and the new menu is usable.
    assert.equal(
      (
        await admin.put(`${base}/api/roles/${custom.id}`, {
          data: {
            code: custom.code,
            name: custom.name,
            description: custom.description,
            permissions: ["users.manage"],
          },
        })
      ).status(),
      200,
    );
    assert.equal((await limited.get(`${base}/api/users`)).status(), 401);
    await apiLogin(limited, base, "legacy-user", "LegacyTest2026");
    assert.equal((await limited.get(`${base}/api/runs`)).status(), 403);
    assert.equal(
      (await limited.get(`${base}/api/settings/models`)).status(),
      403,
    );
    const systemOnly = await browser.newContext({
      storageState: await limited.storageState(),
    });
    const systemPage = await systemOnly.newPage();
    await systemPage.goto(base);
    await systemPage
      .getByRole("heading", { name: "用户管理", exact: true })
      .waitFor();
    assert.equal(
      await systemPage.getByText("后端暂时无法连接", { exact: true }).count(),
      0,
    );
    assert.equal(
      await systemPage
        .locator(".sidebar")
        .getByRole("button", { name: "模型与设置", exact: true })
        .count(),
      0,
    );
    await systemOnly.close();
  });
  await test("移动端导航与布局，内置权限说明和未保存修改保护", async () => {
    await page.goto(`${base}/#roles`);
    await page
      .getByRole("button", { name: "查看角色 回归主管", exact: true })
      .waitFor();
    await page
      .locator("tbody tr")
      .filter({ hasText: "qa_lead" })
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    await dialog().getByLabel("角色说明", { exact: true }).fill("尚未保存");
    await dialog().getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "放弃修改", exact: true }).click();
    await dialog().waitFor({ state: "hidden" });
    await page
      .locator("tbody tr")
      .filter({ hasText: "管理员" })
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    assert(
      await dialog()
        .getByRole("checkbox", { name: "角色管理", exact: true })
        .isDisabled(),
    );
    await dialog().getByRole("button", { name: "取消", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: resolve(output, "roles-mobile.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "展开导航", exact: true }).click();
    await page
      .getByRole("navigation", { name: "系统管理子菜单", exact: true })
      .getByRole("button", { name: "用户管理", exact: true })
      .click();
    await page.waitForURL(`${base}/#users`);
    await page
      .getByRole("heading", { name: "用户管理", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "查看用户 legacy-user", exact: true })
      .waitFor();
    assert.equal(
      await page.locator(".sidebar").getAttribute("class"),
      "sidebar",
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await test("先调整用户归属，再取消或确认删除角色", async () => {
    assert.equal(
      (
        await admin.put(`${base}/api/users/legacy-user`, {
          data: {
            username: "legacy-user",
            displayName: "原有测试员",
            role: "user",
            enabled: true,
          },
        })
      ).status(),
      200,
    );
    await page.goto(`${base}/#roles`);
    const row = page.locator("tbody tr").filter({ hasText: "qa_lead" });
    await row.getByRole("button", { name: "删除", exact: true }).waitFor();
    await row.getByRole("button", { name: "删除", exact: true }).click();
    await dialog().getByRole("button", { name: "取消", exact: true }).click();
    assert(get("role", custom.id));
    await row.getByRole("button", { name: "删除", exact: true }).click();
    await dialog()
      .getByRole("button", { name: "确认删除角色", exact: true })
      .click();
    await dialog().waitFor({ state: "hidden" });
    assert.equal(get("role", custom.id), undefined);
    assert.equal(
      (await admin.get(`${base}/api/roles/${custom.id}`)).status(),
      404,
    );
    assert.equal(
      (
        await admin.post(`${base}/api/users`, {
          data: {
            username: "missing-role",
            displayName: "无效角色",
            role: custom.id,
            enabled: true,
            password: "Test2026abc",
          },
        })
      ).status(),
      404,
    );
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  await Promise.all(contexts.map((context) => context.dispose()));
  server.kill();
  await once(server, "exit");
  writeFileSync(
    resolve(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(`结果与截图：${output}`);
}
