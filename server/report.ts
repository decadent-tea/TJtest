import {
  finalFindings,
  riskSummary,
  analysisNarrative,
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
} from "./evidence-quality";
import { randomUUID } from "node:crypto";
import type { Run, Finding, LogEvent } from "../shared/types";
import {
  isExcludedRequest,
  isExcludedResourceLog,
  EVIDENCE_VERSION,
  responseMarkers,
  navigationForLoadingLog,
  semanticIdentity,
  operationEvidence,
  feedbackForStep,
  feedbackText,
  isAnalysisCurrent,
  suggestedRequestOwners,
} from "../shared/inspection-evidence";
export function finalizeReport(run: Run) {
  // Apply the same resource policy to historical recordings on read/export.
  const removed = run.requests.filter(isExcludedRequest);
  if (removed.length) {
    run.requests = run.requests.filter((r) => !isExcludedRequest(r));
  }
  run.logs = run.logs.filter((l) => !isExcludedResourceLog(l));
  const previous = run.findings;
  const findings: Finding[] = [];
  const seen = new Map<string, Finding>();
  const reusedIds = new Set<string>();
  const add = (key: string, value: Omit<Finding, "id" | "source">) => {
    const existing = seen.get(key);
    if (existing) {
      existing.evidenceIds.push(...value.evidenceIds);
      return;
    }
    const old = previous.find(
      (item) =>
        item.source === "rule" &&
        item.module === value.module &&
        item.title === value.title &&
        item.evidenceIds.some((id) => value.evidenceIds.includes(id)),
    );
    const f = {
      ...value,
      id: old && !reusedIds.has(old.id) ? old.id : randomUUID(),
      source: "rule" as const,
      disposition: old?.disposition,
      note: old?.note,
      deleted: old?.deleted,
      ...(old?.ownershipSource === "manual"
        ? { owners: old.owners, ownershipSource: old.ownershipSource }
        : {}),
    };
    reusedIds.add(f.id);
    seen.set(key, f);
    findings.push(f);
  };
  for (const req of run.requests) {
    if (requestProblem(req) && !requestProblem(req)!.includes("耗时"))
      add(
        JSON.stringify([
          req.module,
          req.method,
          endpoint(req.url),
          semanticIdentity(req),
          req.status,
          req.failure,
          requestProblem(req),
          responseMarkers(req),
        ]),
        {
          severity: req.status && req.status >= 500 ? "high" : "medium",
          title: requestProblem(req)!,
          owners: suggestedRequestOwners(req),
          confidence: "high",
          ownershipSource: "rule",
          category: "interface",
          module: req.module,
          detail: `${req.description}\n${req.method} ${endpoint(req.url)}\n${requestProblem(req)}，出现 ${countOf(req)} 次。请核对是否为预期负向测试。`,
          evidenceIds: [req.id],
          possibleCause: causeAdvice(req).cause,
          suggestion: causeAdvice(req).advice,
        },
      );
    if (requestProblem(req)?.includes("耗时"))
      add(
        JSON.stringify([
          "slow",
          req.module,
          req.method,
          endpoint(req.url),
          semanticIdentity(req),
        ]),
        {
          severity: "low",
          owners: ["undetermined"],
          ownershipSource: "rule",
          category: "performance",
          metricScope: "requestDuration",
          title: "业务接口响应较慢",
          module: req.module,
          detail: `${req.method} ${endpoint(req.url)} 最大耗时 ${req.maxDuration ?? req.duration}ms，超过异常阈值 ${SLOW_REQUEST_THRESHOLD_MS}ms；这不是压力测试结论。`,
          evidenceIds: [req.id],
          possibleCause: causeAdvice(req).cause,
          suggestion: causeAdvice(req).advice,
        },
      );
  }
  for (const log of run.logs) {
    // The browser reports a navigation failure both on the network and in
    // console. Keep the log as supporting evidence of the navigation issue.
    if (navigationForLoadingLog(run, log)) continue;
    const module =
      run.operations.find((o) => o.id === log.stepId)?.module || "页面后台";
    if (
      ["error", "pageerror", "warning", "warn", "unhandledrejection"].includes(
        log.level,
      )
    )
      add(JSON.stringify([module, log.level, log.text, log.location]), {
        severity: ["pageerror", "unhandledrejection"].includes(log.level)
          ? "high"
          : log.level === "error"
            ? "medium"
            : "low",
        title: ["warning", "warn"].includes(log.level)
          ? "前端警告"
          : "前端错误",
        owners: ["frontend"],
        ownershipSource: "rule",
        category: "frontend",
        module,
        detail: log.text,
        evidenceIds: [log.id],
        suggestion: "核查消息来源和堆栈，确认是否影响当前业务。",
      });
  }
  for (const page of run.pageObservations || []) {
    if (!page.failure && !(page.status && page.status >= 400)) continue;
    const module =
      run.operations.find((op) => op.id === page.stepId)?.module || "页面导航";
    add(
      JSON.stringify([
        "navigation",
        module,
        endpoint(page.url),
        page.status,
        page.failure,
      ]),
      {
        severity: page.status && page.status >= 500 ? "high" : "medium",
        title: "页面导航异常",
        category: "stability",
        owners: ["undetermined"],
        ownershipSource: "rule",
        module,
        detail: `${endpoint(page.url)}：${page.failure || `HTTP ${page.status}`}。这是页面导航证据，不计入接口调用次数。`,
        evidenceIds: [
          page.id,
          ...run.logs
            .filter((l) => navigationForLoadingLog(run, l)?.id === page.id)
            .map((l) => l.id),
        ],
        possibleCause:
          "可能涉及入口路由、网关、网络或服务异常，需核对是否为预期负向访问。",
        suggestion:
          "复现相同页面入口，检查导航响应与网关日志，确认页面能打开并补充页面断言。",
      },
    );
  }
  for (const op of run.operations)
    if (op.status === "FAILED")
      add(`step|${op.id}`, {
        severity: "high",
        title: "回放步骤执行失败",
        owners: ["undetermined"],
        ownershipSource: "rule",
        module: op.module,
        detail: `${op.label}：${op.error}`,
        evidenceIds: [op.id],
      });
  run.findings = findings;
  run.cases = run.operations.map((op) => {
    const verified =
      !!(op.assertion || (op.kind === "assert" && op.value)) &&
      op.status === "PASSED";
    const description = isAnalysisCurrent(run)
      ? run.analysis.caseDescriptions?.find((c) => c.stepId === op.id)
      : undefined;
    const related = run.requests.filter(
      (r) => r.stepId === op.id && requestProblem(r),
    );
    const pageProblems = (run.pageObservations || []).filter(
      (p) => p.stepId === op.id && (p.failure || (p.status && p.status >= 400)),
    );
    const evidence = operationEvidence(run, op);
    const feedback = feedbackForStep(run, op.id);
    return {
      id: `YL-${String(op.sequence).padStart(3, "0")}`,
      module: op.module,
      title: description?.title || op.label,
      steps: [`${op.sequence}. ${op.label}`],
      expected:
        op.assertion ||
        (op.kind === "assert" ? op.value : undefined) ||
        (description
          ? description.expected
          : "尚未配置结果断言；请根据本步操作目标设置可验证的页面反馈。"),
      actual:
        op.error ||
        (related.length
          ? `观察到 ${related.reduce((n, r) => n + countOf(r), 0)} 次关联候选问题请求：${related
              .slice(0, 3)
              .map((r) => `${r.method} ${endpoint(r.url)} ${requestProblem(r)}`)
              .join("；")}。操作状态与业务验证结果需分别确认。`
          : "") ||
        (pageProblems.length
          ? `观察到页面导航异常：${pageProblems.map((p) => `${endpoint(p.url)} ${p.failure || `HTTP ${p.status}`}`).join("；")}。导航证据不计入接口调用。`
          : "") ||
        (feedback.length
          ? feedback
              .slice(0, 3)
              .map((f) => feedbackText(run, f))
              .join("\n") +
            "\n" +
            evidence.reason
          : evidence.reason),
      status: ["FAILED", "BLOCKED", "SKIPPED"].includes(op.status)
        ? op.status
        : verified
          ? "PASSED"
          : op.status === "PASSED"
            ? "EXECUTED"
            : op.status,
      evidenceIds: [
        op.id,
        ...run.requests.filter((r) => r.stepId === op.id).map((r) => r.id),
        ...run.logs.filter((l) => l.stepId === op.id).map((l) => l.id),
        ...(run.pageObservations || [])
          .filter((p) => p.stepId === op.id)
          .map((p) => p.id),
        ...feedback.map((f) => f.id),
      ],
    };
  });
}
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export { reportText } from "../shared/report-content";
import {
  reportText,
  reportContent,
  type ReportBlock,
} from "../shared/report-content";
export type { ReportBlock } from "../shared/report-content";
export function reportBlocks(run: Run): ReportBlock[] {
  finalizeReport(run);
  return reportContent(run);
}
export function reportHtml(run: Run) {
  const blocks = reportBlocks(run);
  const safe = (v: unknown) => escape(reportText(run, v));
  return (
    '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>' +
    safe(run.name) +
    ' 体检报告</title><style>*{color:#000!important;font-family:SimSun,"宋体",serif!important;box-sizing:border-box}body{max-width:900px;margin:32px auto;padding:24px;line-height:2;font-size:14pt}h1{font-size:16pt}h2{font-size:15pt}h3,h4{font-size:14pt}h1,h2,h3,h4{break-after:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere;text-indent:2em}table{width:100%;border-collapse:collapse;font-size:11pt}td,th{border:1px solid #888;padding:7px;text-align:left}thead{display:table-header-group}.cover{text-align:center;page-break-after:always;padding:140px 0}.cover p{text-indent:0}.toc{page-break-after:always}.toc a{display:block;text-decoration:none}@media print{@page{size:A4;margin:20mm 30mm}}</style><div class="cover"><h1>' +
    safe(run.project) +
    "<br>Web 体检报告</h1><p>编制单位：北斗天地股份有限公司</p><p>编制日期：" +
    safe(new Date().toLocaleDateString("zh-CN")) +
    '</p></div><div class="toc"><h1>目录</h1>' +
    blocks
      .flatMap((b, i) =>
        b.kind === "heading" && b.level <= 3
          ? ['<a href="#section-' + i + '">' + safe(b.text) + "</a>"]
          : [],
      )
      .join("") +
    "</div>" +
    blocks
      .map((b, i) =>
        b.kind === "heading"
          ? "<h" +
            b.level +
            ' id="section-' +
            i +
            '">' +
            safe(b.text) +
            "</h" +
            b.level +
            ">"
          : b.kind === "paragraph"
            ? "<p>" +
              (b.boldPrefix
                ? "<strong>" +
                  safe(b.boldPrefix) +
                  "</strong>" +
                  safe(b.text.slice(b.boldPrefix.length))
                : safe(b.text)) +
              "</p>"
            : "<table><thead><tr>" +
              b.headers.map((v) => "<th>" + safe(v) + "</th>").join("") +
              "</tr></thead><tbody>" +
              b.rows
                .map(
                  (row) =>
                    "<tr>" +
                    row.map((v) => "<td>" + safe(v) + "</td>").join("") +
                    "</tr>",
                )
                .join("") +
              "</tbody></table>",
      )
      .join("") +
    "</html>"
  );
}
