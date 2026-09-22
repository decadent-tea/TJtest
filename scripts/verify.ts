import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import express from "express";
import ExcelJS from "exceljs";
import { WebSocketServer } from "ws";
import type { Flow, Operation, ModelProfile } from "../shared/types";

process.env.STUDIO_DATA_DIR = resolve(
  "output",
  "verification",
  Date.now().toString(),
);
const {
  startSession,
  stopSession,
  pauseSession,
  setScene,
  getActivePage,
  readRun,
  answerDialog,
} = await import("../server/recorder");
const { put, get, encrypt, decrypt } = await import("../server/store");
const { analyze } = await import("../server/ai");
const { reportHtml, reportBlocks, reportText } =
  await import("../server/report");
const { casesWorkbook } = await import("../server/export");
const { installRecordingFixture } = await import("./fixtures/recording");
const app = express();
app.use(express.json());
installRecordingFixture(app);
app.get("/fixture/repeat", (_req, res) =>
  res.json({ success: true, data: [] }),
);
app.get("/fixture/ping", (_req, res) => res.json({ success: true }));
app.get("/fixture/asset.js", (_req, res) => res.type("js").send("void 0"));
app.get("/fixture/events", (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();
  const timer = setInterval(
    () =>
      res.write(
        'event: alarm\ndata: {"message":"测试实时告警","token":"sse-secret"}\n\n',
      ),
    200,
  );
  res.on("close", () => clearInterval(timer));
});
let badEvidence = false;
app.post("/model/chat/completions", (req, res) => {
  assert.equal(req.get("authorization"), "Bearer verification-api-key");
  const bundle = JSON.parse(req.body.messages[1].content);
  if (bundle.task === "synthesis") {
    res.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "验证：综合分析仅覆盖提供证据，不证明所有业务通过。",
            }),
          },
        },
      ],
    });
    return;
  }
  if (bundle.task === "management") {
    res.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "应优先修复设备查询接口异常。",
              conclusion:
                "本次查询链路存在接口风险，重点维护设备台账服务；修复错误处理并回归查询操作。",
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    return;
  }
  const failedRequest = bundle.requests.find(
    (r: { status: number }) => r.status === 500,
  );
  res.json({
    choices: [
      {
        message: {
          content: JSON.stringify({
            summary: "验证：分析仅覆盖提供的证据，不证明所有业务通过。",
            findings:
              failedRequest || badEvidence
                ? [
                    {
                      title: "验证接口故障",
                      module: "设备台账",
                      severity: "medium",
                      detail: "观察到接口错误，需要业务核查。",
                      suggestion: "查看接口响应。",
                      evidenceIds: [
                        badEvidence ? "non-existent-id" : failedRequest.id,
                      ],
                    },
                  ]
                : [],
            caseDescriptions: bundle.steps.map((step: { id: string }) => ({
              stepId: step.id,
              verdict: "limited",
              reason: "当前采集证据不足以判断完整业务结果。",
              title: "检查工程入口页面",
              expected: "入口页面应正常展示",
            })),
          }),
        },
      },
    ],
    usage: { total_tokens: 100 },
  });
});
const server = createServer(app);
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;
const url = `http://127.0.0.1:${port}/fixture/recording`;
const wsServer = new WebSocketServer({ server, path: "/fixture/socket" });
wsServer.on("connection", (socket) =>
  socket.send(
    JSON.stringify({ message: "测试 WebSocket 告警", token: "ws-secret" }),
  ),
);
const results: string[] = [];
async function waitFor<T>(
  fn: () => T | Promise<T>,
  condition: (v: T) => boolean,
  timeout = 30000,
) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (condition(value)) return value;
    if (Date.now() - start > timeout) throw new Error("验证等待超时");
    await new Promise((r) => setTimeout(r, 150));
  }
}
let liveId = "";
try {
  const run = await startSession({
    name: "闭环验证",
    project: "回归验证工程",
    environment: "自动验证",
    url,
    headless: true,
  });
  liveId = run.id;
  const page = await waitFor(
    () => getActivePage(run.id),
    (p) => !!p,
  );
  assert(page);
  await assert.rejects(
    () =>
      startSession({
        name: "不应重复启动",
        project: "验证",
        environment: "验证",
        url,
        headless: true,
      }),
    /已有活动/,
  );
  await page.locator("#rows tr").first().waitFor();
  await page.locator("#password").fill("verification-password-never-store");
  await page.locator("#login").click();
  await page.locator("#login-panel").waitFor({ state: "hidden" });
  await page.locator("#search").fill("井下环境监测");
  await page.locator("#query").click();
  await page.waitForTimeout(400);
  await page.locator("#new-device").click();
  await page.locator("#device-name").fill("测试设备甲");
  await page.locator("#save-device").click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.locator("#fault").click();
  await page.locator("#console-fault").click();
  await page.waitForTimeout(300);
  const confirmClick = page.locator("#native-confirm").click();
  await waitFor(
    () => run.pendingDialog,
    (d) => !!d,
  );
  await answerDialog(run.id, true, "");
  await confirmClick;
  await page.waitForTimeout(200);
  const countBeforePause = run.operations.length;
  pauseSession(run.id);
  await page.locator("#query").click();
  await page.waitForTimeout(300);
  assert.equal(run.operations.length, countBeforePause);
  pauseSession(run.id);
  setScene(run.id, "告警查询");
  await page.locator("#alarms-menu").click();
  await page.locator("#alarm-query").click();
  await page.locator("#toast").filter({ hasText: "告警查询完成" }).waitFor();
  await page.waitForTimeout(500);
  await page.evaluate(
    ({ port }) => {
      const es = new EventSource("/fixture/events");
      const ws = new WebSocket(`ws://127.0.0.1:${port}/fixture/socket`);
      setTimeout(() => {
        es.close();
        ws.close();
      }, 750);
    },
    { port },
  );
  await page.waitForTimeout(1200);
  assert(
    run.requests.every((r) => ["fetch", "xhr"].includes(r.resourceType)),
    "接口列表仅保留 Fetch/XHR，不收录 WebSocket、EventSource 或页面文档",
  );
  assert(
    run.logs.some((l) => l.level === "sse" && l.text.includes("测试实时告警")),
  );
  assert(!JSON.stringify(run).includes("sse-secret"));
  assert(!JSON.stringify(run).includes("ws-secret"));
  results.push(
    "请求类型过滤：排除 WebSocket/EventSource，SSE 日志及敏感字段脱敏通过。",
  );
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "/fixture/repeat?xhr=1");
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR fixture failed"));
      xhr.send();
    });
    await new Promise<void>((resolve) => {
      const script = document.createElement("script");
      script.src = "/fixture/missing-asset.js";
      script.onerror = () => resolve();
      document.head.append(script);
    });
    for (let i = 0; i < 3; i++) {
      await fetch("/fixture/repeat");
      await fetch("/fixture/ping");
      console.debug("quality-debug-noise");
      console.error("quality-repeat-error");
    }
    await new Promise<void>((resolve) => {
      const script = document.createElement("script");
      script.src = "/fixture/asset.js";
      script.onload = () => resolve();
      document.head.append(script);
    });
  });
  await waitFor(
    () =>
      run.requests.find((r) => r.url.endsWith("/fixture/repeat"))?.occurrences,
    (n) => n === 3,
  );
  assert.equal(
    run.requests.filter((r) => r.url.endsWith("/fixture/repeat")).length,
    1,
  );
  assert(
    !run.requests.some(
      (r) =>
        r.url.endsWith("/fixture/ping") || r.url.endsWith("/fixture/asset.js"),
    ),
  );
  assert(!run.logs.some((l) => l.text === "quality-debug-noise"));
  assert.equal(
    run.logs.find((l) => l.text === "quality-repeat-error")?.occurrences,
    3,
  );
  results.push(
    "真实浏览器降噪：重复接口及错误日志计数、普通日志和正常资源过滤通过。",
  );
  await stopSession(run.id);
  liveId = "";
  assert(run.requests.every((r) => ["fetch", "xhr"].includes(r.resourceType)));
  assert(
    run.requests.some((r) => r.resourceType === "xhr" && r.status === 200),
  );
  assert(
    run.requests.some((r) => r.resourceType === "fetch" && r.status === 500),
  );
  assert(
    run.operations.some((o) => o.kind === "fill" && o.value === "井下环境监测"),
  );
  assert(run.operations.some((o) => o.variable === "LOGIN_PASSWORD"));
  assert(!JSON.stringify(run).includes("verification-password-never-store"));
  assert(run.requests.some((r) => r.status === 500));
  assert(run.requests.some((r) => r.requestBody?.includes("[已脱敏]")));
  assert(run.logs.some((l) => l.level === "pageerror"));
  assert(run.findings.length >= 3);
  assert(run.operations.some((o) => o.screenshot));
  results.push(
    "人工操作采集：登录、中文输入、菜单、表单、异常、截图与暂停恢复通过。",
  );
  assert(
    run.operations.some((o) => o.kind === "dialog" && o.value === "accept"),
  );
  results.push("原生确认对话框：等待人工处理、确认结果录制通过。");
  const flow: Flow = {
    id: randomUUID(),
    name: "闭环回放",
    project: run.project,
    url,
    version: 1,
    sourceRunId: run.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    operations: structuredClone(run.operations),
    variables: ["LOGIN_PASSWORD"],
  };
  const makeStep = (patch: Partial<Operation>): Operation => ({
    id: randomUUID(),
    sequence: flow.operations.length + 1,
    pageId: "page-1",
    framePath: [],
    timestamp: new Date().toISOString(),
    kind: "click",
    label: "验证步骤",
    module: "验证模块",
    scene: "故障场景",
    url,
    locators: [],
    status: "RECORDED",
    dependsOn: [],
    timeout: 600,
    effect: "read",
    enabled: true,
    ...patch,
  });
  const missing = makeStep({
    label: "注入关键控件缺失",
    locators: [{ kind: "css", value: "#missing-control" }],
    effect: "write",
  });
  const blocked = makeStep({
    label: "依赖失败步骤",
    locators: [{ kind: "css", value: "#alarm-query" }],
    dependsOn: [missing.id],
  });
  flow.operations.push(
    missing,
    blocked,
    makeStep({
      kind: "goto",
      label: "恢复下一个独立场景入口",
      navigationMode: "navigate",
      scene: "后续独立场景",
      value: url,
    }),
    makeStep({
      label: "后续查询仍执行",
      scene: "后续独立场景",
      locators: [{ kind: "css", value: "#query" }],
    }),
    makeStep({
      kind: "assert",
      label: "检查设备列表",
      scene: "后续独立场景",
      assertion: "井下环境监测终端",
    }),
  );
  const replay = await startSession({
    name: "回放验证",
    project: flow.project,
    environment: "自动验证",
    url,
    flow,
    variables: { LOGIN_PASSWORD: "verification-password-never-store" },
    headless: true,
  });
  liveId = replay.id;
  await waitFor(
    () => readRun(replay.id),
    (r) => !!r && !["REPLAYING", "RECORDING"].includes(r.status),
    45000,
  );
  liveId = "";
  assert.equal(
    replay.operations.find((o) => o.id === missing.id)?.status,
    "FAILED",
  );
  assert.equal(
    replay.operations.find((o) => o.id === blocked.id)?.status,
    "BLOCKED",
  );
  assert.equal(replay.operations.at(-2)?.status, "EXECUTED");
  assert.equal(replay.operations.at(-1)?.status, "PASSED");
  const unexpected = replay.operations.filter(
    (o) => o.status === "FAILED" && o.id !== missing.id,
  );
  assert.equal(
    unexpected.length,
    0,
    JSON.stringify(unexpected.map((o) => ({ label: o.label, error: o.error }))),
  );
  results.push(
    "容错回放：原流程重复执行、关键步骤失败、依赖阻塞、后续独立场景继续和文本断言通过。",
  );
  const pendingRun = await startSession({
    name: "停止待处理对话框验证",
    project: "验证",
    environment: "验证",
    url,
    headless: true,
  });
  liveId = pendingRun.id;
  const pendingPage = await waitFor(
    () => getActivePage(pendingRun.id),
    (p) => !!p,
  );
  assert(pendingPage);
  await pendingPage.locator("#native-confirm").waitFor();
  const waitingClick = pendingPage.locator("#native-confirm").click();
  await waitFor(
    () => pendingRun.pendingDialog,
    (d) => !!d,
  );
  await stopSession(pendingRun.id);
  await waitingClick.catch(() => {});
  liveId = "";
  assert(pendingRun.endedAt);
  assert.equal(pendingRun.pendingDialog, undefined);
  results.push("结束录制：原生对话框待处理时也能正常停止并保留证据。");
  const profile: ModelProfile = {
    id: randomUUID(),
    name: "本地模拟模型",
    provider: "Custom",
    baseUrl: `http://127.0.0.1:${port}/model`,
    model: "verification",
    apiKey: encrypt("verification-api-key"),
    enabled: true,
    timeout: 10,
    maxTokens: 1024,
  };
  put("model", profile);
  assert.equal(decrypt(profile.apiKey!), "verification-api-key");
  assert(!profile.apiKey!.includes("verification-api-key"));
  await analyze(run, profile.id);
  await waitFor(
    () => get<typeof run>("run", run.id),
    (r) => r?.analysis.status !== "RUNNING",
  );
  assert.equal(run.analysis.status, "COMPLETED");
  assert.equal(run.analysis.findings.length, 1);
  assert.equal(run.cases[0].title, "检查工程入口页面");
  assert(!run.cases[0].expected.includes("人工确认"));
  assert.equal(run.cases[0].status, "PASSED");
  badEvidence = true;
  await analyze(run, profile.id);
  await waitFor(
    () => get<typeof run>("run", run.id),
    (r) => r?.analysis.status !== "RUNNING",
  );
  assert.equal(run.analysis.status, "COMPLETED");
  assert.equal(run.analysis.findings.length, 0);
  assert(
    run.analysis.warnings?.some((warning) =>
      warning.includes("无法由本批输入验证"),
    ),
  );
  results.push(
    "模型分析：加密密钥、真实 HTTP 调用、结构化分析与非法证据引用拦截通过（模拟服务）。",
  );
  const xlsx = await casesWorkbook(run);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx);
  workbook.eachSheet((ws) =>
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        assert.equal(cell.font.name, "宋体");
        assert.equal(cell.font.color?.argb, "FF000000");
      }),
    ),
  );
  assert.equal(workbook.worksheets[0].rowCount, run.operations.length + 6);
  assert.equal(workbook.worksheets[0].getCell("D6").value, "操作");
  assert.equal(workbook.worksheets[0].getCell("E6").value, "接口");
  assert.equal(workbook.worksheets[0].getCell("F6").value, "Console");
  assert.equal(workbook.worksheets[0].getCell("J6").value, "问题描述");
  assert.equal(workbook.worksheets[0].getCell("K6").value, "解决方案");
  assert.equal(workbook.worksheets[0].getCell("I6").value, "是否通过");
  assert.equal(workbook.worksheets[0].getCell("J3").numFmt, "0.0%");
  const originalName = run.name;
  run.name = "<script>alert(1)</script>";
  assert(!reportHtml(run).includes("<script>alert(1)</script>"));
  run.name = originalName;
  assert(reportHtml(run).includes("color:#000!important"));
  const groupedRun = structuredClone(run);
  groupedRun.operations = run.operations.slice(0, 5).map((op, index) => ({
    ...op,
    sequence: [1, 9, 10, 19, 30][index],
    kind: (["goto", "hover", "hover", "goto", "goto"] as const)[index],
    label: (
      [
        "打开首页",
        "鼠标悬浮 · 菜单一",
        "鼠标悬浮 · 菜单二",
        "打开列表",
        "打开列表",
      ] as const
    )[index],
    module: "验证模块",
  }));
  groupedRun.requests = [];
  groupedRun.logs = [];
  groupedRun.analysis.findings = [];
  const groupedBlocks = reportBlocks(groupedRun);
  const stepHeading = groupedBlocks.findIndex(
    (block) => block.kind === "heading" && block.text.startsWith("3.2"),
  );
  const displayedSteps = groupedBlocks
    .slice(
      stepHeading + 1,
      groupedBlocks.findIndex(
        (block, index) => index > stepHeading && block.kind === "heading",
      ),
    )
    .filter((block) => block.kind === "paragraph")
    .map((block) => block.text)
    .join("\n");
  assert.deepEqual(
    [...displayedSteps.matchAll(/(?:^|；)\s*(\d+)\./gm)].map((match) =>
      Number(match[1]),
    ),
    [1, 2, 3],
    "合并后的操作路径应按展示顺序连续编号",
  );
  const resourceRun = structuredClone(groupedRun);
  resourceRun.logs = [
    {
      id: "resource-font-a",
      timestamp: new Date().toISOString(),
      pageId: "page",
      stepId: resourceRun.operations[0].id,
      level: "error",
      text: "Failed to load resource: the server responded with a status of 404 (Not Found)",
      location: "http://local.test/static/fonts/alpha.woff:0",
    },
    {
      id: "resource-font-b",
      timestamp: new Date().toISOString(),
      pageId: "page",
      stepId: resourceRun.operations[0].id,
      level: "error",
      text: "Failed to load resource: the server responded with a status of 404 (Not Found)",
      location: "http://local.test/static/fonts/beta.ttf:0",
    },
  ];
  const resourceBlocks = reportBlocks(resourceRun);
  assert.equal(
    resourceBlocks.filter(
      (block) =>
        block.kind === "heading" && block.text.includes("静态资源加载失败"),
    ).length,
    1,
    "同模块同状态码的资源错误应合并展示",
  );
  assert(
    resourceBlocks.some(
      (block) =>
        block.kind === "paragraph" &&
        block.text.includes("alpha.woff") &&
        block.text.includes("beta.ttf"),
    ),
  );
  assert.equal(
    reportText(
      run,
      "TypeError: 示例异常\n    at wr\n(http://local.test/static/js/chunk-vendors.abcdef1234.js:373:38931)\n日志 ID: aed2dc76, 9ffb5fbc",
    ),
    "TypeError: 示例异常",
  );
  assert.equal(
    reportText(run, "Oswald-Bold.abcdef1234.otf"),
    "Oswald-Bold.otf",
  );
  run.analysis.findings.push({
    id: "report-sanitization-check",
    source: "ai",
    severity: "low",
    title: "报告标识清理验证",
    module: "验证模块",
    detail: "验证报告正文",
    observation: `步骤 ${run.operations[0].id} 关联的请求 id ${run.requests[0].id}, aed2dc76, 9ffb5fbc 返回 HTTP 404`,
    reproductionSteps: [
      `执行步骤 ${run.operations[0].id}，查看请求 ${run.requests[0].id}`,
    ],
    evidenceIds: [run.operations[0].id, run.requests[0].id],
  });
  const sanitizedHtml = reportHtml(run);
  assert(sanitizedHtml.includes("报告标识清理验证"));
  assert(!sanitizedHtml.includes(run.operations[0].id));
  assert(!sanitizedHtml.includes(run.requests[0].id));
  assert(!sanitizedHtml.includes("aed2dc76"));
  assert(!sanitizedHtml.includes("关联证据"));
  assert(sanitizedHtml.includes("HTTP 404"));
  assert(sanitizedHtml.includes("<strong>模块：</strong>"));
  const { reportDocx } = await import("../server/report-docx");
  const docx = await reportDocx(run);
  const { default: JSZip } = await import("jszip");
  const word = await JSZip.loadAsync(docx);
  const documentXml = await word.file("word/document.xml")!.async("string");
  assert(documentXml.includes("体检报告"));
  for (const label of [
    "目录",
    "执行总数",
    "接口总数",
    "Console 总数",
    "通过率",
    "问题接口",
    "解决方案",
  ])
    assert(
      documentXml.replace(/<[^>]+>/g, "").includes(label),
      `报告缺少 ${label}`,
    );
  assert(documentXml.includes("TOC \\o"), "报告缺少可更新的目录字段");
  assert(!documentXml.includes(run.operations[0].id));
  assert(!documentXml.includes(run.requests[0].id));
  assert(documentXml.includes("000000"));
  const moduleTag = documentXml.indexOf("<w:t>模块：</w:t>");
  assert(moduleTag >= 0, "问题字段缺少模块标签");
  assert(
    /<w:b(?:\s[^>]*)?\/>/.test(documentXml.slice(moduleTag - 250, moduleTag)),
    "问题字段标签应加粗",
  );
  results.push(
    "报告导出：DOCX 文件、正文无内部 ID、黑色字体与 Excel 用例宋体格式通过。",
  );
  const output = resolve("output", "verification");
  mkdirSync(output, { recursive: true });
  writeFileSync(
    resolve(output, "results.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        results,
        recordedSteps: run.operations.length,
        requests: run.requests.length,
        replayStatuses: replay.operations.map((o) => ({
          label: o.label,
          status: o.status,
        })),
      },
      null,
      2,
    ),
  );
  writeFileSync(resolve(output, "cases.xlsx"), Buffer.from(xlsx));
  writeFileSync(resolve(output, "report.html"), reportHtml(run));
  writeFileSync(resolve(output, "report.docx"), docx);
  console.log(results.join("\n"));
} finally {
  if (liveId) await stopSession(liveId).catch(() => {});
  wsServer.close();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
