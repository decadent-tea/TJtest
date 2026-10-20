import type {
  Run,
  NetworkCall,
  LogEvent,
  Finding,
  ProblemOwner,
  Operation,
  PageFeedback,
} from "./types";

export const EVIDENCE_VERSION = 2;
export const SLOW_REQUEST_THRESHOLD_MS = 10_000;
export const isAnalysisCurrent = (run: Run) =>
  run.analysis.evidenceVersion === EVIDENCE_VERSION;
export const ownerLabels: Record<ProblemOwner, string> = {
  frontend: "前端",
  backend: "后端",
  operations: "运维",
  implementation: "实施",
  other: "其他",
  undetermined: "待确认",
};
export const countOf = (item: { occurrences?: number }) =>
  Math.max(1, Math.floor(item.occurrences || 1));
export function hasRepeatedRequest(requests: NetworkCall[]) {
  const counts = new Map<string, number>();
  for (const r of requests) {
    // Manual retries in different steps are independent executions. Unknown
    // attribution cannot establish repetition within one action either.
    if (!r.stepId) continue;
    const key = JSON.stringify([
      r.pageId,
      r.framePath,
      r.stepId,
      r.method,
      r.url,
      r.requestBody,
    ]);
    counts.set(key, (counts.get(key) || 0) + countOf(r));
  }
  return [...counts.values()].some((n) => n > 1);
}
export function endpoint(url: string) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url.split("?")[0];
  }
}
export function isStaticAssetUrl(value: string) {
  let path = value;
  try {
    path = new URL(value).pathname;
  } catch {
    /* Relative/malformed URL. */
  }
  return (
    /\.(?:m?js|cjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|mp[34]|webm)(?:$|[?#])/i.test(
      path,
    ) || /\/(?:static|assets|dist)\/(?:js|css|media|fonts?)\//i.test(path)
  );
}
export const isExcludedRequest = (r: NetworkCall) =>
  isStaticAssetUrl(r.url) ||
  r.category === "resource" ||
  !["xhr", "fetch"].includes(r.resourceType);
export function isExcludedResourceLog(log: LogEvent) {
  if (
    ["pageerror", "unhandledrejection"].includes(log.level) ||
    /(?:TypeError|ReferenceError|SyntaxError)/.test(log.text)
  )
    return false;
  const source = (log.location || "").replace(/:\d+(?::\d+)?$/, "");
  return (
    /Failed to load resource|net::ERR_|(?:font|stylesheet|image).*failed to load/i.test(
      log.text,
    ) &&
    (isStaticAssetUrl(source) ||
      (log.text.match(/https?:\/\/[^\s)]+/g) || []).some(isStaticAssetUrl))
  );
}
export function navigationForLoadingLog(run: Run, log: LogEvent) {
  if (log.level !== "error" || !/^Failed to load resource\b/i.test(log.text))
    return undefined;
  const source = (log.location || "").replace(/:\d+(?::\d+)?$/, "");
  return (run.pageObservations || []).findLast(
    (p) =>
      (p.failure || (p.status && p.status >= 400)) &&
      p.pageId === log.pageId &&
      endpoint(p.url) === endpoint(source) &&
      (p.stepId && log.stepId
        ? p.stepId === log.stepId
        : Math.abs(Date.parse(p.timestamp) - Date.parse(log.timestamp)) <
          60_000),
  );
}
export function requestStats(run: Run, ids?: Set<string>) {
  const requests = [
    ...new Map(
      run.requests
        .filter(
          (r) =>
            !isExcludedRequest(r) &&
            (!ids || ids.has(r.id) || (r.stepId && ids.has(r.stepId))),
        )
        .map((r) => [r.id, r]),
    ).values(),
  ];
  const calls = requests.reduce((n, r) => n + countOf(r), 0);
  return {
    calls,
    records: requests.length,
    endpoints: new Set(
      requests.map((r) => `${r.method.toUpperCase()} ${endpoint(r.url)}`),
    ).size,
    observedApiCalls: ids ? undefined : run.captureStats?.apiRequests,
    excludedApiCalls: ids ? undefined : run.captureStats?.excludedApiRequests,
    countBasis:
      run.evidenceVersion === EVIDENCE_VERSION
        ? "采集请求实例"
        : "按现存记录及合并次数统计；历史过滤明细未采集",
  };
}
export function ownersOf(f: Finding): ProblemOwner[] {
  const values = [...new Set((f.owners || []).filter((v) => v in ownerLabels))];
  if (values.length)
    return values
      .filter((v) => values.length === 1 || v !== "undetermined")
      .sort(
        (a, b) =>
          Object.keys(ownerLabels).indexOf(a) -
          Object.keys(ownerLabels).indexOf(b),
      );
  if (f.category === "frontend") return ["frontend"];
  return ["undetermined"];
}
export const ownershipText = (f: Finding) =>
  ownersOf(f)
    .map((o) => ownerLabels[o])
    .join("、");
