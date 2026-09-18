import { finalFindings } from "./evidence-quality";
import type { Run, TestCase } from "../shared/types";
import {
  countOf,
  endpoint,
  importantLog,
  isConsoleLog,
  isSuccessfulStaticAsset,
  requestProblem,
  causeAdvice,
  statusLabel,
} from "./evidence-quality";

export function caseView(run: Run, testCase: TestCase) {
  const ids = new Set(testCase.evidenceIds);
  const operations = run.operations.filter((item) => ids.has(item.id));
  const requests = run.requests.filter(
    (item) => ids.has(item.id) && !isSuccessfulStaticAsset(item),
  );
  const logs = run.logs.filter(
    (item) => ids.has(item.id) && isConsoleLog(item),
  );
  const findings = finalFindings(run).filter(
    (item) => !item.deleted && item.evidenceIds.some((id) => ids.has(id)),
  );
  const judged = run.analysis.status === "COMPLETED";
  const problems = [
    ...(testCase.status === "BLOCKED"
      ? ["步骤受前置失败影响，未完成验证。"]
      : []),
    ...(testCase.status === "SKIPPED" ? ["步骤被跳过，未形成执行结果。"] : []),
    ...operations.flatMap((item) =>
      item.error ? [`操作失败：${item.error}`] : [],
    ),
    ...(judged ? [] : requests).flatMap((item) =>
      requestProblem(item)
        ? [`${item.method} ${endpoint(item.url)}：${requestProblem(item)}`]
        : [],
    ),
    ...(judged ? [] : logs)
      .filter(importantLog)
      .map((item) => `Console ${item.level}：${item.text}`),
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
    ...(judged ? [] : requests)
      .filter(requestProblem)
      .map((item) => causeAdvice(item).advice),
    ...(!judged && logs.some(importantLog)
      ? ["根据异常堆栈定位来源，复现对应操作并补充回归断言。"]
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
    result: statusLabel[testCase.status],
    problem:
      unique(problems) ||
      (testCase.status === "PASSED"
        ? "未发现关联异常。"
        : "尚未完成本步结果判定。"),
    solution:
      unique(solutions) ||
      (testCase.status === "PASSED"
        ? "无需处置。"
        : "等待手动分析，或补充可观察反馈和自动断言。"),
  };
}
