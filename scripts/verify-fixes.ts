import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Flow, Run } from "../shared/types";
import {
  finalFindings,
  riskSummary,
  isStaticAssetUrl,
} from "../server/evidence-quality";
import { reportBlocks } from "../server/report";
process.env.STUDIO_DATA_DIR = resolve(
  "output",
  "verification-fixes",
  randomUUID(),
);
const { startSession, stopSession, getActivePage, readRun } =
  await import("../server/recorder");
const { analyze } = await import("../server/ai");
const { put, encrypt } = await import("../server/store");
const { prepareEvidence } = await import("../server/ai-evidence");
let managementCalls = 0;
const server = createServer(async (req, res) => {
  if (req.url === "/chat/completions") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    const b = JSON.parse(input.messages[1].content);
    let result;
    if (b.task === "management") {
      managementCalls++;
      assert(!JSON.stringify(b).includes("RAW_RESPONSE_SENTINEL"));
      result = {
        summary: "设备接口出现局部失败，应优化异常处理。",
        conclusion:
          "存在局部接口问题，重点维护设备服务和错误降级，修复后回放查询操作。",
      };
    } else {
      assert(
        b.requests.every((r: { url: string }) => !isStaticAssetUrl(r.url)),
      );
      result = {
        summary: "证据分析完成。",
        findings: b.requests
          .filter((r: { status: number }) => r.status === 500)
          .map((r: { id: string }) => ({
            title: "设备接口局部失败",
            module: "设备",
            severity: "medium",
            category: "interface",
            detail: "接口返回500。",
            suggestion: "定位设备服务异常分支并完善降级。",
            evidenceIds: [r.id],
          })),
        caseDescriptions: b.steps.map((s: { id: string }) => ({
          stepId: s.id,
          title: "操作目标验证",
          expected: "操作后展示预期反馈",
          verdict: "limited",
          reason: "当前证据不足以确认完整业务结果。",
        })),
      };
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { content: JSON.stringify(result) },
            finish_reason: "stop",
          },
        ],
      }),
    );
    return;
  }
  if (req.url?.startsWith("/asset.JS")) {
    res.setHeader("Content-Type", "text/javascript");
    res.end("void 0");
    return;
  }
  if (req.url === "/api/fail") {
    res.statusCode = 500;
    res.end("RAW_RESPONSE_SENTINEL");
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    `<!doctype html><title>点击一致性</title><button style="display:none">区域按钮</button><button id="area" style="width:300px;height:70px;text-align:left"><span id="icon" style="display:inline-block;width:25px;height:25px">区域按钮</span></button><button id="keyboard">键盘按钮</button><p id="a">嵌套0</p><p id="b">键盘0</p><script>let a=0,b=0;document.querySelector('#icon').onclick=()=>document.querySelector('#a').textContent='嵌套'+(++a);document.querySelector('#keyboard').onclick=()=>document.querySelector('#b').textContent='键盘'+(++b);fetch('/asset.JS?v=123');fetch('/api/fail');</script>`,
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const url = "http://127.0.0.1:" + (server.address() as { port: number }).port;
put("model", {
  id: "auto",
  name: "自动测试模型",
  provider: "Custom",
  baseUrl: url,
  model: "test",
  apiKey: encrypt("test-key"),
  enabled: true,
  maxTokens: 4000,
  timeout: 10,
});
async function wait(done: () => boolean, ms = 45000) {
  const end = Date.now() + ms;
  while (!done()) {
    assert(Date.now() < end, "执行超时");
    await new Promise((r) => setTimeout(r, 50));
  }
}
let active = "";
try {
  const recorded = await startSession({
    name: "点击验证",
    project: "测试",
    environment: "本地",
    url,
    headless: true,
  });
  active = recorded.id;
  const page = getActivePage(active)!;
  await page.locator("#icon").click();
  await page.locator("#keyboard").press("Enter");
  assert.equal(await page.locator("#a").textContent(), "嵌套1");
  assert.equal(await page.locator("#b").textContent(), "键盘1");
  await stopSession(active);
  active = "";
  assert.equal(readRun(recorded.id)?.analysis.status, "NONE");
  assert.equal(managementCalls, 0, "结束录制不应自动分析");
  await analyze(readRun(recorded.id)!, "auto");
  await wait(() => readRun(recorded.id)?.analysis.status !== "RUNNING");
  const run = readRun(recorded.id)!;
  assert.equal(run.analysis.status, "COMPLETED", run.analysis.error);
  assert.equal(managementCalls, 1, "手动分析后应生成管理结论");
  assert.equal(
    run.operations.filter(
      (o) =>
        o.kind === "click" && o.locators.some((l) => l.value === "#keyboard"),
    ).length,
    0,
    "Enter合成点击不应重复录制",
  );
  const click = run.operations.find((o) => o.kind === "click")!;
  assert(
    click.clickPosition && click.clickPosition.x < 60,
    "必须保留实际局部点击位置",
  );
  assert(run.requests.every((r) => !isStaticAssetUrl(r.url)));
  assert(
    prepareEvidence(run).items.every(
      (i) => !String(i.data.url).includes("asset.JS"),
    ),
  );
  assert.equal(finalFindings(run).length, 1);
  assert.equal(finalFindings(run)[0].severity, "medium");
  assert(riskSummary(run).includes("高风险 0 项、中风险 1 项"));
  assert(run.analysis.conclusion);
  assert(run.analysis.caseDescriptions?.every((c) => c.verdict));
  const compressed = structuredClone(run);
  const fields = Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [`field${i}`, i]),
  );
  compressed.requests = [true, false].map((ok, i) => ({
    ...run.requests[0],
    id: `business-state-${i}`,
    status: 200,
    responseBody: JSON.stringify({
      ...fields,
      ok,
      message: ok ? "成功" : "业务拒绝",
    }),
  }));
  const businessEvidence = prepareEvidence(compressed).items.filter(
    (i) => i.kind === "request",
  );
  assert.equal(
    businessEvidence.length,
    2,
    "不同业务成功标记不能因结构相同而合并",
  );
  assert(
    businessEvidence.some((i) =>
      String(i.data.response).includes('"ok":false'),
    ),
    "尾部业务状态不能被正文压缩丢弃",
  );
  compressed.requests = [100, 9000].map((maxDuration, i) => ({
    ...run.requests[0],
    id: `duration-${i}`,
    duration: 100,
    maxDuration,
  }));
  assert.equal(
    prepareEvidence(compressed).items.find((i) => i.kind === "request")?.data
      .maxDuration,
    9000,
    "合并后必须保留原始最大耗时",
  );
  const blocks = reportBlocks(run);
  assert(
    blocks.some(
      (b) => b.kind === "heading" && b.level === 3 && b.text === "4.3.2 中风险",
    ),
  );
  assert(blocks.some((b) => b.kind === "heading" && b.level === 4));
  assert(!JSON.stringify(blocks).includes("需复核的操作用例"));
  const flow: Flow = {
    id: randomUUID(),
    name: "局部点击与键盘",
    project: "测试",
    url,
    version: 1,
    sourceRunId: run.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    operations: structuredClone(run.operations),
    variables: [],
  };
  flow.operations.find((o) => o.kind === "click")!.assertion = "嵌套1";
  flow.operations.find((o) => o.kind === "press")!.assertion = "键盘1";
  const replay = await startSession({
    name: "回放验证",
    project: "测试",
    environment: "本地",
    url,
    headless: true,
    flow,
  });
  active = replay.id;
  await wait(() => readRun(replay.id)?.status !== "REPLAYING");
  active = "";
  assert.equal(readRun(replay.id)?.analysis.status, "NONE", "流程执行后不应自动分析");
  assert(
    replay.operations.every((o) => ["EXECUTED", "PASSED"].includes(o.status)),
    JSON.stringify(replay.operations.filter((o) => o.status === "FAILED")),
  );
  assert.equal(
    replay.operations.find((o) => o.kind === "click")?.status,
    "PASSED",
  );
  assert.equal(
    replay.operations.find((o) => o.kind === "press")?.status,
    "PASSED",
  );
  console.log(
    "局部点击、隐藏同名按钮、Enter去重、真实效果断言、手动AI分析、统一风险集、静态入口过滤和报告层级回归通过。",
  );
} finally {
  if (active) await stopSession(active).catch(() => {});
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