export const feedbackKindLabels: Record<PageFeedback["kind"], string> = {
  message: "页面提示",
  dialog: "网页弹窗",
  url: "URL变化",
  title: "标题变化",
  loading: "加载状态",
  empty: "空数据状态",
};
export function feedbackForStep(run: Run, stepId: string) {
  return (run.feedback || []).filter(
    (f) => f.stepId === stepId || f.candidateStepIds?.includes(stepId),
  );
}
export function feedbackText(run: Run, f: PageFeedback) {
  const steps = f.stepId ? [f.stepId] : f.candidateStepIds || [];
  const scope =
    f.association === "ambiguous"
      ? `关联不确定（候选${steps.map((id) => `第${run.operations.find((o) => o.id === id)?.sequence ?? "未知"}步`).join("、")}）`
      : f.stepId
        ? `第${run.operations.find((o) => o.id === f.stepId)?.sequence ?? "未知"}步的时间候选`
        : "页面观察，未关联操作";
  return `${feedbackKindLabels[f.kind]}：${f.before !== undefined || f.after !== undefined ? `${f.before || "未采到前值"} → ${f.after || "空"}` : f.text || "无文本"}（${f.change === "disappeared" ? "消失" : f.change === "changed" ? "变化" : f.change === "initial" ? "初始观察" : "出现"}，${countOf(f)}次；${scope}${f.framePath.length ? `；frame ${f.framePath.join(" / ")}` : ""}${f.truncated ? "；文本受限" : ""}）。`;
}

export function constrainRiskClaim<T extends Omit<Finding, "id" | "source">>(
  run: Run,
  f: T,
): T {
  const verifiedFailure = run.operations.some(
    (o) =>
      f.evidenceIds.includes(o.id) &&
      o.status === "FAILED" &&
      !!(o.assertion || (o.kind === "assert" && o.value)),
  );
  if (
    !["security", "data"].includes(f.category || "") ||
    verifiedFailure ||
    (f.severity !== "high" && f.confidence !== "high")
  )
    return f;
  return {
    ...f,
    severity: "low",
    confidence: "low",
    title: `待验证线索：${f.category === "security" ? "安全风险" : "数据一致性风险"}`,
    impact:
      "现有技术证据不足以证明该风险已发生；需核对响应内容或补充对应的结果断言。",
    possibleCause: "现有证据不足以判断原因。",
  };
}

