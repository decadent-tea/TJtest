import { finalFindings } from "./evidence-quality";
import type { Finding, Run, TestCase } from "../shared/types";
import {
  operationEvidence,
  isExcludedRequest,
  isExcludedResourceLog,
  feedbackText,
} from "../shared/inspection-evidence";
import {
  countOf,
  endpoint,
  importantLog,
  isConsoleLog,
  requestProblem,
  causeAdvice,
  statusLabel,
} from "./evidence-quality";

export function caseView(
  run: Run,
  testCase: TestCase,
  allFindings: Finding[] = finalFindings(run),
) {
  const ids = new Set(testCase.evidenceIds);
  const operations = run.operations.filter((item) => ids.has(item.id));
  const requests = run.requests.filter(
    (item) => ids.has(item.id) && !isExcludedRequest(item),
  );
  const logs = run.logs.filter(
    (item) =>
      ids.has(item.id) && isConsoleLog(item) && !isExcludedResourceLog(item),
  );
  const pageObservations = (run.pageObservations || []).filter((item) =>
    ids.has(item.id),
  );
  const feedback = (run.feedback || []).filter((item) => ids.has(item.id));
  const evidence = operations.map((op) => operationEvidence(run, op));
  const findings = allFindings.filter(
    (item) => !item.deleted && item.evidenceIds.some((id) => ids.has(id)),
  );
  const problems = [
    ...(testCase.status === "BLOCKED"
      ? ["步骤受前置失败影响，未完成验证。"]
      : []),
    ...(testCase.status === "SKIPPED" ? ["步骤被跳过，未形成执行结果。"] : []),
    ...operations.flatMap((item) =>
      item.error ? [`操作失败：${item.error}`] : [],
    ),
    ...requests.flatMap((item) =>
      requestProblem(item)
        ? [`${item.method} ${endpoint(item.url)}：${requestProblem(item)}`]
        : [],
    ),
    ...logs
      .filter(importantLog)
      .map((item) => `Console ${item.level}：${item.text}`),
    ...pageObservations.flatMap((item) =>
      item.failure || (item.status && item.status >= 400)
        ? [
            `页面导航异常：${endpoint(item.url)} ${item.failure || `HTTP ${item.status}`}（不计接口调用）`,
          ]
        : [],
    ),
    ...findings.map(
      (item) =>
        `${item.source === "ai" ? "AI 判定" : "规则观察"}：${item.title}`,
    ),
  ];
  const solutions = [
    ...(testCase.status === "BLOCKED"
      ? ["先修复或确认前置步骤，再重新执行当前步骤。"]
      : []),
    ...(testCase.status === "SKIPPED"
      ? ["核查跳过条件，满足执行前置条件后复检。"]
      : []),
    ...findings.flatMap((item) => (item.suggestion ? [item.suggestion] : [])),
    ...requests.filter(requestProblem).map((item) => causeAdvice(item).advice),
    ...(logs.some(importantLog)
      ? ["根据异常堆栈定位来源，复现对应操作并补充回归断言。"]
      : []),
    ...(pageObservations.some((p) => p.failure || (p.status && p.status >= 400))
      ? ["核查页面入口、导航响应和网关，确认页面可以打开。"]
      : []),
  ];
  const unique = (values: string[]) =>
    [...new Set(values.map((item) => item.trim()).filter(Boolean))].join("\n");
  return {
    operation:
      operations.map((item) => `${item.sequence}. ${item.label}`).join("\n") ||
      testCase.steps.join("\n"),
    interface:
      requests
        .map(
          (item) =>
            `${item.method} ${endpoint(item.url)}｜HTTP ${item.status ?? "未结束"}｜${countOf(item)} 次｜${item.maxDuration ?? item.duration ?? 0}ms${requestProblem(item) ? `｜${requestProblem(item)}` : ""}`,
        )
        .join("\n") || "无关联接口记录",
    console:
      logs
        .map((item) => `${item.level}｜${countOf(item)} 次｜${item.text}`)
        .join("\n") || "无关联 Console 记录",
    navigation: pageObservations
      .map(
        (item) =>
          `页面导航 ${endpoint(item.url)}｜${item.failure || (item.status ? `HTTP ${item.status}` : "未取得响应")}（不计接口调用）`,
      )
      .join("\n"),
    feedback: feedback.map((item) => feedbackText(run, item)).join("\n"),
    evidence: evidence.map((item) => item.reason).join("\n"),
    result: statusLabel[testCase.status],
    problem:
      unique(problems) ||
      (testCase.status === "PASSED"
        ? "未发现关联异常。"
        : evidence.map((item) => item.reason).join("\n") ||
          "尚未完成本步结果判定。"),
    solution:
      unique(solutions) ||
      (testCase.status === "PASSED"
        ? "无需处置。"
        : evidence.some((item) => item.state === "missing")
          ? "先复录本步并补充页面截图、导航或接口反馈；再配置结果断言。AI 分析不会替代断言判定通过。"
          : evidence.some((item) => item.state === "partial")
            ? "等待关联请求结束或针对缺失正文补录；按本步操作目标配置结果断言。AI 分析不会替代断言判定通过。"
            : "按本步操作目标补充页面结果断言，再回放验证；AI 分析不会替代断言判定通过。"),
  };
}
