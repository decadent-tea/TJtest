import assert from "node:assert/strict";
import type { Run, Operation, NetworkCall } from "../shared/types";
import { finalizeReport } from "../server/report";
import { reportContent } from "../shared/report-content";
import { caseView } from "../server/case-view";
import { groundFinding } from "../server/evidence-grounding";
import {
  finalFindings,
  analysisNarrative,
  analysisConclusion,
} from "../server/evidence-quality";
import {
  evidenceCoverage,
  operationEvidence,
  requestStats,
  EVIDENCE_VERSION,
} from "../shared/inspection-evidence";

const timestamp = "2026-10-13T01:00:00Z";
const operation = (sequence: number, module = "人员"): Operation => ({
  id: `step-${sequence}`,
  sequence,
  pageId: "page",
  framePath: [],
  timestamp,
  kind: "click",
  label: "查询",
  module,
  scene: module,
  url: "http://fixture.test",
  locators: [],
  status: "RECORDED",
  dependsOn: [],
  timeout: 1000,
  effect: "read",
  enabled: true,
});
const base = (): Run => ({
  id: "product-evidence-fixture",
  name: "产品证据夹具",
  project: "夹具",
  environment: "内存测试",
  url: "http://fixture.test",
  mode: "record",
  status: "COMPLETED",
  startedAt: timestamp,
  scene: "",
  archived: false,
  operations: [],
  requests: [],
  logs: [],
  notes: [],
  findings: [],
  cases: [],
  analysis: { status: "NONE", findings: [] },
});
const request = (
  id: string,
  op: Operation,
  patch: Partial<NetworkCall> = {},
): NetworkCall => ({
  id,
  pageId: op.pageId,
  stepId: op.id,
  startedAt: timestamp,
  method: "GET",
  url: "http://fixture.test/api/query",
  resourceType: "fetch",
  requestHeaders: {},
  status: 200,
  duration: 12000,
  responseBody: '{"success":true}',
  description: "查询",
  module: op.module,
  category: "business",
  confidence: 0.65,
  ...patch,
});

const slow = base();
slow.operations = [operation(1), operation(2, "设备")];
slow.requests = [
  request("r1", slow.operations[0]),
  request("r2", slow.operations[1], { method: "POST" }),
  request("r3", slow.operations[0], { method: "POST" }),
  request("r4", slow.operations[0], {
    method: "POST",
    requestBody: '{"operationName":"login"}',
  }),
  request("r5", slow.operations[0], {
    method: "POST",
    requestBody: '{"operationName":"logout"}',
  }),
  request("r6", slow.operations[0]),
];
finalizeReport(slow);
assert.equal(slow.findings.length, 5, "慢接口按模块、方法和 RPC 语义分别归并");
assert.deepEqual(
  slow.findings.find((f) => f.evidenceIds.includes("r1"))?.evidenceIds,
  ["r1", "r6"],
);
assert.equal(
  slow.findings.find((f) => f.evidenceIds.includes("r2"))?.module,
  "设备",
);
slow.findings[0].owners = ["operations"];
slow.findings[0].ownershipSource = "manual";
finalizeReport(slow);
assert.deepEqual(
  slow.findings[0].owners,
  ["operations"],
  "重新生成保留人工归属",
);
slow.findings = [
  { ...slow.findings[0], evidenceIds: ["r1", "r3", "r4", "r5", "r6"] },
];
finalizeReport(slow);
assert.equal(
  new Set(slow.findings.map((f) => f.id)).size,
  slow.findings.length,
  "历史过度合并问题拆分后生成唯一问题 ID",
);

const logs = base();
logs.operations = [operation(1), operation(2, "设备")];
for (const [id, stepId, location] of [
  ["l1", "step-1", "http://fixture.test/source-a.js:1:2"],
  ["l2", "step-2", "http://fixture.test/source-a.js:1:2"],
  ["l3", "step-1", "http://fixture.test/source-b.js:3:4"],
  ["l4", "step-1", "http://fixture.test/source-a.js:1:2"],
])
  logs.logs.push({
    id,
    stepId,
    location,
    pageId: "page",
    timestamp,
    level: "pageerror",
    text: "TypeError: value is undefined",
  });
