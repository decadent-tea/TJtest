import type {
  Run,
  NetworkCall,
  LogEvent,
  StepStatus,
  Finding,
} from "../shared/types";

export const statusLabel: Record<StepStatus, string> = {
  RECORDED: "已录制，待验证",
  RUNNING: "执行中",
  EXECUTED: "已执行，待验证",
  PASSED: "通过",
  FAILED: "失败",
  BLOCKED: "阻塞",
  SKIPPED: "跳过",
};
export const countOf = (item: { occurrences?: number }) =>
  item.occurrences || 1;
export const SLOW_REQUEST_THRESHOLD_MS = 10_000;
export const isStaticAssetUrl = (value: string) => {
  let pathname = value;
  try {
    pathname = new URL(value).pathname;
  } catch {
    /* Preserve malformed URLs for the remaining checks. */
  }
  return (
    /\.(?:m?js|cjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|mp[34]|webm)(?:$|[?#])/i.test(
      pathname,
    ) ||
    /\/(?:static|assets|dist)\/(?:js|css|media|fonts?)\//i.test(pathname) ||
    /\/(?:chunk|runtime|vendor)[^/]*\.(?:m?js|css)$/i.test(pathname)
  );
};
export const isSuccessfulStaticAsset = (request: NetworkCall) =>
  isStaticAssetUrl(request.url) &&
  !request.failure &&
  !!request.status &&
  request.status < 400;

// A single presentation set for the UI, exports and summary counts. Once AI has
// assessed all evidence, its decisions replace provisional rule observations.
export function finalFindings(run: Run): Finding[] {
  const candidates =
    run.analysis.status === "COMPLETED"
      ? run.analysis.findings
      : [
          ...run.analysis.findings,
          ...run.findings.filter(
            (f) =>
              !run.analysis.findings.some((a) =>
                a.evidenceIds.some((id) => f.evidenceIds.includes(id)),
              ),
          ),
        ];
  return candidates
    .filter(
      (f) =>
        !f.deleted &&
        findingHasRelevantEvidence(run, f) &&
        !isBelowPerformanceThreshold(run, f),
    )
    .sort(
      (a, b) =>
        ({ high: 3, medium: 2, low: 1 })[b.severity] -
        { high: 3, medium: 2, low: 1 }[a.severity],
    );
}
export function riskSummary(run: Run) {
  const findings = finalFindings(run);
  return `高风险 ${findings.filter((f) => f.severity === "high").length} 项、中风险 ${findings.filter((f) => f.severity === "medium").length} 项、低风险 ${findings.filter((f) => f.severity === "low").length} 项。`;
}
export function analysisNarrative(run: Run) {
  const findings = finalFindings(run);
  let text = run.analysis.summary || "";
  for (const [severity, label] of [
    ["high", "高风险"],
    ["medium", "中风险"],
    ["low", "低风险"],
  ] as const) {
    const count = findings.filter((f) => f.severity === severity).length;
    text = text
      .replace(
        new RegExp(
          `(${label}(?:问题)?[：:\\s]*)(\\d+|零)(\\s*(?:项|个|条)?)`,
          "g",
        ),
        (_, prefix, _old, suffix) => `${prefix}${count}${suffix}`,
      )
      .replace(
        new RegExp(`(\\d+|零)(\\s*(?:项|个|条)?\\s*${label})`, "g"),
        (_, _old, suffix) => `${count}${suffix}`,
      );
    if (count)
      text = text.replace(
        new RegExp(`(?:未发现|不存在|没有)${label}(?:问题)?`, "g"),
        `发现 ${count} 项${label}问题`,
      );
  }
  return text;
}
export const interfaceTotal = (run: Run) => {
  const retainedStatic = run.requests
    .filter((r) => isStaticAssetUrl(r.url))
    .reduce((sum, item) => sum + countOf(item), 0);
  return run.captureStats
    ? Math.max(
        0,
        run.captureStats.requests -
          run.captureStats.filteredRequests -
          retainedStatic,
      )
    : run.requests
        .filter((item) => !isStaticAssetUrl(item.url))
        .reduce((sum, item) => sum + countOf(item), 0);
};
export const isConsoleLog = (log: LogEvent) =>
  log.level !== "sse" && !log.text.startsWith("触发下载：");
export const consoleTotal = (run: Run) => {
  const auxiliary = run.logs
    .filter((log) => !isConsoleLog(log))
    .reduce((sum, log) => sum + countOf(log), 0);
  return run.captureStats
    ? Math.max(0, run.captureStats.logs - auxiliary)
    : run.logs.filter(isConsoleLog).reduce((sum, log) => sum + countOf(log), 0);
};
export const findingHasRelevantEvidence = (run: Run, finding: Finding) =>
  finding.evidenceIds.some(
    (id) =>
      run.operations.some((item) => item.id === id) ||
      run.logs.some((item) => item.id === id) ||
      run.requests.some(
        (item) => item.id === id && !isStaticAssetUrl(item.url),
      ),
  );
export const isBelowPerformanceThreshold = (run: Run, finding: Finding) => {
  if (
    !/性能|响应时间|响应较慢|耗时|瓶颈/.test(
      `${finding.title}${finding.detail}`,
    )
  )
    return false;
  const evidence = finding.evidenceIds.flatMap((id) => {
    const request = run.requests.find((item) => item.id === id);
    return request ? [request] : [];
  });
  return (
    evidence.length > 0 &&
    Math.max(
      ...evidence.map(
        (request) => request.maxDuration ?? request.duration ?? 0,
      ),
    ) <= SLOW_REQUEST_THRESHOLD_MS
  );
};
export const endpoint = (url: string) => {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url.split("?")[0];
  }
};
export function requestProblem(r: NetworkCall): string | undefined {
  if (r.failure) return `网络失败：${r.failure}`;
  if (r.status && r.status >= 400) return `HTTP ${r.status}`;
  try {
    const body = JSON.parse(r.responseBody || "null");
    if (
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body.success === false || body.ok === false)
    )
      return "业务返回失败标记，需核对业务约定";
  } catch {
    /* Non-JSON bodies have no standard business success marker. */
  }
  if (
    (r.maxDuration ?? r.duration ?? 0) > SLOW_REQUEST_THRESHOLD_MS &&
    ["xhr", "fetch"].includes(r.resourceType) &&
    r.category !== "background"
  )
    return `接口耗时超过 ${SLOW_REQUEST_THRESHOLD_MS}ms`;
  return undefined;
}
export const importantLog = (l: LogEvent) =>
  ["error", "pageerror", "unhandledrejection", "warn", "warning"].includes(
    l.level,
  );
