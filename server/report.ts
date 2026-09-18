import {
  finalFindings,
  riskSummary,
  analysisNarrative,
  isStaticAssetUrl,
  requestProblem,
  evidenceLabel,
  problemRequests,
  importantLogs,
  countOf,
  interfaceTotal,
  consoleTotal,
  SLOW_REQUEST_THRESHOLD_MS,
  endpoint,
  causeAdvice,
} from "./evidence-quality";
import { randomUUID } from "node:crypto";
import type { Run, Finding } from "../shared/types";
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
const severityLabel = { high: "高", medium: "中", low: "低" };
export function reportText(run: Run, value: unknown) {
  let text = String(value ?? "");
  const labels = [
    ...run.operations.map((op) => [op.id, `第${op.sequence}步（${op.label}）`]),
    ...run.requests.map((request) => [
      request.id,
      `${request.method} ${endpoint(request.url)}`,
    ]),
    ...run.logs.map((log) => [log.id, `浏览器${log.level}日志`]),
  ] as const;
  for (const [id, label] of labels) {
    if (id) text = text.split(id).join(label);
  }
  return text
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "关联证据",
    )
    .replace(
      /\b(?:id|ID)\s*[:：]?\s*(?:[0-9a-f]{7,}(?:\s*[,，、]\s*|\s+|$))+/g,
      "关联证据 ",
    )
    .replace(
      /\b(?:id|ID)\s*[:：]?\s*(?=(?:GET|POST|PUT|PATCH|DELETE|第\d+步|浏览器))/g,
      "",
    )
    .replace(/\b[a-f0-9]{8,}\b/gi, "关联证据")
    .replace(/\s+([，。；、])/g, "$1");
}

