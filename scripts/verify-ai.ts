import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import express from "express";
import type { Run, ModelProfile } from "../shared/types";

process.env.STUDIO_DATA_DIR = resolve(
  "output",
  "verification-ai",
  Date.now().toString(),
);
const { analyze } = await import("../server/ai");
const { prepareEvidence, INPUT_CHAR_BUDGET } =
  await import("../server/ai-evidence");
const { put, get, encrypt, recoverInterrupted } =
  await import("../server/store");
const { reportHtml } = await import("../server/report");
const app = express();
app.use(express.json({ limit: "1mb" }));
const successfulKeys = new Map<string, number>();
let acceptedCalls = 0;
let failOnce = true;
let capacitySplits = 0;
let outputSplits = 0;
let summaryCalls = 0;
let failSynthesis = false;
let invalidCrossBatch = false;
let rateLimitOnce = false;
app.post("/chat/completions", (req, res) => {
  assert.equal(req.get("authorization"), "Bearer long-recording-test-key");
  const text = req.body.messages[1].content;
  const bundle = JSON.parse(text);
  if (bundle.task === "management" || Array.isArray(bundle)) {
    summaryCalls++;
    if (failSynthesis) {
      res.status(401).json({ error: "test synthesis failure" });
      return;
    }
    res.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary:
                "优先处理接口错误和前端异常，按证据受限边界评价业务结果。",
              conclusion:
                "重点维护数据查询服务与前端异常处理，修复后通过自动回放验证异常消失。",
            }),
          },
          finish_reason: "stop",
        },
      ],
      usage: { total_tokens: 20 },
    });
    return;
  }
  const systemPrompt = String(req.body.messages[0].content);
  assert(systemPrompt.includes("业务流程"));
  assert(systemPrompt.includes("接口链路"));
  assert(systemPrompt.includes("observation"));
  assert(systemPrompt.includes("reproductionSteps"));
  assert(systemPrompt.includes("置信度"));
  assert(systemPrompt.includes("HTTP 2xx"));
  if (rateLimitOnce) {
    rateLimitOnce = false;
    res.status(429).json({ error: "test rate limit" });
    return;
  }
  if (text.length > 7000) {
    capacitySplits++;
    res.status(400).json({ error: "maximum context length exceeded" });
    return;
  }
  if (bundle.steps.length > 3) {
    outputSplits++;
    res.json({
      choices: [{ message: { content: "" }, finish_reason: "length" }],
    });
    return;
  }
  if (failOnce && acceptedCalls === 3) {
    failOnce = false;
    res.status(401).json({ error: "test interrupted call" });
    return;
  }
  acceptedCalls++;
  for (const [kind, values] of [
    ["step", bundle.steps],
    ["request", bundle.requests],
    ["log", bundle.logs],
  ] as const)
    for (const value of values) {
      const key = `${kind}:${value.id}`;
      successfulKeys.set(key, (successfulKeys.get(key) || 0) + 1);
    }
  const failedRequests = bundle.requests.filter(
    (r: { status: number }) => r.status >= 400,
  );
  const failedLogs = bundle.logs.filter(
    (l: { level: string }) => l.level === "error",
  );
  res.json({
    choices: [
      {
        message: {
          content: JSON.stringify({
            summary: `本批检查 ${bundle.steps.length} 个步骤、${bundle.requests.length} 个请求、${bundle.logs.length} 条日志。观察异常，不推断未经验证的通过结论。`,
            findings: [
              ...failedRequests.map((r: { id: string }) => ({
                title: "重复接口故障",
                module: "设备台账",
                severity: "high",
                category: "interface",
                confidence: "high",
                observation: "GET /api/data 接口返回 HTTP 500。",
                impact: "对应设备数据无法取得，当前操作可能无法完成。",
                reproductionSteps: ["进入设备台账", "执行数据查询"],
                possibleCause: "服务端处理异常，具体根因需结合服务日志核查。",
                suggestion: "核查后端。",
                validationSteps: ["重放查询并断言 HTTP 状态和业务码"],
                evidenceIds: [r.id],
              })),
              ...failedLogs.map((l: { id: string }) => ({
                title: "长流程尾部前端异常",
                module: "历史告警",
                severity: "medium",
                category: "frontend",
                confidence: "high",
                observation: "历史告警步骤记录到前端 error 日志。",
                impact: "当前页面功能可能局部不可用，影响范围待确认。",
                reproductionSteps: ["进入历史告警", "执行告警查询"],
                possibleCause: "可能存在未捕获的前端异常。",
                suggestion: "核查页面。",
                validationSteps: ["清空控制台后重放并确认错误不再出现"],
                evidenceIds: [l.id],
              })),
              ...(invalidCrossBatch
                ? [
                    {
                      title: "跨批伪造引用",
                      module: "验证",
                      severity: "low",
                      detail: "无依据",
                      suggestion: "核查",
                      evidenceIds: ["not-provided-by-any-batch"],
                    },
                  ]
                : []),
            ],
            caseDescriptions: bundle.steps.map(
              (s: { id: string; label: string }) => ({
                stepId: s.id,
                verdict: "limited",
                reason: "当前采集证据不足以判断完整业务结果。",
                title: `AI 用例：${s.label}`,
                expected: "业务结果应满足已配置的预期。",
              }),
            ),
          }),
        },
        finish_reason: "stop",
      },
    ],
    usage: { total_tokens: 100 },
  });
});
const server = createServer(app);
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const port = (server.address() as { port: number }).port;
const start = Date.parse("2026-09-16T00:00:00Z");
const timestamp = (index: number) =>
  new Date(start + index * 1000).toISOString();
