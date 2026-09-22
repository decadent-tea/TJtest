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
} from "../server/evidence-quality";
import type { Run, LogEvent } from "./types";
const severityLabel = { high: "高", medium: "中", low: "低" };
export function reportText(run: Run, value: unknown) {
  let text = String(value ?? "");
  // Browser stack frames point into generated bundles and are not useful in a
  // reader-facing report. Keep the error message itself for diagnosis.
  text = text
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^\s*(?:日志\s*ID|关联证据\s*[:：])/i.test(line) &&
        !/^\s*at\s+\S+/.test(line) &&
        !/^\s*\(?https?:\/\/\S+\.(?:m?js|cjs)(?::\d+){1,2}\)?\s*$/i.test(line),
    )
    .join("\n")
    .replace(/\(?https?:\/\/[^\s()，。；]+\.(?:m?js|cjs)(?::\d+){1,2}\)?/gi, "")
    .replace(/\b[\w.-]*[._-][a-f0-9]{8,}\.(?:m?js|cjs)\b/gi, "前端脚本")
    .replace(/\.[a-f0-9]{8,}(?=\.(?:m?js|cjs|css|ttf|otf|woff2?|eot)\b)/gi, "")
    .replace(
      /(?:日志\s*)?(?:关联证据\s*)?\bID\s*[:：]\s*[a-f0-9-]{8,}(?:\s*[,，、;；]\s*[a-f0-9-]{8,})*/gi,
      "",
    );
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
      /\b(?:id|ID)\s*[:：]?\s*(?=(?:GET|POST|PUT|PATCH|DELETE|第\d+步|浏览器))/g,
      "",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "",
    )
    .replace(/\b[a-f0-9]{8,}\b/gi, "")
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
  evidenceIds: string[];
  count: number;
  status?: string;
  resources: Set<string>;
};
function reportLogs(run: Run): ReportLog[] {
  const groups = new Map<string, ReportLog>();
  for (const log of run.logs.filter(importantLog)) {
    const status = log.text.match(
      /Failed to load resource:.*status of (\d+)/i,
    )?.[1];
    const resourceUrl = log.location?.replace(/:\d+(?::\d+)?$/, "");
    const staticResource =
      status && resourceUrl && isStaticAssetUrl(resourceUrl);
    const key = staticResource
      ? JSON.stringify(["static", status])
      : JSON.stringify([log.level, log.text, log.location]);
    let group = groups.get(key);
    if (!group) {
      group = {
        log,
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
export function reportContent(run: Run): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const h = (level: 1 | 2 | 3 | 4, text: string) =>
    blocks.push({ kind: "heading", level, text: reportText(run, text) });
  const p = (text: string) => {
    const cleaned = reportText(run, text);
    const boldPrefix = cleaned.match(
      /^(?:模块|观察事实|问题分析|处置方向|业务影响|复现路径|原因分析|解决方案|验证建议)：/,
    )?.[0];
    blocks.push({ kind: "paragraph", text: cleaned, boldPrefix });
  };
  const table = (headers: string[], rows: unknown[][]) =>
    blocks.push({
      kind: "table",
      headers,
      rows: rows.map((r) => r.map((v) => reportText(run, v))),
    });
  const findings = finalFindings(run),
    requests = problemRequests(run),
    logs = reportLogs(run);
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
  p("以下按展示顺序列出主要操作，连续悬浮浏览与重复页面跳转合并展示。");
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
      while (
        run.operations[index + group.length]?.kind === "hover" &&
        run.operations[index + group.length].module === op.module
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
        `${steps.length + 1}. ${module}悬浮浏览：${briefTargets.slice(0, 5).join("、")}${briefTargets.length > 5 ? `等 ${briefTargets.length} 项` : ""}`,
      );
      index += group.length;
      continue;
    }
    if (op.kind === "goto") {
      let count = 1;
      while (
        run.operations[index + count]?.kind === "goto" &&
        run.operations[index + count].module === op.module &&
        run.operations[index + count].label === op.label
      )
        count++;
      if (count > 1) {
        steps.push(
          `${steps.length + 1}. ${module}${shortLabel(op.label, op.kind)}`,
        );
        index += count;
        continue;
      }
    }
    steps.push(
      `${steps.length + 1}. ${module}${shortLabel(op.label, op.kind)}`,
    );
    index++;
  }
  for (let index = 0; index < steps.length; index += 8)
    p(steps.slice(index, index + 8).join("；") + "。");
  if (!run.operations.length) p("本次没有操作记录。");
  h(1, "四 测试结果及分析");
  h(2, "4.1 问题接口");
  for (const [
    index,
    { request: r, reason, count, duration },
  ] of requests.entries()) {
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
    p(
      "观察事实：" +
        (item.status
          ? `浏览器报告静态资源 HTTP ${item.status}，涉及 ${[...item.resources].join("、")}（${item.count} 次）`
          : l.text.slice(0, 1200) + "（" + item.count + " 次）"),
    );
    p(
      "问题分析：" +
        ([...new Set(ai.map((f) => f.observation || f.detail))].join("；") ||
          (judged ? "AI 未将该日志判定为独立业务风险。" : "AI 分析尚未完成。")),
    );
    p(
      "处置方向：" +
        ([...new Set(ai.map((f) => f.suggestion).filter(Boolean))].join("；") ||
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