finalizeReport(logs);
assert.equal(logs.findings.length, 3, "不同模块或来源的错误不混为首个模块");
assert.deepEqual(logs.findings[0].evidenceIds, ["l1", "l4"]);
assert.equal(
  reportContent(logs).filter(
    (b) => b.kind === "heading" && b.text.startsWith("4.2."),
  ).length,
  3,
);

const path = base();
path.operations = Array.from({ length: 7 }, (_, i) => operation(i + 1));
for (const op of path.operations.slice(0, 3)) {
  op.kind = "goto";
  op.label = "打开人员页";
}
path.operations[2].status = "FAILED";
path.operations[2].error = "加载失败";
for (const op of path.operations.slice(3, 6)) {
  op.kind = "hover";
  op.label = "鼠标悬浮 · 查询";
}
path.logs.push({
  id: "hover-error",
  pageId: "page",
  stepId: "step-6",
  timestamp,
  level: "error",
  text: "悬浮回调失败",
});
path.operations[6].module = "未访问模块";
path.operations[6].status = "BLOCKED";
finalizeReport(path);
const text = reportContent(path)
  .flatMap((b) => (b.kind === "paragraph" ? [b.text] : []))
  .join("\n");
assert(text.includes("第1—2步（2次跳转）"));
assert(text.includes("第3步：打开人员页〔执行失败〕"));
assert(text.includes("第4—5步（2次悬浮）"));
assert(text.includes("第6步：鼠标悬浮"), "异常悬浮单独显示真实步骤编号");
const modules = reportContent(path).find(
  (b) => b.kind === "paragraph" && b.text.startsWith("实际访问模块："),
);
assert(modules?.kind === "paragraph" && !modules.text.includes("未访问模块"));

const unknown = base();
unknown.operations = [operation(1)];
finalizeReport(unknown);
assert.equal(unknown.cases[0].status, "RECORDED");
assert(
  caseView(unknown, unknown.cases[0]).solution.includes("AI 分析不会替代断言"),
);
assert.equal(
  operationEvidence(unknown, unknown.operations[0]).state,
  "missing",
);
assert(caseView(unknown, unknown.cases[0]).solution.includes("先复录"));
unknown.operations[0].screenshot = "/fixture-screen.png";
finalizeReport(unknown);
assert.equal(
  operationEvidence(unknown, unknown.operations[0]).state,
  "available",
);
assert.equal(unknown.cases[0].status, "RECORDED", "截图取证不能替代结果断言");
assert(!caseView(unknown, unknown.cases[0]).solution.includes("先复录"));
unknown.requests = [
  request("partial", unknown.operations[0], {
    bodyState: "sampled",
    duration: 100,
  }),
];
finalizeReport(unknown);
assert.equal(
  operationEvidence(unknown, unknown.operations[0]).state,
  "partial",
);
assert.equal(evidenceCoverage(unknown).partialSteps, 1);
assert(caseView(unknown, unknown.cases[0]).solution.includes("缺失正文补录"));

const navigation = base();
navigation.operations = [operation(1)];
navigation.pageObservations = [
  {
    id: "page-failure",
    timestamp,
    pageId: "page",
    stepId: "step-1",
    url: "http://fixture.test/login",
    status: 503,
    kind: "navigation",
  },
];
finalizeReport(navigation);
assert.equal(requestStats(navigation).calls, 0, "导航观察不计为接口");
assert.equal(navigation.findings.length, 1);
assert.equal(finalFindings(navigation).length, 1, "导航问题保留在最终结果中");
assert.deepEqual(navigation.findings[0].owners, ["undetermined"]);
assert.equal(navigation.findings[0].category, "stability");
assert(navigation.cases[0].actual.includes("页面导航异常"));
assert(navigation.cases[0].evidenceIds.includes("page-failure"));
assert(
  caseView(navigation, navigation.cases[0]).navigation.includes("HTTP 503"),
);
assert(
  caseView(navigation, navigation.cases[0]).problem.includes("页面导航异常"),
);

