import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import express from "express";
import type { Run, Operation, NetworkCall } from "../shared/types";
import {
  EVIDENCE_VERSION,
  requestFact,
  requestStats,
  operationEvidence,
  evidenceCoverage,
} from "../shared/inspection-evidence";
import { prepareEvidence } from "../server/ai-evidence";
import { groundFinding } from "../server/evidence-grounding";
import {
  finishRequest,
  finalFindings,
  requestProblem,
} from "../server/evidence-quality";
import { finalizeReport } from "../server/report";
import { reportContent } from "../shared/report-content";

const base = (): Run => ({
  id: "audit-local",
  evidenceVersion: EVIDENCE_VERSION,
  name: "内部会议证据回归",
  project: "测试夹具",
  environment: "隔离内存",
  url: "http://fixture.test",
  mode: "record",
  status: "COMPLETED",
  startedAt: "2026-10-13T00:00:00.000Z",
  scene: "设备",
  archived: false,
  operations: [],
  requests: [],
  logs: [],
  notes: [],
  findings: [],
  cases: [],
  analysis: { status: "NONE", findings: [] },
});
const op = (sequence: number, module = "设备"): Operation => ({
  id: `step-${sequence}`,
  sequence,
  pageId: "page",
  framePath: [],
  timestamp: `2026-10-13T00:00:${String(sequence).padStart(2, "0")}.000Z`,
  kind: "click",
  label: "查询",
  module,
  scene: module,
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
  url: "http://fixture.test/api/list",
  resourceType: "fetch",
  requestHeaders: {},
  status: 200,
  duration: 100,
  responseBody: '{"success":true}',
  module: step.module,
  description: "查询数据",
  category: "business",
  confidence: 0.65,
  association: "time-candidate",
  ...patch,
});
const check = (title: string, run: () => void) => {
  try {
    run();
    console.log(`PASS ${title}`);
  } catch (error) {
    failures++;
    console.error(
      `FAIL ${title}: ${error instanceof Error ? error.message : error}`,
    );
  }
};
let failures = 0;

check("反复人工操作保持按步骤统计，正常总次数不成为重复提交缺陷", () => {
  const r = base();
  r.operations = [op(1), op(2), op(3)];
  r.requests = r.operations.map((s, i) => req(i, s));
  const f = requestFact(r, r.requests, "fact");
  assert.equal(f.calls, 3);
  assert.equal(f.scope, "run");
  assert.deepEqual(
    f.perStepCounts.map((s) => s.calls),
    [1, 1, 1],
  );
  assert.equal(
    groundFinding(r, {
      title: "接口重复提交3次",
      module: "设备",
      severity: "medium",
      detail: "重复",
      evidenceIds: r.requests.map((n) => n.id),
    }),
    undefined,
  );
});

check("跨步骤汇总保留某一步真实多请求线索，但不确证重复提交", () => {
  const r = base();
  r.operations = [op(1), op(2)];
  r.requests = [
    req(1, r.operations[0], { occurrences: 2 }),
    req(2, r.operations[1]),
  ];
  const f = groundFinding(r, {
    title: "接口重复调用",
    module: "设备",
    severity: "high",
    confidence: "high",
    category: "interface",
    detail: "重复提交",
    evidenceIds: r.requests.map((q) => q.id),
  });
  assert(f, "跨步骤代表不能抹掉某步真实的多请求线索");
  assert.equal(f.confidence, "low");
  assert(!f.title.includes("重复提交"));
  assert(f.observation?.includes("第1步 2次"));
  assert(f.observation?.includes("第2步 1次"));
});

check("一次失败请求不能被称为重复提交，错误事实保留", () => {
  const r = base();
  r.operations = [op(1)];
  r.requests = [req(1, r.operations[0], { status: 500 })];
  const value = {
    title: "登录接口重复提交14次",
    module: "设备",
    severity: "medium" as const,
    detail: "重复",
    evidenceIds: [r.requests[0].id],
  };
  const f = groundFinding(r, value);
  assert(
    !f || !/重复|冗余|频繁|高频/.test(f.title),
    "只有 1 次 HTTP500 也不能保留重复提交标题",
  );
  r.analysis.findings = [{ ...value, id: "legacy-ai", source: "ai" }];
  finalizeReport(r);
  assert(
    finalFindings(r).some((f) => f.title.includes("HTTP 500")),
    "HTTP500 事实仍保留",
  );
  assert(
    finalFindings(r).every((f) => !/重复|冗余|频繁|高频/.test(f.title)),
    "历史 AI 重复结论也需校验",
  );
});

