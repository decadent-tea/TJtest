import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  chromium,
  request,
  type APIRequestContext,
  type Page,
} from "playwright";
import { apiLogin, captchaText, fillCaptcha } from "./fixtures/auth";
import type { User } from "../shared/auth";

const directory = resolve("output", "verification-auth", String(Date.now()));
mkdirSync(directory, { recursive: true });
process.env.STUDIO_DATA_DIR = resolve(directory, "data");
const { get, list, put } = await import("../server/store");
const base = "http://127.0.0.1:14338";
const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  env: { ...process.env, PORT: "14338" },
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
const results: { name: string; pass: boolean }[] = [];
const browser = await chromium.launch({ headless: true });
const contexts: APIRequestContext[] = [];
const anonymous = await request.newContext();
contexts.push(anonymous);
const headers = { "X-Studio-Request": "1" };
let admin: User;
let worker: User;
let secondAdmin: User;
let adminRequest: APIRequestContext;
let workerRequest: APIRequestContext;
const test = async (name: string, fn: () => Promise<void>) => {
  await fn();
  results.push({ name, pass: true });
  console.log(`PASS: ${name}`);
};
const dialog = (page: Page) => page.getByRole("dialog");
const row = (page: Page, username: string) =>
  page.locator("tbody tr").filter({ hasText: username });
