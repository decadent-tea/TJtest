import type { Finding, Run } from "../shared/types";
import { findingPossibleCause } from "../shared/finding-cause";
import {
  EVIDENCE_VERSION,
  findingObservation,
  isExcludedRequest,
  ownerLabels,
  hasRepeatedRequest,
  constrainRiskClaim,
  navigationForLoadingLog,
  endpoint,
  requestProblem,
  isExcludedResourceLog,
  findingReproduction,
  suggestedRequestOwners,
} from "../shared/inspection-evidence";

function httpStatuses(text: string, browserLog = false) {
  const codes = [
    ...text.matchAll(
      /\bHTTP(?:\/\d(?:\.\d)?)?(?:\s*(?:status|状态码?))?\s*[:：]?\s*([1-5]\d{2})\b/gi,
    ),
  ].map((match) => Number(match[1]));
  if (browserLog)
    for (const match of text.matchAll(
      /\bstatus(?:\s+code)?(?:\s+of)?\s*[:：]?\s*([1-5]\d{2})\b/gi,
    ))
      codes.push(Number(match[1]));
  return codes;
}

export function groundFinding(run: Run, value: Omit<Finding, "id" | "source">) {
  // Recheck old and new analyses individually. Outdated metadata is not a reason
  // to discard a useful diagnosis that still has verifiable source evidence.
  if (
    /静态资源|瓦片|字体.{0,12}(?:加载|缺失)|(?:字体|font).{0,20}(?:失败|missing)/i.test(
      value.title,
    )
  )
    return undefined;
  const validIds = new Set(
    [
      ...run.operations,
      ...run.requests.filter((r) => !isExcludedRequest(r)),
      ...run.logs.filter((l) => !isExcludedResourceLog(l)),
      ...(run.pageObservations || []),
      ...(run.feedback || []),
    ].map((item) => item.id),
  );
  value = {
    ...value,
    evidenceIds: value.evidenceIds.filter((id) => validIds.has(id)),
  };
  if (!value.evidenceIds.length) return undefined;
  const requests = run.requests.filter(
    (r) => value.evidenceIds.includes(r.id) && !isExcludedRequest(r),
  );
  if (
    (value.category === "performance" ||
      /响应时间|响应较慢|耗时|瓶颈/.test(value.title)) &&
    !value.metricScope &&
    !requests.length
  )
    return undefined;
  const repeated = /重复|冗余|频繁|高频/.test(value.title);
  // Repetition over multiple manual actions is not a defect or a submission retry.
  if (repeated && requests.length && !hasRepeatedRequest(requests))
    return undefined;
  const owners = (value.owners || []).filter((o) => o in ownerLabels);
  const suggestedOwners = [
    ...new Set(requests.filter(requestProblem).flatMap(suggestedRequestOwners)),
  ].filter((owner) => owner !== "undetermined");
  const modules = [...new Set(requests.map((r) => r.module))];
  const f = {
    ...value,
    module: modules.length === 1 ? modules[0] : value.module,
    title: value.title.replace(
      /\d+(?:\.\d+)?\s*(?:次|毫秒|ms|秒|%)/gi,
      "（数值见观察事实）",
    ),
    owners: owners.some((owner) => owner !== "undetermined")
      ? owners
      : suggestedOwners.length
        ? suggestedOwners
        : ["undetermined" as const],
    ownershipSource: "ai" as const,
    factVersion: EVIDENCE_VERSION,
    observation: findingObservation(run, {
      ...value,
      id: "local",
      source: "ai",
    }),
  };
  // A step ID only proves the action was recorded. Without result signals it
  // cannot support an asserted defect, regardless of the model's certainty.
  const logs = run.logs.filter((l) => value.evidenceIds.includes(l.id));
  const pages = (run.pageObservations || []).filter((p) =>
    value.evidenceIds.includes(p.id),
  );
  const operations = run.operations.filter((o) =>
    value.evidenceIds.includes(o.id),
  );
  const feedback = (run.feedback || []).filter((f) =>
    value.evidenceIds.includes(f.id),
  );
  // Real IDs do not support invented protocol facts, even when another linked
  // signal proves a business failure, runtime error or slow response.
  const observedStatuses = new Set([
    ...requests.flatMap((r) => (r.status === undefined ? [] : [r.status])),
    ...pages.flatMap((p) => (p.status === undefined ? [] : [p.status])),
    ...logs.flatMap((log) => httpStatuses(log.text, true)),
  ]);
  if (
    httpStatuses(`${value.title}\n${value.impact || ""}`).some(
      (status) => !observedStatuses.has(status),
    )
  )
    return undefined;
  const linkedStepIds = new Set([
    ...operations.map((operation) => operation.id),
    ...requests.map((request) => request.stepId),
    ...logs.map((log) => log.stepId),
    ...pages.map((page) => page.stepId),
    ...feedback.flatMap((item) =>
      item.stepId ? [item.stepId] : item.candidateStepIds || [],
    ),
  ]);
  const linkedOperations = run.operations
    .filter((operation) => linkedStepIds.has(operation.id))
    .sort((a, b) => a.sequence - b.sequence);
  if (!modules.length) {
    const actualModules = [
      ...new Set(
        logs
          .map(
            (log) => run.operations.find((op) => op.id === log.stepId)?.module,
          )
          .filter((module): module is string => !!module),
      ),
    ];
    if (actualModules.length === 1) f.module = actualModules[0];
  }
  const readablePath = (value.reproductionSteps || []).filter(
    (text) =>
      /[A-Za-z\u4e00-\u9fff]{2}/.test(text) &&
      !value.evidenceIds.includes(text.trim()) &&
      !/^[\w-]+[.:][\d.]+$/.test(text.trim()),
  );
  const recordedLabels = run.operations.map((op) =>
    op.label.replace(/^(?:点击|鼠标悬浮|打开页面)\s*[·:]?\s*/, ""),
  );
  const recordedUrls = [run.url, ...run.operations.map((op) => op.url)].filter(
    Boolean,
  );
  const supportedPath = readablePath.filter(
    (text) =>
      recordedLabels.some(
        (label) =>
          label.length >= 2 &&
          text
            .replace(/\s*[·:]\s*/g, "")
            .includes(label.replace(/\s*[·:]\s*/g, "")),
      ) ||
      recordedUrls.some((url) => text.includes(url)) ||
      /^(?:观察|检查|核对).*(?:接口|网络|请求|控制台|日志|响应|HTTP)/i.test(
        text,
      ),
  );
  f.reproductionSteps =
    supportedPath.length >= 2 ? supportedPath : findingReproduction(run, value);
  const readableValidation = (f.validationSteps || []).filter(
    (text) =>
      /[A-Za-z\u4e00-\u9fff]{2}/.test(text) &&
      !value.evidenceIds.includes(text.trim()) &&
      !/^[\w-]+[.:][\d.]+$/.test(text.trim()),
  );
  if (readableValidation.length) f.validationSteps = readableValidation;
  else if (requests.length)
    f.validationSteps = requests
      .slice(0, 3)
      .map(
        (request) =>
          `复测${linkedOperations[0] ? `第${linkedOperations[0].sequence}步“${linkedOperations[0].label}”` : "关联操作"}，核对${request.method} ${endpoint(request.url)}的HTTP状态和业务标记，并检查对应页面结果是否符合测试预期。`,
      );
  else
    f.validationSteps = [
      "重走关联操作，核对原异常是否再次出现，并用明确断言验证页面结果。",
    ];
  const linkedPages = logs
    .map((l) => navigationForLoadingLog(run, l))
    .filter((p) => !!p);
  if (!requests.length && logs.length && linkedPages.length === logs.length) {
    f.category = "stability";
    f.title = "页面导航异常";
    f.owners = ["undetermined"];
    f.module =
      run.operations.find((o) => o.id === linkedPages[0].stepId)?.module ||
      "页面导航";
    f.evidenceIds = [
      ...new Set([...f.evidenceIds, ...linkedPages.map((p) => p.id)]),
    ];
    f.impact = "页面导航记录到异常；页面实际可用性需结合页面反馈或断言确认。";
  }
  const hasDirectFailure =
    requests.some(requestProblem) ||
    logs.some((l) =>
      ["error", "pageerror", "unhandledrejection"].includes(l.level),
    ) ||
    pages.some((p) => p.failure || (p.status && p.status >= 400)) ||
    operations.some((o) => o.error || o.status === "FAILED");
  const hasErrorFeedback = feedback.some(
    (item) =>
      ["message", "dialog"].includes(item.kind) &&
      item.level === "error" &&
      item.change !== "disappeared",
  );
  if (
    !hasDirectFailure &&
    !requests.length &&
    !logs.length &&
    !pages.length &&
    !feedback.length
  )
    return undefined;
  const hasWeakSignal =
    logs.some((log) => ["warn", "warning"].includes(log.level)) ||
    feedback.some(
      (item) =>
        item.kind === "message" &&
        item.change !== "disappeared" &&
        !["success", "info"].includes(item.level || "unknown"),
    );
  if (
    !hasDirectFailure &&
    !hasErrorFeedback &&
    !hasWeakSignal &&
    !(repeated && requests.length && hasRepeatedRequest(requests)) &&
    // Security/data clues have their own constraints below; a successful
    // response can still contain evidence relevant to those categories.
    !["security", "data"].includes(f.category || "")
  )
    return undefined;
  Object.assign(f, constrainRiskClaim(run, f));
  if (!hasDirectFailure && feedback.some((p) => p.association === "ambiguous"))
    f.confidence = "low";
  if (
    feedback.length &&
    !hasDirectFailure &&
    !hasErrorFeedback &&
    feedback.every(
      (p) =>
        ["url", "title", "loading", "empty", "dialog"].includes(p.kind) ||
        p.level === "success",
    )
  )
    return undefined;
  if (!hasDirectFailure && !hasErrorFeedback && f.severity === "high") {
    f.severity = "low";
    f.confidence = "low";
    if (!f.title.startsWith("待核查：")) f.title = `待核查：${f.title}`;
    f.impact = f.impact || "已记录相关线索，实际影响需人工复现确认。";
  }
  if (repeated && requests.length) {
    f.title = "关联操作内出现多次同类请求，需核查";
    f.confidence = "low";
    f.impact = "时间关联与调用次数不足以确认重复提交或多余负载。";
    f.possibleCause = "需核对该端点的重试、刷新及操作约定。";
  }
  f.observation = findingObservation(run, { ...f, id: "local", source: "ai" });
  f.possibleCause = findingPossibleCause(run, f);
  f.detail = `观察事实：${f.observation}\n业务影响（AI建议）：${f.impact || "待核查"}\n可能原因（AI建议）：${f.possibleCause || "未明确"}`;
  return f;
}
