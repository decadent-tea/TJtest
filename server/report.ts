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
export function finalizeReport(run: Run) {
  // Apply the same resource policy to historical recordings on read/export.
  const removed = run.requests.filter((r) => isStaticAssetUrl(r.url));
  if (removed.length) {
    run.requests = run.requests.filter((r) => !isStaticAssetUrl(r.url));
    if (run.captureStats)
      run.captureStats.filteredRequests += removed.reduce(
        (n, r) => n + countOf(r),
        0,
      );
  }
  const previous = run.findings;
  const findings: Finding[] = [];
  const seen = new Map<string, Finding>();
  const add = (key: string, value: Omit<Finding, "id" | "source">) => {
    const existing = seen.get(key);
    if (existing) {
      existing.evidenceIds.push(...value.evidenceIds);
      return;
    }
    const old = previous.find(
      (item) =>
        item.source === "rule" &&
        item.title === value.title &&
        item.evidenceIds.some((id) => value.evidenceIds.includes(id)),
    );
    const f = {
      ...value,
      id: old?.id || randomUUID(),
      source: "rule" as const,
      disposition: old?.disposition,
      note: old?.note,
      deleted: old?.deleted,
    };
    seen.set(key, f);
    findings.push(f);
  };
  for (const req of run.requests) {
    if (requestProblem(req) && !requestProblem(req)!.includes("耗时"))
      add(
        `${req.method}|${req.url.split("?")[0]}|${req.status}|${req.failure}`,
        {
          severity: req.status && req.status >= 500 ? "high" : "medium",
          title: requestProblem(req)!,
          module: req.module,
          detail: `${req.description}\n${req.method} ${endpoint(req.url)}\n${requestProblem(req)}，出现 ${countOf(req)} 次。请核对是否为预期负向测试。`,
          evidenceIds: [req.id],
          possibleCause: causeAdvice(req).cause,
          suggestion: causeAdvice(req).advice,
        },
      );
    if (requestProblem(req)?.includes("耗时"))
      add(`slow|${req.url.split("?")[0]}`, {
        severity: "low",
        title: "业务接口响应较慢",
        module: req.module,
        detail: `${req.method} ${endpoint(req.url)} 最大耗时 ${req.maxDuration ?? req.duration}ms，超过异常阈值 ${SLOW_REQUEST_THRESHOLD_MS}ms；这不是压力测试结论。`,
        evidenceIds: [req.id],
        possibleCause: causeAdvice(req).cause,
        suggestion: causeAdvice(req).advice,
      });
  }
  for (const log of run.logs)
    if (
      ["error", "pageerror", "warning", "warn", "unhandledrejection"].includes(
        log.level,
      )
    )
      add(`${log.level}|${log.text}`, {
        severity: ["pageerror", "unhandledrejection"].includes(log.level)
          ? "high"
          : log.level === "error"
            ? "medium"
            : "low",
        title: ["warning", "warn"].includes(log.level)
          ? "前端警告"
          : "前端错误",
        module:
          run.operations.find((o) => o.id === log.stepId)?.module || "页面后台",
        detail: log.text,
        evidenceIds: [log.id],
        suggestion: "核查消息来源和堆栈，确认是否影响当前业务。",
      });
  for (const op of run.operations)
    if (op.status === "FAILED")
      add(`step|${op.id}`, {
        severity: "high",
        title: "回放步骤执行失败",
        module: op.module,
        detail: `${op.label}：${op.error}`,
        evidenceIds: [op.id],
      });
  run.findings = findings;
  run.cases = run.operations.map((op) => {
    const description = run.analysis.caseDescriptions?.find(
      (c) => c.stepId === op.id,
    );
    const judged = run.analysis.status === "COMPLETED";
    const related = run.requests.filter(
      (r) => r.stepId === op.id && requestProblem(r),
    );
    return {
      id: `YL-${String(op.sequence).padStart(3, "0")}`,
      module: op.module,
      title: description?.title || op.label,
      steps: [`${op.sequence}. ${op.label}`],
      expected:
        op.assertion ||
        (description
          ? description.expected
          : "按实际操作目标与采集证据自动判断。"),
      actual:
        op.error ||
        (description?.verdict === "limited" && judged
          ? "本步操作已完成；通过仅表示本步执行目标达成，不代表整个业务流程已验证。"
          : description?.reason) ||
        (related.length
          ? `观察到 ${related.length} 类问题请求：${related
              .slice(0, 3)
              .map((r) => `${r.method} ${endpoint(r.url)} ${requestProblem(r)}`)
              .join("；")}。操作状态与业务验证结果需分别确认。`
          : "") ||
        (["BLOCKED", "SKIPPED"].includes(op.status)
          ? "未执行。"
          : op.kind === "assert" && op.status === "PASSED"
            ? "配置的页面断言成立。"
            : judged
              ? "本步操作已完成，未记录到明确失败。"
              : "操作已记录或执行，等待手动分析。"),
      status: ["FAILED", "BLOCKED", "SKIPPED"].includes(op.status)
        ? op.status
        : description?.verdict === "failed"
          ? "FAILED"
          : judged || description?.verdict === "passed"
            ? "PASSED"
            : op.status,
      evidenceIds: [
        op.id,
        ...run.requests.filter((r) => r.stepId === op.id).map((r) => r.id),
        ...run.logs.filter((l) => l.stepId === op.id).map((l) => l.id),
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
