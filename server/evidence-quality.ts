import type {
  Run,
  NetworkCall,
  LogEvent,
  StepStatus,
  Finding,
} from "../shared/types";
import {
  countOf,
  endpoint,
  isStaticAssetUrl,
  isExcludedRequest,
  isExcludedResourceLog,
  requestStats,
  findingObservation,
  hasRepeatedRequest,
  responseMarkers,
  semanticIdentity,
  constrainRiskClaim,
  feedbackText,
  requestProblem,
  SLOW_REQUEST_THRESHOLD_MS,
} from "../shared/inspection-evidence";
import { groundFinding } from "./evidence-grounding";
import { summarizeVerifiedFindings } from "../shared/analysis-summary";
import { describeFinding } from "../shared/finding-details";
import { requestPossibleCause } from "../shared/finding-cause";
export {
  countOf,
  endpoint,
  isStaticAssetUrl,
  requestProblem,
  SLOW_REQUEST_THRESHOLD_MS,
} from "../shared/inspection-evidence";

export const statusLabel: Record<StepStatus, string> = {
  RECORDED: "已录制，待验证",
  RUNNING: "执行中",
  EXECUTED: "已执行，待验证",
  PASSED: "通过",
  FAILED: "失败",
  BLOCKED: "阻塞",
  SKIPPED: "跳过",
};
export const isSuccessfulStaticAsset = (request: NetworkCall) =>
  isStaticAssetUrl(request.url) &&
  !request.failure &&
  !!request.status &&
  request.status < 400;

