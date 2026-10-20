import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import type { Run, Flow, ModelProfile } from "../shared/types";
import { prepareEvidence } from "../server/ai-evidence";
import { groundFinding } from "../server/evidence-grounding";
import { feedbackText, operationEvidence } from "../shared/inspection-evidence";
import { captureFeedback } from "../server/page-feedback";
import { redactFeedbackUrl } from "../server/redact";
import { reportHtml, finalizeReport } from "../server/report";
import { caseView } from "../server/case-view";
import { evidenceLabel } from "../server/evidence-quality";
import { casesWorkbook } from "../server/export";

process.env.STUDIO_DATA_DIR = resolve(
  "output",
  "verification-feedback",
  randomUUID(),
);
const { startSession, stopSession, getActivePage, pauseSession } =
  await import("../server/recorder");
const { get, put, encrypt } = await import("../server/store");
const { analyze } = await import("../server/ai");
let modelCalls = 0;
const server = createServer(async (req, res) => {
  if (req.url === "/chat/completions") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    const batch = JSON.parse(payload.messages[1].content);
    modelCalls++;
    assert(String(payload.messages[0].content).includes("ambiguous"));
    const feedback = [
      ...(batch.feedback || []),
      ...(batch.contextFeedback || []),
    ].find((f) => f.level === "error");
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                findings: feedback
                  ? [
                      {
                        title: "页面提示需核查",
                        module: "页面",
                        severity: "medium",
                        category: "frontend",
                        confidence: "high",
                        observation: "出现99次",
                        detail: "提示",
                        evidenceIds: [feedback.id],
                      },
                    ]
                  : [],
                caseDescriptions: batch.steps.map(
                  (s: { id: string; label: string }) => ({
                    stepId: s.id,
                    title: s.label,
                    expected: "已配置的结果断言",
                    verdict: "limited",
                    reason: "反馈文字不证明业务通过",
                  }),
                ),
              }),
            },
            finish_reason: "stop",
          },
        ],
      }),
    );
    return;
  }
  if (req.url?.startsWith("/slow")) {
    res.setHeader("Content-Type", "application/json");
    res.write('{"ok":true,');
    setTimeout(() => res.end('"data":[]}'), 700);
    return;
  }
  if (req.url?.startsWith("/frame")) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<button id="frame-message">iframe提示</button><script>document.querySelector("button").onclick=()=>{const el=document.createElement("div");el.setAttribute("role","alert");el.textContent="iframe独立校验提示";document.body.append(el);}</script>',
    );
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html><head><title>反馈夹具</title></head><body><h1>页面反馈夹具</h1>
  <button id="error">出现错误提示</button><button id="flash">短暂提示</button><button id="success">成功提示</button><button id="dialog">打开弹窗</button><button id="close">关闭弹窗</button><button id="location">变更位置</button><button id="loading">切换加载</button><button id="empty">切换空状态</button><button id="later">迟到提示</button><button id="other">其他操作</button><button id="long">长提示</button>
  <div id="load-area" style="width:100px;height:30px" aria-busy="false"></div><div id="empty-area" class="el-empty" hidden><p class="el-empty__description">暂无设备数据</p></div>
  <div id="popup-wrapper" hidden><div id="popup" role="dialog" aria-labelledby="popup-title" aria-describedby="popup-description"><h2 id="popup-title">保存确认</h2><p id="popup-description">请确认本次保存</p><form><input type="password" value="secret-input"><textarea>textarea-private</textarea><span data-sensitive>hidden-person</span></form></div></div>
  <div role="status" id="clock">12:00:00</div><iframe id="child" src="/frame"></iframe>
  <script>
  function notify(text,type='error'){const el=document.createElement('div');el.className='el-message el-message--'+type;el.textContent=text;document.body.append(el);return el;}
  document.getElementById('error').onclick=()=>notify('保存失败 password=fixture-secret');
  document.getElementById('flash').onclick=()=>{const el=notify('短暂出现的提示');setTimeout(()=>el.remove(),10);};
  document.getElementById('success').onclick=()=>notify('保存成功','success');
  document.getElementById('dialog').onclick=()=>document.getElementById('popup-wrapper').hidden=false;
  document.getElementById('close').onclick=()=>document.getElementById('popup-wrapper').hidden=true;
  document.getElementById('location').onclick=()=>{history.pushState({},'','#/devices?token=hash-secret&tab=1');document.title='设备查询结果';};
  document.getElementById('loading').onclick=()=>{const el=document.getElementById('load-area');el.setAttribute('aria-busy','true');setTimeout(()=>el.setAttribute('aria-busy','false'),150);};
  document.getElementById('empty').onclick=()=>document.getElementById('empty-area').hidden=!document.getElementById('empty-area').hidden;
  document.getElementById('later').onclick=()=>fetch('/slow').then(r=>r.json()).then(()=>notify('迟到的保存失败'));
  document.getElementById('other').onclick=()=>{};
  document.getElementById('long').onclick=()=>notify('长提示'+ '字'.repeat(900));
  </script></body></html>`);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
let activeId = "";
const wait = async (check: () => boolean, label: string, timeout = 6000) => {
  const end = Date.now() + timeout;
  while (!check()) {
    assert(Date.now() < end, label);
    await new Promise((r) => setTimeout(r, 20));
  }
};
try {
  const run = await startSession({
    name: "页面反馈采集验证",
    project: "夹具",
    environment: "隔离",
    url: base + "/page",
    headless: true,
  });
  activeId = run.id;
  const page = getActivePage(run.id)!;
  await page.locator("#error").click();
  await wait(
    () =>
      !!run.feedback?.some((f) => f.kind === "message" && f.level === "error"),
    "错误提示取证",
  );
  assert(!JSON.stringify(run.feedback).includes("fixture-secret"));
  const initialMessages = run
    .feedback!.filter((f) => f.kind === "message")
    .reduce((n, f) => n + (f.occurrences || 1), 0);
  await page.locator("#other").click();
  await page.locator("#other").click();
  await page.waitForTimeout(100);
  assert.equal(
    run
      .feedback!.filter((f) => f.kind === "message")
      .reduce((n, f) => n + (f.occurrences || 1), 0),
    initialMessages,
    "常驻提示不反复采样",
  );
  await page.locator("#error").click();
  await wait(
    () =>
      run
        .feedback!.filter((f) => f.kind === "message")
        .reduce((n, f) => n + (f.occurrences || 1), 0) ===
      initialMessages + 1,
    "重复操作保留真实新提示次数",
  );
  await page.locator("#dialog").click();
  await wait(
    () =>
      !!run.feedback?.some(
        (f) => f.kind === "dialog" && f.change === "appeared",
      ),
    "弹窗摘要",
  );
  const popup = run.feedback!.find((f) => f.kind === "dialog")!;
  assert(
    popup.text?.includes("保存确认") && popup.text?.includes("请确认本次保存"),
  );
  assert(!JSON.stringify(run.feedback).includes("secret-input"));
  assert(!JSON.stringify(run.feedback).includes("textarea-private"));
  assert(!JSON.stringify(run.feedback).includes("hidden-person"));
  await page.locator("#close").click();
  await wait(
    () =>
      !!run.feedback?.some(
        (f) => f.kind === "dialog" && f.change === "disappeared",
      ),
    "弹窗关闭",
  );
  await page.locator("#location").click();
  await wait(
    () =>
      !!run.feedback?.some(
        (f) => f.kind === "url" && f.after?.includes("#/devices"),
      ),
    "hash路由反馈",
  );
  assert(!JSON.stringify(run.feedback).includes("hash-secret"));
  await wait(
    () =>
      !!run.feedback?.some(
        (f) => f.kind === "title" && f.after === "设备查询结果",
      ),
    "动态标题",
  );
  await page.locator("#loading").click();
  await wait(
    () =>
      !!run.feedback?.some(
        (f) => f.kind === "loading" && f.change === "disappeared",
      ),
    "加载出现消失",
  );
  await page.locator("#empty").click();
  await wait(
    () =>
      !!run.feedback?.some(
        (f) => f.kind === "empty" && f.text?.includes("暂无设备数据"),
      ),
    "空数据状态",
  );
  await page.frameLocator("#child").locator("#frame-message").click();
  await wait(
    () => !!run.feedback?.some((f) => f.text === "iframe独立校验提示"),
    "iframe反馈",
  );
  assert(
    run.feedback!.find((f) => f.text === "iframe独立校验提示")!.framePath
      .length > 0,
  );
  await page.locator("#later").click();
  await page.locator("#other").click();
  await wait(
    () => !!run.feedback?.some((f) => f.text === "迟到的保存失败"),
    "迟到响应提示",
  );
  assert.equal(
    run.feedback!.find((f) => f.text === "迟到的保存失败")!.association,
    "ambiguous",
    "迟到反馈不能强行归最后一步",
  );
  await page.locator("#long").click();
  await wait(
    () => !!run.feedback?.some((f) => f.text?.startsWith("长提示")),
    "长文本采集",
  );
  assert(
    run.feedback!.find((f) => f.text?.startsWith("长提示"))!.truncated,
    "截断标记明确",
  );
  const noise = run.feedback!.length;
  await page.evaluate(() => {
    for (let i = 0; i < 30; i++)
      document.getElementById("clock")!.textContent = String(i);
  });
  await page.waitForTimeout(100);
  assert.equal(run.feedback!.length, noise, "普通实时文本更新不进入反馈");
  await page.locator("#flash").click();
  await wait(
    () => !!run.feedback?.some((f) => f.text === "短暂出现的提示"),
    "短暂提示仍能采集",
  );
  pauseSession(run.id);
  const beforePause = run.feedback!.length;
  await page.locator("#success").click();
  await page.waitForTimeout(100);
  assert.equal(run.feedback!.length, beforePause, "暂停不采反馈");
  pauseSession(run.id);
  await page.locator("#success").click();
  await wait(
    () => !!run.feedback?.some((f) => f.level === "success"),
    "恢复后新提示",
  );
  await page.goto(base + "/next");
  await wait(
    () =>
      !!run.feedback?.some(
        (f) =>
          f.kind === "title" &&
          f.before === "设备查询结果" &&
          f.after === "反馈夹具",
      ),
    "全页跳转标题前后变化",
  );
  const operationCount = run.operations.length;
  await stopSession(run.id);
  activeId = "";
  assert.equal(run.operations.length, operationCount, "反馈不添加回放操作");
  assert.equal(
    get<Run>("run", run.id)!.feedback!.length,
    run.feedback!.length,
    "停止落库一致",
  );
  assert(
    run.cases.every((c) => c.status !== "PASSED"),
    "页面提示不判业务通过",
  );
  const prepared = prepareEvidence(run);
  assert.equal(prepared.coverage.feedbackRecords, run.feedback!.length);
  const bundle = prepared.bundle(prepared.items.map((i) => i.key));
  assert.equal(bundle.feedback.length, run.feedback!.length);
  assert(
    run.feedback!.every((f) => bundle.feedback.some((v) => v.id === f.id)),
    "AI证据引用完整",
  );
  assert(reportHtml(run).includes("页面反馈摘要"));
  const candidate = run.feedback!.find((f) => f.association === "ambiguous")!;
  assert(feedbackText(run, candidate).includes("关联不确定"));
  const caseWithFeedback = run.cases.find((c) =>
    c.evidenceIds.some((id) => run.feedback!.some((f) => f.id === id)),
  )!;
  assert(caseView(run, caseWithFeedback).feedback);
  assert.equal(evidenceLabel(run, [candidate.id]), feedbackText(run, candidate));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await casesWorkbook(run));
  const exportedActual = String(
    workbook.worksheets[0].getCell(
      `H${run.cases.findIndex((c) => c.id === caseWithFeedback.id) + 7}`,
    ).value,
  );
  for (const line of caseView(run, caseWithFeedback).feedback.split("\n")) {
    assert.equal(exportedActual.split(line).length - 1, 1, "导出反馈事实仅出现一次");
  }
  const success = run.feedback!.find((f) => f.level === "success")!;
  assert.equal(
    groundFinding(run, {
      title: "保存成功因此系统正常",
      module: "页面",
      severity: "high",
      detail: "通过",
      evidenceIds: [success.id],
    }),
    undefined,
    "成功提示不生成风险/通过推断",
  );
  const isolated = structuredClone(run);
  isolated.feedback = [];
  isolated.feedbackCapture = undefined;
  const input = {
    kind: "message",
    change: "appeared",
    timestamp: new Date().toISOString(),
    eventId: "unique",
    text: "重复观察",
    level: "error",
  };
  const context = {
    pageId: run.operations[0].pageId,
    framePath: [],
    candidateStepIds: [run.operations[0].id],
  };
  captureFeedback(isolated, input, context);
  captureFeedback(isolated, input, context);
  captureFeedback(isolated, { ...input, eventId: "second" }, context);
  assert.equal(isolated.feedback.length, 1);
  assert.equal(isolated.feedback[0].occurrences, 2, "按真实事件去重计数");
  const capped = structuredClone(isolated);
  capped.feedback = Array.from({ length: 2000 }, (_, i) => ({
    ...isolated.feedback![0],
    id: `cap-${i}`,
    text: `已保存-${i}`,
  }));
  capped.feedbackCapture = { events: 2000, discarded: 0, truncated: 0 };
  captureFeedback(
    capped,
    { ...input, eventId: "over-cap" },
    { ...context, candidateStepIds: [] },
  );
  assert.equal(capped.feedback.length, 2000);
  assert.equal(capped.feedbackCapture.discarded, 1);
  assert(
    capped.notes.some((n) => n.includes("采集上限")),
    "限额不会伪装全量取证",
  );
  assert.equal(
    redactFeedbackUrl(base + "/#access_token=private"),
    base + "/",
    "认证片段不保存",
  );
  const profile: ModelProfile = {
    id: randomUUID(),
    name: "隔离反馈协议",
    provider: "Custom",
    baseUrl: base,
    model: "feedback-mock",
    apiKey: encrypt("local-fixture"),
    enabled: true,
    timeout: 10,
    maxTokens: 8192,
    aiSynthesis: false,
  };
  put("model", profile);
  put("run", run);
  await analyze(run, profile.id);
  await wait(() => run.analysis.status !== "RUNNING", "本地AI协议完成", 15000);
  assert.equal(run.analysis.status, "COMPLETED", run.analysis.error);
  assert(modelCalls > 0);
  assert(
    run.analysis.findings.some((f) =>
      f.evidenceIds.some((id) => run.feedback!.some((p) => p.id === id)),
    ),
    "真实反馈引用进入最终AI结果",
  );
  assert(
    run.analysis.findings.every((f) => !f.observation?.includes("99次")),
    "观察事实由本地生成，不沿用AI次数",
  );
  console.log(
    "录制页面反馈：提示、弹窗摘要、URL/标题、加载/空状态、iframe、重复/迟到、限额脱敏、暂停恢复、AI引用和报告通过。",
  );
  const flow: Flow = {
    id: randomUUID(),
    name: "页面反馈复检",
    project: "夹具",
    url: base + "/page",
    version: 1,
    sourceRunId: run.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    variables: [],
    operations: [
      structuredClone(run.operations.find((o) => o.kind === "goto")!),
      structuredClone(
        run.operations.find(
          (o) =>
            o.kind === "click" &&
            o.locators.some((h) => h.value === "error" || h.value === "#error"),
        )!,
      ),
    ],
  };
  assert(flow.operations.every(Boolean));
  const replay = await startSession({
    name: "反馈回放",
    project: "夹具",
    environment: "隔离",
    url: base + "/page",
    headless: true,
    flow,
  });
  activeId = replay.id;
  await wait(
    () => !["REPLAYING", "RECORDING"].includes(replay.status),
    "回放完成",
    15000,
  );
  activeId = "";
  assert(
    replay.feedback?.some((f) => f.level === "error"),
    "回放也采反馈",
  );
  assert.equal(replay.operations.length, 2);
  assert(replay.cases.every((c) => c.status !== "PASSED"));
  console.log("回放页面反馈采集与原始操作数量/断言状态保持一致，通过。");
  const lateStop = await startSession({
    name: "停止前迟到反馈",
    project: "夹具",
    environment: "隔离",
    url: base + "/page",
    headless: true,
  });
  activeId = lateStop.id;
  await getActivePage(lateStop.id)!.locator("#later").click();
  await stopSession(lateStop.id);
  activeId = "";
  assert(
    lateStop.feedback?.some((f) => f.text === "迟到的保存失败"),
    "停止窗口内已开始请求的页面反馈保留",
  );
  assert.equal(
    get<Run>("run", lateStop.id)!.feedback!.length,
    lateStop.feedback!.length,
  );
  console.log("结束录制的迟到响应反馈与最终落库一致性通过。");
} finally {
  if (activeId) await stopSession(activeId).catch(() => {});
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
