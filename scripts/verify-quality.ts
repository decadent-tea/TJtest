import assert from "node:assert/strict";
import type { Run, NetworkCall, LogEvent } from "../shared/types";
import {
  finishRequest,
  captureLog,
  detailedAnalysis,
  problemRequests,
  interfaceTotal,
  consoleTotal,
  isSuccessfulStaticAsset,
  requestProblem,
} from "../server/evidence-quality";
import { reportHtml } from "../server/report";
import { casesWorkbook } from "../server/export";
import ExcelJS from "exceljs";
import { attachmentHeader, downloadName } from "../server/download-name";

const run: Run = {
  id: "internal-run-uuid",
  name: "降噪验证",
  project: "测试项目",
  environment: "本地",
  url: "http://local.test",
  mode: "record",
  status: "COMPLETED",
  startedAt: new Date().toISOString(),
  scene: "查询",
  archived: false,
  operations: [],
  requests: [],
  logs: [],
  notes: [],
  findings: [],
  cases: [],
  analysis: { status: "NONE", findings: [] },
  captureStats: {
    requests: 0,
    logs: 0,
    filteredRequests: 0,
    filteredLogs: 0,
    mergedRequests: 0,
    mergedLogs: 0,
  },
};
const exportedName = downloadName({ ...run, project: "北斗天地", name: "矿井/设备体检" }, "cases");
assert.equal(exportedName, "北斗天地-矿井_设备体检-体检用例.xlsx");
const disposition = attachmentHeader(exportedName, "cases-test.xlsx");
assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]), exportedName);
let sequence = 0;
function request(patch: Partial<NetworkCall> = {}) {
  const r: NetworkCall = {
    id: `internal-request-${++sequence}`,
    pageId: "p",
    stepId: "step-a",
    startedAt: new Date().toISOString(),
    method: "GET",
    url: "http://local.test/api/list?page=1",
    resourceType: "fetch",
    requestHeaders: {},
    status: 200,
    responseBody: '{"success":true,"data":[1]}',
    duration: 100,
    description: "查询列表",
    module: "设备",
    category: "business",
    confidence: 1,
    ...patch,
  };
  run.captureStats!.requests++;
  run.requests.push(r);
  finishRequest(run, r);
  return r;
}
const first = request();
request({ duration: 200 });
assert.equal(run.requests.length, 1);
assert.equal(first.occurrences, 2);
assert.equal(first.maxDuration, 200);
request({ url: "http://local.test/api/list?page=2" });
request({ stepId: "step-b" });
request({ responseBody: '{"success":true,"data":[2]}' });
assert.equal(run.requests.length, 4, "参数、步骤和响应差异不可合并");
request({
  resourceType: "script",
  category: "initialization",
  url: "http://local.test/app.js",
});
request({ category: "background", url: "http://local.test/ping" });
request({ method: "OPTIONS" });
assert.equal(run.requests.length, 4);
request({ resourceType: "script", category: "resource", status: 404 });
request({ category: "background", status: 500 });
request({ failure: "net::ERR_FAILED", status: undefined });
request({ responseBody: '{"success":false,"data":null}' });
request({ duration: 11000 });
assert.equal(
  problemRequests(run).length,
  5,
  "静态失败、后台失败、网络失败、业务失败和慢请求必须保留",
);
assert.equal(
  requestProblem({
    id: "threshold-boundary",
    pageId: "p",
    startedAt: new Date().toISOString(),
    method: "GET",
    url: "http://local.test/api/boundary",
    resourceType: "fetch",
    requestHeaders: {},
    status: 200,
    duration: 10000,
    description: "阈值边界",
    module: "设备",
    category: "business",
    confidence: 1,
  }),
  undefined,
  "10000ms 不应被判定为异常，只有超过 10000ms 才进入问题接口",
);
const log: LogEvent = {
  id: "log-a",
  timestamp: new Date().toISOString(),
  pageId: "p",
  level: "error",
  text: "未捕获异常",
};
captureLog(run, { ...log, level: "debug" });
captureLog(run, log);
captureLog(run, { ...log, id: "log-b" });
captureLog(run, { ...log, id: "sse-a", level: "sse", text: "[SSE /events] update", occurrences: undefined });
captureLog(run, { ...log, id: "download-a", level: "info", text: "触发下载：report.xlsx", occurrences: undefined });
assert.equal(run.logs.length, 3);
assert.equal(run.logs[0].occurrences, 2);
assert.equal(run.captureStats!.requests, 13);
assert.equal(run.captureStats!.filteredRequests, 3);
assert.equal(interfaceTotal(run), 10, "接口总数应排除过滤的资源和后台请求");
assert.equal(run.captureStats!.mergedRequests, 1);
assert.equal(run.captureStats!.logs, 5);
assert.equal(run.captureStats!.filteredLogs, 1);
assert.equal(consoleTotal(run), 3, "Console 总数应排除 SSE 和下载事件，但保留被过滤的普通控制台消息");
const interfaceCountBeforeStaticChunk = interfaceTotal(run);
const staticChunk = request({
  url: "http://local.test/static/js/chunk.editor.js",
  resourceType: "fetch",
  category: "business",
});
assert.equal(isSuccessfulStaticAsset(staticChunk), true);
assert(!run.requests.some((item) => item.id === staticChunk.id), "成功加载的静态脚本不应作为业务接口保留");
assert.equal(interfaceTotal(run), interfaceCountBeforeStaticChunk, "动态加载的脚本不应计入接口总数");
run.analysis.findings = [{
  id: "ai-related-request",
  source: "ai",
  title: "缺少业务断言",
  module: "设备",
  severity: "low",
  category: "functional",
  detail: "操作结果缺少可观察的业务断言。",
  evidenceIds: [first.id],
}];
assert.equal(
  problemRequests(run).length,
  5,
  "AI 引用正常接口作为上下文时，不得将该接口虚构为问题接口",
);
const huge = request({
  url: "http://local.test/api/large",
  status: 500,
  responseBody: JSON.stringify({
    data: "RESPONSE_BODY_MUST_NOT_EXPORT".repeat(10000),
  }),
});
const summary = detailedAnalysis(run, "模型总览");
for (const word of [
  "存在问题的接口",
  "重要报错",
  "原因分析",
  "优化方向",
  "/api/large",
])
  assert(summary.includes(word));
const html = reportHtml(run);
assert(!html.includes("RESPONSE_BODY_MUST_NOT_EXPORT"));
assert(!html.includes(huge.id));
assert(!html.includes("page=2"));
assert(html.length < 30000);
const book = new ExcelJS.Workbook();
await book.xlsx.load(await casesWorkbook(run));
assert.equal(book.worksheets[0].getCell("A6").value, "序号");
assert.equal(book.worksheets[0].getCell("D6").value, "操作");
assert.equal(book.worksheets[0].getCell("E6").value, "接口");
assert.equal(book.worksheets[0].getCell("F6").value, "Console");
assert(!JSON.stringify(book.model).includes("RESPONSE_BODY_MUST_NOT_EXPORT"));
console.log(
  "降噪边界、计数、异常保留、详细分析、报告体积及空用例导出验证通过。",
);
