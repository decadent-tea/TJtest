import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { EVIDENCE_VERSION } from "../shared/inspection-evidence";
import { chromium, type Page } from "playwright";
import { reportDetailFixture } from "./fixtures/report-detail";
import type {
  Run,
  Flow,
  Operation,
  Finding,
  ModelProfile,
} from "../shared/types";
const output = resolve("output", "verification-ui", String(Date.now()));
mkdirSync(output, { recursive: true });
const now = new Date().toISOString();
const op: Operation = {
  id: "op1",
  sequence: 1,
  pageId: "page1",
  framePath: [],
  timestamp: now,
  kind: "click",
  label: "查询设备",
  module: "设备",
  scene: "查询",
  url: "http://example.test",
  locators: [{ kind: "text", value: "查询" }],
  status: "PASSED",
  dependsOn: [],
  timeout: 8000,
  effect: "read",
  enabled: true,
};
const finding: Finding = {
  id: "finding",
  severity: "high",
  title: "设备接口异常",
  module: "设备",
  detail: "本地模拟异常",
  evidenceIds: ["op1"],
  source: "rule",
  disposition: "open",
};
const fixture: Run = {
  id: "done",
  name: "已完成记录",
  project: "回归验证",
  environment: "隔离",
  url: "http://example.test",
  mode: "record",
  status: "COMPLETED",
  startedAt: now,
  scene: "查询",
  archived: false,
  operations: [op],
  requests: [],
  logs: [],
  feedback: [
    {
      id: "ui-feedback",
      timestamp: now,
      pageId: "page1",
      framePath: [],
      stepId: "op1",
      association: "time-candidate",
      kind: "message",
      change: "appeared",
      level: "error",
      text: "保存失败，请稍后重试",
    },
  ],
  notes: [],
  findings: [finding],
  cases: [],
  analysis: { status: "NONE", findings: [] },
};
let runs: Run[];
let flow: Flow;
let models: ModelProfile[];
let failDownload: boolean;
let delaySave: boolean;
const detailReads = new Map<string, number>();
function reset() {
  detailReads.clear();
  runs = [
    structuredClone(fixture),
    {
      ...structuredClone(fixture),
      id: "live",
      name: "正在复检的任务",
      mode: "replay",
      status: "REPLAYING",
      findings: [],
    },
    {
      ...structuredClone(fixture),
      id: "archived",
      name: "归档记录",
      archived: true,
    },
  ];
  flow = {
    id: "flow",
    name: "设备流程",
    project: "回归验证",
    url: "http://example.test",
    version: 1,
    sourceRunId: "done",
    createdAt: now,
    updatedAt: now,
    operations: [
      structuredClone(op),
      {
        ...structuredClone(op),
        id: "op2",
        sequence: 2,
        label: "检查结果",
        dependsOn: ["op1"],
      },
    ],
    variables: [],
  };
  models = [
    {
      id: "model",
      name: "测试模型",
      provider: "Custom",
      baseUrl: "http://example.test",
      model: "mock",
      enabled: true,
      hasKey: true,
      timeout: 90,
      maxTokens: 4096,
    },
  ];
  failDownload = true;
  delaySave = false;
}
reset();
const app = express();
app.use(express.json());
app.get("/api/auth/session", (_, res) =>
  res.json({
    setupRequired: false,
    user: {
      id: "test-admin",
      username: "tester",
      displayName: "测试工程师",
      role: "admin",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
  }),
);
app.get("/api/health", (_, res) => res.json({ status: "ok", active: [] }));
app.get("/api/runs", (_, res) =>
  res.json(
    runs.map((r) => ({
      ...r,
      operationCount: r.operations.length,
      requestCount: 0,
      issueCount: r.findings.length,
      analysisStatus: r.analysis.status,
    })),
  ),
);
app.get("/api/runs/:id", (req, res) => {
  detailReads.set(req.params.id, (detailReads.get(req.params.id) || 0) + 1);
  const r = runs.find((r) => r.id === req.params.id);
  r ? res.json(r) : res.status(404).json({ error: "记录不存在" });
});
app.post("/api/runs/:id/analyze", (req, res) => {
  const run = runs.find((run) => run.id === req.params.id)!;
  run.analysis = {
    status: "RUNNING",
    evidenceVersion: EVIDENCE_VERSION,
    findings: [],
    progress: {
      phase: "batches",
      completed: 1,
      total: 3,
      processedRecords: 4,
      totalRecords: 12,
      resumed: false,
    },
  };
  res.json({ ok: true });
});
app.get("/api/flows", (_, res) => res.json([flow]));
app.post("/api/runs/:id/findings/:findingId/ownership", (req, res) => {
  const run = runs.find((r) => r.id === req.params.id)!;
  const finding = [...run.findings, ...run.analysis.findings].find(
    (f) => f.id === req.params.findingId,
  )!;
  finding.owners = req.body.owners;
  finding.ownershipSource = "manual";
  res.json(run);
});
app.get("/api/runs/:id/report", (_, res) => {
  if (failDownload) {
    failDownload = false;
    res.status(503).json({ error: "报告暂时生成失败，请重试" });
    return;
  }
  res
    .type(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    .send(Buffer.from("mock report"));
});
app.get("/api/runs/:id/cases.xlsx", (_, res) => {
  res.attachment("cases.xlsx").send(Buffer.from("mock cases"));
});
app.get("/api/settings/models", (_, res) => res.json(models));
app.post("/api/settings/models", async (req, res) => {
  if (delaySave) await new Promise((r) => setTimeout(r, 1500));
  models = [{ ...req.body, hasKey: true }];
  res.json(models[0]);
});
app.put("/api/flows/:id", async (req, res) => {
  if (delaySave) await new Promise((r) => setTimeout(r, 1500));
  flow = { ...flow, ...req.body, version: flow.version + 1 };
  res.json(flow);
});
app.use("/api", (_, res) =>
  res.status(400).json({ error: "测试未实现的操作" }),
);
app.use(express.static(resolve("dist")));
const server = createServer(app);
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await chromium.launch({ headless: true });
const results: { name: string; pass: boolean; error?: string }[] = [];
async function test(name: string, fn: (page: Page) => Promise<void>) {
  reset();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(6000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await fn(page);
    assert.deepEqual(errors, [], "浏览器出现未处理异常");
    results.push({ name, pass: true });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, pass: false, error: String(e) });
    console.error("FAIL", name, String(e));
  } finally {
    await page
      .screenshot({
        path: resolve(output, `${results.length}.png`),
        fullPage: true,
      })
      .catch(() => {});
    await page.close({ runBeforeUnload: false });
  }
}
try {
  await test("工作台恢复任务后，自然完成进入记录详情", async (page) => {
    await page.goto(`${base}/#workbench`);
    await page
      .getByRole("heading", { name: "正在复检的任务", exact: true })
      .waitFor();
    runs[1].status = "COMPLETED";
    await page.waitForURL(`${base}/#record/live`, { timeout: 8000 });
    await page.getByRole("region", { name: "AI 体检分析" }).waitFor();
  });
  await test("独立分析区与五个证据标签，移除问题中心入口", async (page) => {
    await page.goto(`${base}/#record/done`);
    await page.getByRole("region", { name: "AI 体检分析" }).waitFor();
    assert.deepEqual(await page.getByRole("tab").allTextContents(), [
      "接口 0 次 · 0 条",
      "日志 0 次 · 0 条",
      "画面",
      "页面反馈 1 次 · 1 条",
      "风险 1",
    ]);
    assert.equal(
      await page.getByRole("button", { name: "问题中心", exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: "体检结果", exact: true }).count(),
      1,
    );
    assert.equal(
      await page.getByRole("link", { name: "导出用例", exact: true }).count(),
      0,
    );
    assert.equal(
      await page
        .locator(".analysis-trigger")
        .evaluate((el) => getComputedStyle(el).clipPath !== "none"),
      true,
    );
    assert.equal(await page.locator(".analysis-particles i").count(), 8);
    await page.goto(`${base}/#issues`);
    await page
      .getByRole("heading", { name: "体检记录", exact: true })
      .waitFor();
  });
  await test("页面反馈证据支持刷新和移动端查看", async (page) => {
    await page.goto(`${base}/#record/done/feedback`);
    await page
      .getByRole("tab", { name: "页面反馈 1 次 · 1 条", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("tab", { name: "页面反馈 1 次 · 1 条", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    await page
      .getByRole("cell")
      .filter({ hasText: "保存失败，请稍后重试" })
      .waitFor();
    await page.reload();
    await page
      .getByRole("cell")
      .filter({ hasText: "保存失败，请稍后重试" })
      .waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.getByRole("tabpanel").scrollIntoViewIfNeeded();
    const tabBounds = await page.getByRole("tablist").boundingBox();
    const panelBounds = await page.getByRole("tabpanel").boundingBox();
    assert.ok(tabBounds && panelBounds);
    assert.ok(
      tabBounds.y + tabBounds.height <= panelBounds.y,
      "换行后的证据标签不得覆盖面板内容",
    );
    await page.screenshot({ path: resolve(output, "feedback-mobile.png") });
  });
  await test("选择操作和定位问题默认仅显示本步证据，可恢复全程查看", async (page) => {
    runs[0].operations.push({
      ...op,
      id: "op2",
      sequence: 2,
      label: "刷新设备",
    });
    runs[0].requests = runs[0].operations.map((operation, index) => ({
      id: `ui-request-${index + 1}`,
      pageId: "page1",
      stepId: operation.id,
      startedAt: now,
      method: "GET",
      url: `http://example.test/api/${index ? "devices" : "login"}`,
      resourceType: "fetch",
      requestHeaders: {},
      status: index ? 500 : 200,
      duration: 100,
      description: index ? "设备故障请求" : "登录请求",
      module: "设备",
      category: "business",
      confidence: 0.65,
    }));
    runs[0].findings[0].evidenceIds = ["op1", "ui-request-2"];
    await page.goto(`${base}/#record/done/network`);
    await page
      .getByRole("tab", { name: "接口 2 次 · 2 条", exact: true })
      .waitFor();
    await page.locator("#path-step-op2").click();
    await page
      .getByRole("tab", { name: "接口 1 次 · 1 条", exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "登录请求", exact: true }).count(),
      0,
    );
    await page
      .getByRole("button", { name: "设备故障请求", exact: true })
      .waitFor();
    assert.equal(
      await page.locator("#path-step-op2").getAttribute("aria-pressed"),
      "true",
    );
    await page
      .getByPlaceholder("搜索接口描述、模块、URL 或状态码…")
      .fill("没有匹配的内容");
    await page.locator("#path-step-op2").click();
    await page
      .getByRole("tab", { name: "接口 2 次 · 2 条", exact: true })
      .waitFor();
    assert.equal(
      await page.locator("#path-step-op2").getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(
      await page
        .getByPlaceholder("搜索接口描述、模块、URL 或状态码…")
        .inputValue(),
      "",
    );
    await page.getByRole("button", { name: "登录请求", exact: true }).waitFor();
    await page.locator("#path-step-op1").click();
    await page
      .getByRole("tab", { name: "接口 1 次 · 1 条", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "登录请求", exact: true }).waitFor();
    await page.locator("#path-step-op2").click();
    await page
      .getByRole("button", { name: "显示全部证据", exact: true })
      .click();
    await page
      .getByRole("tab", { name: "接口 2 次 · 2 条", exact: true })
      .waitFor();
    await page.getByRole("tab", { name: "风险 1", exact: true }).click();
    await page.getByRole("button", { name: "定位证据", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page
      .getByRole("tab", { name: "接口 1 次 · 1 条", exact: true })
      .waitFor();
    await page
      .getByRole("heading", { name: "刷新设备", exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "登录请求", exact: true }).count(),
      0,
    );
    await page
      .getByRole("button", { name: "设备故障请求", exact: true })
      .waitFor();
    await page
      .getByRole("tab", { name: "接口 1 次 · 1 条", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(output, "selected-step-evidence.png"),
    });
    await page
      .getByRole("button", { name: "查看全部步骤", exact: true })
      .click();
    await page
      .getByRole("tab", { name: "接口 2 次 · 2 条", exact: true })
      .waitFor();
  });
  await test("已完成记录不频繁全量重载，回到窗口后可获取外部更新", async (page) => {
    await page.goto(`${base}/#record/done/network`);
    await page.getByRole("button", { name: "体检结果", exact: true }).waitFor();
    const reads = detailReads.get("done")!;
    await page.waitForTimeout(4200);
    assert.equal(
      detailReads.get("done"),
      reads,
      "静态记录不随原1.8秒定时器反复下载与重算",
    );
    runs[0].name = "外部更新后的记录";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page
      .getByRole("heading", { name: "外部更新后的记录", exact: true })
      .waitFor();
  });
  await test("已完成记录启动AI后恢复实时进度，结束后停止频繁重载", async (page) => {
    await page.goto(`${base}/#record/done/network`);
    await page.getByRole("button", { name: "体检结果", exact: true }).waitFor();
    assert.equal(
      await page
        .locator(".inspection-result-trigger")
        .evaluate((el) => getComputedStyle(el, "::before").animationName),
      "none",
    );
    await page
      .getByRole("button", { name: "AI 分析本次体检", exact: true })
      .click();
    await page.getByRole("progressbar").waitFor();
    await page.getByRole("button", { name: "体检结果", exact: true }).waitFor();
    runs[0].analysis.progress!.completed = 2;
    await page.waitForFunction(
      () =>
        document
          .querySelector('[role="progressbar"]')
          ?.getAttribute("aria-valuenow") === "2",
    );
    runs[0].analysis.status = "COMPLETED";
    await page
      .getByRole("heading", {
        name: "分析已完成，查看本次体检结论",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("button", { name: "体检结果（AI分析完成）", exact: true })
      .waitFor();
    await page.mouse.move(0, 0);
    const analysisButton = page.locator(".analysis-trigger");
    await page.getByRole("button", { name: "分析完成", exact: true }).waitFor();
    const completedWidth = (await analysisButton.boundingBox())!.width;
    await analysisButton.hover();
    await page.getByRole("button", { name: "再次分析", exact: true }).waitFor();
    assert.equal((await analysisButton.boundingBox())!.width, completedWidth);
    await page.mouse.move(0, 0);
    await page.getByRole("button", { name: "分析完成", exact: true }).waitFor();
    await analysisButton.press("Tab");
    await page.locator(".inspection-result-trigger").press("Shift+Tab");
    await page.getByRole("button", { name: "再次分析", exact: true }).waitFor();
    await analysisButton.press("Tab");
    await page.getByRole("button", { name: "分析完成", exact: true }).waitFor();
    assert.notEqual(
      await page
        .locator(".inspection-result-trigger")
        .evaluate((el) => getComputedStyle(el, "::before").animationName),
      "none",
    );
    await page.setViewportSize({ width: 304, height: 844 });
    const entry = page.locator(".inspection-result-trigger");
    const entryBounds = await entry.boundingBox();
    assert(
      entryBounds &&
        entryBounds.x >= 0 &&
        entryBounds.x + entryBounds.width <= 304,
      "完成状态长标签在窄窗口内保持完整",
    );
    await entry.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(output, "report-entry-completed-mobile.png"),
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await entry.evaluate(
        (el) => getComputedStyle(el, "::before").animationName,
      ),
      "none",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const reads = detailReads.get("done")!;
    await page.waitForTimeout(4200);
    assert.equal(detailReads.get("done"), reads);
    await analysisButton.hover();
    await page.getByRole("button", { name: "再次分析", exact: true }).click();
    await page.getByRole("progressbar").waitFor();
    assert.equal(
      await page.getByRole("button", { name: "正在分析", exact: true }).isDisabled(),
      true,
    );
  });
  await test("分析运行中展示真实进度和动画，禁止重复分析", async (page) => {
    runs[0].analysis = {
      status: "RUNNING",
      findings: [],
      progress: {
        phase: "batches",
        completed: 1,
        total: 3,
        processedRecords: 8,
        totalRecords: 20,
        resumed: false,
      },
    };
    await page.goto(`${base}/#record/done`);
    await page.getByText("正在分析执行证据", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "正在分析", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page.getByRole("progressbar").getAttribute("aria-valuenow"),
      "1",
    );
    assert.equal(await page.locator(".analysis-wave i").count(), 24);
    assert.equal(
      await page
        .locator(".analysis-wave i")
        .first()
        .evaluate((el) => getComputedStyle(el).animationName),
      "intelligence-bars",
    );
    await page.getByRole("button", { name: "停止分析", exact: true }).waitFor();
  });
  await test("体检结果章节定位、风险统计、下载入口和证据返回", async (page) => {
    runs[0].analysis = {
      status: "COMPLETED",
      evidenceVersion: EVIDENCE_VERSION,
      findings: [{ ...finding, source: "ai" }],
      summary: "本次存在设备接口风险",
      conclusion: "优先修复设备查询",
      provider: "Custom",
      model: "mock",
      generatedAt: now,
    };
    await page.goto(`${base}/#record/done`);
    await page
      .getByRole("button", { name: "体检结果（AI分析完成）", exact: true })
      .click();
    await page.waitForURL(`${base}/#record/done/result`);
    await page
      .getByRole("heading", { name: "体检结果", exact: true })
      .waitFor();
    assert.equal(await page.getByRole("tab").count(), 0);
    assert.equal(
      await page
        .getByRole("link", { name: "导出用例", exact: true })
        .getAttribute("href"),
      "/api/runs/done/cases.xlsx",
    );
    await page
      .getByRole("button", { name: "下载体检报告", exact: true })
      .waitFor();
    assert.equal(
      await page
        .locator("[data-severity=high] .risk-overview-count")
        .textContent(),
      "1项",
    );
    await page
      .getByRole("navigation", { name: "报告章节导航" })
      .getByRole("button", { name: "4.3.1 高风险", exact: true })
      .click();
    await page.waitForFunction(() => {
      const el = Array.from(document.querySelectorAll(".result-heading")).find(
        (e) => e.textContent === "4.3.1 高风险",
      );
      return (
        !!el &&
        el.getBoundingClientRect().top > 80 &&
        el.getBoundingClientRect().top < 150
      );
    });
    assert.equal(
      await page
        .locator(".result-document")
        .evaluate((el) => getComputedStyle(el).fontFamily.includes("SimSun")),
      true,
    );
    await page.getByRole("button", { name: "定位证据", exact: true }).click();
    await page.waitForURL(`${base}/#record/done/screen`);
    await page.getByRole("tab", { name: "画面", exact: true }).waitFor();
    await page.goBack();
    await page.waitForURL(`${base}/#record/done/result`);
    await page.reload();
    await page
      .getByRole("heading", { name: "体检结果", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "下载体检报告", exact: true })
      .click();
    await page.getByText("报告暂时生成失败，请重试", { exact: true }).waitFor();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "下载体检报告", exact: true })
      .click();
    assert((await download).suggestedFilename().endsWith(".docx"));
    const casesDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: "导出用例", exact: true }).click();
    assert((await casesDownload).suggestedFilename().endsWith(".xlsx"));
    await page.screenshot({
      path: resolve(output, "result-desktop.png"),
      fullPage: false,
    });
  });
  for (const current of [false, true])
    await test(`${current ? "新版" : "历史"}AI详细报告保留具体标题、完整诊断和准确计数`, async (page) => {
      runs[0] = reportDetailFixture(current);
      await page.goto(`${base}/#record/done/result`);
      await page
        .getByText(current ? "分析已完成" : "历史AI分析（已按现有证据复核）", {
          exact: true,
        })
        .waitFor();
      await page
        .getByRole("heading", {
          name: "4.3.1.1 点击采掘工程平面图时接口返回业务失败并触发未捕获异常",
          exact: true,
        })
        .waitFor();
      const content = await page.locator(".result-document").innerText();
      assert(content.includes("第42、43、44步"));
      assert(content.includes("3次调用，3条证据"));
      assert(content.includes("HTTP 200"));
      assert(content.includes("uniqueCode=1644990245790396418"));
      assert(content.includes("点击鲍店煤矿 → 点击采掘工程平面图"));
      assert(content.includes("前端增加.catch或try-catch"));
      assert(!content.includes("无证据全站白屏"));
      await page
        .getByRole("navigation", { name: "报告章节导航" })
        .getByRole("button", { name: "4.3.1 高风险", exact: true })
        .click();
      await page.screenshot({
        path: resolve(
          output,
          `${current ? "current" : "legacy"}-report-detail.png`,
        ),
      });
    });
  await test("窄窗口详细问题标题可阅读，操作按钮不会挤成竖排", async (page) => {
    runs[0] = reportDetailFixture(true);
    for (const width of [304, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${base}/#record/done/result`);
      const title = page.locator('.result-heading[data-level="4"] h5').first();
      await title.waitFor();
      const rect = await title.boundingBox();
      assert(
        rect && rect.width > 180 && rect.height < 200,
        "长标题应正常横向换行，不能被按钮挤成逐字竖排",
      );
      assert(
        await page
          .getByRole("button", { name: "定位证据", exact: true })
          .isVisible(),
      );
      assert(
        await page
          .getByRole("button", { name: "修改问题归属", exact: true })
          .isVisible(),
      );
      await title.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(output, `report-detail-width-${width}.png`),
      });
    }
  });
  await test("历史AI明确提示重新分析，风险与报告不展示旧猜测", async (page) => {
    runs[0].analysis = {
      status: "COMPLETED",
      findings: [
        {
          ...finding,
          id: "legacy-only",
          source: "ai",
          title: "旧AI推断全站白屏",
          category: "usability",
        },
      ],
      summary: "旧AI推断全站白屏",
      conclusion: "旧AI推断全站白屏",
    };
    await page.goto(`${base}/#record/done`);
    await page
      .getByRole("heading", { name: "历史AI分析需要更新", exact: true })
      .waitFor();
    await page.getByRole("tab", { name: "风险 1", exact: true }).click();
    assert.equal(
      await page.getByText("旧AI推断全站白屏", { exact: true }).count(),
      0,
    );
    await page
      .getByRole("button", { name: "体检结果（AI分析完成）", exact: true })
      .click();
    await page
      .getByText("基础规则报告（历史AI待重新分析）", { exact: true })
      .waitFor();
    assert.equal(
      await page.getByText("旧AI推断全站白屏", { exact: true }).count(),
      0,
    );
    await page.screenshot({ path: resolve(output, "legacy-analysis.png") });
  });
  await test("结果页移动端无横向溢出，未完成分析有返回入口", async (page) => {
    runs[0].analysis = {
      status: "COMPLETED",
      findings: [],
      summary: "未发现风险",
      model: "mock",
    };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/#record/done/result`);
    await page
      .getByRole("heading", { name: "体检结果", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: resolve(output, "result-mobile.png"),
      fullPage: false,
    });
    runs[0].analysis.status = "FAILED";
    await page.reload();
    await page
      .getByText("基础规则报告（AI 分析未完成）", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "返回执行证据", exact: true })
      .click();
    await page.waitForURL(`${base}/#record/done/report`);
  });
  await test("无AI基础报告与人工问题归属保存", async (page) => {
    runs[0].analysis = { status: "NONE", findings: [] };
    await page.goto(`${base}/#record/done/result`);
    await page.getByText("基础规则报告", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "修改问题归属", exact: true })
      .first()
      .click();
    await page.getByRole("checkbox", { name: "前端", exact: true }).check();
    await page.getByRole("checkbox", { name: "后端", exact: true }).check();
    await page.getByRole("button", { name: "保存归属", exact: true }).click();
    await page
      .getByText("问题归属：前端、后端（人工确认）", { exact: true })
      .waitFor();
    await page.reload();
    await page
      .getByText("问题归属：前端、后端（人工确认）", { exact: true })
      .waitFor();
  });
  await test("流程非法定位器不能切换，依赖错误不能保存", async (page) => {
    await page.goto(`${base}/#flows`);
    await page.getByRole("button", { name: "编辑流程", exact: true }).click();
    await page
      .getByRole("textbox", { name: "元素定位器候选", exact: true })
      .fill("{");
    await page
      .getByRole("button", { name: "2. 检查结果 查询", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("textbox", { name: "步骤描述", exact: true })
        .inputValue(),
      "查询设备",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "保存为 v2", exact: true })
        .isEnabled(),
      false,
    );
    await page
      .getByRole("textbox", { name: "元素定位器候选", exact: true })
      .fill("[]");
    await page
      .getByRole("button", { name: "下移步骤", exact: true })
      .first()
      .click();
    await page.getByRole("alert").filter({ hasText: "依赖必须位于" }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "保存为 v2", exact: true })
        .isEnabled(),
      false,
    );
  });
  await test("保存模型期间锁定输入，避免后输入的内容被关闭丢失", async (page) => {
    delaySave = true;
    await page.goto(`${base}/#settings`);
    await page
      .getByRole("button", { name: "编辑测试模型", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "配置名称", exact: true })
      .fill("正在保存的名称");
    await page
      .getByRole("button", { name: "保存模型配置", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("textbox", { name: "配置名称", exact: true })
        .isEnabled(),
      false,
    );
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  });
  await test("保存流程期间锁定输入和步骤入口", async (page) => {
    delaySave = true;
    await page.goto(`${base}/#flows`);
    await page.getByRole("button", { name: "编辑流程", exact: true }).click();
    await page
      .getByRole("textbox", { name: "流程名称", exact: true })
      .fill("保存中流程");
    await page.getByRole("button", { name: "保存为 v2", exact: true }).click();
    assert.equal(
      await page
        .getByRole("textbox", { name: "流程名称", exact: true })
        .isEnabled(),
      false,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "文本断言", exact: true })
        .isEnabled(),
      false,
    );
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  });
  await test("手工入口导航保存为主动导航，能够恢复相同地址的页面", async (page) => {
    await page.goto(`${base}/#flows`);
    await page.getByRole("button", { name: "编辑流程", exact: true }).click();
    await page.getByRole("button", { name: "入口导航", exact: true }).click();
    await page.getByRole("button", { name: "保存为 v2", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(flow.operations.at(-1)?.navigationMode, "navigate");
  });
  await test("归档详情返回保留筛选与分页设置", async (page) => {
    await page.goto(`${base}/#archive`);
    await page
      .getByRole("textbox", { name: "搜索体检记录", exact: true })
      .fill("归档");
    await page.getByRole("button", { name: "归档记录", exact: true }).click();
    await page
      .getByRole("navigation", { name: "面包屑" })
      .getByRole("link", { name: "已归档记录", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "搜索体检记录", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("textbox", { name: "搜索体检记录", exact: true })
        .inputValue(),
      "归档",
    );
    assert.equal(
      await page
        .getByRole("combobox", { name: "每页条数", exact: true })
        .count(),
      1,
    );
  });
  await test("缺失记录和未知路由提供恢复入口", async (page) => {
    await page.goto(`${base}/#record/missing`);
    await page.getByText("记录读取失败", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "重新读取", exact: true }).count(),
      1,
    );
    await page.goto(`${base}/#unknown`);
    await page.getByText("找不到这个页面", { exact: true }).waitFor();
    await page.getByRole("button", { name: "返回首页", exact: true }).click();
    await page.waitForURL(`${base}/#overview`);
  });
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  writeFileSync(
    resolve(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(`结果与截图：${output}`);
}
if (results.some((r) => !r.pass)) process.exitCode = 1;