async function loginUI(page: Page, username: string, password: string) {
  await page.getByLabel("账号", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await fillCaptcha(page);
  await page.getByRole("button", { name: "登录工作空间", exact: true }).click();
  await page.getByRole("button", { name: "账户与安全", exact: true }).waitFor();
}
async function logoutUI(page: Page) {
  await page.getByRole("button", { name: "账户与安全", exact: true }).click();
  await dialog(page)
    .getByRole("button", { name: "退出登录", exact: true })
    .click();
  await page.getByRole("heading", { name: "欢迎回来", exact: true }).waitFor();
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    ready = await fetch(`${base}/api/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, logs);
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await test("未登录拦截业务接口与证据文件，初始化仅执行一次", async () => {
    assert.equal((await anonymous.get(`${base}/api/runs`)).status(), 401);
    assert.equal(
      (await anonymous.get(`${base}/artifacts/private.png`)).status(),
      401,
    );
    assert.equal((await anonymous.get(`${base}/api/users`)).status(), 401);
    assert.deepEqual(
      await (await anonymous.get(`${base}/api/auth/session`)).json(),
      { setupRequired: true, user: null },
    );
    await page.goto(`${base}/#users`);
    await page
      .getByRole("heading", { name: "创建管理员", exact: true })
      .waitFor();
    await page.getByLabel("账号", { exact: true }).fill("admin");
    await page.getByLabel("姓名", { exact: true }).fill("测试管理员");
    await page.getByLabel("密码", { exact: true }).fill("AdminTest2026");
    await page.getByLabel("确认密码", { exact: true }).fill("AdminTest2026");
    await fillCaptcha(page);
    await page.waitForFunction(
      () =>
        Number(
          getComputedStyle(document.querySelector(".auth-form-panel")!).opacity,
        ) > 0.99,
    );
    await page.screenshot({
      path: resolve(directory, "setup-desktop.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "创建并进入工作空间", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "用户管理", exact: true })
      .waitFor();
    admin = (await (await page.request.get(`${base}/api/auth/session`)).json())
      .user;
    const cookie = (await page.context().cookies()).find(
      (c) => c.name === "studio_session",
    );
    assert(cookie?.httpOnly);
    assert.equal(cookie.sameSite, "Strict");
    const stored = get<{ passwordHash: string }>("user", admin.id)!;
    assert(stored.passwordHash);
    assert(!stored.passwordHash.includes("AdminTest2026"));
    assert(!("passwordHash" in admin));
    assert.equal(
      (await anonymous.post(`${base}/api/auth/setup`, { data: {} })).status(),
      409,
    );
    adminRequest = await request.newContext({
      storageState: await page.context().storageState(),
      extraHTTPHeaders: headers,
    });
    contexts.push(adminRequest);
  });
  await test("用户新增、重复账号校验、详情查看、编辑与搜索", async () => {
    await page.getByRole("button", { name: "新增用户", exact: true }).click();
    await dialog(page).getByLabel("账号", { exact: true }).fill("worker");
    await dialog(page).getByLabel("姓名", { exact: true }).fill("设备测试员");
    await dialog(page)
      .getByLabel("初始密码", { exact: true })
      .fill("WorkerTest2026");
    await dialog(page)
      .getByLabel("确认密码", { exact: true })
      .fill("WorkerTest2026");
    await dialog(page)
      .getByRole("button", { name: "创建用户", exact: true })
      .click();
    await dialog(page).waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "查看用户 worker", exact: true })
      .waitFor();
    const values: User[] = await (
      await adminRequest.get(`${base}/api/users`)
    ).json();
    worker = values.find((u) => u.username === "worker")!;
    assert(worker);
    const duplicate = await adminRequest.post(`${base}/api/users`, {
      data: {
        username: "WORKER",
        displayName: "重复",
        password: "Duplicate2026",
        role: "user",
        enabled: true,
      },
    });
    assert.equal(duplicate.status(), 409);
    await page
      .getByRole("button", { name: "查看用户 worker", exact: true })
      .click();
    await dialog(page)
      .getByRole("heading", { name: "用户详情", exact: true })
      .waitFor();
    await dialog(page)
      .getByRole("button", { name: "编辑用户", exact: true })
      .click();
    await dialog(page).getByLabel("姓名", { exact: true }).fill("接口测试员");
    await dialog(page)
      .getByRole("button", { name: "保存用户", exact: true })
      .click();
    await dialog(page).waitFor({ state: "hidden" });
    await page.getByLabel("搜索用户", { exact: true }).fill("接口");
    assert.equal(await page.locator("tbody tr").count(), 1);
    await page.getByLabel("搜索用户", { exact: true }).fill("不存在");
    await page.getByText("没有匹配的用户", { exact: true }).waitFor();
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await page.screenshot({
      path: resolve(directory, "users-desktop.png"),
      fullPage: true,
    });
    assert.equal(
      (await adminRequest.get(`${base}/api/users/${worker.id}`)).status(),
      200,
    );
  });
  await test("编辑取消保留修改，当前账号与最后管理员保护，跨站写入拦截", async () => {
    await row(page, "worker")
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    await dialog(page).getByLabel("姓名", { exact: true }).fill("未保存姓名");
    await dialog(page)
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "放弃未保存的修改？", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "继续编辑", exact: true }).click();
    assert.equal(
      await dialog(page).getByLabel("姓名", { exact: true }).inputValue(),
      "未保存姓名",
    );
    await dialog(page)
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await page.getByRole("button", { name: "放弃修改", exact: true }).click();
    await dialog(page).waitFor({ state: "hidden" });
    assert.equal(
      (await adminRequest.delete(`${base}/api/users/${admin.id}`)).status(),
      409,
    );
    assert.equal(
      (
        await adminRequest.put(`${base}/api/users/${admin.id}`, {
          data: { ...admin, enabled: false },
        })
      ).status(),
      409,
    );
    assert.equal(
      (
        await page.request.post(`${base}/api/users`, {
          data: {
            username: "csrf",
            password: "Test2026abc",
            displayName: "csrf",
            role: "user",
            enabled: true,
          },
        })
      ).status(),
      403,
    );
    assert.equal(
      (
        await adminRequest.get(`${base}/api/users`, {
          headers: { Origin: "https://evil.example" },
        })
      ).status(),
      403,
    );
    assert.equal(
      await row(page, "admin")
        .getByRole("button", { name: "删除", exact: true })
        .isDisabled(),
      true,
    );
  });
  await test("验证码一次性、刷新失效与登录失败重试", async () => {
    const challenge = await anonymous.get(`${base}/api/auth/captcha`);
    const code = captchaText((await challenge.json()).image);
    const oldCookies = await anonymous.storageState();
    await anonymous.get(`${base}/api/auth/captcha`);
    const stale = await request.newContext({ storageState: oldCookies });
    contexts.push(stale);
    assert.equal(
      (
        await stale.post(`${base}/api/auth/login`, {
          data: { username: "admin", password: "AdminTest2026", captcha: code },
        })
      ).status(),
      400,
    );
    const single = await anonymous.get(`${base}/api/auth/captcha`);
    const valid = captchaText((await single.json()).image);
    assert.equal(
      (
        await anonymous.post(`${base}/api/auth/login`, {
          data: { username: "admin", password: "wrong", captcha: valid },
        })
      ).status(),
      401,
    );
    assert.equal(
      (
        await anonymous.post(`${base}/api/auth/login`, {
          data: {
            username: "admin",
            password: "AdminTest2026",
            captcha: valid,
          },
        })
      ).status(),
      400,
    );
    await logoutUI(page);
    await page.getByLabel("账号", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("wrong");
    await fillCaptcha(page);
    const before = await page
      .getByRole("img", { name: "图片验证码" })
      .getAttribute("src");
    await page
      .getByRole("button", { name: "登录工作空间", exact: true })
      .click();
    await page
      .getByText("账号或密码错误，或账号已停用。", { exact: true })
      .waitFor();
    await page.waitForFunction(
      (old) =>
        document.querySelector<HTMLImageElement>(".captcha-image img")?.src !==
          old && !!document.querySelector(".captcha-image img"),
      before,
    );
    await page.screenshot({
      path: resolve(directory, "login-desktop.png"),
      fullPage: true,
    });
    await loginUI(page, "ADMIN", "AdminTest2026");
    await page.reload();
    await page
      .getByRole("button", { name: "账户与安全", exact: true })
      .waitFor();
  });
  await test("普通用户隐藏管理入口且无法绕过后台权限，停用和启用生效", async () => {
    workerRequest = await request.newContext({ extraHTTPHeaders: headers });
    contexts.push(workerRequest);
    await apiLogin(workerRequest, base, "worker", "WorkerTest2026");
    assert.equal((await workerRequest.get(`${base}/api/users`)).status(), 403);
    assert.equal(
      (await workerRequest.post(`${base}/api/users`, { data: {} })).status(),
      403,
    );
    assert.equal(
      (await workerRequest.delete(`${base}/api/users/${admin.id}`)).status(),
      403,
    );
    const workerContext = await browser.newContext({
      storageState: await workerRequest.storageState(),
    });
    const workerPage = await workerContext.newPage();
    await workerPage.goto(`${base}/#users`);
    await workerPage.getByText("暂无访问权限", { exact: true }).waitFor();
    assert.equal(
      await workerPage
        .locator(".sidebar")
        .getByRole("button", { name: "用户管理", exact: true })
        .count(),
      0,
    );
    await page.goto(`${base}/#users`);
    await row(page, "worker")
      .getByRole("button", { name: "停用", exact: true })
      .click();
    await dialog(page)
      .getByRole("button", { name: "确认停用", exact: true })
      .click();
    await dialog(page).waitFor({ state: "hidden" });
    assert.equal((await workerRequest.get(`${base}/api/runs`)).status(), 401);
    const challenge = await workerRequest.get(`${base}/api/auth/captcha`);
    assert.equal(
      (
        await workerRequest.post(`${base}/api/auth/login`, {
          data: {
            username: "worker",
            password: "WorkerTest2026",
            captcha: captchaText((await challenge.json()).image),
          },
        })
      ).status(),
      401,
    );
    await row(page, "worker")
      .getByRole("button", { name: "启用", exact: true })
      .click();
    await dialog(page)
      .getByRole("button", { name: "确认启用", exact: true })
      .click();
    await dialog(page).waitFor({ state: "hidden" });
    await apiLogin(workerRequest, base, "worker", "WorkerTest2026");
    await workerContext.close();
  });
  await test("重置密码使旧密码和旧会话失效，新密码可登录", async () => {
    await row(page, "worker")
      .getByRole("button", { name: "重置密码", exact: true })
      .click();
    await dialog(page)
      .getByLabel("新密码", { exact: true })
      .fill("WorkerNew2026");
    await dialog(page)
      .getByLabel("确认新密码", { exact: true })
      .fill("WorkerNew2026");
    await dialog(page)
      .getByRole("button", { name: "确认重置密码", exact: true })
      .click();
    await dialog(page).waitFor({ state: "hidden" });
    assert.equal((await workerRequest.get(`${base}/api/runs`)).status(), 401);
    const challenge = await workerRequest.get(`${base}/api/auth/captcha`);
    assert.equal(
      (
        await workerRequest.post(`${base}/api/auth/login`, {
          data: {
            username: "worker",
            password: "WorkerTest2026",
            captcha: captchaText((await challenge.json()).image),
          },
        })
      ).status(),
      401,
    );
    await apiLogin(workerRequest, base, "worker", "WorkerNew2026");
    assert.equal((await workerRequest.get(`${base}/api/runs`)).status(), 200);
  });
  await test("删除取消、确认删除和业务记录保留", async () => {
    put("flow", { id: "preserved", name: "保留流程" });
    await row(page, "worker")
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await dialog(page)
      .getByRole("button", { name: "取消", exact: true })
      .click();
    assert(get("user", worker.id));
    await row(page, "worker")
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await dialog(page)
      .getByRole("button", { name: "确认删除用户", exact: true })
      .click();
    await dialog(page).waitFor({ state: "hidden" });
    assert.equal(get("user", worker.id), undefined);
    assert.equal((await workerRequest.get(`${base}/api/runs`)).status(), 401);
    assert(get("flow", "preserved"));
    // Avoid sending an incomplete business fixture to the React overview.
    const { remove } = await import("../server/store");
    remove("flow", "preserved");
  });
  await test("最后管理员无法被另一账号降级、停用或删除", async () => {
    await apiLogin(adminRequest, base, "admin", "AdminTest2026");
    secondAdmin = await (
      await adminRequest.post(`${base}/api/users`, {
        data: {
          username: "admin-two",
          displayName: "另一管理员",
          password: "AdminTwo2026",
          role: "admin",
          enabled: true,
        },
      })
    ).json();
    const other = await request.newContext({ extraHTTPHeaders: headers });
    contexts.push(other);
    await apiLogin(other, base, "admin-two", "AdminTwo2026");
    assert.equal(
      (
        await other.put(`${base}/api/users/${admin.id}`, {
          data: { ...admin, role: "user" },
        })
      ).status(),
      200,
    );
    const changed: User = await (
      await other.get(`${base}/api/users/${admin.id}`)
    ).json();
    // Use the ordinary account to verify it cannot remove the remaining administrator.
    const ordinary = await request.newContext({ extraHTTPHeaders: headers });
    contexts.push(ordinary);
    await apiLogin(ordinary, base, "admin", "AdminTest2026");
    assert.equal(
      (await ordinary.delete(`${base}/api/users/${secondAdmin.id}`)).status(),
      403,
    );
    assert.equal(
      (
        await other.put(`${base}/api/users/${secondAdmin.id}`, {
          data: { ...secondAdmin, role: "user" },
        })
      ).status(),
      409,
    );
    assert.equal(
      (
        await other.put(`${base}/api/users/${admin.id}`, {
          data: { ...changed, role: "admin" },
        })
      ).status(),
      200,
    );
    // Restore a fresh admin session after the permission change invalidated the old one.
    await apiLogin(adminRequest, base, "admin", "AdminTest2026");
    assert.equal(
      (
        await adminRequest.put(`${base}/api/users/${admin.id}`, {
          data: { ...admin, role: "user" },
        })
      ).status(),
      409,
    );
    assert(list("auth-session").length > 0);
  });
  await test("会话到期拦截，手机登录及用户列表无页面横向溢出", async () => {
    const expiring = await request.newContext({ extraHTTPHeaders: headers });
    contexts.push(expiring);
    await apiLogin(expiring, base, "admin", "AdminTest2026");
    const cookie = (await expiring.storageState()).cookies.find(
      (c) => c.name === "studio_session",
    )!;
    const { createHash } = await import("node:crypto");
    const id = createHash("sha256").update(cookie.value).digest("hex");
    const stored = get<{
      id: string;
      userId: string;
      version: number;
      expiresAt: number;
    }>("auth-session", id)!;
    put("auth-session", { ...stored, expiresAt: Date.now() - 1 });
    assert.equal((await expiring.get(`${base}/api/runs`)).status(), 401);
    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await mobile.goto(base);
    await mobile
      .getByRole("heading", { name: "欢迎回来", exact: true })
      .waitFor();
    await mobile.waitForFunction(
      () =>
        Number(
          getComputedStyle(document.querySelector(".auth-form-panel")!).opacity,
        ) > 0.99,
    );
    await mobile
      .getByRole("img", { name: "图片验证码", exact: true })
      .waitFor();
    await mobile.screenshot({
      path: resolve(directory, "login-mobile.png"),
      fullPage: true,
    });
    assert(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await loginUI(mobile, "admin", "AdminTest2026");
    await mobile.goto(`${base}/#users`);
    await mobile
      .getByRole("heading", { name: "用户管理", exact: true })
      .waitFor();
    await mobile.locator(".user-list-card tbody tr").first().waitFor();
    await mobile.waitForFunction(() => {
      const content = document.querySelector(".page-content");
      return (
        !!content &&
        Number(getComputedStyle(content).opacity) > 0.99 &&
        getComputedStyle(content).filter === "blur(0px)"
      );
    });
    await mobile.screenshot({
      path: resolve(directory, "users-mobile.png"),
      fullPage: true,
    });
    assert(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await mobile.close();
  });
  await test("本人修改密码、旧会话撤销、重新登录和退出", async () => {
    await page.goto(base);
    // The earlier role change invalidated the browser session; log in if needed.
    if (
      !(await (await page.request.get(`${base}/api/auth/session`)).json()).user
    )
      await loginUI(page, "admin", "AdminTest2026");
    await page.getByRole("button", { name: "账户与安全", exact: true }).click();
    await dialog(page)
      .getByRole("button", { name: "修改密码", exact: true })
      .click();
    await dialog(page)
      .getByLabel("当前密码", { exact: true })
      .fill("WrongPassword2026");
    await dialog(page)
      .getByLabel("新密码", { exact: true })
      .fill("AdminNew2026");
    await dialog(page)
      .getByLabel("确认新密码", { exact: true })
      .fill("AdminNew2026");
    await dialog(page)
      .getByRole("button", { name: "保存新密码", exact: true })
      .click();
    await dialog(page).getByText("当前密码不正确。", { exact: true }).waitFor();
    await dialog(page)
      .getByLabel("当前密码", { exact: true })
      .fill("AdminTest2026");
    await dialog(page)
      .getByRole("button", { name: "保存新密码", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "欢迎回来", exact: true })
      .waitFor();
    assert.equal((await adminRequest.get(`${base}/api/runs`)).status(), 401);
    await loginUI(page, "admin", "AdminNew2026");
    await logoutUI(page);
    assert.equal((await page.request.get(`${base}/api/runs`)).status(), 401);
    assert.deepEqual(errors, [], "浏览器不应出现运行异常");
  });
  await test("密码与账号输入约束、失败尝试限流", async () => {
    const administrator = await request.newContext({
      extraHTTPHeaders: headers,
    });
    contexts.push(administrator);
    await apiLogin(administrator, base, "admin-two", "AdminTwo2026");
    const data = {
      username: "invalid-user",
      displayName: "输入约束",
      role: "user",
      enabled: true,
      password: "12345678",
    };
    assert.equal(
      (await administrator.post(`${base}/api/users`, { data })).status(),
      400,
    );
    assert.equal(
      (
        await administrator.post(`${base}/api/users`, {
          data: { ...data, username: "x", password: "ValidTest2026" },
        })
      ).status(),
      400,
    );
    assert.equal(
      (await administrator.get(`${base}/api/users/missing`)).status(),
      404,
    );
    assert(
      (await (await administrator.get(`${base}/api/users`)).json()).every(
        (user: Record<string, unknown>) => !("passwordHash" in user),
      ),
    );
    const attacker = await request.newContext();
    contexts.push(attacker);
    for (let attempt = 0; attempt < 11; attempt++) {
      const challenge = await attacker.get(`${base}/api/auth/captcha`);
      const captcha = captchaText((await challenge.json()).image);
      const login = await attacker.post(`${base}/api/auth/login`, {
        data: { username: "rate-test", password: "WrongPassword2026", captcha },
      });
      assert.equal(login.status(), attempt < 10 ? 401 : 429);
    }
  });
} finally {
  await browser.close();
  await Promise.all(contexts.map((context) => context.dispose()));
  server.kill();
  await once(server, "exit");
  writeFileSync(
    resolve(directory, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(`结果与截图：${directory}`);
}
