import {
  finalFindings,
  riskSummary,
  analysisNarrative,
  analysisConclusion,
  isStaticAssetUrl,
  requestProblem,
  evidenceLabel,
  problemRequests,
  importantLog,
  countOf,
  interfaceTotal,
  consoleTotal,
  SLOW_REQUEST_THRESHOLD_MS,
  endpoint,
  causeAdvice,
} from "../server/evidence-quality";
import type { Run, LogEvent, Finding } from "./types";
import {
  requestStats,
  ownershipText,
  findingObservation,
  EVIDENCE_VERSION,
  feedbackText,
  evidenceCoverage,
  requestFact,
  factText,
} from "./inspection-evidence";
const severityLabel = { high: "高", medium: "中", low: "低" };
function textContext(run: Run) {
  const labels = new Map<string, string>([
    ...run.operations.map(
      (op) => [op.id, `第${op.sequence}步（${op.label}）`] as const,
    ),
    ...run.requests.map(
      (request) =>
        [request.id, `${request.method} ${endpoint(request.url)}`] as const,
    ),
    ...run.logs.map((log) => [log.id, `浏览器${log.level}日志`] as const),
  ]);
  const ids = [...labels.keys()]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const pattern = ids.length
    ? new RegExp(
        ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
        "g",
      )
    : undefined;
  return { labels, pattern };
}
export function reportText(
  run: Run,
  value: unknown,
  context = textContext(run),
) {
  let text = String(value ?? "");
  // Keep one source position per error, without dumping generated bundle stacks.
  let inStack = false;
  text = text
    .split(/\r?\n/)
    .flatMap((line) => {
      if (/^\s*(?:日志\s*ID|关联证据\s*[:：])/i.test(line)) return [];
      if (/^\s*(?:at\s+|\(?https?:\/\/\S+\.(?:m?js|cjs):\d+)/i.test(line)) {
        const position = line.match(
          /https?:\/\/[^\s()]+\.(?:m?js|cjs)(?::\d+){1,2}/i,
        )?.[0];
        if (!position || inStack) return [];
        inStack = true;
        return [`堆栈位置：${position}`];
      }
      inStack = false;
      return [line];
    })
    .join("\n")
    .replace(
      /\(?https?:\/\/[^\s()，。；]+\.(?:m?js|cjs)(?::\d+){1,2}\)?/gi,
      (position) => {
        const location = position
          .replace(/[()]/g, "")
          .match(/\.(?:m?js|cjs)((?::\d+){1,2})$/i)?.[1];
        return `前端脚本${location || ""}`;
      },
    )
    .replace(/\b[\w.-]*[._-][a-f0-9]{8,}\.(?:m?js|cjs)\b/gi, "前端脚本")
    .replace(/\.[a-f0-9]{8,}(?=\.(?:m?js|cjs|css|ttf|otf|woff2?|eot)\b)/gi, "")
    .replace(
      /(?:日志\s*)?(?:关联证据\s*)?\bID\s*[:：]\s*[a-f0-9-]{8,}(?:\s*[,，、;；]\s*[a-f0-9-]{8,})*/gi,
      "",
    );
  if (context.pattern)
    text = text.replace(context.pattern, (id) => context.labels.get(id) || id);
  return text
    .replace(
      /\b(?:id|ID)\s*[:：]?\s*(?=(?:GET|POST|PUT|PATCH|DELETE|第\d+步|浏览器))/g,
      "",
    )
    .replace(/(?:关联证据\s*[、,，;；:：.。…]*)+/g, "")
    .replace(/\.{2,}(?=(?:m?js|cjs|css|ttf|otf|woff2?|eot)\b)/gi, ".")
    .replace(/\(\s*\)|（\s*）/g, "")
    .replace(/\s*[,，、;；]\s*[,，、;；]/g, "，")
    .replace(/\s+([，。；、])/g, "$1")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export type ReportBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "paragraph"; text: string; boldPrefix?: string }
  | { kind: "table"; headers: string[]; rows: string[][] };
type ReportLog = {
  log: LogEvent;
  module: string;
  evidenceIds: string[];
  count: number;
  status?: string;
  resources: Set<string>;
};
function reportLogs(run: Run): ReportLog[] {
  const groups = new Map<string, ReportLog>();
  for (const log of run.logs.filter(importantLog)) {
    const module =
      run.operations.find((op) => op.id === log.stepId)?.module || "页面后台";
    const status = log.text.match(
      /Failed to load resource:.*status of (\d+)/i,
    )?.[1];
    const resourceUrl = log.location?.replace(/:\d+(?::\d+)?$/, "");
    const staticResource =
      status && resourceUrl && isStaticAssetUrl(resourceUrl);
    const key = staticResource
      ? JSON.stringify([module, "static", status])
      : JSON.stringify([module, log.level, log.text, log.location]);
    let group = groups.get(key);
    if (!group) {
      group = {
        log,
        module,
        evidenceIds: [],
        count: 0,
        status: staticResource ? status : undefined,
        resources: new Set(),
      };
      groups.set(key, group);
    }
    group.evidenceIds.push(log.id);
    group.count += countOf(log);
    if (staticResource) {
      const pathname = new URL(resourceUrl, "http://local").pathname;
      const rawName = pathname.split("/").at(-1) || "";
      let name = rawName;
      try {
        name = decodeURIComponent(rawName);
      } catch {
        // Keep malformed asset names readable without affecting report export.
      }
      group.resources.add(
        /\.(?:m?js|cjs)$/i.test(name) ? "脚本资源（路径省略）" : name,
      );
    }
  }
  return [...groups.values()];
}
export function reportContent(
  run: Run,
  findings: Finding[] = finalFindings(run),
): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const context = textContext(run);
  const clean = (value: unknown) => reportText(run, value, context);
  const h = (level: 1 | 2 | 3 | 4, text: string) =>
    blocks.push({ kind: "heading", level, text: clean(text) });
  const p = (text: string) => {
    const cleaned = clean(text);
    const boldPrefix = cleaned.match(
      /^(?:模块|问题归属|观察事实|问题分析|处置方向|业务影响|复现路径|原因分析|解决方案|验证建议)：/,
    )?.[0];
    blocks.push({ kind: "paragraph", text: cleaned, boldPrefix });
  };
  const table = (headers: string[], rows: unknown[][]) =>
    blocks.push({
      kind: "table",
      headers,
      rows: rows.map((r) => r.map(clean)),
    });
  const requests = problemRequests(run, findings),
    logs = reportLogs(run);
  const judged = run.analysis.status === "COMPLETED";
  const reviewedAnalysis = findings.some(
    (finding) => finding.explanationSource === "ai",
  );
  const hasAnalysis =
    run.analysis.evidenceVersion === EVIDENCE_VERSION || reviewedAnalysis;
  const stats = requestStats(run);
  const coverage = evidenceCoverage(run);
  const passed = run.cases.filter((c) => c.status === "PASSED").length;
  const failed = run.cases.filter((c) => c.status === "FAILED").length;
  const other = run.cases.filter((c) =>
    ["RECORDED", "EXECUTED"].includes(c.status),
  ).length;
  h(1, "一 概要");
  p(
    "本报告面向项目负责人，依据实际操作、业务接口与浏览器日志分析质量风险，并给出项目优化和维护方向。" +
      riskSummary(run, findings) +
      (judged ? "" : "基础规则报告已生成；AI分析为可选补充。"),
  );
  table(
    ["项目", "内容"],
    [
      ["项目名称", run.project],
      ["体检任务", run.name],
      ["执行环境", run.environment],
      ["测试入口", endpoint(run.url)],
      [
        "测试方式",
        (run.mode === "record" ? "人工录制" : "自动回放") +
          (judged ? "，已完成 AI 分析" : "，基础规则检查（AI 分析可选）"),
      ],
      ["开始时间", run.startedAt],
      ["结束时间", run.endedAt || "尚未结束"],
    ],
  );
  h(1, "二 测试范围与内容");
  p(
    "实际访问模块：" +
      ([
        ...new Set(
          run.operations
            .filter((o) => !["BLOCKED", "SKIPPED"].includes(o.status))
            .map((o) => o.module),
        ),
      ].join("、") || "无操作记录") +
      "。测试内容包括操作路径、执行反馈、业务接口异常和 Console 日志。结论限定于本次执行及所采集证据，单次耗时不作为压力测试结论。",
  );
  h(1, "三 测试过程与统计");
  h(2, "3.1 执行范围与结果");
  table(
    ["统计项", "结果"],
    [
      ["操作记录总数（含阻塞和跳过）", run.cases.length],
      ["通过（明确断言已验证）", passed],
      ["关键操作（含触发证据的悬浮和滚动）", coverage.eligibleSteps],
      ["关键操作已有证据（含截图或受限）", coverage.withEvidence],
      ["其中技术证据受限的关键操作", coverage.partialSteps],
      ["关键操作仅有记录，页面效果未取证", coverage.withoutEvidence],
      ["明确断言已验证的关键操作", coverage.assertedSteps],
      ["失败", failed],
      ["已记录或执行，结果未验证", other],
      ["阻塞", run.cases.filter((c) => c.status === "BLOCKED").length],
      ["跳过", run.cases.filter((c) => c.status === "SKIPPED").length],
      [
        "通过率",
        passed + failed
          ? ((passed / (passed + failed)) * 100).toFixed(1) + "%"
          : "暂无可判定检查",
      ],
      ["保留的 Fetch/XHR 调用次数", interfaceTotal(run)],
      ["接口证据记录数（合并后）", stats.records],
      ["唯一端点数（方法与路径）", stats.endpoints],
      [
        "观察到的非静态Fetch/XHR",
        stats.observedApiCalls ?? "历史未采集过滤明细",
      ],
      ["策略排除调用", stats.excludedApiCalls ?? "历史未采集过滤明细"],
      ["正文或完成状态受限的请求记录", coverage.requestBodyLimited],
      ["未结束或结束时中断的请求调用", coverage.pendingRequests],
      ["页面导航观察（不计接口调用）", (run.pageObservations || []).length],
      [
        "页面反馈观察（不计接口调用）",
        run.feedback === undefined
          ? "历史未采集此类证据"
          : `${run.feedback.reduce((n, f) => n + countOf(f), 0)}次，${run.feedback.length}条证据；${run.feedback.filter((f) => f.association === "ambiguous").length}条关联不确定`,
      ],
      ["Console 总数（保留日志次数）", consoleTotal(run)],
      ["风险分布", riskSummary(run, findings)],
    ],
  );
  p("取证范围与限制：" + coverage.limitations.join("；"));
  p(
    "通过仅表示明确断言成立；失败表示定位、执行或断言明确失败。无法判断、未执行和跳过不计入通过率分母；未发现异常不等于业务通过。规则问题为异常观察，需按项目约定核对是否为预期负向测试。接口次数按请求实例/合并次数计算，证据记录数与AI代表项不同。" +
      stats.countBasis,
  );
  h(2, "3.2 执行过程（操作路径）");
  p(
    "以下沿用录制步骤编号；连续正常悬浮和重复页面跳转合并展示并保留次数，有异常证据的步骤单独列出。",
  );
  const shortLabel = (label: string, kind: string) => {
    if (kind === "scroll") return "滚动页面";
    const compact = label.replace(/\s+/g, " ").trim();
    if (compact.length > 100)
      return `${compact.includes("·") ? compact.split("·")[0].trim() : "页面操作"} · 页面内容`;
    return compact.length > 80 ? compact.slice(0, 80) + "…" : compact;
  };
  let lastModule = "";
  const steps: string[] = [];
  const problemSteps = new Set([
    ...run.operations
      .filter(
        (op) =>
          op.error ||
          op.assertion ||
          op.kind === "assert" ||
          op.status === "FAILED",
      )
      .map((op) => op.id),
    ...run.requests
      .filter(requestProblem)
      .flatMap((r) => (r.stepId ? [r.stepId] : [])),
    ...run.logs
      .filter(importantLog)
      .flatMap((l) => (l.stepId ? [l.stepId] : [])),
    ...(run.pageObservations || [])
      .filter((p) => p.failure || (p.status && p.status >= 400))
      .flatMap((p) => (p.stepId ? [p.stepId] : [])),
    ...findings.flatMap((f) => [
      ...f.evidenceIds,
      ...run.requests
        .filter((r) => f.evidenceIds.includes(r.id))
        .flatMap((r) => (r.stepId ? [r.stepId] : [])),
    ]),
  ]);
  for (let index = 0; index < run.operations.length;) {
    const op = run.operations[index];
    const module = op.module !== lastModule ? `${op.module} / ` : "";
    lastModule = op.module;
    if (op.kind === "hover" && !problemSteps.has(op.id)) {
      const group = [op];
      while (
        run.operations[index + group.length]?.kind === "hover" &&
        run.operations[index + group.length].module === op.module &&
        !problemSteps.has(run.operations[index + group.length].id)
      )
        group.push(run.operations[index + group.length]);
      const targets = [
        ...new Set(
          group.map((item) =>
            item.label
              .replace(/^鼠标悬浮\s*·\s*/, "")
              .replace(/\s+/g, " ")
              .trim(),
          ),
        ),
      ];
      const briefTargets = [
        ...new Set(
          targets.map((target) => (target.length > 40 ? "页面内容" : target)),
        ),
      ];
      steps.push(
        `第${op.sequence}${group.length > 1 ? `—${group.at(-1)!.sequence}` : ""}步（${group.length}次悬浮）：${module}悬浮浏览：${briefTargets.slice(0, 5).join("、")}${briefTargets.length > 5 ? `等 ${briefTargets.length} 项` : ""}`,
      );
      index += group.length;
      continue;
    }
    if (op.kind === "goto" && !problemSteps.has(op.id)) {
      let count = 1;
      while (
        run.operations[index + count]?.kind === "goto" &&
        run.operations[index + count].module === op.module &&
        run.operations[index + count].label === op.label &&
        !problemSteps.has(run.operations[index + count].id)
      )
        count++;
      if (count > 1) {
        steps.push(
          `第${op.sequence}—${run.operations[index + count - 1].sequence}步（${count}次跳转）：${module}${shortLabel(op.label, op.kind)}`,
        );
        index += count;
        continue;
      }
    }
    steps.push(
      `第${op.sequence}步：${module}${shortLabel(op.label, op.kind)}${op.error ? "〔执行失败〕" : ""}${["BLOCKED", "SKIPPED"].includes(op.status) ? "〔未执行〕" : ""}`,
    );
    index++;
  }
  for (let index = 0; index < steps.length; index += 8)
    p(steps.slice(index, index + 8).join("；") + "。");
  if (!run.operations.length) p("本次没有操作记录。");
  if (run.feedback?.length) {
    h(3, "3.2.1 页面反馈摘要");
    p(
      "以下优先展示提示和弹窗，随后展示URL、标题、加载和空状态；反馈不代表业务通过，时间候选不证明因果。全部记录可在页面反馈证据标签查看。",
    );
    const ordered = [...run.feedback].sort(
      (a, b) =>
        Number(b.kind === "message" || b.kind === "dialog") -
          Number(a.kind === "message" || a.kind === "dialog") ||
        a.timestamp.localeCompare(b.timestamp),
    );
    ordered.slice(0, 20).forEach((f) => p(feedbackText(run, f)));
    if (ordered.length > 20)
      p(`本报告摘要展示20条，其余${ordered.length - 20}条保留在本机证据中。`);
  }
  h(1, "四 测试结果及分析");
  h(2, "4.1 问题接口");
  for (const [
    index,
    { request: r, reason, evidenceIds },
  ] of requests.entries()) {
    const ai = findings.filter((f) =>
      f.evidenceIds.some((id) => evidenceIds.includes(id)),
    );
    const groupRequests = run.requests.filter((item) =>
      evidenceIds.includes(item.id),
    );
    h(3, `4.1.${index + 1} ${r.method} ${endpoint(r.url)}`);
    p("模块：" + r.module);
    p(
      "观察事实：" +
        reason +
        "；" +
        factText(requestFact(run, groupRequests, "report")),
    );
    p(
      "问题分析：" +
        ([...new Set(ai.map((f) => f.possibleCause).filter(Boolean))].join(
          "；",
        ) || causeAdvice(r).cause),
    );
    p(
      "处置方向：" +
        (ai
          .map((f) => f.suggestion)
          .filter(Boolean)
          .join("；") ||
          (judged
            ? "保留异常监测，当前证据未支持新增整改项。"
            : causeAdvice(r).advice)),
    );
  }
  if (!requests.length) p("未发现问题接口。");
  h(2, "4.2 问题 Console 日志");
  for (const [index, item] of logs.entries()) {
    const { log: l } = item;
    const ai = findings.filter((f) =>
      f.evidenceIds.some((id) => item.evidenceIds.includes(id)),
    );
    const firstLine = l.text.split("\n")[0].replace(run.project, "").trim();
    h(
      3,
      item.status
        ? `4.2.${index + 1} 静态资源加载失败 · HTTP ${item.status}`
        : `4.2.${index + 1} ${l.level} · ${firstLine.slice(0, 140)}${firstLine.length > 140 ? "…" : ""}`,
    );
    p("模块：" + item.module);
    p(
      "观察事实：" +
        (item.status
          ? `浏览器报告静态资源 HTTP ${item.status}，涉及 ${[...item.resources].join("、")}（${item.count} 次）`
          : `${item.count}次记录；${l.text.slice(0, 1200)}`),
    );
    p(
      "问题分析：" +
        ([...new Set(ai.map((f) => f.possibleCause).filter(Boolean))].join(
          "；",
        ) ||
          "日志表明浏览器记录了异常或警告；实际影响与根因需结合对应操作确认。"),
    );
    p(
      "处置方向：" +
        ([...new Set(ai.map((f) => f.suggestion).filter(Boolean))].join("；") ||
          (judged
            ? "保留日志监测，当前证据未支持新增整改项。"
            : "根据日志源位置及关联操作检查异常分支，补充回归验证。")),
    );
  }
  if (!logs.length) p("未采集到错误或警告日志。");
  h(2, "4.3 发现问题");
  for (const [index, severity] of (
    ["high", "medium", "low"] as const
  ).entries()) {
    h(3, "4.3." + (index + 1) + " " + severityLabel[severity] + "风险");
    const group = findings.filter((f) => f.severity === severity);
    if (!group.length) p("本次未发现该等级风险。");
    for (const [i, f] of group.entries()) {
      h(4, "4.3." + (index + 1) + "." + (i + 1) + " " + clean(f.title));
      p("模块：" + f.module);
      p(
        "问题归属：" +
          ownershipText(f) +
          (f.ownershipSource === "manual"
            ? "（人工确认）"
            : "（建议，人工可调整）"),
      );
      p("观察事实：" + findingObservation(run, f));
      p("业务影响：" + (f.impact || "影响范围限定于关联操作和异常证据。"));
      p(
        "复现路径：" +
          (f.reproductionSteps?.join(" → ") ||
            evidenceLabel(run, f.evidenceIds)),
      );
      p(
        "原因分析：" +
          (f.possibleCause ||
            "现有记录缺少具体异常信息，暂无法提出有依据的可能原因。"),
      );
      p("解决方案：" + (f.suggestion || "针对关联异常修复后执行自动回归。"));
      p(
        "验证建议：" +
          (f.validationSteps?.join("；") ||
            "回放关联操作，确认原异常消失且操作目标达成。"),
      );
    }
  }
  h(2, "4.4 AI 分析摘要");
  p(riskSummary(run, findings));
  if (reviewedAnalysis && run.analysis.evidenceVersion !== EVIDENCE_VERSION)
    p(
      "历史AI问题明细已按现有录制证据逐项复核；接口次数和观察事实以原始采集记录为准，缺少证据支持的旧结论未纳入报告。",
    );
  p(
    hasAnalysis
      ? analysisNarrative(run, findings) || "AI分析未完成；基础规则事实仍有效。"
      : (run.analysis.status === "COMPLETED"
          ? "当前为基础规则报告；历史AI分析未经过新版统计范围校验，可重新分析。"
          : "当前为基础规则报告，已列出采集到的异常；AI分析可进一步补充原因和处置建议。") +
          (run.analysis.error || ""),
  );
  h(1, "五 测试结论");
  p(
    (hasAnalysis ? analysisConclusion(run, findings) : undefined) ||
      "本次结论限于实际访问、采集和已验证的检查。请按有证据的问题复测；未访问或结果未验证的部分不判通过。" +
        riskSummary(run, findings),
  );
  return blocks;
}
