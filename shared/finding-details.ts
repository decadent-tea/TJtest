import type { Finding, Run } from "./types";
import { findingPossibleCause } from "./finding-cause";
import {
  endpoint,
  findingOperations,
  findingReproduction,
  businessFailureReason,
  isExcludedRequest,
  isExcludedResourceLog,
} from "./inspection-evidence";

// These are evidence-specific rule diagnostics, used when no AI explanation is
// available. They identify the action and concrete checks instead of empty prose.
export function describeFinding(run: Run, value: Finding): Finding {
  const operations = findingOperations(run, value);
  const operation =
    operations.find((item) => !["hover", "scroll"].includes(item.kind)) ||
    operations[0];
  const action = operation?.label.replace(
    /^(?:点击|鼠标悬浮|输入)\s*[·:]?\s*/,
    "",
  );
  const subject = action ? `“${action}”操作` : `${value.module}模块`;
  const requests = run.requests.filter(
    (request) =>
      value.evidenceIds.includes(request.id) && !isExcludedRequest(request),
  );
  const logs = run.logs.filter(
    (log) => value.evidenceIds.includes(log.id) && !isExcludedResourceLog(log),
  );
  const request = requests[0];
  const log = logs[0];
  // Page feedback, navigation and assertion findings already carry their own
  // diagnostics. A missing console log must not become an invented JS error.
  if (!request && !log)
    return {
      ...value,
      possibleCause: findingPossibleCause(run, value),
      reproductionSteps: value.reproductionSteps?.length
        ? value.reproductionSteps
        : findingReproduction(run, value),
    };
  const requestName = request
    ? `${request.method} ${endpoint(request.url)}`
    : "";
  const rejection = logs.some((item) => item.level === "unhandledrejection");
  const error = log?.text.split("\n")[0] || "";
  const business = request && businessFailureReason(request);
  let title = value.title;
  if (/^(?:前端错误|前端警告)$/.test(title))
    title = `${subject}${rejection ? "出现未处理的Promise异常" : log?.level === "pageerror" ? "出现未捕获异常" : "记录到前端" + (/警告/.test(title) ? "警告" : "错误")}：${error.slice(0, 120)}`;
  else if (
    /^(?:HTTP \d+|网络失败：|业务返回失败标记|业务响应|业务接口响应较慢)/.test(
      title,
    )
  )
    title = `${subject}${request?.failure ? "的接口请求失败" : request?.status && request.status >= 400 ? `的接口返回HTTP ${request.status}` : business ? (business.includes("提示") ? "的接口返回失败提示" : "的接口返回业务失败") : "关联接口响应耗时偏高"}`;
  const impact =
    value.impact ||
    (request
      ? `${subject}关联的${requestName}${business ? (business.includes("提示") ? "的响应包含失败提示，需人工确认是否为预期校验或业务处理失败" : "返回明确的业务失败标记，当前请求未取得成功业务结果") : request.failure ? `发生${request.failure}` : request.status && request.status >= 400 ? `返回HTTP ${request.status}` : "耗时偏高"}，可能影响该步骤的数据获取或提交结果；实际页面表现可对照关联截图核查。`
      : `${subject}期间浏览器记录到${rejection ? "未处理的Promise异常" : log?.level === "pageerror" ? "未捕获异常" : "前端错误或警告"}“${error}”，可能影响该步骤的页面处理或后续交互；具体影响范围以对应操作与页面反馈为准。`);
  const cause = findingPossibleCause(run, value);
  const genericSuggestion =
    !value.suggestion ||
    /^核查消息来源和堆栈|^针对关联异常修复后/.test(value.suggestion);
  const suggestion = genericSuggestion
    ? `${operation ? `按第${operation.sequence}步“${operation.label}”复现，` : "复现关联操作，"}${request ? `检查${requestName}的输入参数、HTTP状态及业务返回标记；` : "定位浏览器堆栈中的首个业务调用，检查对象状态及异常分支；"}${rejection ? "为失败的异步调用补充.catch或try-catch，向用户显示可理解的失败提示；" : "核对异常发生后的页面反馈和恢复入口；"}修复后对相同操作补充成功与失败分支验证。`
    : value.suggestion;
  return {
    ...value,
    title,
    impact,
    possibleCause: cause,
    suggestion,
    reproductionSteps: value.reproductionSteps?.length
      ? value.reproductionSteps
      : findingReproduction(run, value),
    validationSteps: value.validationSteps?.length
      ? value.validationSteps
      : [
          `重新执行${operation ? `第${operation.sequence}步“${operation.label}”` : subject}，核对页面是否出现符合测试预期的结果或明确失败提示。`,
          ...(request
            ? [
                `检查${requestName}的HTTP状态、success/code等业务字段与接口约定一致。`,
              ]
            : []),
          ...(log
            ? [
                `检查浏览器是否再次出现“${error}”，并核对异常处理后的页面能否继续操作。`,
              ]
            : []),
        ],
  };
}