const run: Run = {
  id: randomUUID(),
  name: "连续三小时体检验证",
  project: "矿山智能化系统",
  environment: "验证",
  url: "http://example.test",
  mode: "record",
  status: "COMPLETED",
  startedAt: timestamp(0),
  endedAt: timestamp(10800),
  scene: "历史告警",
  archived: false,
  notes: [],
  findings: [],
  cases: [],
  analysis: { status: "FAILED", error: "旧版单次限额", findings: [] },
  operations: Array.from({ length: 240 }, (_, i) => ({
    id: `step-${i}`,
    sequence: i + 1,
    pageId: "page-1",
    framePath: [],
    timestamp: timestamp(i),
    kind: "click",
    label: `业务按钮 ${i}`,
    module: i < 120 ? "设备台账" : "历史告警",
    scene: i < 120 ? "设备查询" : "告警查询",
    url: "http://example.test",
    locators: [],
    status: "RECORDED",
    dependsOn: [],
    timeout: 5000,
    effect: "read",
    enabled: true,
  })),
  requests: Array.from({ length: 330 }, (_, i) => ({
    id: i === 329 ? "tail-request" : `request-${i}`,
    pageId: "page-1",
    stepId: `step-${i % 240}`,
    startedAt: timestamp(i + 1),
    method: "GET",
    url: `http://example.test/api/data/${i}`,
    resourceType: "fetch",
    requestHeaders: {},
    status: i === 280 || i === 329 ? 500 : 200,
    responseBody: "长流程接口响应".repeat(i === 329 ? 600 : 140),
    description: `业务查询 ${i}`,
    module: "设备台账",
    category: "business",
    confidence: 0.65,
  })),
  logs: Array.from({ length: 190 }, (_, i) => ({
    id: i === 189 ? "tail-log" : `log-${i}`,
    timestamp: timestamp(i + 400),
    pageId: "page-1",
    stepId: `step-${i % 240}`,
    level: i === 189 ? "error" : "info",
    text: `日志 ${i}：` + "设备状态记录".repeat(70),
  })),
};
const profile: ModelProfile = {
  id: randomUUID(),
  name: "受控模型",
  provider: "Custom",
  baseUrl: `http://127.0.0.1:${port}`,
  model: "test",
  apiKey: encrypt("long-recording-test-key"),
  enabled: true,
  maxTokens: 4096,
  timeout: 10,
  aiSynthesis: true,
};
async function waitAnalysis(target: Run) {
  const timeout = Date.now() + 180000;
  while (get<Run>("run", target.id)?.analysis.status === "RUNNING") {
    if (Date.now() > timeout) throw new Error("AI 验证等待超时");
    await new Promise((done) => setTimeout(done, 15));
  }
}
try {
  put("model", profile);
  put("run", run);
  const prepared = prepareEvidence(run);
  const resourceRun = structuredClone(run);
  resourceRun.requests = [
    {
      ...run.requests[0],
      id: "successful-resource",
      category: "resource",
      status: 200,
    },
    {
      ...run.requests[0],
      id: "failed-resource",
      category: "resource",
      status: 404,
    },
  ];
  const resources = prepareEvidence(resourceRun);
  assert.equal(resources.coverage.omittedResources, 1);
  assert(!resources.items.some((i) => i.data.id === "successful-resource"));
  assert(resources.items.some((i) => i.data.id === "failed-resource"));
  assert(JSON.stringify(prepared.items).length > 200000);
  for (const keys of prepared.pack(profile))
    assert(JSON.stringify(prepared.bundle(keys)).length <= INPUT_CHAR_BUDGET);
  await analyze(run, profile.id);
  await waitAnalysis(run);
  assert.equal(run.analysis.status, "FAILED");
  assert((run.analysis.progress?.completed || 0) >= 3);
  assert(run.analysis.caseDescriptions!.length > 0);
  const firstJobId = run.analysis.jobId;
  const firstJob = get<{ batches: { keys: string[]; result?: unknown }[] }>(
    "analysis-job",
    firstJobId!,
  )!;
  const committed = new Map(
    firstJob.batches
      .filter((b) => b.result)
      .flatMap((b) => b.keys)
      .map((key) => [key, successfulKeys.get(key)]),
  );
  // Simulate recovery of a stopped process without starting a second background worker.
  const persisted = get<Run>("run", run.id)!;
  persisted.analysis.status = "RUNNING";
  persisted.archived = true;
  put("run", persisted);
  recoverInterrupted();
  const recovered = get<Run>("run", run.id)!;
  assert.equal(recovered.analysis.status, "FAILED");
  assert.equal(recovered.analysis.jobId, firstJobId);
  rateLimitOnce = true;
  await analyze(recovered, profile.id);
  await waitAnalysis(recovered);
  assert.equal(
    recovered.analysis.status,
    "COMPLETED",
    recovered.analysis.error,
  );
  assert.equal(recovered.analysis.jobId, firstJobId);
  assert.equal(recovered.analysis.progress?.resumed, true);
  assert.equal(
    recovered.analysis.progress?.completed,
    recovered.analysis.progress?.total,
  );
  assert.equal(
    recovered.analysis.progress?.processedRecords,
    prepared.items.length,
  );
  assert.equal(recovered.analysis.coverage?.requests, 330);
  assert.equal(recovered.analysis.coverage?.logs, 190);
  assert.equal(recovered.analysis.coverage?.steps, 240);
  assert.equal(recovered.analysis.caseDescriptions?.length, 240);
  assert(get<Run>("run", run.id)?.archived);
  for (const item of prepared.items)
    assert((successfulKeys.get(item.key) || 0) >= 1, `漏处理：${item.key}`);
  for (const [key, before] of committed)
    assert.equal(
      successfulKeys.get(key),
      before,
      `重复分析已完成检查点：${key}`,
    );
  assert.equal(successfulKeys.size, 760);
  assert(capacitySplits > 0, "未覆盖自动缩小上下文批次");
  assert(outputSplits > 0, "未覆盖自动缩小输出批次");
  assert(summaryCalls >= 1, "管理结论未生成");
  assert(
    recovered.analysis.findings.some((f) =>
      f.evidenceIds.includes("tail-request"),
    ),
  );
  assert(
    recovered.analysis.findings.some((f) => f.evidenceIds.includes("tail-log")),
  );
  const merged = recovered.analysis.findings.find(
    (f) => f.title === "重复接口故障",
  )!;
  assert.equal(merged.evidenceIds.length, 2);
  assert.equal(merged.category, "interface");
  assert.equal(merged.confidence, "high");
  assert(merged.observation?.includes("HTTP 500"));
  assert(merged.reproductionSteps?.includes("执行数据查询"));
  assert(merged.validationSteps?.some((step) => step.includes("业务码")));
  assert.equal(recovered.cases.at(-1)?.status, "PASSED");
  assert(!recovered.cases.at(-1)?.expected.includes("人工确认"));
  assert(reportHtml(recovered).includes("/api/data/329"));
  assert(reportHtml(recovered).includes("观察事实"));
  assert(reportHtml(recovered).includes("复现路径"));
  console.log(
    `长录制：${prepared.items.length} 条证据、${recovered.analysis.progress?.total} 批全部分析，无 250/150 条截断；尾部异常与全部用例保留。`,
  );
  console.log(
    "自动缩批：上下文超限与输出截断通过；限流重试、失败续传、重启检查点及去重通过。",
  );
  console.log("跨批汇总：多级 AI 汇总通过，归档与实际执行状态保持不变。");
  const groupedRun = structuredClone(run);
  groupedRun.id = randomUUID();
  groupedRun.operations = groupedRun.operations.slice(0, 2);
  groupedRun.requests = Array.from({ length: 20 }, (_, i) => ({
    ...run.requests[329],
    id: `repeat-request-${i}`,
    stepId: "step-0",
    startedAt: timestamp(i),
    responseBody: '{"code":500,"message":"故障"}',
  }));
  groupedRun.logs = Array.from({ length: 80 }, (_, i) => ({
    ...run.logs[189],
    id: `repeat-log-${i}`,
    stepId: "step-0",
    timestamp: timestamp(i),
    text: "重复的页面异常",
  }));
  groupedRun.analysis = { status: "NONE", findings: [] };
  const groupedEvidence = prepareEvidence(groupedRun);
  assert.equal(groupedEvidence.items.length, 4);
  assert.equal(groupedEvidence.rawRecords, 102);
  put("run", groupedRun);
  await analyze(groupedRun, profile.id);
  await waitAnalysis(groupedRun);
  assert.equal(
    groupedRun.analysis.status,
    "COMPLETED",
    groupedRun.analysis.error,
  );
  assert.equal(groupedRun.analysis.progress?.processedRecords, 102);
  assert.equal(
    groupedRun.analysis.findings.find((f) => f.title === "重复接口故障")
      ?.evidenceIds.length,
    20,
  );
  assert.equal(
    groupedRun.analysis.findings.find((f) => f.title === "长流程尾部前端异常")
      ?.evidenceIds.length,
    80,
  );
  const businessCodes = structuredClone(groupedRun);
  businessCodes.requests = [
    {
      ...groupedRun.requests[0],
      id: "code-ok",
      status: 200,
      responseBody: '{"code":0,"data":[{"id":1}]}',
    },
    {
      ...groupedRun.requests[0],
      id: "code-failed",
      status: 200,
      responseBody: '{"code":500,"data":[{"id":2}]}',
    },
  ];
  assert.equal(
    prepareEvidence(businessCodes).items.filter((i) => i.kind === "request")
      .length,
    2,
    "HTTP200不同业务状态不应合并",
  );
  console.log(
    "证据压缩：102 条原始证据合并为 4 项输入，异常定位扩展到全部原始 ID，业务错误码保持区分。",
  );
  // Every actual ID must also be present in the current batch, not just elsewhere in the run.
  invalidCrossBatch = true;
  const maliciousRun = structuredClone(run);
  maliciousRun.id = randomUUID();
  maliciousRun.analysis = { status: "NONE", findings: [] };
  put("run", maliciousRun);
  await analyze(maliciousRun, profile.id);
  await waitAnalysis(maliciousRun);
  assert.equal(maliciousRun.analysis.status, "COMPLETED");
  assert(
    !maliciousRun.analysis.findings.some(
      (finding) => finding.title === "跨批伪造引用",
    ),
  );
  assert(
    maliciousRun.analysis.warnings?.some((warning) =>
      warning.includes("无法由本批输入验证"),
    ),
  );
  invalidCrossBatch = false;
  failSynthesis = true;
  const fallbackRun = structuredClone(run);
  fallbackRun.id = randomUUID();
  fallbackRun.operations = fallbackRun.operations.slice(0, 8);
  fallbackRun.requests = fallbackRun.requests.slice(-2);
  fallbackRun.logs = fallbackRun.logs.slice(-2);
  fallbackRun.analysis = { status: "NONE", findings: [] };
  put("run", fallbackRun);
  await analyze(fallbackRun, profile.id);
  await waitAnalysis(fallbackRun);
  assert.equal(fallbackRun.analysis.status, "FAILED");
  assert(fallbackRun.analysis.error);
  assert(
    fallbackRun.analysis.findings.some((f) =>
      f.evidenceIds.includes("tail-request"),
    ),
  );
  assert(!fallbackRun.analysis.conclusion);
  console.log(
    "证据校验与降级：拒绝跨批伪造引用，综合摘要调用失败仍保留完整已分析明细。",
  );
} finally {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}