check("慢接口按方法、模块与RPC语义区分，不能并入首个模块", () => {
  const r = base();
  r.operations = [op(1, "设备"), op(2, "报警")];
  r.requests = [
    req(1, r.operations[0], {
      url: "http://fixture.test/rpc",
      method: "POST",
      requestBody: '{"operation":"deviceList"}',
      duration: 11001,
    }),
    req(2, r.operations[1], {
      url: "http://fixture.test/rpc",
      method: "POST",
      requestBody: '{"operation":"alarmList"}',
      duration: 12001,
    }),
    req(3, r.operations[1], {
      url: "http://fixture.test/rpc",
      method: "GET",
      duration: 13001,
    }),
  ];
  finalizeReport(r);
  assert.equal(
    r.findings.length,
    3,
    "不同方法、模块、RPC操作应保留独立慢接口项",
  );
  assert(r.findings.some((f) => f.module === "报警"));
});

check("不同模块不同源位置的相同错误文本不丢失模块归属", () => {
  const r = base();
  r.operations = [op(1, "设备"), op(2, "报警")];
  r.logs = r.operations.map((s, i) => ({
    id: `log-${i}`,
    timestamp: s.timestamp,
    pageId: s.pageId,
    stepId: s.id,
    level: "error",
    text: "数据为空",
    location: `http://fixture.test/${i}.js:12`,
  }));
  finalizeReport(r);
  assert.equal(r.findings.length, 2, "不同模块/位置不能都挂在首个模块");
  assert.deepEqual(r.findings.map((f) => f.module).sort(), ["报警", "设备"]);
});

check("相同请求乱序完成仍保留完整发起时间窗口", () => {
  const r = base();
  r.operations = [op(1)];
  const rows = [0, 1, 2].map((i) =>
    req(i, r.operations[0], {
      startedAt: `2026-10-13T00:00:0${i}.000Z`,
      events: [
        {
          id: `event-${i}`,
          startedAt: `2026-10-13T00:00:0${i}.000Z`,
          pageId: "page",
          stepId: "step-1",
        },
      ],
    }),
  );
  r.requests.push(...rows);
  for (const i of [1, 2, 0]) finishRequest(r, rows[i]);
  assert.equal(r.requests.length, 1);
  assert.equal(requestStats(r).calls, 3);
  const f = requestFact(r, r.requests, "fact");
  assert.equal(f.firstSeen, rows[0].startedAt);
  assert.equal(
    f.lastSeen,
    rows[2].startedAt,
    "最终窗口必须包括 t2，不能被最后完成的 t0覆盖",
  );
});

check("无实例事件的兼容请求乱序完成也保留最早与最晚时间", () => {
  const r = base();
  r.operations = [op(1)];
  const rows = [0, 1].map((i) =>
    req(i, r.operations[0], { startedAt: `2026-10-13T00:00:0${i}.000Z` }),
  );
  r.requests.push(...rows);
  finishRequest(r, rows[1]);
  finishRequest(r, rows[0]);
  const f = requestFact(r, r.requests, "fact");
  assert.equal(f.firstSeen, rows[0].startedAt);
  assert.equal(f.lastSeen, "2026-10-13T00:00:01.000Z");
});

check("不同frame相同接口保持独立实例，不伪造成同frame重复提交", () => {
  const r = base();
  r.operations = [op(1)];
  const rows = ["frame-a", "frame-b"].map((frame, i) =>
    req(i, r.operations[0], { framePath: [frame] }),
  );
  for (const row of rows) {
    r.requests.push(row);
    finishRequest(r, row);
  }
  assert.equal(r.requests.length, 2, "录制去重必须保留frame归属");
  assert.equal(requestStats(r).calls, 2);
  assert.equal(
    groundFinding(r, {
      title: "接口重复提交",
      module: "设备",
      severity: "medium",
      detail: "重复",
      evidenceIds: rows.map((n) => n.id),
    }),
    undefined,
  );
});

