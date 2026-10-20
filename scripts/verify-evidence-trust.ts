import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import express from "express";
import type { Run, Operation, NetworkCall } from "../shared/types";
import {
  requestStats,
  requestFact,
  EVIDENCE_VERSION,
  findingObservation,
} from "../shared/inspection-evidence";
import { prepareEvidence } from "../server/ai-evidence";
import { groundFinding } from "../server/evidence-grounding";
import { finalizeReport, reportHtml } from "../server/report";
import { finalFindings, finishRequest } from "../server/evidence-quality";
import { installEvidenceTrustFixture } from "./fixtures/evidence-trust";

process.env.STUDIO_DATA_DIR = resolve(
  "output",
  "verification-evidence-trust",
  randomUUID(),
);
const { startSession, stopSession, getActivePage } =
  await import("../server/recorder");
const { analyze, ANALYSIS_CONCURRENCY } = await import("../server/ai");
const { put, get, encrypt, summary } = await import("../server/store");
const base = (): Run => ({
  id: randomUUID(),
  evidenceVersion: EVIDENCE_VERSION,
  name: "可信体检",
  project: "夹具",
  environment: "独立测试",
  url: "http://fixture.test",
  mode: "record",
  status: "COMPLETED",
  startedAt: new Date().toISOString(),
  scene: "登录",
  archived: false,
  operations: [],
  requests: [],
  logs: [],
  notes: [],
  findings: [],
  cases: [],
  analysis: { status: "NONE", findings: [] },
});
const op = (sequence: number): Operation => ({
  id: `step-${sequence}`,
  sequence,
  pageId: "page",
  framePath: [],
  timestamp: new Date(Date.now() + sequence * 1000).toISOString(),
  kind: "click",
  label: "点击登录",
  module: "登录",
  scene: "登录",
  url: "http://fixture.test",
  locators: [],
  status: "EXECUTED",
  dependsOn: [],
  timeout: 1000,
  effect: "read",
  enabled: true,
});
const req = (
  id: number,
  step: Operation,
  patch: Partial<NetworkCall> = {},
): NetworkCall => ({
  id: `request-${id}`,
  pageId: step.pageId,
  stepId: step.id,
  startedAt: step.timestamp,
  method: "GET",
  url: "http://fixture.test/api/captcha",
  resourceType: "fetch",
  requestHeaders: {},
  status: 200,
  duration: 100,
  responseBody: '{"success":true,"code":200}',
  module: "登录",
  description: "验证码",
  category: "business",
  confidence: 0.65,
  association: "time-candidate",
  ...patch,
});