// Rules remain authoritative; AI can explain the same evidence without deleting it.
export function finalFindings(run: Run): Finding[] {
  const aiFindings: Finding[] = run.analysis.findings.flatMap((stored) => {
    if (stored.deleted) return [];
    const checked = groundFinding(run, stored);
    return checked
      ? [
          {
            ...checked,
            id: stored.id,
            source: "ai" as const,
            explanationSource: "ai" as const,
            ...(stored.ownershipSource === "manual"
              ? { owners: stored.owners, ownershipSource: "manual" as const }
              : {}),
          },
        ]
      : [];
  });
  const explained = new Set<string>();
  const candidates: Finding[] = [];
  const combined = new Map<string, Finding>();
  const rank = { high: 3, medium: 2, low: 1 };
  for (const rule of run.findings) {
    const ai = aiFindings.find(
      (item) =>
        item.module === rule.module &&
        (item.category === rule.category ||
          [item.category, rule.category].every((category) =>
            ["frontend", "interface", "functional", "stability"].includes(
              category || "",
            ),
          )) &&
        rule.evidenceIds.length > 0 &&
        rule.evidenceIds.every((id) => item.evidenceIds.includes(id)),
    );
    if (!ai) {
      candidates.push(rule);
      continue;
    }
    explained.add(ai.id);
    const previous = combined.get(ai.id);
    if (previous) {
      // Keep separately reviewed rows when merging would lose a tester's
      // disposition or conflict with a manually confirmed owner.
      if (
        rule.note ||
        (rule.disposition && rule.disposition !== "open") ||
        (rule.ownershipSource === "manual" &&
          previous.ownershipSource === "manual" &&
          JSON.stringify(rule.owners) !== JSON.stringify(previous.owners))
      ) {
        candidates.push({
          ...rule,
          ...ai,
          id: rule.id,
          source: "rule",
          explanationSource: "ai",
          deleted: rule.deleted,
          disposition: rule.disposition,
          note: rule.note,
          severity:
            rank[rule.severity] > rank[ai.severity]
              ? rule.severity
              : ai.severity,
          owners: rule.ownershipSource === "manual" ? rule.owners : ai.owners,
          ownershipSource:
            rule.ownershipSource === "manual" ? "manual" : ai.ownershipSource,
        });
        continue;
      }
      previous.evidenceIds = [
        ...new Set([...previous.evidenceIds, ...rule.evidenceIds]),
      ];
      if (rank[rule.severity] > rank[previous.severity])
        previous.severity = rule.severity;
      if (rule.ownershipSource === "manual") {
        previous.owners = rule.owners;
        previous.ownershipSource = "manual";
      } else if (previous.ownershipSource !== "manual") {
        previous.owners = [
          ...new Set([...(previous.owners || []), ...(rule.owners || [])]),
        ].filter((owner) => owner !== "undetermined");
      }
      continue;
    }
    const result: Finding = {
      ...rule,
      ...ai,
      id: rule.id,
      source: "rule",
      explanationSource: "ai",
      deleted: rule.deleted,
      disposition: rule.disposition,
      note: rule.note,
      severity:
        rank[rule.severity] > rank[ai.severity] ? rule.severity : ai.severity,
      evidenceIds: [...new Set([...rule.evidenceIds, ...ai.evidenceIds])],
      owners:
        rule.ownershipSource === "manual"
          ? rule.owners
          : ai.ownershipSource === "manual"
            ? ai.owners
            : [
                ...new Set([...(ai.owners || []), ...(rule.owners || [])]),
              ].filter((owner) => owner !== "undetermined"),
      ownershipSource:
        rule.ownershipSource === "manual" ? "manual" : ai.ownershipSource,
    };
    combined.set(ai.id, result);
    candidates.push(result);
  }
  candidates.push(
    ...aiFindings.filter((finding) => !explained.has(finding.id)),
  );
  return candidates
    .filter(
      (f) =>
        !f.deleted &&
        findingHasRelevantEvidence(run, f) &&
        !isBelowPerformanceThreshold(run, f) &&
        !(
          f.source === "ai" &&
          /重复|冗余|频繁|高频/.test(f.title) &&
          (() => {
            const requests = run.requests.filter(
              (r) => f.evidenceIds.includes(r.id) && !isExcludedRequest(r),
            );
            return requests.length > 0 && !hasRepeatedRequest(requests);
          })()
        ),
    )
    .map((f) => (f.source === "ai" ? constrainRiskClaim(run, f) : f))
    .map((f) =>
      f.source === "ai" &&
      /重复|冗余|频繁|高频/.test(f.title) &&
      run.requests.some(
        (r) => f.evidenceIds.includes(r.id) && !isExcludedRequest(r),
      )
        ? {
            ...f,
            title: "关联操作内出现多次同类请求，需核查",
            confidence: "low" as const,
            impact: "时间关联与调用次数不足以确认重复提交或多余负载。",
            possibleCause: "需核对该端点的重试、刷新及操作约定。",
          }
        : f,
    )
    .map((f) => describeFinding(run, f))
    .map((f) => ({
      ...f,
      observation: findingObservation(run, f),
      ...(f.source === "ai"
        ? {
            title: f.title.replace(
              /\d+(?:\.\d+)?\s*(?:次|毫秒|ms|秒|%)/gi,
              "（数值见观察事实）",
            ),
            detail: `观察事实：${findingObservation(run, f)}\n业务影响（AI建议）：${f.impact || "待核查"}\n可能原因（AI建议）：${f.possibleCause || "未明确"}`,
          }
        : {}),
    }))
    .sort(
      (a, b) =>
        ({ high: 3, medium: 2, low: 1 })[b.severity] -
        { high: 3, medium: 2, low: 1 }[a.severity],
    );
}
export function riskSummary(run: Run, findings = finalFindings(run)) {
  return `高风险 ${findings.filter((f) => f.severity === "high").length} 项、中风险 ${findings.filter((f) => f.severity === "medium").length} 项、低风险 ${findings.filter((f) => f.severity === "low").length} 项。`;
}
export function analysisNarrative(run: Run, findings = finalFindings(run)) {
  return summarizeVerifiedFindings(run, findings).summary;
}
export function analysisConclusion(run: Run, findings = finalFindings(run)) {
  return summarizeVerifiedFindings(run, findings).conclusion;
}
export const interfaceTotal = (run: Run) => requestStats(run).calls;
export const isConsoleLog = (log: LogEvent) =>
  log.level !== "sse" && !log.text.startsWith("触发下载：");
export const consoleTotal = (run: Run) => {
  return run.logs
    .filter((log) => isConsoleLog(log) && !isExcludedResourceLog(log))
    .reduce((sum, log) => sum + countOf(log), 0);
};
export const findingHasRelevantEvidence = (run: Run, finding: Finding) =>
  finding.evidenceIds.some(
    (id) =>
      run.operations.some((item) => item.id === id) ||
      run.logs.some((item) => item.id === id && !isExcludedResourceLog(item)) ||
      (run.pageObservations || []).some((item) => item.id === id) ||
      (run.feedback || []).some((item) => item.id === id) ||
      run.requests.some((item) => item.id === id && !isExcludedRequest(item)),
  );
