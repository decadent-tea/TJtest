import type { Finding, Operation, Run } from "../../shared/types";
import { finalizeReport } from "../../server/report";

// Minimal reproduction of the saved GIS report: three manual clicks, each with
// one business failure and two browser error channels. No external calls.
export function reportDetailFixture(current = false): Run {
  const timestamp = "2026-10-14T01:00:00.000Z";
  const module = "首页-GIS公共服务系统";
  const operation = (sequence: number, label: string): Operation => ({
    id: `detail-step-${sequence}`,
    sequence,
    pageId: "gis-page",
    framePath: [],
    timestamp,
    kind: "click",
    label,
    module,
    scene: "图纸查看",
    url: "http://fixture.test/",
    locators: [],
    status: "RECORDED",
    dependsOn: [],
    timeout: 8000,
    effect: "read",
    enabled: true,
  });
  const operations = [
    operation(37, "点击 · 鲍店煤矿"),
    ...[42, 43, 44].map((n) => operation(n, "点击 · 采掘工程平面图")),
  ];
  const requests = operations.slice(1).map((op) => ({
    id: `detail-request-${op.sequence}`,
    pageId: op.pageId,
    stepId: op.id,
    startedAt: timestamp,
    method: "GET",
    url: "http://fixture.test/api/drawinguserbind/detail?uniqueCode=1644990245790396418",
    resourceType: "xhr",
    requestHeaders: {},
    status: 200,
    duration: 200,
    description: "图纸详情",
    module,
    category: "business" as const,
    confidence: 0.65,
    responseBody: '{"code":400,"success":false,"data":{},"msg":"操作失败"}',
  }));
  const logs = operations.slice(1).flatMap((op) =>
    (["unhandledrejection", "pageerror"] as const).map((level) => ({
      id: `detail-log-${op.sequence}-${level}`,
      timestamp,
      pageId: op.pageId,
      stepId: op.id,
      level,
      text: "Error: 操作失败\n    at t.a (http://fixture.test/js/app.718e76b7.js:2:15745417)",
    })),
  );
  const finding: Finding = {
    id: "detail-ai",
    source: "ai",
    severity: "high",
    confidence: "high",
    category: "interface",
    module,
    title: "点击采掘工程平面图时接口返回业务失败并触发未捕获异常",
    detail: "图纸详情接口失败，同时出现浏览器异常。",
    evidenceIds: [...operations.slice(1), ...requests, ...logs].map(
      (item) => item.id,
    ),
    impact:
      "本次图纸详情请求未取得成功业务结果，可能影响采掘工程平面图详情的加载；页面后续交互需结合实际操作确认。",
    possibleCause:
      "可能原因：图纸绑定记录不存在或已失效、当前用户无查看权限，或后端校验拒绝。需核查uniqueCode=1644990245790396418对应记录及服务端日志确认。",
    suggestion:
      "1) 核查/api/drawinguserbind/detail接口对uniqueCode=1644990245790396418的查询和权限校验；2) 前端增加.catch或try-catch，展示明确的失败提示；3) 复测成功与失败场景，确认异常不再冒泡。",
    reproductionSteps: [
      "进入GIS公共服务系统首页（http://fixture.test/）",
      "点击鲍店煤矿",
      "点击采掘工程平面图",
      "观察网络请求和控制台",
    ],
    validationSteps: [
      "重新点击采掘工程平面图。",
      "检查业务字段success为true，或失败时有明确提示。",
      "检查控制台不再出现unhandledrejection和pageerror。",
      "确认页面可继续操作。",
    ],
  };
  const run: Run = {
    id: "done",
    name: "图纸详情体检",
    project: "GIS公共服务平台",
    environment: "隔离回归",
    url: "http://fixture.test/",
    mode: "record",
    status: "COMPLETED_WITH_ISSUES",
    startedAt: timestamp,
    endedAt: timestamp,
    scene: "图纸查看",
    archived: false,
    operations,
    requests,
    logs,
    notes: [],
    findings: [],
    cases: [],
    analysis: {
      status: "COMPLETED",
      ...(current ? { evidenceVersion: 2 } : {}),
      provider: "Custom",
      model: "mock",
      generatedAt: timestamp,
      findings: [finding],
      summary: "旧摘要中的无证据全站白屏",
      conclusion: "旧摘要中的无证据全站白屏",
    },
  };
  finalizeReport(run);
  return run;
}