check("HTTP200的明确业务失败进入本地规则，缺少断言不会改成通过", () => {
  const r = base();
  r.operations = [op(1)];
  r.requests = [
    req(1, r.operations[0], {
      responseBody: '{"success":false,"message":"依赖失败"}',
    }),
  ];
  assert(requestProblem(r.requests[0]));
  finalizeReport(r);
  assert.equal(r.findings.length, 1);
  assert.notEqual(r.cases[0].status, "PASSED");
});

check("聚合代表的别名扩展含全部真实请求且次数分布正确", () => {
  const r = base();
  r.operations = Array.from({ length: 20 }, (_, i) => op(i + 1));
  r.requests = r.operations.map((s, i) => req(i, s));
  const e = prepareEvidence(r),
    selected = e.items.filter((i) => i.kind === "request");
  assert.equal(selected.length, 2, "每组最多16条，20条需要2组");
  const expanded = selected.flatMap((i) => e.aliases.get(i.data.id) || []);
  assert.deepEqual(new Set(expanded), new Set(r.requests.map((n) => n.id)));
  assert.equal(
    [...e.facts.values()].reduce((n, f) => n + f.calls, 0),
    20,
  );
  assert(
    e.items
      .filter((i) => i.kind === "request")
      .every((i) => i.data.stepId === undefined),
  );
});

check("不可读取或未结束的响应保留限制信息，不能伪造成业务成功", () => {
  const r = base();
  r.operations = [op(1)];
  r.requests = [
    req(1, r.operations[0], {
      responseBody: undefined,
      status: undefined,
      bodyNote: "停止时请求未结束。",
    }),
  ];
  const e = prepareEvidence(r);
  assert(e.items.find((i) => i.kind === "request")?.data.bodyNote);
  assert([...e.facts.values()][0].bodyNotes.includes("停止时请求未结束。"));
  finalizeReport(r);
  assert.notEqual(r.cases[0].status, "PASSED");
});

check("导航失败的console提示作为附证，不误报成另一项前端错误", () => {
  const r = base();
  r.operations = [op(1)];
  r.pageObservations = [
    {
      id: "navigation-500",
      timestamp: r.operations[0].timestamp,
      pageId: r.operations[0].pageId,
      stepId: r.operations[0].id,
      url: "http://fixture.test/error-page",
      status: 500,
      kind: "navigation",
    },
  ];
  r.logs = [
    {
      id: "loading-error",
      timestamp: r.operations[0].timestamp,
      pageId: r.operations[0].pageId,
      stepId: r.operations[0].id,
      level: "error",
      text: "Failed to load resource: the server responded with a status of 500",
      location: "http://fixture.test/error-page:0",
    },
  ];
  finalizeReport(r);
  assert.equal(finalFindings(r).length, 1);
  assert.equal(finalFindings(r)[0].category, "stability");
  assert(finalFindings(r)[0].evidenceIds.includes("loading-error"));
  r.logs.push({
    ...r.logs[0],
    id: "runtime-error",
    level: "pageerror",
    text: "TypeError: cannot read property",
  });
  finalizeReport(r);
  assert.equal(finalFindings(r).length, 2, "独立JS运行时错误仍保留");
});

check("正常接口和操作证据不能确证高风险敏感数据泄露", () => {
  const r = base();
  r.operations = [op(1)];
  r.requests = [req(1, r.operations[0])];
  const f = groundFinding(r, {
    title: "接口泄露敏感数据",
    module: "设备",
    category: "security",
    confidence: "high",
    severity: "high",
    detail: "后台泄露身份信息",
    observation: "泄露身份证",
    evidenceIds: [r.operations[0].id, r.requests[0].id],
  });
  assert(
    !f || f.confidence === "low",
    "真实证据ID不等于证据支持确定性安全结论",
  );
});

check("HTTP500技术错误不能替代敏感数据泄露的专门证据", () => {
  const r = base();
  r.operations = [op(1)];
  r.requests = [req(1, r.operations[0], { status: 500 })];
  const f = groundFinding(r, {
    title: "接口泄露敏感数据",
    module: "设备",
    category: "security",
    confidence: "high",
    severity: "high",
    detail: "后台泄露身份信息",
    observation: "泄露身份证",
    evidenceIds: [r.requests[0].id],
  });
  assert(
    !f || f.confidence === "low",
    "500支持接口错误，不支持泄露的确定性推断",
  );
});