export const isBelowPerformanceThreshold = (run: Run, finding: Finding) => {
  if (finding.metricScope && finding.metricScope !== "requestDuration")
    return false;
  if (
    finding.category !== "performance" &&
    !/性能|响应时间|响应较慢|耗时|瓶颈/.test(finding.title)
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
  if (call.events?.length === 1)
    Object.assign(call.events[0], {
      duration: call.duration,
      status: call.status,
      failure: call.failure,
    });
  const s = stats(run);
  const remove = () => {
    const i = run.requests.indexOf(call);
    if (i >= 0) run.requests.splice(i, 1);
  };
  if (isExcludedRequest(call)) {
    remove();
    s.filteredRequests += countOf(call);
    return;
  }
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
    if (s.excludedApiRequests !== undefined) s.excludedApiRequests++;
    return;
  }
  // Exact payload comparison: different query values, bodies, pages and steps remain distinct.
  const key = JSON.stringify([
    call.pageId,
    call.framePath,
    call.stepId,
    call.method,
    call.url,
    call.requestBody,
    call.status,
    call.failure,
    call.responseBody,
    call.completion,
    call.bodyState,
    responseMarkers(call),
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
    previous.lastSeen = [
      previous.lastSeen || previous.startedAt,
      call.lastSeen || call.startedAt,
    ]
      .sort()
      .at(-1);
    previous.startedAt = [previous.startedAt, call.startedAt].sort()[0];
    previous.maxDuration = Math.max(
      previous.maxDuration ?? previous.duration ?? 0,
      call.duration ?? 0,
    );
    if (call.events)
      previous.events = [...(previous.events || []), ...call.events];
    remove();
    s.mergedRequests++;
  } else index.set(key, call);
}
export function captureLog(run: Run, log: LogEvent) {
  const s = stats(run);
  s.logs++;
  if (
    isExcludedResourceLog(log) ||
    (!importantLog(log) &&
      log.level !== "sse" &&
      !log.text.startsWith("触发下载："))
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
        if (l) return `${l.level}：${l.text.slice(0, 240)}（${countOf(l)} 次）`;
        const feedback = run.feedback?.find((f) => f.id === id);
        return feedback ? feedbackText(run, feedback) : "关联证据不可用";
      }),
    ),
  ].join("\n");
}
export function problemRequests(run: Run, findings = finalFindings(run)) {
  const groups = new Map<
    string,
    {
      request: NetworkCall;
      reason: string;
      count: number;
      duration: number;
      evidenceIds: string[];
    }
  >();
  for (const r of run.requests) {
    // A micro-frontend can fetch code chunks with Fetch/XHR. A successful chunk is
    // implementation transport, not a business interface or AI issue.
    if (isExcludedRequest(r)) continue;
    // AI 引用了接口证据，只说明它分析过相关操作，不能推导为接口异常。
    // 这里仅展示由协议、业务返回或耗时规则直接证明的问题。
    const ai = findings.find(
      (f) => f.category === "interface" && f.evidenceIds.includes(r.id),
    );
    const reason = requestProblem(r) || ai?.observation || ai?.detail;
    if (!reason) continue;
    const key = JSON.stringify([
      r.module,
      r.method,
      endpoint(r.url),
      semanticIdentity(r),
      responseMarkers(r),
      reason,
    ]);
    const existing = groups.get(key);
    if (existing) {
      existing.count += countOf(r);
      existing.duration = Math.max(
        existing.duration,
        r.maxDuration ?? r.duration ?? 0,
      );
      existing.evidenceIds.push(r.id);
    } else
      groups.set(key, {
        request: r,
        reason,
        count: countOf(r),
        duration: r.maxDuration ?? r.duration ?? 0,
        evidenceIds: [r.id],
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
  const cause =
    requestPossibleCause(r) ||
    "当前缺少具体失败信息，需补充失败响应或错误日志后分析可能原因。";
  if (r.failure)
    return {
      cause,
      advice:
        "按发生时间检查网关及网络错误，复现相同操作并确认请求是否被主动取消。",
    };
  if (r.status === 401 || r.status === 403)
    return {
      cause,
      advice: "核查登录态、令牌有效期与角色权限，补充失效会话及越权断言。",
    };
  if (r.status && r.status >= 500)
    return {
      cause,
      advice:
        "按时间、接口和请求链路核查服务端异常与下游依赖，补充异常响应及重试验证。",
    };
  if (r.status && r.status >= 400)
    return {
      cause,
      advice: "检查参数校验、路由配置及业务前置条件，补充正向与负向用例。",
    };
  if (requestProblem(r)?.includes("耗时"))
    return {
      cause,
      advice:
        "重复采样并拆分网关、服务、数据库耗时，再评估索引、分页、缓存与超时策略。",
    };
  return {
    cause,
    advice:
      "后端按接口、参数和时间核查拒绝或异常分支，必要时与前端联查参数及登录态；确认是否属于预期负向测试，再复测正常输入与失败反馈。",
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