const repeated = base();
repeated.operations = [operation(1), operation(2)];
repeated.requests = [
  request("http1", repeated.operations[0], { status: 500, duration: 100 }),
  request("http2", repeated.operations[1], { status: 500, duration: 100 }),
];
finalizeReport(repeated);
const repeatText = reportContent(repeated)
  .flatMap((b) => (b.kind === "paragraph" ? [b.text] : []))
  .join("\n");
assert(repeatText.includes("跨步骤汇总 2次调用"));
assert(
  repeatText.includes("第1步 1次；第2步 1次"),
  "接口报告保留重复执行分布，不将累计次数归到首步",
);
console.log(
  "产品证据验证通过：跨模块/方法/RPC 归并、人工归属保留、重复动作与请求分布、导航异常、证据缺失/受限与未做断言分别展示。",
);

const legacy = base();
legacy.operations = [operation(1)];
legacy.requests = [
  request("legacy-http", legacy.operations[0], { status: 500, duration: 100 }),
];
legacy.analysis = {
  status: "COMPLETED",
  summary: "未观察到的页面白屏和告警风暴",
  conclusion: "未观察到的页面白屏和告警风暴",
  findings: [
    {
      id: "legacy-ai",
      source: "ai",
      severity: "high",
      module: "人员",
      title: "静态瓦片资源故障",
      detail: "旧版推断",
      evidenceIds: ["step-1", "legacy-http"],
    },
  ],
  caseDescriptions: [
    { stepId: "step-1", title: "旧版未经校验的用例", expected: "旧版业务猜测" },
  ],
};
const originalLegacyAnalysis = JSON.stringify(legacy.analysis);
finalizeReport(legacy);
assert(
  finalFindings(legacy).every((finding) => finding.source === "rule"),
  "旧版AI不得混入当前风险",
);
assert.notEqual(legacy.cases[0].title, "旧版未经校验的用例");
assert.equal(
  JSON.stringify(legacy.analysis),
  originalLegacyAnalysis,
  "旧AI数据保留，不改写历史",
);
const legacyText = reportContent(legacy)
  .map((block) => JSON.stringify(block))
  .join("\n");
assert(legacyText.includes("历史AI分析未经过新版统计范围校验"));
assert(!legacyText.includes("静态瓦片资源故障"));
legacy.analysis.evidenceVersion = EVIDENCE_VERSION;
legacy.analysis.findings[0].title = "设备查询接口失败";
finalizeReport(legacy);
assert(analysisNarrative(legacy).includes("观察证据："));
assert(analysisNarrative(legacy).includes("HTTP 500"));
assert(!analysisNarrative(legacy).includes("告警风暴"));
assert(!analysisConclusion(legacy).includes("告警风暴"));
assert(analysisConclusion(legacy).includes("明确断言通过0项"));
const currentText = reportContent(legacy)
  .map((block) => JSON.stringify(block))
  .join("\n");
assert(
  !currentText.includes("未观察到的页面白屏"),
  "页面和导出结论不能直接显示旧模型扩写",
);
legacy.analysis.findings[0].deleted = true;
assert(
  !analysisNarrative(legacy).includes("设备查询接口失败"),
  "删除问题后摘要同步更新",
);
const readable = groundFinding(legacy, {
  title: "设备查询失败",
  module: "人员",
  severity: "high",
  category: "interface",
  detail: "接口500",
  evidenceIds: ["legacy-http"],
  reproductionSteps: ["1.2"],
  validationSteps: ["1.3"],
});
assert(
  readable?.reproductionSteps?.some((step) => step.includes("第1步：查询")),
);
assert(readable?.validationSteps?.[0].includes("HTTP状态和业务标记"));
assert(!readable?.validationSteps?.includes("1.3"));
legacy.analysis.findings = [{ ...readable!, id: "current-ai", source: "ai" }];
assert(
  finalFindings(legacy)
    .find((finding) => finding.source === "rule")
    ?.reproductionSteps?.some((step) => step.includes("第1步：查询")),
  "规则与AI合并后仍保留可执行复现路径",
);
console.log(
  "结果可信度通过：旧AI隔离、原始记录保留、用例描述校验、事实摘要与结论、问题删除同步。",
);