export type ReportBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; headers: string[]; rows: string[][] };
export function reportBlocks(run: Run): ReportBlock[] {
  finalizeReport(run);
  const blocks: ReportBlock[] = [];
  const h = (level: 1 | 2 | 3 | 4, text: string) =>
    blocks.push({ kind: "heading", level, text });
  const p = (text: string) =>
    blocks.push({ kind: "paragraph", text: reportText(run, text) });
  const table = (headers: string[], rows: unknown[][]) =>
    blocks.push({
      kind: "table",
      headers,
      rows: rows.map((r) => r.map((v) => reportText(run, v))),
    });
  const findings = finalFindings(run),
    requests = problemRequests(run),
    logs = importantLogs(run);
  const related = (id: string) =>
    findings.filter((f) => f.evidenceIds.includes(id));
  const judged = run.analysis.status === "COMPLETED";
  const passed = run.cases.filter((c) => c.status === "PASSED").length;
  const failed = run.cases.filter((c) => c.status === "FAILED").length;
  const other = run.cases.filter((c) =>
    ["RECORDED", "EXECUTED"].includes(c.status),
  ).length;
  h(1, "一 概要");
  p(
    "本报告面向项目负责人，依据实际操作、业务接口与浏览器日志分析质量风险，并给出项目优化和维护方向。" +
      (judged ? riskSummary(run) : "AI 分析尚未完成，当前结果为过程记录。"),
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
        run.mode === "record" ? "人工录制与 AI 分析" : "自动回放与 AI 分析",
      ],
      ["开始时间", run.startedAt],
      ["结束时间", run.endedAt || "尚未结束"],
    ],
  );
  h(1, "二 测试范围与内容");
  p(
    "覆盖模块：" +
      ([...new Set(run.operations.map((o) => o.module))].join("、") ||
        "无操作记录") +
      "。测试内容包括操作路径、执行反馈、业务接口异常和 Console 日志。结论限定于本次执行及所采集证据，单次耗时不作为压力测试结论。",
  );
  h(1, "三 测试过程与统计");
  h(2, "3.1 执行范围与结果");
  table(
    ["统计项", "结果"],
    [
      ["执行总数（操作用例）", run.cases.length],
      ["通过（断言或 AI 证据判定）", passed],
      ["失败", failed],
      [judged ? "其他状态" : "待分析", other],
      ["阻塞", run.cases.filter((c) => c.status === "BLOCKED").length],
      ["跳过", run.cases.filter((c) => c.status === "SKIPPED").length],
      [
        "通过率",
        run.cases.length
          ? ((passed / run.cases.length) * 100).toFixed(1) + "%"
          : "0.0%",
      ],
      ["接口总数（有效 Fetch/XHR 调用）", interfaceTotal(run)],
      ["Console 总数", consoleTotal(run)],
      ["风险分布", riskSummary(run)],
    ],
  );
  p(
    "通过表示本步配置断言或 AI 判断的可观察操作目标达成，不代表整个业务流程已验证。风险等级由最终问题集统一计算。",
  );
  h(2, "3.2 执行过程（操作路径）");
  p("以下按原始步骤编号列出主要操作，连续悬浮浏览与重复页面跳转合并展示。");
  const shortLabel = (label: string, kind: string) => {
    if (kind === "scroll") return "滚动页面";
    const compact = label.replace(/\s+/g, " ").trim();
    if (compact.length > 100)
      return `${compact.includes("·") ? compact.split("·")[0].trim() : "页面操作"} · 页面内容`;
    return compact.length > 80 ? compact.slice(0, 80) + "…" : compact;
  };
  let lastModule = "";
  const steps: string[] = [];
  for (let index = 0; index < run.operations.length;) {
    const op = run.operations[index];
    const module = op.module !== lastModule ? `${op.module} / ` : "";
    lastModule = op.module;
    if (op.kind === "hover") {
      const group = [op];
      while (run.operations[index + group.length]?.kind === "hover" &&
        run.operations[index + group.length].module === op.module)
        group.push(run.operations[index + group.length]);
      const targets = [...new Set(group.map((item) =>
        item.label.replace(/^鼠标悬浮\s*·\s*/, "").replace(/\s+/g, " ").trim(),
      ))];
      const briefTargets = [...new Set(targets.map((target) =>
        target.length > 40 ? "页面内容" : target,
      ))];
      const range = group.length > 1
        ? `${op.sequence}–${group.at(-1)!.sequence}`
        : String(op.sequence);
      steps.push(`${range}. ${module}悬浮浏览：${briefTargets.slice(0, 5).join("、")}${briefTargets.length > 5 ? `等 ${briefTargets.length} 项` : ""}`);
      index += group.length;
      continue;
    }
    if (op.kind === "goto") {
      let count = 1;
      while (run.operations[index + count]?.kind === "goto" &&
        run.operations[index + count].module === op.module &&
        run.operations[index + count].label === op.label)
        count++;
      if (count > 1) {
        steps.push(`${op.sequence}–${run.operations[index + count - 1].sequence}. ${module}${shortLabel(op.label, op.kind)}`);
        index += count;
        continue;
      }
    }
    steps.push(`${op.sequence}. ${module}${shortLabel(op.label, op.kind)}`);
    index++;
  }
  for (let index = 0; index < steps.length; index += 8)
    p(steps.slice(index, index + 8).join("；") + "。");
  if (!run.operations.length) p("本次没有操作记录。");
  h(1, "四 测试结果及分析");
  h(2, "4.1 问题接口");
  for (const [index, { request: r, reason, count, duration }] of requests.entries()) {
    const ai = related(r.id);
    h(3, `4.1.${index + 1} ${r.method} ${endpoint(r.url)}`);
    p(
      "观察事实：" +
        reason +
        "；出现 " +
        count +
        " 次；最大耗时 " +
        duration +
        "ms。",
    );
    p(
      "问题分析：" +
        (ai.map((f) => f.observation || f.detail).join("；") ||
          (judged ? "AI 未将该信号判定为独立业务风险。" : "AI 分析尚未完成。")),
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
  for (const [index, l] of logs.entries()) {
    const ai = related(l.id);
    const firstLine = l.text.split("\n")[0].replace(run.project, "").trim();
    h(3, `4.2.${index + 1} ${l.level} · ${firstLine.slice(0, 140)}${firstLine.length > 140 ? "…" : ""}`);
    p("观察事实：" + l.text.slice(0, 1200) + "（" + countOf(l) + " 次）");
    p(
      "问题分析：" +
        (ai.map((f) => f.observation || f.detail).join("；") ||
          (judged ? "AI 未将该日志判定为独立业务风险。" : "AI 分析尚未完成。")),
    );
    p(
      "处置方向：" +
        (ai
          .map((f) => f.suggestion)
          .filter(Boolean)
          .join("；") ||
          (judged
            ? "保留日志监测，当前证据未支持新增整改项。"
            : "等待手动分析生成处置方向。")),
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
      h(
        4,
        "4.3." + (index + 1) + "." + (i + 1) + " " + reportText(run, f.title),
      );
      p("模块：" + f.module);
      p("观察事实：" + (f.observation || f.detail));
      p("业务影响：" + (f.impact || "影响范围限定于关联操作和异常证据。"));
      p(
        "复现路径：" +
          (f.reproductionSteps?.join(" → ") ||
            evidenceLabel(run, f.evidenceIds)),
      );
      p("原因分析：" + (f.possibleCause || "现有证据未明确根因。"));
      p("解决方案：" + (f.suggestion || "针对关联异常修复后执行自动回归。"));
      p(
        "验证建议：" +
          (f.validationSteps?.join("；") ||
            "回放关联操作，确认原异常消失且操作目标达成。"),
      );
    }
  }
  h(2, "4.4 AI 分析摘要");
  p(riskSummary(run));
  p(analysisNarrative(run) || "AI 分析尚未完成。" + (run.analysis.error || ""));
  h(1, "五 测试结论");
  p(
    run.analysis.conclusion ||
      "AI 管理结论尚未生成，当前报告未形成最终项目质量结论。",
  );
  return blocks;
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
            ? "<p>" + safe(b.text) + "</p>"
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
