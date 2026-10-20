import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { readdirSync } from "node:fs";
import type { Run } from "../shared/types";
import { countOf, requestStats } from "../shared/inspection-evidence";

process.env.STUDIO_DATA_DIR = resolve(
  "output",
  "verification-recording-audit",
  randomUUID(),
);
const { startSession, stopSession, getActivePage, pauseSession } =
  await import("../server/recorder");
const { get, dataRoot } = await import("../server/store");
const server = createServer((req, res) => {
  if (req.url === "/bad-page") {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end("<title>页面错误</title><h1>Internal Server Error</h1>");
    return;
  }
  if (req.url === "/broken-page") {
    req.socket.destroy();
    return;
  }
  if (req.url === "/download") {
    res.writeHead(200, {
      "Content-Disposition": "attachment; filename=audit.txt",
    });
    res.end("download body");
    return;
  }
  if (req.url === "/title-first" || req.url === "/title-next") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      req.url === "/title-first"
        ? '<title>first</title><h1>初始页面</h1><button id="next">下一页</button><script>document.getElementById("next").onclick=()=>location.href="/title-next"</script>'
        : "<title>next</title><h1>后续页面</h1>",
    );
    return;
  }
  if (req.url === "/frame") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      `<button id="frame-button">frame</button><script>document.getElementById('frame-button').onclick=()=>fetch('/api/frame')</script>`,
    );
    return;
  }
  if (req.url === "/page") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><title>录制审计夹具</title><h1>录制审计</h1>
      ${["fast", "twice", "large", "huge", "gzip", "gzip-large", "chunked", "slow", "metrics", "static", "nested", "empty", "pending"].map((k) => `<button id="${k}">${k}</button>`).join("")}
      <a id="download" href="/download">下载</a><iframe id="child" src="/frame"></iframe>
      <script>
      for(const k of ['fast','large','huge','gzip','gzip-large','chunked','slow','metrics','nested','empty','pending'])document.getElementById(k).onclick=()=>fetch('/api/'+k);
      document.getElementById('twice').onclick=()=>Promise.all([fetch('/api/twice'),fetch('/api/twice')]);
      document.getElementById('static').onclick=async()=>{await fetch('/asset.js');await fetch('/broken.css');console.error('TypeError: runtime in asset.js stays visible');};
      </script>`);
    return;
  }
  if (req.url === "/asset.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    res.end("void 0");
    return;
  }
  if (req.url === "/broken.css") {
    res.writeHead(404, { "Content-Type": "text/css" });
    res.end("missing");
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const body = (size: number) =>
    JSON.stringify({
      success: false,
      code: 500,
      msg: "业务错误 password=fixture-secret",
      data: "a".repeat(size),
    });
  if (req.url === "/api/large") {
    res.end(body(280000));
    return;
  }
  if (req.url === "/api/huge") {
    res.end(body(3 * 1024 * 1024));
    return;
  }
  if (req.url === "/api/gzip" || req.url === "/api/gzip-large") {
    res.setHeader("Content-Encoding", "gzip");
    res.end(
      gzipSync(
        req.url.endsWith("large") ? body(280000) : '{"success":true,"data":[]}',
      ),
    );
    return;
  }
  if (req.url === "/api/chunked") {
    res.write('{"success":true,');
    setTimeout(() => res.end('"data":[]}'), 50);
    return;
  }
  if (req.url === "/api/slow") {
    res.write('{"success":false,');
    setTimeout(() => res.end('"msg":"late response"}'), 800);
    return;
  }
  if (req.url === "/api/pending") {
    res.write('{"success":false,');
    return;
  }
  if (req.url === "/api/nested") {
    res.end('{"success":true,"data":{"success":false}}');
    return;
  }
  if (req.url === "/api/empty") {
    res.writeHead(204);
    res.end();
    return;
  }
  res.end('{"success":true}');
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
let liveId = "";
const waitFor = async (check: () => boolean, label: string, timeout = 5000) => {
  const end = Date.now() + timeout;
  while (!check()) {
    assert(Date.now() < end, label);
    await new Promise((r) => setTimeout(r, 25));
  }
};
try {
  const run = await startSession({
    name: "录制证据审计",
    project: "回归",
    environment: "独立本地",
    url: `${base}/page`,
    headless: true,
  });
  liveId = run.id;
  const page = getActivePage(run.id)!;
  await page.locator("#fast").waitFor();
  await page.waitForTimeout(150);
  // A malformed exposed-binding event must not poison the queue and prevent all
  // subsequent genuine collector events from being recorded.
  await page.evaluate(async () => {
    await (
      window as unknown as { __healthEmit: (event: unknown) => Promise<void> }
    ).__healthEmit({ kind: "fill", value: 123 });
  });
  for (let i = 0; i < 5; i++) {
    await page.locator("#fast").click();
    await page.waitForTimeout(90);
  }
  await waitFor(
    () =>
      run.requests.filter(
        (r) => r.url.endsWith("/api/fast") && r.completion === "complete",
      ).length === 5,
    "重复点击请求应完整采集",
  );
  const fast = run.requests.filter((r) => r.url.endsWith("/api/fast"));
  assert.equal(fast.length, 5);
  assert.equal(new Set(fast.map((r) => r.stepId)).size, 5);
  assert(
    fast.every(
      (r) => run.operations.find((o) => o.id === r.stepId)?.kind === "click",
    ),
  );
  await page.locator("#twice").click();
  await waitFor(() => requestStats(run).calls === 7, "单次动作双请求应计2次");
  await waitFor(
    () =>
      run.requests
        .filter((r) => r.url.endsWith("/api/twice"))
        .reduce((n, r) => n + countOf(r), 0) === 2,
    "双请求次数",
  );
  assert.equal(
    run.requests
      .filter((r) => r.url.endsWith("/api/twice"))
      .flatMap((r) => r.events || []).length,
    2,
  );
  for (const name of [
    "large",
    "huge",
    "gzip",
    "gzip-large",
    "chunked",
    "metrics",
    "nested",
    "empty",
  ]) {
    await page.locator(`#${name}`).click();
    await waitFor(
      () =>
        run.requests.some(
          (r) => r.url.endsWith(`/api/${name}`) && r.completion === "complete",
        ),
      `${name}完成`,
    );
  }
  const lookup = (name: string) =>
    run.requests.find((r) => r.url.endsWith(`/api/${name}`))!;
  assert.equal(lookup("large").bodyState, "sampled");
  assert.equal(lookup("large").businessMarkers?.success, false);
  assert.equal(lookup("large").responseBody, undefined);
  assert(!JSON.stringify(lookup("large")).includes("fixture-secret"));
  assert.equal(lookup("huge").bodyState, "unavailable");
  assert.match(lookup("huge").bodyNote || "", /2MB/);
  assert.equal(lookup("gzip").bodyState, "captured");
  assert.equal(lookup("gzip").businessMarkers?.success, true);
  assert.equal(lookup("gzip-large").bodyState, "sampled");
  assert.equal(lookup("gzip-large").businessMarkers?.success, false);
  assert.equal(lookup("chunked").bodyState, "captured");
  assert.equal(lookup("chunked").businessMarkers?.success, true);
  assert.equal(lookup("metrics").category, "business");
  assert.equal(lookup("nested").businessMarkers?.success, true);
  assert.equal(lookup("empty").bodyState, "empty");
  await page.locator("#static").click();
  await page.waitForTimeout(150);
  assert(!run.requests.some((r) => /asset\.js|broken\.css/.test(r.url)));
  assert(run.logs.some((l) => l.text.includes("TypeError: runtime")));
  await page.frameLocator("#child").locator("#frame-button").click();
  await waitFor(
    () =>
      run.requests.some(
        (r) => r.url.endsWith("/api/frame") && r.completion === "complete",
      ),
    "iframe请求完成",
  );
  const frame = lookup("frame");
  assert.deepEqual(frame.framePath, ["#child"]);
  assert.deepEqual(
    run.operations.find((o) => o.id === frame.stepId)?.framePath,
    ["#child"],
  );
  const beforeDownload = run.logs.length;
  pauseSession(run.id);
  await page.locator("#download").click();
  await page.waitForTimeout(150);
  assert.equal(run.logs.length, beforeDownload);
  assert(
    !readdirSync(resolve(dataRoot, "artifacts", run.id)).some((f) =>
      f.endsWith("audit.txt"),
    ),
  );
  pauseSession(run.id);
  await page.locator("#slow").click();
  const slowStep = run.requests.find((r) =>
    r.url.endsWith("/api/slow"),
  )?.stepId;
  await page.locator("#fast").click();
  await page.locator("#pending").click();
  await waitFor(() => lookup("pending")?.status === 200, "pending收到HTTP头");
  const started = Date.now();
  const statuses: string[] = [];
  await Promise.all([
    stopSession(run.id).then((r) => statuses.push(r.status)),
    stopSession(run.id).then((r) => statuses.push(r.status)),
  ]);
  liveId = "";
  assert(Date.now() - started < 5500, "停止应有界等待");
  assert(
    statuses.every((s) => s === "COMPLETED" || s === "COMPLETED_WITH_ISSUES"),
  );
  assert.equal(lookup("slow").completion, "complete");
  assert.equal(lookup("slow").stepId, slowStep);
  assert.equal(lookup("pending").completion, "stopped");
  assert.equal(lookup("pending").bodyState, "unavailable");
  assert.match(lookup("pending").bodyNote || "", /未完成|未结束|主动中断/);
  const saved = get<Run>("run", run.id)!;
  assert.equal(
    JSON.stringify(saved.requests),
    JSON.stringify(run.requests),
    "停止快照应完整落库",
  );
  assert.equal(
    saved.requests.find((r) => r.url.endsWith("/api/pending"))?.completion,
    "stopped",
  );
  console.log(
    "录制：重复人工操作、单动作多请求、迟到响应、有界停止与重复停止一致性通过。",
  );
  console.log(
    "正文：大JSON顶层失败标记、脱敏、2MB上限、gzip/chunked/空正文与嵌套标记隔离通过。",
  );
  console.log(
    "采集：静态成功/失败全排除、运行时错误保留、iframe关联、metrics业务保留与暂停下载通过。",
  );
  const bad = await startSession({
    name: "导航500",
    project: "回归",
    environment: "独立本地",
    url: `${base}/bad-page`,
    headless: true,
  });
  liveId = bad.id;
  await getActivePage(bad.id)!.locator("h1").waitFor();
  await stopSession(bad.id);
  liveId = "";
  assert.equal(bad.requests.length, 0);
  assert(
    bad.pageObservations?.some(
      (o) => o.status === 500 && o.kind === "navigation",
    ),
  );
  assert(
    bad.pageObservations?.some(
      (o) => o.stepId && bad.operations.some((op) => op.id === o.stepId),
    ),
  );
  const broken = await startSession({
    name: "导航网络失败",
    project: "回归",
    environment: "独立本地",
    url: `${base}/broken-page`,
    headless: true,
  });
  liveId = broken.id;
  await waitFor(
    () => !!broken.pageObservations?.some((o) => o.failure),
    "导航失败观察",
  );
  await stopSession(broken.id);
  liveId = "";
  assert.equal(broken.requests.length, 0);
  assert(broken.pageObservations?.some((o) => o.failure));
  console.log("导航：HTTP500及网络失败单独取证，不混入接口次数，通过。");
  const titleRun = await startSession({
    name: "标题归属保护",
    project: "回归",
    environment: "独立本地",
    url: `${base}/title-first`,
    headless: true,
  });
  liveId = titleRun.id;
  const titlePage = getActivePage(titleRun.id)!;
  await titlePage.locator("#next").waitFor();
  await waitFor(
    () => titleRun.operations[0]?.module === "初始页面",
    "初始页面标题归属",
  );
  const initial = titleRun.operations[0];
  await titlePage.locator("#next").click();
  await titlePage.getByText("后续页面", { exact: true }).waitFor();
  await titlePage.waitForTimeout(100);
  assert.equal(initial.module, "初始页面", "后续跳转不能改写历史goto归属");
  await titlePage.goto(`${base}/title-first`);
  await waitFor(
    () =>
      titleRun.operations.findLast((o) => o.kind === "goto")?.module ===
      "初始页面",
    "手动页面导航归属",
  );
  const pausedGoto = titleRun.operations.findLast((o) => o.kind === "goto")!;
  pauseSession(titleRun.id);
  await titlePage.goto(`${base}/title-next`);
  await titlePage.waitForTimeout(100);
  assert.equal(pausedGoto.module, "初始页面", "暂停导航不能改写已录制标题");
  await stopSession(titleRun.id);
  liveId = "";
  console.log("标题：后续页面跳转及暂停导航不能改写历史模块归属，通过。");
} finally {
  if (liveId) await stopSession(liveId).catch(() => {});
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