check("AI摘要优先保留明确业务失败标记并显式统计截断", () => {
  const r = base();
  r.operations = [op(1)];
  r.requests = [
    req(1, r.operations[0], {
      responseBody: JSON.stringify({
        data: { payload: "普通业务数据".repeat(5000) },
        success: false,
        code: "E_DEPENDENCY",
        message: "依赖返回失败",
      }),
    }),
  ];
  const e = prepareEvidence(r),
    item = e.items.find((i) => i.kind === "request")!;
  assert(String(item.data.response).includes('"success":false'));
  assert(String(item.data.response).includes("E_DEPENDENCY"));
  assert(e.coverage.truncatedFields > 0, "采样/正文裁剪必须计入覆盖限制");
  assert(
    [...e.facts.values()][0].businessStates.some((v) => v.success === false),
  );
});

check("有技术证据、部分证据、完全缺失与明确断言分别统计", () => {
  const r = base();
  r.operations = [
    op(1),
    op(2),
    op(3),
    { ...op(4), kind: "assert", value: "结果已展示", status: "PASSED" },
    { ...op(5), status: "SKIPPED" },
  ];
  r.requests = [
    req(1, r.operations[0], { completion: "complete", bodyState: "captured" }),
    req(3, r.operations[2], {
      status: 200,
      responseBody: undefined,
      completion: "pending",
      bodyState: "unavailable",
    }),
  ];
  assert.equal(
    operationEvidence(r, r.operations[0]).state,
    "available",
    "没有业务断言的完整HTTP证据仍可诊断技术问题",
  );
  assert.equal(operationEvidence(r, r.operations[1]).state, "missing");
  assert.equal(
    operationEvidence(r, r.operations[2]).state,
    "partial",
    "仅响应头200不代表完整正文已取到",
  );
  assert.equal(operationEvidence(r, r.operations[4]).state, "not-executed");
  const coverage = evidenceCoverage(r);
  assert.equal(coverage.eligibleSteps, 4);
  assert.equal(coverage.withEvidence, 3);
  assert.equal(coverage.withoutEvidence, 1);
  assert.equal(coverage.partialSteps, 1);
  assert.equal(coverage.assertedSteps, 1);
  assert.equal(coverage.pendingRequests, 1);
});

check("步骤截图保留供核查，普通悬浮截图不增加文本AI判定负荷", () => {
  const r = base();
  r.operations = [
    { ...op(1), screenshot: "/artifacts/step-1.png" },
    { ...op(2), kind: "hover", screenshot: "/artifacts/step-2.png" },
  ];
  const coverage = evidenceCoverage(r);
  assert.equal(coverage.eligibleSteps, 1);
  assert.equal(coverage.screenshotOnlySteps, 1);
  assert(operationEvidence(r, r.operations[0]).reason.includes("未读取截图"));
  const prepared = prepareEvidence(r);
  assert.equal(prepared.coverage.selectedSteps, 1);
  assert.equal(prepared.coverage.compactedSteps, 1);
});

check("触发接口异常的悬停仍属于可诊断关键操作", () => {
  const r = base();
  r.operations = [{ ...op(1), kind: "hover" }];
  r.requests = [
    req(1, r.operations[0], { status: 500, completion: "complete" }),
  ];
  const prepared = prepareEvidence(r);
  assert.equal(
    prepared.coverage.selectedSteps,
    1,
    "有异常证据的hover不能压缩成正常过程噪声",
  );
  const coverage = evidenceCoverage(r);
  assert.equal(
    coverage.eligibleSteps,
    1,
    "hover触发真实异常时也需纳入覆盖分母",
  );
  assert.equal(coverage.withEvidence, 1);
});