const distributed = base();
const distribution = [
  [23, 1],
  [24, 1],
  [134, 2],
  [407, 1],
  [408, 1],
  [486, 1],
  [487, 1],
  [553, 2],
  [625, 2],
  [634, 1],
  [635, 1],
];
for (const [sequence, count] of distribution) {
  const operation = op(sequence);
  distributed.operations.push(operation);
  for (let i = 0; i < count; i++)
    distributed.requests.push(req(distributed.requests.length, operation));
}
const prepared = prepareEvidence(distributed);
const fact = requestFact(distributed, distributed.requests, "test");
assert.equal(fact.calls, 14);
assert.equal(fact.perStepCounts.length, 11);
assert.equal(fact.perStepCounts.find((s) => s.sequence === 23)?.calls, 1);
assert.equal(fact.perStepCounts.find((s) => s.sequence === 24)?.calls, 1);
assert(
  prepared.items
    .filter((i) => i.kind === "request")
    .every((i) => i.data.scope === "run" && i.data.stepId === undefined),
);
const falseFinding = {
  title: "登录接口重复提交14次",
  severity: "medium" as const,
  module: "登录",
  detail: "第23步调用10次",
  observation: "第23步调用10次",
  evidenceIds: distributed.requests.map((r) => r.id),
  owners: ["backend" as const],
};
const repetitionCandidate = groundFinding(distributed, falseFinding)!;
assert.equal(repetitionCandidate.confidence, "low");
assert(
  !repetitionCandidate.title.includes("重复提交"),
  "跨多个人工操作的总次数不能生成重复提交缺陷",
);
assert(repetitionCandidate.observation.includes("第23步 1次"));
assert(
  repetitionCandidate.observation.includes("第134步 2次"),
  "某步真实多请求线索不能因跨步骤汇总而丢失",
);
assert.equal(
  groundFinding(distributed, {
    ...falseFinding,
    title: "验证码调用观察",
  }),
  undefined,
  "正常调用统计本身不是风险，只有符合规则的多请求线索才进入问题集",
);
assert(!repetitionCandidate.detail.includes("第23步调用10次"));
const one = base();
one.operations = [op(1)];
one.requests = Array.from({ length: 14 }, (_, i) =>
  req(i, one.operations[0], {
    url:
      i === 0
        ? "http://fixture.test/api/login"
        : `http://fixture.test/api/data/${i}`,
  }),
);
assert.equal(requestStats(one).calls, 14);
assert.equal(requestStats(one).endpoints, 14);
assert.equal(requestFact(one, [one.requests[0]], "login").calls, 1);
assert.equal(
  groundFinding(one, {
    ...falseFinding,
    evidenceIds: one.requests.map((r) => r.id),
  }),
  undefined,
  "不同端点的关联总数不能成为重复调用缺陷",
);
const duplicate = base();
duplicate.operations = [op(1)];
for (let i = 0; i < 14; i++) {
  const r = req(i, duplicate.operations[0]);
  duplicate.requests.push(r);
  finishRequest(duplicate, r);
}
assert.equal(duplicate.requests.length, 1);
assert.equal(requestStats(duplicate).calls, 14);
assert.equal(requestStats(duplicate).endpoints, 1);
const gateway = base();
gateway.operations = [op(1)];
gateway.requests = [
  req(1, gateway.operations[0], {
    url: "http://fixture.test/rpc?operation=login",
  }),
  req(2, gateway.operations[0], {
    url: "http://fixture.test/rpc?operation=logout",
  }),
];
assert.equal(prepareEvidence(gateway).coverage.requestRepresentatives, 2);
const noise = base();
noise.operations = Array.from({ length: 100 }, (_, i) => ({
  ...op(i),
  kind: "hover" as const,
}));
const compressed = prepareEvidence(noise);
assert.equal(noise.operations.length, 100);
assert.equal(compressed.coverage.compactedSteps, 100);
assert.equal(compressed.coverage.selectedSteps, 0);
assert(compressed.items.length < 100);
const failed = base();
failed.operations = [op(1)];
failed.requests = [req(1, failed.operations[0], { status: 500 })];
failed.analysis = {
  status: "COMPLETED",
  evidenceVersion: 2,
  findings: [],
  caseDescriptions: [
    {
      stepId: "step-1",
      title: "登录",
      expected: "完成",
      verdict: "passed",
      reason: "AI说通过",
    },
  ],
};
finalizeReport(failed);
assert.equal(finalFindings(failed).length, 1);
assert.equal(failed.cases[0].status, "EXECUTED");
assert(reportHtml(failed).includes("问题归属："));
assert(reportHtml(failed).includes("后端"));
assert(reportHtml(failed).includes("暂无可判定检查"));
assert.equal(summary(duplicate).requestCount, 14);
const positive = base();
positive.operations = [
  { ...op(1), kind: "assert", value: "结果已展示", status: "PASSED" },
];
finalizeReport(positive);
assert.equal(positive.cases[0].status, "PASSED", "明确本地断言仍能判通过");

const app = express();
app.use(express.json({ limit: "2mb" }));
const calls = new Map<string, number>();
installEvidenceTrustFixture(app, calls);
let active = 0,
  peak = 0,
  rateLimit = true;
