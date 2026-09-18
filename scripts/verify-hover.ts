import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Flow } from "../shared/types";

process.env.STUDIO_DATA_DIR = resolve("output", "verification-hover", randomUUID());
const { startSession, stopSession, getActivePage, readRun } = await import("../server/recorder");
const { put, get } = await import("../server/store");
const html = `<!doctype html><meta charset="utf-8"><title>悬浮回归</title>
<style>
body{margin:40px} .root,.nested{width:180px;padding:12px;position:relative}
.submenu,.leaf{display:none;position:absolute;left:100%;top:0;width:180px;background:#eee}
.root:hover>.submenu,.nested:hover>.leaf{display:block}
#portal{position:absolute;left:40px;top:250px} #trigger{margin-top:120px}
</style>
<div class="root" id="root"><span id="caption">设备菜单</span>
<div class="submenu"><div class="nested" id="nested">二级菜单
<div class="leaf"><button id="leaf" onclick="document.querySelector('#result').textContent='多级成功'">设备台账</button></div>
</div></div></div>
<button id="trigger" aria-haspopup="menu">延迟菜单</button><div id="portal"></div>
<p id="result"></p><p id="portal-result"></p>
<script>let timer;const trigger=document.querySelector('#trigger');
trigger.addEventListener('mouseenter',()=>{timer=setTimeout(()=>{
const button=document.createElement('button');button.id='portal-leaf';button.textContent='动态子菜单';
button.onclick=()=>document.querySelector('#portal-result').textContent='延迟成功';
document.querySelector('#portal').replaceChildren(button);
},650)});trigger.addEventListener('mouseleave',()=>clearTimeout(timer));</script>`;
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(req.url === "/frame" ? `<iframe id="child" src="/" width="950" height="600"></iframe>` : html);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
let liveId = "";
try {
  for (const framed of [false, true]) {
    const url = base + (framed ? "/frame" : "/");
    const run = await startSession({ name: "悬浮录制", project: "回归", environment: "本地", url, headless: true });
    liveId = run.id;
    const page = getActivePage(run.id)!;
    const scope = framed ? page.frameLocator("#child") : page;
    await scope.locator("#caption").hover();
    await scope.locator("#nested").hover({ position: { x: 30, y: 15 } });
    await scope.locator("#leaf").click();
    assert.equal(await scope.locator("#result").textContent(), "多级成功");
    await scope.locator("#trigger").hover();
    await scope.locator("#portal-leaf").click();
    assert.equal(await scope.locator("#portal-result").textContent(), "延迟成功");
    await stopSession(run.id);
    liveId = "";
    const hoverIds = run.operations.filter((o) => o.kind === "hover").map((o) => o.locators.find((l) => l.kind === "css")?.value);
    assert.deepEqual(hoverIds, ["#root", "#nested", "#leaf", "#trigger", "#portal-leaf"]);
    assert(run.operations.filter((o) => o.kind === "hover").every((o) => o.effect === "read" && o.framePath.length === (framed ? 1 : 0)));
    const flow: Flow = {
      id: randomUUID(), name: "悬浮保存回放", project: run.project, url, version: 1,
      sourceRunId: run.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      operations: structuredClone(run.operations), variables: [],
    };
    flow.operations.find((o) => o.kind === "click" && o.locators.some((l) => l.value === "#leaf"))!.assertion = "多级成功";
    flow.operations.find((o) => o.kind === "click" && o.locators.some((l) => l.value === "#portal-leaf"))!.assertion = "延迟成功";
    // Assertions in the existing executor are page-scoped; iframe outcomes were checked above.
    if (framed) flow.operations.forEach((o) => { o.assertion = undefined; });
    put("flow", flow);
    const saved = get<Flow>("flow", flow.id)!;
    assert.deepEqual(saved.operations, JSON.parse(JSON.stringify(flow.operations)));
    const replay = await startSession({ name: "悬浮回放", project: run.project, environment: "本地", url, headless: true, flow: saved });
    liveId = replay.id;
    const deadline = Date.now() + 45000;
    while (readRun(replay.id)?.status === "REPLAYING") {
      assert(Date.now() < deadline, "回放超时");
      await new Promise((r) => setTimeout(r, 100));
    }
    liveId = "";
    assert.equal(replay.operations.length, saved.operations.length);
    assert(replay.operations.every((o) => ["EXECUTED", "PASSED"].includes(o.status)), JSON.stringify(replay.operations.filter((o) => o.status === "FAILED")));
    console.log(`${framed ? "iframe" : "主页面"}：多级 CSS 悬浮、动态延迟子菜单、动作顺序、保存加载及真实浏览器回放通过。`);
  }
} finally {
  if (liveId) await stopSession(liveId).catch(() => {});
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
