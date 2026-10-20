import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";
import { reportDocx } from "../server/report-docx";
import { reportHtml } from "../server/report";
import type { Run } from "../shared/types";

const timestamp = "2026-10-13T03:00:00.000Z";
const run: Run = {
  id: "layout-qa",
  name: "体检可信度升级验证",
  project: "煤矿智能化系统",
  environment: "本地夹具",
  url: "http://fixture.test",
  mode: "replay",
  evidenceVersion: 2,
  status: "COMPLETED_WITH_ISSUES",
  startedAt: timestamp,
  endedAt: timestamp,
  scene: "设备查询",
  archived: false,
  operations: [
    {
      id: "query",
      sequence: 1,
      pageId: "page",
      framePath: [],
      timestamp,
      kind: "click",
      label: "查询设备",
      module: "设备台账",
      scene: "设备查询",
      url: "http://fixture.test/devices",
      locators: [],
      status: "EXECUTED",
      dependsOn: [],
      timeout: 8000,
      effect: "read",
      enabled: true,
    },
  ],
  requests: [
    {
      id: "query-request",
      pageId: "page",
      stepId: "query",
      startedAt: timestamp,
      method: "GET",
      url: "http://fixture.test/api/devices",
      resourceType: "fetch",
      requestHeaders: {},
      status: 500,
      duration: 180,
      description: "GET /api/devices",
      module: "设备台账",
      category: "business",
      confidence: 0.65,
      responseBody: '{"success":false,"message":"测试服务故障"}',
    },
  ],
  logs: [],
  feedback: [
    {
      id: "layout-message",
      timestamp,
      pageId: "page",
      framePath: [],
      stepId: "query",
      association: "time-candidate",
      kind: "message",
      change: "appeared",
      level: "error",
      text: "查询失败，请稍后重试",
    },
    {
      id: "layout-url",
      timestamp,
      pageId: "page",
      framePath: [],
      stepId: "query",
      association: "time-candidate",
      kind: "url",
      change: "changed",
      before: "http://fixture.test/#/devices",
      after: "http://fixture.test/#/devices?tab=detail",
    },
    {
      id: "layout-dialog",
      timestamp,
      pageId: "page",
      framePath: [],
      stepId: "query",
      association: "time-candidate",
      kind: "dialog",
      change: "appeared",
      text: "设备查询提示；服务暂不可用，请稍后重试",
    },
  ],
  notes: [],
  findings: [],
  cases: [],
  analysis: {
    status: "COMPLETED",
    evidenceVersion: 2,
    concurrency: 7,
    summary: "本次设备查询记录到接口失败，优先检查服务端异常与前端降级。",
    conclusion: "修复后复测关联操作，未验证部分保持未知。",
    findings: [
      {
        id: "issue",
        source: "ai",
        category: "interface",
        severity: "high",
        title: "设备查询接口失败",
        module: "设备台账",
        detail: "设备查询失败",
        impact: "设备台账数据暂时无法取得。",
        owners: ["frontend", "backend"],
        ownershipSource: "manual",
        evidenceIds: ["query-request"],
        possibleCause: "可能存在服务处理异常，需结合环境和请求核对。",
        suggestion: "后端检查错误分支，前端确认异常提示与恢复入口。",
        reproductionSteps: ["进入设备台账", "点击查询"],
        validationSteps: ["确认接口恢复与异常提示正确", "复测页面结果检查点"],
      },
    ],
  },
};
const output = resolve("output", "verification-report-layout");
mkdirSync(output, { recursive: true });
const buffer = await reportDocx(run);
const zip = await JSZip.loadAsync(buffer);
const xml = await zip.file("word/document.xml")!.async("string");
const styles = await zip.file("word/styles.xml")!.async("string");
writeFileSync(resolve(output, "report.docx"), buffer);
writeFileSync(resolve(output, "report.html"), reportHtml(run));
assert(xml.includes("问题归属："), "归属标签");
assert(xml.includes("页面反馈摘要"), "页面反馈报告字段");
assert(xml.includes("查询失败，请稍后重试"), "提示事实保留");
assert(xml.includes("前端、后端"), "归属分类");
assert(xml.includes('w:color w:val="000000"'), "黑色文本");
assert(
  /w:eastAsia="(?:宋体|SimSun)"/.test(xml + styles),
  "宋体字体（Word可能将字体归并至文档样式）",
);
assert(xml.includes("TOC \\o"), "目录字段");
console.log("报告模板、归属字段、宋体黑色与目录字段核验通过：" + output);
