import type { Finding, Run } from "./types";
import { findingObservation, requestStats } from "./inspection-evidence";

const short = (value: string, limit: number) => {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

// Summaries project the reviewed findings. A second free-form generation can
// invent effects (blank screens, outages) that the recording never observed.
export function summarizeVerifiedFindings(
  run: Run,
  findings: Finding[],
  expanded = true,
) {
  const stats = requestStats(run);
  const selected = findings.slice(0, expanded ? 6 : 3);
  const summary = [
    `本次采集记录${stats.calls}次接口调用、${stats.records}条请求证据；发现${findings.length}项规则异常或AI核查线索。范围为已访问页面及实际采集内容。`,
    ...selected.map((finding, index) => {
      const level = { high: "优先核查", medium: "随后核查", low: "后续核查" }[
        finding.severity
      ];
      const fact = short(findingObservation(run, finding), 360);
      const direction =
        expanded && finding.suggestion
          ? `\n处置建议${finding.source === "ai" || finding.explanationSource === "ai" ? "（AI建议）" : ""}：${short(finding.suggestion, 220)}`
          : "";
      return `${index + 1}. ${level}：${short(finding.module, 60)} / ${short(finding.title, 140)}\n观察证据：${fact}${direction}`;
    }),
    ...(findings.length > selected.length
      ? [`其余${findings.length - selected.length}项见问题明细及对应证据。`]
      : []),
    ...(!findings.length
      ? [
          "本次采集范围内未发现有证据的异常；这不代表未访问功能或业务结果全部通过。",
        ]
      : []),
  ].join("\n\n");
  const verified = run.cases.filter((item) => item.status === "PASSED").length;
  const unverified = run.cases.filter(
    (item) => !["PASSED", "FAILED"].includes(item.status),
  ).length;
  const replayFailures = run.operations.some(
    (item) =>
      item.status === "FAILED" && item.kind !== "assert" && !item.assertion,
  );
  const conclusion = [
    findings.length
      ? `优先处理上述已记录异常与核查线索，从“${short(findings[0].module, 60)} / ${short(findings[0].title, 140)}”开始定位；严重程度按问题明细展示，不据此推断未观察到的页面或业务影响。`
      : "本次覆盖范围内未发现明确异常，不能据此认定整个系统可发布。",
    ...(replayFailures
      ? [
          "存在自动复检执行失败：先核对定位器、页面状态及运行环境，人工复现后再确认是否为被测系统缺陷。",
        ]
      : []),
    ...(selected.length
      ? [
          `复测重点：${short(selected[0].validationSteps?.join("；") || "重走关联操作，核对原异常是否消失，并用明确断言验证页面结果。", 280)}`,
        ]
      : []),
    `明确断言通过${verified}项，结果未验证、阻塞或跳过${unverified}项；HTTP成功、成功提示和未发现错误均不代替业务通过判定。`,
  ].join("\n\n");
  return { summary, conclusion };
}