app.post("/model/chat/completions", (request, response) => {
  if (rateLimit) {
    rateLimit = false;
    response.status(429).json({ error: "test rate limit" });
    return;
  }
  active++;
  peak = Math.max(peak, active);
  const bundle = JSON.parse(request.body.messages[1].content);
  setTimeout(() => {
    active--;
    response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              findings: bundle.requests.map((r: { id: string }) => ({
                title: "接口重复提交14次",
                module: "伪造模块",
                severity: "medium",
                owners: ["backend"],
                evidenceIds: [r.id],
                observation: "单次登录14次",
                detail: "单次登录14次",
                suggestion: "检查",
              })),
              caseDescriptions: bundle.steps.map((s: { id: string }) => ({
                stepId: s.id,
                title: "关键操作",
                expected: "明确检查点",
                verdict: "passed",
                reason: "未报错所以通过",
              })),
            }),
          },
          finish_reason: "stop",
        },
      ],
      usage: { total_tokens: 10 },
    });
  }, 180);
});
const server = createServer(app);
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert(address && typeof address === "object");
const origin = `http://127.0.0.1:${address.port}`;
let browserRun: Run | undefined;
try {
  browserRun = await startSession({
    name: "录制端到端",
    project: "夹具",
    environment: "测试",
    url: origin + "/fixture/page",
    headless: true,
  });
  const page = getActivePage(browserRun.id)!;
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "完成", exact: true }).waitFor();
  await stopSession(browserRun.id);
  const retained = get<Run>("run", browserRun.id)!;
  assert.equal(calls.get("POST /login"), 1);
  assert.equal(
    retained.requests
      .filter((r) => new URL(r.url).pathname === "/fixture/login")
      .reduce((n, r) => n + (r.occurrences || 1), 0),
    1,
  );
  assert.equal(requestStats(retained).calls, 14);
  assert.equal(retained.captureStats?.apiRequests, 14);
  assert(retained.requests.every((r) => !r.url.endsWith(".js")));
  assert(retained.requests.every((r) => r.association && r.events?.length));
  assert(retained.logs.some((l) => l.text.includes("业务运行时错误保留")));
  const parallel = base();
  parallel.operations = Array.from({ length: 40 }, (_, i) => op(i + 1));
  parallel.requests = [
    req(1, parallel.operations[0], { url: "http://fixture.test/api/login" }),
  ];
  put("run", parallel);
  put("model", {
    id: "fixture-model",
    name: "本地模型",
    provider: "Custom",
    baseUrl: origin + "/model",
    model: "mock",
    apiKey: encrypt("local-key"),
    enabled: true,
    maxTokens: 512,
    timeout: 10,
    aiSynthesis: false,
  });
  await analyze(parallel, "fixture-model");
  const deadline = Date.now() + 30000;
  while (get<Run>("run", parallel.id)?.analysis.status === "RUNNING") {
    assert(Date.now() < deadline, "分析超时");
    await new Promise((done) => setTimeout(done, 25));
  }
  const result = get<Run>("run", parallel.id)!;
  assert.equal(result.analysis.status, "COMPLETED", result.analysis.error);
  assert.equal(ANALYSIS_CONCURRENCY, 7);
  assert.equal(peak, 7);
  assert(result.cases.every((c) => c.status !== "PASSED"));
  assert(
    result.analysis.findings.every(
      (f) => !f.observation?.includes("单次登录14次"),
    ),
  );
  assert.equal(
    result.analysis.progress?.completed,
    result.analysis.progress?.total,
  );
  assert.equal(requestStats(result).calls, 1);
  assert.equal(
    result.analysis.findings.length,
    0,
    "真实只有1次调用，模型声称重复14次不能形成风险",
  );
  console.log(
    "可信度专项通过：14次跨11步分布、单次登录1+其他13、单步14次、RPC语义、AI数字校验、基础报告、压缩过程动作、入口静态排除、7路并发与429重试。",
  );
} finally {
  if (browserRun && getActivePage(browserRun.id))
    await stopSession(browserRun.id);
  await new Promise<void>((done) => server.close(() => done()));
}