// Local protocol mock exercises the actual analysis validation path without a vendor model.
process.env.STUDIO_DATA_DIR = resolve(
  "output",
  "verification-audit",
  randomUUID(),
);
const { analyze } = await import("../server/ai");
const { put, get, encrypt } = await import("../server/store");
const app = express();
app.use(express.json({ limit: "2mb" }));
app.post("/model/chat/completions", (request, response) => {
  const bundle = JSON.parse(request.body.messages[1].content);
  const requestId = bundle.requests[0]?.id;
  const factId = bundle.facts[0]?.id;
  response.json({
    choices: [
      {
        message: {
          content: JSON.stringify({
            findings: [
              {
                title: "接口返回HTTP500",
                module: "设备",
                category: "interface",
                severity: "high",
                factIds: [factId],
                evidenceIds: [],
                detail: "失败",
              },
              {
                title: "接口返回HTTP500",
                module: "设备",
                category: "interface",
                severity: "high",
                factIds: ["fact:invented"],
                evidenceIds: [requestId],
                detail: "失败",
              },
              {
                title: "虚构发现",
                module: "设备",
                category: "interface",
                severity: "high",
                factIds: ["fact:invented-only"],
                evidenceIds: ["invented-evidence"],
                detail: "无证据",
              },
            ],
            caseDescriptions: bundle.steps.map((s: { id: string }) => ({
              stepId: s.id,
              title: "查询",
              expected: "采集执行结果",
              verdict: "limited",
              reason: "没有已验证断言",
            })),
          }),
        },
        finish_reason: "stop",
      },
    ],
    usage: { total_tokens: 10 },
  });
});
const server = createServer(app);
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert(address && typeof address === "object");
try {
  const r = base();
  r.id = randomUUID();
  r.operations = [op(1)];
  r.requests = [req(1, r.operations[0], { status: 500 })];
  put("run", r);
  put("model", {
    id: "audit-mock",
    name: "隔离协议夹具",
    provider: "Custom",
    baseUrl: `http://127.0.0.1:${address.port}/model`,
    model: "mock",
    apiKey: encrypt("local-fixture"),
    enabled: true,
    maxTokens: 2048,
    timeout: 10,
    aiSynthesis: false,
  });
  await analyze(r, "audit-mock");
  const deadline = Date.now() + 15000;
  while (get<Run>("run", r.id)?.analysis.status === "RUNNING") {
    assert(Date.now() < deadline, "本地协议回归超时");
    await new Promise((done) => setTimeout(done, 25));
  }
  const result = get<Run>("run", r.id)!;
  check(
    "AI facts与evidence引用按本批校验，无效facts不保留且warning不为负数",
    () => {
      assert.equal(result.analysis.status, "COMPLETED", result.analysis.error);
      assert(
        result.analysis.findings.length > 0,
        "有效fact-only引用必须保留真实失败事实",
      );
      assert(
        result.analysis.findings.every(
          (f) => !f.factIds?.some((id) => id.includes("invented")),
        ),
        "无效factIds不应残留在最终发现",
      );
      assert(!result.analysis.findings.some((f) => f.title === "虚构发现"));
      assert(
        !(result.analysis.warnings || []).some((s) => /忽略\s*-\d/.test(s)),
        "校验warning不能出现负数引用数量",
      );
      assert(
        (result.analysis.warnings || []).some((s) => /忽略\s*3\s*个/.test(s)),
        "1个无效fact及2个虚构引用均应计数，不与fact-only正确引用抵消",
      );
    },
  );
  for (const status of [200, 403]) {
    const run = base();
    run.id = randomUUID();
    run.operations = [op(1)];
    run.requests = [
      req(1, run.operations[0], {
        status,
        responseBody: JSON.stringify({ success: status === 200 }),
      }),
    ];
    put("run", run);
    await analyze(run, "audit-mock");
    const deadline = Date.now() + 15000;
    while (get<Run>("run", run.id)?.analysis.status === "RUNNING") {
      assert(Date.now() < deadline, "误报校验回归超时");
      await new Promise((done) => setTimeout(done, 25));
    }
    const result = get<Run>("run", run.id)!;
    check(`HTTP${status}不能经模型真实引用伪造为HTTP500`, () => {
      assert.equal(result.analysis.status, "COMPLETED", result.analysis.error);
      assert.equal(
        result.analysis.findings.length,
        0,
        "拒绝持久化错误模型发现",
      );
      const findings = finalFindings(result);
      assert.equal(findings.length, status === 200 ? 0 : 1);
      assert(findings.every((finding) => finding.source === "rule"));
      assert(
        !/HTTP\s*500/i.test(JSON.stringify(reportContent(result))),
        "错误状态不进入网页及导出报告",
      );
      assert(!/HTTP\s*500/i.test(result.analysis.summary || ""));
      assert(!/HTTP\s*500/i.test(result.analysis.conclusion || ""));
      assert(result.cases.every((item) => item.status !== "PASSED"));
    });
  }
} finally {
  await new Promise<void>((done) => server.close(() => done()));
}

if (failures) {
  console.error(`内部会议回归未通过：${failures} 项`);
  process.exitCode = 1;
} else
  console.log("内部会议证据回归全部通过（隔离内存，无真实数据库、外部模型）。");
