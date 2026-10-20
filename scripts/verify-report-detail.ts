import assert from "node:assert/strict";
import { finalFindings } from "../server/evidence-quality";
import { reportContent, reportText } from "../shared/report-content";
import { reportDetailFixture } from "./fixtures/report-detail";

for (const current of [false, true]) {
  const run = reportDetailFixture(current);
  const before = JSON.stringify(run);
  const findings = finalFindings(run);
  assert.equal(
    findings.length,
    1,
    "同一组接口与浏览器异常合并成一项有完整分析的问题",
  );
  const detail = findings[0];
  assert.equal(
    detail.title,
    run.analysis.findings[0].title,
    "具体AI标题不被通用规则标题覆盖",
  );
  assert.equal(detail.evidenceIds.length, 12);
  assert.equal(detail.explanationSource, "ai");
  for (const key of [
    "impact",
    "possibleCause",
    "suggestion",
    "reproductionSteps",
    "validationSteps",
  ] as const)
    assert.deepEqual(
      detail[key],
      run.analysis.findings[0][key],
      `${key}完整保留`,
    );
  const text = reportContent(run)
    .map((block) => JSON.stringify(block))
    .join("\n");
  assert(text.includes("第42、43、44步"));
  assert(text.includes("共3次独立录制操作"));
  assert(text.includes("3次调用，3条证据"));
  assert(text.includes("HTTP 200"));
  assert(!text.includes("HTTP 400"), "业务code:400不能变成HTTP 400");
  assert(text.includes("unhandledrejection记录3次"));
  assert(text.includes("pageerror记录3次"));
  assert(
    text.includes("观察事实：3次记录；Error: 操作失败"),
    "日志章节的次数不会在堆栈精简时丢失",
  );
  assert(text.includes("前端脚本:2:15745417"), "保留有用的异常定位行列");
  assert(
    text.includes("uniqueCode=1644990245790396418"),
    "业务标识不被当作内部证据ID清空",
  );
  for (const field of [
    "观察事实",
    "业务影响",
    "复现路径",
    "原因分析",
    "解决方案",
    "验证建议",
  ])
    assert(text.includes(`${field}：`));
  assert(text.includes("点击鲍店煤矿 → 点击采掘工程平面图"));
  assert(!text.includes("无证据全站白屏"));
  assert(!text.includes("在步骤，"));
  assert(!text.includes("现有证据未明确根因。"));
  assert(!text.includes("核查消息来源和堆栈，确认是否影响当前业务。"));
  assert(!text.includes("detail-step-") && !text.includes("detail-request-"));
  if (!current) assert(text.includes("历史AI问题明细已按现有录制证据逐项复核"));
  assert.equal(JSON.stringify(run), before, "展示和导出内容计算不改写原始记录");

  const canonical = run.findings.find((finding) => finding.id === detail.id)!;
  canonical.owners = ["backend"];
  canonical.ownershipSource = "manual";
  canonical.disposition = "investigating";
  canonical.note = "已确认由接口组核查";
  const annotated = finalFindings(run)[0];
  assert.equal(annotated.id, canonical.id);
  assert.deepEqual(annotated.owners, ["backend"]);
  assert.equal(annotated.ownershipSource, "manual");
  assert.equal(annotated.note, canonical.note);
  assert.equal(annotated.disposition, "investigating");
  canonical.deleted = true;
  assert.equal(
    finalFindings(run).length,
    0,
    "合并后的问题删除后不借另一来源重新出现",
  );
}

const noAI = reportDetailFixture();
noAI.analysis = { status: "NONE", findings: [] };
const ruleDetails = finalFindings(noAI);
assert(
  ruleDetails.every((finding) => finding.title.includes("采掘工程平面图")),
  "无AI时基础问题也明确关联动作",
);
assert(
  ruleDetails.every((finding) =>
    finding.reproductionSteps?.some((step) => step.includes("第42步")),
  ),
);
assert(
  ruleDetails.every(
    (finding) =>
      finding.impact &&
      finding.possibleCause &&
      finding.validationSteps?.length,
  ),
);
assert.equal(
  reportText(noAI, "业务编号=1ec04883-4f40-45b4-95d9-68d92b11a102"),
  "业务编号=1ec04883-4f40-45b4-95d9-68d92b11a102",
);
console.log(
  "报告详细度验证通过：历史/新版AI逐项证据复核、具体标题与完整诊断、三次手动操作独立计数、HTTP/业务失败区分、日志按通道计数、业务标识和源位置保留、人工处置及删除同步。",
);
