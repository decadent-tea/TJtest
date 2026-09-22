import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { chromium, type Page } from "playwright";
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
function reset() {
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
app.get("/api/health", (_, res) =>
  res.json({ status: "ok", active: [] }),
);
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
  const r = runs.find((r) => r.id === req.params.id);
  r ? res.json(r) : res.status(404).json({ error: "记录不存在" });
});
app.get("/api/flows", (_, res) => res.json([flow]));
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
  await test("独立分析区与四个证据标签，移除问题中心入口", async (page) => {
    await page.goto(`${base}/#record/done`);
    await page.getByRole("region", { name: "AI 体检分析" }).waitFor();
    assert.deepEqual(await page.getByRole("tab").allTextContents(), [
      "接口 0",
      "日志 0",
      "画面",
      "风险 1",
    ]);
    assert.equal(
      await page.getByRole("button", { name: "问题中心", exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: "体检结果", exact: true }).count(),
      0,
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
      findings: [{ ...finding, source: "ai" }],
      summary: "本次存在设备接口风险",
      conclusion: "优先修复设备查询",
      provider: "Custom",
      model: "mock",
      generatedAt: now,
    };
    await page.goto(`${base}/#record/done`);
    await page.getByRole("button", { name: "体检结果", exact: true }).click();
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
    await page.getByText("体检结果尚未生成", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "返回执行证据", exact: true })
      .click();
    await page.waitForURL(`${base}/#record/done/report`);
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
