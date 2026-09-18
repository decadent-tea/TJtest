import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import type { Run } from "../shared/types";

process.env.STUDIO_DATA_DIR = resolve("output", "archive-verification", String(Date.now()));
const { put, get, dataRoot } = await import("../server/store");
const fixture = (id: string, patch: Partial<Run> = {}): Run => ({
  id, name: id, project: "归档验证", environment: "隔离测试", url: "http://localhost",
  mode: "record", status: "COMPLETED", startedAt: new Date().toISOString(),
  scene: "验证", archived: true, operations: [], requests: [], logs: [], notes: [],
  findings: [], cases: [], analysis: { status: "NONE", findings: [] }, ...patch,
});
put("run", fixture("archive-delete", { analysis: { status: "NONE", findings: [], jobId: "legacy-job" } }));
put("run", fixture("archive-keep"));
put("run", fixture("history", { archived: false }));
put("analysis-job", { id: "legacy-job" });
put("analysis-job", { id: "earlier-job", runId: "archive-delete" });
put("analysis-job", { id: "keep-job", runId: "archive-keep" });
for (const id of ["archive-delete", "archive-keep"]) {
  mkdirSync(resolve(dataRoot, "artifacts", id, "nested"), { recursive: true });
  writeFileSync(resolve(dataRoot, "artifacts", id, "nested", "download.txt"), "fixture");
}
const port = 14328;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  env: { ...process.env, PORT: String(port) }, stdio: "pipe", windowsHide: true,
});
let output = "";
server.stdout.on("data", (chunk) => { output += chunk; });
server.stderr.on("data", (chunk) => { output += chunk; });
const browser = await chromium.launch({ headless: true });
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    ready = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, output);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${base}/#history`);
  const historyNav = page.locator(".sidebar").getByRole("button", { name: /体检记录/ });
  await page.getByRole("button", { name: "history", exact: true }).waitFor();
  assert.equal(await historyNav.locator(".nav-count").textContent(), "1");
  await page.getByRole("button", { name: "归档记录", exact: true }).click();
  await page.getByText("暂无匹配记录", { exact: true }).waitFor();
  assert.equal(await historyNav.locator(".nav-count").count(), 0);
  await page.locator(".sidebar").getByRole("button", { name: "历史档案" }).click();
  await page.getByRole("button", { name: "archive-delete", exact: true }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 3);
  assert.equal(await page.getByText("archive-delete", { exact: true }).count(), 1);
  const row = page.locator("tbody tr").filter({ hasText: "archive-delete" });
  await row.getByRole("button", { name: "彻底删除", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
  assert(get("run", "archive-delete"));
  assert(existsSync(resolve(dataRoot, "artifacts", "archive-delete")));
  await row.getByRole("button", { name: "彻底删除", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认彻底删除" }).click();
  await page.getByText("体检记录及对应本地文件已彻底删除。", { exact: true }).waitFor();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(get("run", "archive-delete"), undefined);
  assert.equal(get("analysis-job", "legacy-job"), undefined);
  assert.equal(get("analysis-job", "earlier-job"), undefined);
  assert(!existsSync(resolve(dataRoot, "artifacts", "archive-delete")));
  assert(get("run", "archive-keep"));
  assert(get("analysis-job", "keep-job"));
  assert(existsSync(resolve(dataRoot, "artifacts", "archive-keep", "nested", "download.txt")));
  await page.screenshot({ path: resolve(dataRoot, "archive.png"), fullPage: true });
  const historyRow = page.locator("tbody tr").filter({ has: page.getByRole("button", { name: "history", exact: true }) });
  await historyRow.getByRole("button", { name: "移出归档" }).click();
  await page.getByText("已移出归档。", { exact: true }).waitFor();
  assert.equal(await historyNav.locator(".nav-count").textContent(), "1");
  for (const [id, patch] of [
    ["unarchived", { archived: false }],
    ["recording", { status: "RECORDING" }],
    ["analyzing", { analysis: { status: "RUNNING", findings: [] } }],
  ] as [string, Partial<Run>][]) {
    put("run", fixture(id, patch));
    assert.equal((await fetch(`${base}/api/runs/${id}`, { method: "DELETE" })).status, 422);
    assert(get("run", id));
  }
  put("run", fixture("../escape"));
  assert.equal((await fetch(`${base}/api/runs/${encodeURIComponent("../escape")}`, { method: "DELETE" })).status, 422);
  console.log("PASS: 归档计数、单一列表、移出归档、取消与确认删除、数据库与文件清理、其他记录保留、活动任务和路径保护。");
  console.log(`截图：${resolve(dataRoot, "archive.png")}`);
} finally {
  await browser.close();
  server.kill();
  await once(server, "exit");
}
