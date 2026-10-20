import type { Finding, NetworkCall, Run } from "./types";
import {
  endpoint,
  isExcludedRequest,
  isExcludedResourceLog,
  requestProblem,
  responseMarkers,
} from "./inspection-evidence";

function messageCause(text: string): string | undefined {
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(text))
    return "连接被拒绝，优先怀疑目标服务未启动、端口未监听，或代理转发到了不可用的地址。";
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(text))
    return "域名解析失败，可能是访问地址配置有误、DNS不可用，或当前网络无法解析内网域名。";
  if (/ERR_CERT_|CERT_HAS_EXPIRED|证书.*(?:过期|无效)/i.test(text))
    return "证书校验失败，可能是证书过期、域名不匹配或证书链不受当前浏览器信任。";
  if (/CORS|cross-origin|跨域/i.test(text))
    return "可能是接口或网关的跨域响应头配置不匹配，或预检请求被鉴权规则拦截。";
  if (/timeout|timed.?out|ETIMEDOUT|超时/i.test(text))
    return "请求出现超时，可能是服务处理或下游依赖响应过慢，也可能是网络不通或超时配置过短。";
  if (/ERR_ABORTED|AbortError|取消|cancell?ed/i.test(text))
    return "请求可能因页面切换、组件销毁或主动取消而中止，也可能是客户端超时机制触发了取消。";
  if (
    /服务.*(?:不可用|未就绪)|service unavailable|no healthy upstream/i.test(
      text,
    )
  )
    return "可能是服务尚未就绪、没有可用的服务实例，或负载与依赖故障触发了限流、熔断。";
  if (/SQL|数据库|deadlock|死锁|duplicate key|唯一约束/i.test(text))
    return "错误信息指向数据访问，可能是SQL执行异常、数据约束冲突，或数据库连接与锁等待问题。";
  if (
    /未登录|登录.*(?:失效|过期)|token.*(?:expired|invalid)|unauthorized/i.test(
      text,
    )
  )
    return "可能是登录会话或令牌已失效，或请求未携带服务要求的认证信息。";
  if (
    /无.*权限|权限不足|权限.*(?:失败|异常|错误)|access denied|permission denied|forbidden/i.test(
      text,
    )
  )
    return "可能是当前角色缺少访问权限、资源授权范围不匹配，或接口鉴权规则与前端入口不一致。";
  if (
    /参数.*(?:错误|异常|缺失|为空|不合法)|必填|validation|invalid (?:parameter|argument)/i.test(
      text,
    )
  )
    return "可能是请求漏传必填参数、字段类型或格式不符合接口约定，或前后端校验规则不一致。";
  if (/(?:记录|数据|绑定|资源).*(?:不存在|失效|未找到)|not found/i.test(text))
    return "可能是目标记录不存在或已失效、关联标识传错，或当前数据范围内没有对应的绑定关系。";
  const access = text.match(
    /Cannot read (?:properties|property) of (null|undefined).*?reading\s+['"]([^'"]+)/i,
  );
  if (access)
    return `错误指向在${access[1]}对象上读取“${access[2]}”。可能是接口数据或组件尚未准备完成，也可能是异步回调执行时对象已被销毁。`;
  if (/is not a function/i.test(text))
    return "可能是被调用对象或接口返回字段的类型与代码预期不一致，或方法尚未初始化、已被覆盖。";
  if (/ReferenceError|is not defined/i.test(text))
    return "可能是变量未声明、依赖未初始化，或脚本执行顺序与作用域不符合调用方预期。";
  if (/JSON.*(?:parse|解析)|Unexpected token.*JSON|not valid JSON/i.test(text))
    return "可能是接口返回了非JSON内容、响应被截断，或客户端按错误的数据格式解析响应。";
  if (/(?:保存|提交|删除)(?:失败|异常)/.test(text))
    return "可能是提交数据不符合校验要求、目标记录状态不允许变更，或服务端写入处理出现异常。";
  return undefined;
}