const stats = (run: Run) =>
  (run.captureStats ??= {
    requests: run.requests.reduce((n, r) => n + countOf(r), 0),
    logs: run.logs.reduce((n, l) => n + countOf(l), 0),
    filteredRequests: 0,
    filteredLogs: 0,
    mergedRequests: 0,
    mergedLogs: 0,
  });
const fingerprints = new WeakMap<Run, Map<string, NetworkCall>>();
export function finishRequest(run: Run, call: NetworkCall) {
  const s = stats(run);
  const remove = () => {
    const i = run.requests.indexOf(call);
    if (i >= 0) run.requests.splice(i, 1);
  };
  if (
    !requestProblem(call) &&
    call.status !== undefined &&
    call.status < 400 &&
    (isSuccessfulStaticAsset(call) ||
      call.category === "resource" ||
      ["image", "stylesheet", "font", "media", "script", "manifest"].includes(
        call.resourceType,
      ) ||
      call.category === "background" ||
      call.method === "OPTIONS")
  ) {
    remove();
    s.filteredRequests++;
    return;
  }
  // Exact payload comparison: different query values, bodies, pages and steps remain distinct.
  const key = JSON.stringify([
    call.pageId,
    call.stepId,
    call.method,
    call.url,
    call.requestBody,
    call.status,
    call.failure,
    call.responseBody,
    requestProblem(call),
  ]);
  let index = fingerprints.get(run);
  if (!index) {
    index = new Map();
    fingerprints.set(run, index);
  }
  const previous = index.get(key);
  if (previous && previous !== call) {
    previous.occurrences = countOf(previous) + 1;
    previous.lastSeen = call.startedAt;
    previous.maxDuration = Math.max(
      previous.maxDuration ?? previous.duration ?? 0,
      call.duration ?? 0,
    );
    remove();
    s.mergedRequests++;
  } else index.set(key, call);
}
export function captureLog(run: Run, log: LogEvent) {
  const s = stats(run);
  s.logs++;
  if (
    !importantLog(log) &&
    log.level !== "sse" &&
    !log.text.startsWith("触发下载：")
  ) {
    s.filteredLogs++;
    return;
  }
  const previous = run.logs.find(
    (l) =>
      l.pageId === log.pageId &&
      l.stepId === log.stepId &&
      l.level === log.level &&
      l.text === log.text &&
      l.location === log.location,
  );
  if (previous) {
    previous.occurrences = countOf(previous) + 1;
    previous.lastSeen = log.timestamp;
    s.mergedLogs++;
  } else run.logs.push(log);
}
export function evidenceLabel(run: Run, ids: string[]) {
  return [
    ...new Set(
      ids.map((id) => {
        const op = run.operations.find((o) => o.id === id);
        if (op) return `步骤 ${op.sequence}：${op.label}`;
        const r = run.requests.find((r) => r.id === id);
        if (r)
          return `${r.method} ${endpoint(r.url)}（${requestProblem(r) || `HTTP ${r.status ?? "未结束"}`}，${countOf(r)} 次）`;
        const l = run.logs.find((l) => l.id === id);
        return l
          ? `${l.level}：${l.text.slice(0, 240)}（${countOf(l)} 次）`
          : "关联证据不可用";
      }),
    ),
  ].join("\n");
}
export function problemRequests(run: Run) {
  const groups = new Map<
    string,
    { request: NetworkCall; reason: string; count: number; duration: number }
  >();
  for (const r of run.requests) {
    // A micro-frontend can fetch code chunks with Fetch/XHR. A successful chunk is
    // implementation transport, not a business interface or AI issue.
    if (isStaticAssetUrl(r.url)) continue;
    // AI 引用了接口证据，只说明它分析过相关操作，不能推导为接口异常。
    // 这里仅展示由协议、业务返回或耗时规则直接证明的问题。
    const ai = finalFindings(run).find(
      (f) => f.category === "interface" && f.evidenceIds.includes(r.id),
    );
    const reason = requestProblem(r) || ai?.observation || ai?.detail;
    if (!reason) continue;
    const key = JSON.stringify([r.module, r.method, endpoint(r.url), reason]);
    const existing = groups.get(key);
    if (existing) {
      existing.count += countOf(r);
      existing.duration = Math.max(
        existing.duration,
        r.maxDuration ?? r.duration ?? 0,
      );
    } else
      groups.set(key, {
        request: r,
        reason,
        count: countOf(r),
        duration: r.maxDuration ?? r.duration ?? 0,
      });
  }
  return [...groups.values()];
}
export function importantLogs(run: Run) {
  const groups = new Map<string, LogEvent>();
  for (const l of run.logs.filter(importantLog)) {
    const key = JSON.stringify([l.level, l.text, l.location]);
    const old = groups.get(key);
    if (old) old.occurrences = countOf(old) + countOf(l);
    else groups.set(key, { ...l });
  }
  return [...groups.values()];
}
export function causeAdvice(r: NetworkCall) {
  if (r.failure)
    return {
      cause:
        "可能涉及网络连通性、跨域策略、证书或请求取消，需结合浏览器网络面板核查。",
      advice:
        "按发生时间检查网关及网络错误，复现相同操作并确认请求是否被主动取消。",
    };
  if (r.status === 401 || r.status === 403)
    return {
      cause: "可能与会话失效或权限配置有关，需确认是否为预期鉴权测试。",
      advice: "核查登录态、令牌有效期与角色权限，补充失效会话及越权断言。",
    };
  if (r.status && r.status >= 500)
    return {
      cause: "服务端或网关返回错误；具体异常及依赖故障需服务端日志确认。",
      advice:
        "按时间、接口和请求链路核查服务端异常与下游依赖，补充异常响应及重试验证。",
    };
  if (r.status && r.status >= 400)
    return {
      cause: "可能为参数、路由或业务前置条件不满足，需核对接口约定。",
      advice: "检查参数校验、路由配置及业务前置条件，补充正向与负向用例。",
    };
  if (requestProblem(r)?.includes("耗时"))
    return {
      cause: "本次耗时偏高；网络、查询或依赖延迟均需进一步测量。",
      advice:
        "重复采样并拆分网关、服务、数据库耗时，再评估索引、分页、缓存与超时策略。",
    };
  return {
    cause: "存在业务失败标记，具体原因需核对业务返回约定和服务端日志。",
    advice: "核查业务前置条件与错误处理，增加业务成功及失败分支断言。",
  };
}
export function detailedAnalysis(run: Run, overview: string) {
  const requests = problemRequests(run),
    logs = importantLogs(run);
  return [
    overview,
    "一、存在问题的接口",
    requests.length
      ? requests
          .map(({ request: r, reason, count, duration }, i) => {
            const related = run.analysis.findings.filter((f) =>
              f.evidenceIds.includes(r.id),
            );
            const advice = causeAdvice(r);
            return `${i + 1}. ${r.module} · ${r.method} ${endpoint(r.url)}\n观察事实：${reason}；出现 ${count} 次；最大耗时 ${duration}ms。\n原因分析：${
              related
                .map((f) => f.possibleCause)
                .filter(Boolean)
                .join("；") || advice.cause
            }\n优化方向：${
              related
                .map((f) => f.suggestion)
                .filter(Boolean)
                .join("；") || advice.advice
            }`;
          })
          .join("\n\n")
      : "未发现满足当前规则或 AI 证据约束的问题接口。",
    "二、重要报错与警告日志",
    logs.length
      ? logs
          .map(
            (l, i) =>
              `${i + 1}. ${l.level}（${countOf(l)} 次） ${l.text.slice(0, 500)}\n位置：${l.location || "见关联操作"}\n原因分析：${run.analysis.findings.find((f) => f.evidenceIds.includes(l.id))?.possibleCause || "浏览器记录了错误或警告，具体触发原因及业务影响需结合堆栈与对应操作确认。"}\n优化方向：${run.analysis.findings.find((f) => f.evidenceIds.includes(l.id))?.suggestion || "根据首个异常堆栈定位源代码，检查空值、异步异常捕获和失败降级；复测相同操作。"}`,
          )
          .join("\n\n")
      : "未采集到错误或警告日志。",
    "三、复核与优化优先级",
    "优先核查网络失败、服务端错误和未捕获异常；其次核查业务失败、权限及参数；最后复测慢接口与警告。原因判断是候选方向，HTTP 成功及已录制状态均不代表业务验证通过。",
  ].join("\n\n");
}