export interface RequestFact {
  id: string;
  scope: "run" | "action";
  method: string;
  endpoint: string;
  calls: number;
  records: number;
  firstSeen: string;
  lastSeen: string;
  perStepCounts: {
    stepId: string;
    sequence?: number;
    pageId: string;
    calls: number;
  }[];
  statusCodes: number[];
  maxDuration: number;
  failures: string[];
  businessStates: Record<string, unknown>[];
  bodyNotes: string[];
}
export function responseMarkers(r: NetworkCall): Record<string, unknown> {
  let body: unknown = r.businessMarkers || {};
  try {
    const parsed = JSON.parse(r.responseBody || "null");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      body = { ...r.businessMarkers, ...parsed };
  } catch {
    // Sampled/truncated bodies can still have independently parsed markers.
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return Object.fromEntries(
    Object.entries(body)
      .filter(([k]) =>
        /^(code|success|ok|status|message|msg|error|errors|errorMessage|reason)$/i.test(
          k,
        ),
      )
      .map(([k, v]) => [
        k,
        typeof v === "string"
          ? v.slice(0, 160)
          : v && typeof v === "object"
            ? JSON.stringify(v).slice(0, 160)
            : v,
      ]),
  );
}
export function requestProblem(r: NetworkCall): string | undefined {
  if (r.failure) return `网络失败：${r.failure}`;
  if (r.status && r.status >= 400) return `HTTP ${r.status}`;
  const business = businessFailureReason(r);
  if (business) return business;
  if (
    (r.maxDuration ?? r.duration ?? 0) > SLOW_REQUEST_THRESHOLD_MS &&
    ["xhr", "fetch"].includes(r.resourceType) &&
    r.category !== "background"
  )
    return `接口耗时超过 ${SLOW_REQUEST_THRESHOLD_MS}ms`;
  return undefined;
}
export function businessFailureReason(r: NetworkCall): string | undefined {
  const markers = responseMarkers(r);
  if (markers.success === false || markers.ok === false)
    return "业务返回失败标记，需核对业务约定";
  if (/^(?:error|fail|failed|failure)$/i.test(String(markers.status || "")))
    return "业务响应返回失败状态，需核查";
  const message = [
    markers.msg,
    markers.message,
    markers.errorMessage,
    markers.error,
    markers.reason,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("；");
  // A clear failure message is actionable even without a success flag. Numeric
  // business codes alone remain contract-specific; do not assume 0/200 meanings.
  if (
    /(?:操作|请求|查询|加载|保存|提交|删除|更新|登录|服务|系统|内部|数据库|处理|执行|参数|权限|认证|授权)(?:失败|异常|错误)|^(?:error|failed|failure|exception)\b|internal server error|(?:request|query|save|login) failed|access denied|permission denied|unauthorized|forbidden|request timeout/i.test(
      message,
    )
  )
    return "业务响应包含失败提示，需人工核查";
  return undefined;
}
export function suggestedRequestOwners(r: NetworkCall): ProblemOwner[] {
  if (r.failure) return ["undetermined"];
  if (r.status && r.status >= 500) return ["backend"];
  if (r.status && r.status >= 400) return ["frontend", "backend"];
  if (businessFailureReason(r)) return ["backend"];
  return ["undetermined"];
}
export function requestFact(
  run: Run,
  requests: NetworkCall[],
  id: string,
): RequestFact {
  const rows = [...new Map(requests.map((r) => [r.id, r])).values()];
  const steps = new Map<string, RequestFact["perStepCounts"][number]>();
  for (const r of rows) {
    const key = `${r.pageId}|${r.stepId || "unassociated"}`;
    const item = steps.get(key) || {
      stepId: r.stepId || "unassociated",
      sequence: run.operations.find((o) => o.id === r.stepId)?.sequence,
      pageId: r.pageId,
      calls: 0,
    };
    item.calls += countOf(r);
    steps.set(key, item);
  }
  const timestamps = rows
    .flatMap((r) => [
      r.startedAt,
      r.lastSeen || r.startedAt,
      ...(r.events || []).map((e) => e.startedAt),
    ])
    .sort();
  return {
    id,
    scope: steps.size === 1 && rows[0]?.stepId ? "action" : "run",
    method: rows[0]?.method || "",
    endpoint: rows[0] ? endpoint(rows[0].url) : "",
    calls: rows.reduce((n, r) => n + countOf(r), 0),
    records: rows.length,
    firstSeen: timestamps[0] || "",
    lastSeen: timestamps.at(-1) || "",
    perStepCounts: [...steps.values()],
    statusCodes: [
      ...new Set(
        rows.flatMap((r) => (r.status === undefined ? [] : [r.status])),
      ),
    ],
    maxDuration: Math.max(
      0,
      ...rows.map((r) => r.maxDuration ?? r.duration ?? 0),
    ),
    failures: [...new Set(rows.flatMap((r) => (r.failure ? [r.failure] : [])))],
    businessStates: [
      ...new Map(
        rows.map((r) => {
          const markers = responseMarkers(r);
          return [JSON.stringify(markers), markers];
        }),
      ).values(),
    ].filter((v) => Object.keys(v).length > 0),
    bodyNotes: [...new Set(rows.flatMap(requestLimitations))],
  };
}
export function factText(f: RequestFact) {
  const distribution = f.perStepCounts
    .map(
      (s) =>
        `${s.sequence === undefined ? "未关联操作" : `第${s.sequence}步`} ${s.calls}次`,
    )
    .join("；");
  const time = (v: string) =>
    Number.isFinite(Date.parse(v))
      ? new Date(v).toLocaleString("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour12: false,
        })
      : v;
  return `${f.method} ${f.endpoint}：${f.scope === "run" ? "跨步骤汇总" : "当前关联操作"} ${f.calls}次调用，${f.records}条证据；${distribution}；HTTP ${f.statusCodes.join("/") || "未取得响应"}${f.failures.length ? `；网络失败：${f.failures.join("；")}` : ""}${f.businessStates.length ? `；业务标记 ${f.businessStates.map((v) => JSON.stringify(v)).join(" / ")}` : ""}；最大耗时${f.maxDuration}ms${f.scope === "run" ? `；窗口 ${time(f.firstSeen)} 至 ${time(f.lastSeen)}（北京时间）` : ""}${f.bodyNotes.length ? `；证据限制：${f.bodyNotes.join("；")}` : ""}。`;
}
export function findingObservation(run: Run, f: Finding) {
  const selected = run.requests.filter(
    (r) => f.evidenceIds.includes(r.id) && !isExcludedRequest(r),
  );
  const groups = new Map<string, NetworkCall[]>();
  for (const r of selected) {
    const key = `${r.method} ${endpoint(r.url)}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  const facts = [...groups.values()].map((rows) =>
    factText(requestFact(run, rows, "local")),
  );
  const groupedLogs = new Map<
    string,
    { level: string; text: string; count: number }
  >();
  for (const log of run.logs.filter(
    (l) => f.evidenceIds.includes(l.id) && !isExcludedResourceLog(l),
  )) {
    const key = JSON.stringify([log.level, log.text, log.location]);
    const previous = groupedLogs.get(key);
    if (previous) previous.count += countOf(log);
    else
      groupedLogs.set(key, {
        level: log.level,
        text: log.text,
        count: countOf(log),
      });
  }
  const logs = [...groupedLogs.values()].map(
    (log) => `${log.level}记录${log.count}次：${log.text.slice(0, 1000)}`,
  );
  const linked = findingOperations(run, f);
  const operationGroups = new Map<string, Operation[]>();
  for (const op of linked) {
    const key = `${op.pageId}|${op.kind}|${op.label}`;
    operationGroups.set(key, [...(operationGroups.get(key) || []), op]);
  }
  const operations = [...operationGroups.values()].map((items) => {
    const first = items[0];
    const numbers = items.map((item) => item.sequence).join("、");
    return `操作背景：第${numbers}步${first.label}${items.length > 1 ? `（共${items.length}次独立录制操作）` : ""}${first.error ? `；执行错误：${first.error}` : ""}。`;
  });
  const pages = (run.pageObservations || [])
    .filter((p) => f.evidenceIds.includes(p.id))
    .map(
      (p) =>
        `页面导航 ${endpoint(p.url)}：HTTP ${p.status ?? "未取得响应"}${p.failure ? `；${p.failure}` : ""}（只观察导航，不判业务通过）。`,
    );
  const feedback = (run.feedback || [])
    .filter((p) => f.evidenceIds.includes(p.id))
    .map((p) => feedbackText(run, p));
  return (
    [...operations, ...facts, ...logs, ...pages, ...feedback].join("\n") ||
    "关联证据不可用，无法核实观察事实。"
  );
}

export function findingOperations(
  run: Run,
  finding: Pick<Finding, "evidenceIds">,
): Operation[] {
  const ids = new Set(finding.evidenceIds);
  for (const signal of [
    ...run.requests.filter((r) => !isExcludedRequest(r)),
    ...run.logs.filter((l) => !isExcludedResourceLog(l)),
    ...(run.pageObservations || []),
    ...(run.feedback || []),
  ]) {
    if (ids.has(signal.id) && signal.stepId) ids.add(signal.stepId);
  }
  return run.operations
    .filter((op) => ids.has(op.id))
    .sort((a, b) => a.sequence - b.sequence);
}

export function findingReproduction(
  run: Run,
  finding: Pick<Finding, "evidenceIds">,
): string[] {
  const linked = findingOperations(run, finding);
  if (!linked.length) return [];
  const first = linked[0];
  const context = run.operations
    .filter(
      (op) =>
        op.pageId === first.pageId &&
        op.sequence < first.sequence &&
        op.sequence >= first.sequence - 40 &&
        ["click", "navigate"].includes(op.kind) &&
        !/^(?:点击|打开页面)\s*[·:]?\s*(?:div|span|canvas|i|img|input|body)$/i.test(
          op.label,
        ),
    )
    .slice(-3);
  return [
    `打开测试页面 ${endpoint(first.url || run.url)}`,
    ...[...context, ...linked]
      .slice(0, 12)
      .map((op) => `第${op.sequence}步：${op.label}（${op.module}）`),
  ];
}

export function requestLimitations(r: NetworkCall): string[] {
  const result = r.bodyNote ? [r.bodyNote] : [];
  if (
    ["pending", "stopped"].includes(r.completion || "") ||
    (r.status === undefined && !r.failure)
  )
    result.push("请求未完整结束，响应头不代表完整业务结果");
  if (
    ["sampled", "unavailable", "streaming"].includes(r.bodyState || "") &&
    !r.bodyNote
  )
    result.push(
      r.bodyState === "sampled" ? "响应正文为限额样本" : "响应正文未完整采集",
    );
  return [...new Set(result)];
}

// Evidence availability is separate from business verification. A captured HTTP
// response can support technical diagnosis without proving the action succeeded.
export function operationEvidence(run: Run, op: Operation) {
  const requests = run.requests.filter(
    (r) => r.stepId === op.id && !isExcludedRequest(r),
  );
  const logs = run.logs.filter(
    (l) => l.stepId === op.id && !isExcludedResourceLog(l),
  );
  const pages = (run.pageObservations || []).filter((p) => p.stepId === op.id);
  const feedback = feedbackForStep(run, op.id);
  const verified =
    !!(op.assertion || (op.kind === "assert" && op.value)) &&
    op.status === "PASSED";
  const requestCalls = requests.reduce((n, r) => n + countOf(r), 0);
  const bodyLimited = requests.filter(
    (r) => requestLimitations(r).length > 0,
  ).length;
  const available =
    requests.length > 0 ||
    logs.length > 0 ||
    pages.length > 0 ||
    feedback.length > 0 ||
    !!op.screenshot ||
    !!op.error ||
    verified;
  const state = ["BLOCKED", "SKIPPED"].includes(op.status)
    ? ("not-executed" as const)
    : bodyLimited ||
        feedback.some((f) => f.association === "ambiguous" || f.truncated)
      ? ("partial" as const)
      : available
        ? ("available" as const)
        : ("missing" as const);
  const reason =
    state === "not-executed"
      ? "本步未执行，不能判断结果。"
      : state === "missing"
        ? "仅采到操作记录，没有关联接口、日志、导航或截图；页面效果未取证。"
        : state === "partial"
          ? bodyLimited
            ? "已取得部分技术证据，但存在未结束请求或正文采样/缺失，不能判断完整业务结果。"
            : "已采到页面反馈，但关联不确定或文本受限；不能据此确认某一步的业务结果。"
          : verified
            ? "已执行明确断言；其他证据仍限定于本次采集范围。"
            : !requests.length &&
                !logs.length &&
                !pages.length &&
                !feedback.length &&
                op.screenshot
              ? "仅保存步骤截图，可核对画面；文本AI未读取截图，页面效果和业务结果未验证。"
              : feedback.length
                ? "已采到页面反馈；时间关联只作候选，反馈文字不等于业务结果断言。"
                : "已取得技术证据，可诊断接口/运行异常；未执行结果断言，业务结果未验证。";
  return {
    state,
    reason,
    requestCalls,
    logs: logs.reduce((n, l) => n + countOf(l), 0),
    bodyLimited,
    verified,
  };
}

export function evidenceCoverage(run: Run) {
  const eligible = run.operations.filter(
    (o) =>
      !["BLOCKED", "SKIPPED"].includes(o.status) &&
      (!["hover", "scroll"].includes(o.kind) ||
        o.error ||
        o.assertion ||
        o.status === "FAILED" ||
        run.requests.some((r) => r.stepId === o.id && !isExcludedRequest(r)) ||
        run.logs.some((l) => l.stepId === o.id && !isExcludedResourceLog(l)) ||
        (run.pageObservations || []).some((p) => p.stepId === o.id) ||
        feedbackForStep(run, o.id).length > 0),
  );
  const states = eligible.map((o) => operationEvidence(run, o));
  const requests = run.requests.filter((r) => !isExcludedRequest(r));
  const requestBodyLimited = requests.filter(
    (r) => requestLimitations(r).length > 0,
  ).length;
  const pendingRequests = requests
    .filter(
      (r) =>
        ["pending", "stopped"].includes(r.completion || "") ||
        (r.status === undefined && !r.failure),
    )
    .reduce((n, r) => n + countOf(r), 0);
  const withoutEvidence = states.filter((s) => s.state === "missing").length;
  const partialSteps = states.filter((s) => s.state === "partial").length;
  const screenshotOnlySteps = eligible.filter(
    (o) =>
      o.screenshot &&
      !o.error &&
      !run.requests.some((r) => r.stepId === o.id && !isExcludedRequest(r)) &&
      !run.logs.some((l) => l.stepId === o.id && !isExcludedResourceLog(l)) &&
      !(run.pageObservations || []).some((p) => p.stepId === o.id) &&
      !feedbackForStep(run, o.id).length,
  ).length;
  const limitations = [
    ...(run.feedback === undefined
      ? ["历史未采集页面反馈；页面提示、弹窗和加载结果不能补造。"]
      : []),
    ...((run.feedback || []).some((f) => f.association === "ambiguous")
      ? ["部分页面反馈有多个候选操作，未强行分配给最后一步。"]
      : []),
    ...(run.feedbackCapture?.discarded
      ? ["页面反馈达到采集限额，超限部分未保存。"]
      : []),
    ...(withoutEvidence
      ? [`${withoutEvidence}个关键操作仅有操作记录，页面效果未取证。`]
      : []),
    ...(requestBodyLimited
      ? [`${requestBodyLimited}条请求证据存在未结束、正文采样或不可读取限制。`]
      : []),
    ...(screenshotOnlySteps
      ? [
          `${screenshotOnlySteps}个关键操作仅保留步骤截图；文本AI未读取画面，不能自动判断页面效果。`,
        ]
      : []),
    "没有明确断言不等于没有取证；未发现技术异常不等于业务通过。",
    ...(!eligible.length ? ["未采集关键操作，不能评价系统质量。"] : []),
  ];
  return {
    eligibleSteps: eligible.length,
    withEvidence: states.length - withoutEvidence,
    partialSteps,
    withoutEvidence,
    assertedSteps: states.filter((s) => s.verified).length,
    requestBodyLimited,
    pendingRequests,
    screenshotOnlySteps,
    limitations,
  };
}
// RPC/gateway operation values define semantics; do not group solely by field types.
export function semanticIdentity(r: NetworkCall) {
  const keys =
    /^(?:operation(?:Name)?|action|method|command|rpc|query|mutation|type|service)$/i;
  const semantic: unknown[] = [];
  try {
    for (const [k, v] of new URL(r.url).searchParams)
      if (keys.test(k)) semantic.push([k, v]);
  } catch {
    /* URL remains in the caller's signature. */
  }
  try {
    const walk = (v: unknown, depth: number) => {
      if (!v || typeof v !== "object" || depth > 3) return;
      for (const [k, value] of Object.entries(v)) {
        if (keys.test(k)) semantic.push([k, value]);
        else if (!Array.isArray(value)) walk(value, depth + 1);
      }
    };
    walk(JSON.parse(r.requestBody || "null"), 0);
  } catch {
    /* Non JSON remains exact. */
  }
  return semantic;
}