function transportCause(value: { failure?: string; status?: number }) {
  if (value.failure)
    return (
      messageCause(value.failure) ||
      "请求未正常完成，可能是目标服务不可达、网络连接中断，或浏览器策略拦截了请求。"
    );
  switch (value.status) {
    case 401:
      return "HTTP 401提示认证未通过，可能是会话或令牌失效、请求未携带认证信息，或认证配置不匹配。";
    case 403:
      return "HTTP 403提示访问被拒绝，可能是当前角色权限不足、资源授权范围不匹配，或网关访问策略拦截。";
    case 404:
      return "HTTP 404提示目标未找到，可能是接口路径或网关路由配置不匹配、服务版本不一致，或目标资源不存在。";
    case 409:
      return "HTTP 409提示请求冲突，可能是重复数据、并发更新冲突，或当前业务状态不允许执行该操作。";
    case 429:
      return "HTTP 429提示请求受到限流，可能是短时间调用过密，或网关、服务的访问配额已用尽。";
    case 502:
      return "HTTP 502提示网关未取得有效上游响应，可能是上游服务不可用、连接被重置，或代理目标配置错误。";
    case 503:
      return "HTTP 503提示服务暂不可用，可能是服务未就绪、没有健康实例，或负载过高触发了限流与熔断。";
    case 504:
      return "HTTP 504提示网关等待上游超时，可能是后端处理、数据库查询或下游依赖耗时过长。";
  }
  if (value.status && value.status >= 500)
    return `HTTP ${value.status}提示服务端处理失败，优先怀疑业务处理出现未捕获异常、数据访问失败或下游依赖调用异常。`;
  if (value.status && value.status >= 400)
    return `HTTP ${value.status}提示请求被拒绝，可能是必填参数缺失、字段格式不符合约定，或业务前置条件未满足。`;
}

export function requestPossibleCause(request: NetworkCall): string | undefined {
  const problem = requestProblem(request);
  if (!problem) return undefined;
  if (request.failure || request.status === 401 || request.status === 403)
    return transportCause(request);
  const message = Object.entries(responseMarkers(request))
    .filter(([key]) =>
      /^(?:message|msg|error|errors|errorMessage|reason)$/i.test(key),
    )
    .map(([, value]) => String(value ?? ""))
    .join("；");
  const cause = messageCause(message) || transportCause(request);
  if (cause) return cause;
  if (problem.includes("耗时"))
    return "本次接口耗时偏高，可能是查询或下游调用较慢、服务排队，或网络传输延迟。需要分段耗时验证优先方向。";
  return "接口已返回业务失败标记或失败提示，可能是请求参数或业务前置条件不满足、目标记录失效，或服务端业务处理进入了异常分支。";
}

function isEmptyDiagnosis(text: string) {
  if (
    !text ||
    /^(?:未知|未明确|待确认|待核查|不详|无|证据不足|信息不足|缺少线索|unknown|n\/?a|[-—]+)[。.]?$/i.test(
      text,
    )
  )
    return true;
  const refusal =
    /(?:无法|不能|尚不能|未能|暂不|不足|未明确|不确定|不明).{0,18}(?:原因|根因|分析|判断)|(?:原因|根因).{0,10}(?:未知|不明|未确定|未明确|待确认)/.test(
      text,
    );
  // Keep useful hypotheses even when they also acknowledge uncertainty.
  const explanation =
    /可能|优先怀疑|疑似|推测|原因(?:是|为|包括)|由于|所致|源于|导致|指向|表明|已确认/.test(
      text,
    );
  return refusal && !explanation;
}

// Fill missing/refusal-only explanations from actual signals. Concrete model
// diagnoses remain intact, including those that cannot identify a unique cause.
export function findingPossibleCause(
  run: Run,
  value: Pick<Finding, "possibleCause" | "evidenceIds">,
): string {
  const existing = value.possibleCause?.trim() || "";
  if (!isEmptyDiagnosis(existing)) return existing;
  const causes: string[] = [];
  for (const request of run.requests) {
    if (!value.evidenceIds.includes(request.id) || isExcludedRequest(request))
      continue;
    const cause = requestPossibleCause(request);
    if (cause)
      causes.push(`${request.method} ${endpoint(request.url)}：${cause}`);
  }
  for (const log of run.logs) {
    if (!value.evidenceIds.includes(log.id) || isExcludedResourceLog(log))
      continue;
    const cause = messageCause(log.text);
    if (cause) causes.push(cause);
    else if (log.level === "unhandledrejection")
      causes.push(
        "Promise拒绝未被处理，可能是异步请求失败后缺少.catch或try-catch，或错误处理分支再次抛出了异常。",
      );
    else if (log.level === "pageerror")
      causes.push(
        "页面出现未捕获的脚本异常，可能是输入或返回数据不符合代码预期、组件状态未就绪，或异常分支缺少保护。",
      );
  }
  for (const page of run.pageObservations || []) {
    if (!value.evidenceIds.includes(page.id)) continue;
    const cause = transportCause(page);
    if (cause) causes.push(cause);
  }
  for (const feedback of run.feedback || []) {
    if (
      !value.evidenceIds.includes(feedback.id) ||
      feedback.level !== "error" ||
      feedback.change === "disappeared"
    )
      continue;
    const cause = messageCause(feedback.text || "");
    if (cause) causes.push(cause);
  }
  return (
    [...new Set(causes)].slice(0, 3).join("\n") ||
    "现有记录缺少可指向故障机制的具体错误信息，暂无法提出有依据的可能原因；需补充异常堆栈、失败响应或触发条件。"
  );
}
