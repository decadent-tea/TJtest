import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import type { Flow, Operation } from "../shared/types";
import { actualOperations } from "../src/lib/run-path";

process.env.STUDIO_DATA_DIR = resolve(
  "output",
  "verification-replay",
  randomUUID(),
);
const { startSession, stopSession, readRun, getActivePage } =
  await import("../server/recorder");
const { dataRoot } = await import("../server/store");
const documentLoads = new Map<string, number>();
const server = createServer((req, res) => {
  if (req.url === "/poll-data") {
    setTimeout(() => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ value: Date.now() }));
    }, 120);
    return;
  }
  if (["/", "/tab", "/login", "/dashboard"].includes(req.url || ""))
    documentLoads.set(req.url!, (documentLoads.get(req.url!) || 0) + 1);
  if (req.url === "/slow-business") {
    setTimeout(() => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    }, 1400);
    return;
  }
  if (req.url === "/never") {
    res.setHeader("Content-Type", "application/json");
    res.flushHeaders();
    return;
  }
  if (req.url === "/child") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end("<!doctype html><script>fetch('/never')</script>旧页签初始化请求");
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><meta charset="utf-8"><style>
    body{margin:40px}.menu{width:162px;height:32px;position:relative}
    .name{position:absolute;left:21px;top:8px;width:98px;height:16px;font:14px/16px SimSun}
    #small{width:48px;height:16px}#border{border:4px solid black;width:90px;height:24px}
    #covered{position:relative;width:130px;height:32px;margin-top:20px}
    #cover{position:absolute;inset:0;background:white;z-index:1}
    #partial-wrap{position:relative;width:100px;height:25px}
    #hover-partial{width:100px;height:25px}
    #partial-cover{position:absolute;left:50px;top:0;width:50px;height:25px;background:white;z-index:1}
    #hover-trigger{position:relative;width:150px;height:30px}
    #hover-leaf{position:absolute;left:150px;top:0;width:100px}
    #choices [role=menuitem]::after{content:"▼"}
    #icon-button{width:300px;height:50px;text-align:left}#icon{display:inline-block;width:25px;height:25px}
    .el-loading-mask.is-fullscreen{position:fixed;inset:0;background:#ffffffd9;z-index:20}
    </style>
    <div class="menu"><div id="history" class="name">历史预报警记录</div></div>
    <div class="menu"><div id="small" class="name">缩小</div></div>
    <div id="border">边框控件</div>
    <button id="icon-button"><span id="icon">图标</span></button>
    <div id="covered"><span id="blocked-target">被遮挡的操作</span><div id="cover"></div></div>
    <div id="partial-wrap"><div id="hover-partial">局部可悬浮</div><div id="partial-cover"></div></div>
    <div id="map-test" style="position:fixed;left:632px;top:523px"><div><div><img id="moved-img" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" style="width:60px;height:32px;background:#008888" onclick="document.querySelector('#result').textContent='图片点击成功'"></div></div></div>
    <input id="cascader" readonly placeholder="请选择" onclick="document.querySelector('#choices').hidden=false">
    <div id="choices" hidden><div role="menuitem" id="cascader-${randomUUID()}"><label><input type="radio" name="mine">南屯煤矿</label></div></div>
    <div id="hover-trigger">延迟关闭菜单<button id="hover-leaf" hidden>子菜单</button></div>
    <button id="slow" onclick="fetch('/slow-business').then(()=>document.querySelector('#after').hidden=false)">慢接口</button>
    <button id="poll" onclick="fetch('/poll-data');window.poller=setInterval(()=>fetch('/poll-data'),500);fetch('/slow-business').then(()=>document.querySelector('#after').hidden=false)">实时数据</button>
    <button id="orphan" onmouseenter="fetch('/never')">旧页面未结束读取</button>
    <button id="spa-next" onclick="fetch('/slow-business').then(()=>document.querySelector('#after').hidden=false);history.pushState({},'', '/next-view')">切换页面</button>
    <button id="after" hidden onclick="document.querySelector('#result').textContent='接口已完成'">接口后操作</button>
    <button id="disabled-action" disabled onmouseenter="document.querySelector('#result').textContent='禁用按钮悬浮成功'" onclick="fetch('/forbidden-write')">批量修改状态</button>
    <button id="show-mask" onclick="document.querySelector('#busy-mask').hidden=false;setTimeout(()=>document.querySelector('#busy-mask').hidden=true,1400)">显示加载遮罩</button>
    <button id="after-mask" onclick="document.querySelector('#result').textContent='遮罩已消失'">遮罩后操作</button>
    <div id="busy-mask" class="el-loading-mask is-fullscreen" hidden></div>
    <button id="wait-forever" onclick="fetch('/never')">等待中止</button>
    <button id="open-child" onclick="window.open('/child')">打开新页签</button>
    <button id="open-recorded-tab" onclick="setTimeout(()=>window.open('/tab'),1200)">打开业务页签</button>
    <input placeholder="页签输入" name="tab-input">
    <button id="login" onclick="fetch('/never');setTimeout(()=>location.href='/dashboard',1800)">登录系统</button>
    <p id="result"></p>
    <script>
    window.hits={};
    for(const id of ['history','small','border','icon','blocked-target','hover-leaf']) {
      document.getElementById(id).onclick=()=>{
        window.hits[id]=(window.hits[id]||0)+1;
        document.getElementById('result').textContent=id+'成功'+window.hits[id];
        fetch('/hit?id='+id);
      };
    }
    document.querySelector('input[type=radio]').onchange=()=>document.querySelector('#choices').hidden=true;
    document.querySelector('#hover-partial').onmouseenter=()=>document.querySelector('#result').textContent='悬浮成功';
    let entries=0;
    document.querySelector('#hover-trigger').onmouseenter=()=>{
      const leaf=document.querySelector('#hover-leaf');leaf.hidden=false;
      if(++entries===1)setTimeout(()=>leaf.hidden=true,150);
    };
    </script>`);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const op = (
  kind: Operation["kind"],
  selector: string,
  extra: Partial<Operation> = {},
): Operation => ({
  id: randomUUID(),
  sequence: 1,
  pageId: "page-1",
  framePath: [],
  timestamp: new Date().toISOString(),
  kind,
  label: selector,
  module: "回归",
  scene: "边界点击",
  url,
  locators: selector ? [{ kind: "css", value: selector }] : [],
  status: "RECORDED",
  dependsOn: [],
  timeout: 1200,
  effect: "read",
  enabled: true,
  ...extra,
});
const base = [
  op("goto", ""),
  // Real failing recording: target height 16, recorded y exactly 16.
  op("hover", "#history", { hoverPosition: { x: 50.59375, y: 0 } }),
  op("click", "#history", {
    clickPosition: { x: 50.59375, y: 16 },
    assertion: "history成功1",
  }),
  op("click", "#small", {
    clickPosition: { x: 90, y: 30 },
    assertion: "small成功1",
  }),
  op("click", "#border", {
    clickPosition: { x: 90, y: 24 },
    assertion: "border成功1",
  }),
  // A valid interior coordinate must retain its nested target, not move to the centre.
  op("click", "#icon-button", {
    clickPosition: { x: 15, y: 15 },
    assertion: "icon成功1",
  }),
];
let liveId = "";
const results: unknown[] = [];
async function execute(operations: Operation[]) {
  const flow: Flow = {
    id: randomUUID(),
    name: "复检稳定性",
    project: "本地回归",
    url,
    version: 1,
    sourceRunId: "fixture",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    operations,
    variables: [],
  };
  const run = await startSession({
    name: flow.name,
    project: flow.project,
    environment: "本地回归",
    url,
    headless: true,
    flow,
  });
  liveId = run.id;
  const deadline = Date.now() + 30000;
  while (readRun(run.id)?.status === "REPLAYING") {
    assert(Date.now() < deadline, "复检未在期限内结束");
    await new Promise((r) => setTimeout(r, 100));
  }
  liveId = "";
  results.push({
    id: run.id,
    status: run.status,
    operations: run.operations,
    notes: run.notes,
  });
  return run;
}
try {
  const tabs = await startSession({
    name: "多页签连续录制",
    project: "回归",
    environment: "本地",
    url,
    headless: true,
  });
  liveId = tabs.id;
  const parent = getActivePage(tabs.id)!;
  const childReady = parent.waitForEvent("popup");
  await parent.locator("#open-recorded-tab").click();
  const child = await childReady;
  await child.getByPlaceholder("页签输入").fill("新标签页连续操作");
  await child.locator("#history").click();
  await child.locator("#small").click();
  await parent.locator("#border").click();
  await stopSession(tabs.id);
  liveId = "";
  assert(
    tabs.operations.some(
      (step) => step.pageId === "page-2" && step.kind === "fill",
    ),
  );
  assert(
    tabs.operations.some(
      (step) => step.pageId === "page-2" && step.kind === "click",
    ),
  );
  assert.equal(
    tabs.operations.filter((step) => step.kind === "goto").length,
    2,
  );
  const beforeRoot = documentLoads.get("/") || 0;
  const beforeTab = documentLoads.get("/tab") || 0;
  const tabsReplay = await execute(tabs.operations);
  assert.equal(
    tabsReplay.status,
    "COMPLETED",
    JSON.stringify(tabsReplay.operations),
  );
  assert.equal(
    (documentLoads.get("/") || 0) - beforeRoot,
    1,
    "主页面只能加载一次",
  );
  assert.equal(
    (documentLoads.get("/tab") || 0) - beforeTab,
    1,
    "新标签页不能重复加载",
  );
  assert.equal(
    tabsReplay.requests.filter((r) => r.url.includes("/hit?")).length,
    3,
  );
  console.log(
    "真实录制→复检：延迟打开页签、页签内输入和连续点击、切回主页面及无重复加载通过。",
  );
  const xpathRun = await execute([
    op("goto", ""),
    op("click", "", {
      locators: [
        { kind: "css", value: "#missing-generated-id" },
        { kind: "xpath", value: "//div[@id='history']" },
      ],
      assertion: "history成功1",
    }),
    op("fill", "", {
      locators: [{ kind: "placeholder", value: "页签输入" }],
      value: "属性定位",
    }),
  ]);
  assert.equal(
    xpathRun.status,
    "COMPLETED",
    JSON.stringify(xpathRun.operations),
  );
  console.log("失效CSS回退XPath和placeholder定位通过。");
  const login = await startSession({
    name: "登录跳转录制",
    project: "回归",
    environment: "本地",
    url: `${url}/login`,
    headless: true,
  });
  liveId = login.id;
  const loginPage = getActivePage(login.id)!;
  await loginPage.locator("#login").click();
  await loginPage.waitForURL(`${url}/dashboard`);
  await loginPage.locator("#history").click();
  await loginPage.goto(`${url}/tab`);
  await loginPage.locator("#small").click();
  await stopSession(login.id);
  liveId = "";
  assert.equal(
    login.operations.filter((step) => step.kind === "goto").length,
    2,
    "登录跳转不应录成重复导航指令",
  );
  const beforeLogin = documentLoads.get("/login") || 0;
  const beforeDashboard = documentLoads.get("/dashboard") || 0;
  const loginReplay = await execute(login.operations);
  assert.equal(
    loginReplay.status,
    "COMPLETED",
    JSON.stringify(loginReplay.operations),
  );
  assert.equal((documentLoads.get("/login") || 0) - beforeLogin, 1);
  assert.equal((documentLoads.get("/dashboard") || 0) - beforeDashboard, 1);
  console.log("登录延迟跳转后继续操作，登录页和业务页各加载一次，通过。");
  const recorded = await startSession({
    name: "级联输入框录制",
    project: "回归",
    environment: "本地",
    url,
    headless: true,
  });
  liveId = recorded.id;
  const page = getActivePage(recorded.id)!;
  await page.locator("#cascader").click();
  await page
    .getByRole("menuitem", { name: "南屯煤矿" })
    .locator("label")
    .click();
  await stopSession(recorded.id);
  liveId = "";
  assert(
    recorded.operations.some(
      (o) =>
        o.kind === "click" && o.locators.some((l) => l.value === "#cascader"),
    ),
    "只读输入框展开点击不能漏录",
  );
  const check = recorded.operations.find((o) => o.kind === "check")!;
  assert(
    check.locators.some((l) => l.value.includes(':has-text("南屯煤矿")')),
    "单选框应优先使用稳定的父菜单名称定位",
  );
  const selection = await execute(recorded.operations);
  assert.equal(
    selection.status,
    "COMPLETED",
    JSON.stringify(selection.operations.filter((o) => o.status === "FAILED")),
  );
  console.log("真实录制及复检：只读输入框展开、随机ID级联菜单和单选操作通过。");
  const restored = await execute([
    op("goto", ""),
    op("hover", "#hover-trigger"),
    op("click", "#hover-leaf", { timeout: 3500, assertion: "hover-leaf成功1" }),
  ]);
  assert.equal(
    restored.operations.at(-1)?.status,
    "PASSED",
    JSON.stringify(restored.operations),
  );
  assert.equal(
    restored.requests.filter((r) => r.url.includes("id=hover-leaf")).length,
    1,
  );
  console.log("菜单异步关闭后重新悬浮展开，业务点击仅执行一次，通过。");
  const uncoveredHover = await execute([
    op("goto", ""),
    op("hover", "#hover-partial", {
      hoverPosition: { x: 90, y: 12 },
      assertion: "悬浮成功",
    }),
  ]);
  assert.equal(uncoveredHover.operations.at(-1)?.status, "PASSED");
  console.log("悬浮坐标被局部装饰元素遮挡时改用同控件可交互区域，通过。");
  const movedImage = await execute([
    op("goto", ""),
    op("click", "#map-test > div > img", {
      label: "点击 · img",
      position: { x: 632, y: 463, width: 60, height: 32 },
      clickPosition: { x: 36, y: 15 },
      assertion: "图片点击成功",
    }),
  ]);
  assert.equal(movedImage.operations.at(-1)?.status, "PASSED");
  console.log("地图图片层级和位置变化后按唯一邻近图片恢复定位，通过。");
  const disabledHover = await execute([
    op("goto", ""),
    op("hover", "#disabled-action", { assertion: "禁用按钮悬浮成功" }),
    op("click", "#disabled-action", { scene: "禁止点击禁用按钮" }),
  ]);
  assert.equal(disabledHover.operations[1].status, "PASSED");
  assert.equal(disabledHover.operations[2].status, "FAILED");
  assert(!disabledHover.requests.some(r => r.url.endsWith("/forbidden-write")));
  console.log("禁用按钮可以真实悬浮，禁用按钮点击仍失败且不触发写请求，通过。");
  const stale = await execute([
    op("goto", ""),
    op("hover", "#orphan"),
    op("click", "#spa-next"),
    op("click", "#after", { url: `${url}/next-view`, assertion: "接口已完成" }),
  ]);
  assert.equal(stale.status, "COMPLETED", JSON.stringify(stale.operations));
  assert((stale.operations[2].duration || 0) >= 2300,
    "路由切换仅清理旧步骤遗留请求，当前步骤慢请求仍需等待");
  assert(stale.requests.some(r => r.url.endsWith("/never")), "旧请求证据必须保留");
  console.log("SPA切换不再被旧页面未结束请求阻塞，当前导航的慢请求仍正确等待，通过。");
  const polling = await execute([
    op("goto", ""),
    op("click", "#poll"),
    op("click", "#after", { assertion: "接口已完成" }),
    op("click", "#slow"),
  ]);
  assert.equal(polling.status, "COMPLETED", JSON.stringify(polling.operations));
  assert(polling.requests.filter(r => r.url.endsWith("/poll-data")).length >= 5,
    "实时轮询必须继续采集，不能屏蔽请求来伪造完成");
  assert((polling.operations[1].duration || 0) >= 2300,
    "识别轮询后仍必须等待首次慢查询完成");
  assert((polling.operations[3].duration || 0) >= 2300,
    "已有轮询不能导致新操作的慢请求被跳过");
  assert((polling.operations[1].duration || 0) < 8000,
    "正常实时页面不能等待全局网络静默而超时");
  console.log("持续实时轮询下继续复检、完整采集、首次慢查询及后续新查询仍正确等待，通过。");
  const delayed = await execute([
    op("goto", ""),
    op("click", "#slow"),
    op("click", "#after", { assertion: "接口已完成" }),
  ]);
  assert.equal(delayed.operations.at(-1)?.status, "PASSED");
  assert(
    (delayed.operations[1].duration || 0) >= 2300,
    "必须等接口结束和页面安静后再执行下一步",
  );
  assert.equal(
    delayed.requests.find((r) => r.url.endsWith("/slow-business"))?.status,
    200,
  );
  const masked = await execute([
    op("goto", ""),
    op("click", "#show-mask"),
    op("click", "#after-mask", { assertion: "遮罩已消失" }),
  ]);
  assert.equal(masked.operations.at(-1)?.status, "PASSED");
  assert(
    (masked.operations[1].duration || 0) >= 1400,
    "页面加载遮罩消失前不得执行下一步",
  );
  console.log("页面加载遮罩消失后才进入下一步，通过。");
  const popup = await execute([
    op("goto", ""),
    op("click", "#open-child"),
    op("goto", "", { pageId: "page-2" }),
    op("click", "#slow", { pageId: "page-2" }),
  ]);
  assert.equal(popup.status, "COMPLETED", JSON.stringify(popup.operations));
  assert.equal(popup.operations.at(-1)?.status, "EXECUTED");
  console.log("新页签导航不等待旧文档遗留的请求，通过。");
  console.log("慢接口未完成时不进入下一步，接口与页面就绪后继续，通过。");
  for (let repeat = 0; repeat < 3; repeat++) {
    const run = await execute(structuredClone(base));
    assert.equal(
      run.status,
      "COMPLETED",
      JSON.stringify(run.operations.filter((o) => o.status === "FAILED")),
    );
    assert.equal(run.operations.filter((o) => o.status === "PASSED").length, 4);
    assert.equal(
      run.requests.filter((r) => r.url.includes("/hit?")).length,
      4,
      "每次操作只能真实点击一次",
    );
    console.log(
      `第 ${repeat + 1} 次：边界坐标、布局缩小、边框坐标、局部图标点击及效果断言通过。`,
    );
  }
  const blocked = op("click", "#blocked-target", {
    scene: "遮挡",
    clickPosition: { x: 20, y: 8 },
  });
  const run = await execute([
    op("goto", ""),
    blocked,
    op("click", "#history", { scene: "遮挡" }),
    op("click", "#small", { scene: "独立场景", dependsOn: [blocked.id] }),
    op("goto", "", { scene: "恢复" }),
    op("click", "#history", { scene: "恢复", assertion: "history成功1" }),
  ]);
  assert.deepEqual(
    run.operations.map((o) => o.status),
    ["EXECUTED", "FAILED", "BLOCKED", "BLOCKED", "EXECUTED", "PASSED"],
  );
  assert(
    !run.requests.some((r) => r.url.includes("id=blocked-target")),
    "不能穿透真实遮挡强制点击",
  );
  assert.deepEqual(
    actualOperations(run).map((o) => o.status),
    ["EXECUTED", "FAILED", "EXECUTED", "PASSED"],
  );
  console.log("真实遮挡保留失败、依赖阻塞、独立场景继续执行通过。");
  const interrupted = await startSession({
    name: "中止原因验证",
    project: "回归",
    environment: "本地",
    url,
    headless: true,
    flow: {
      id: randomUUID(),
      name: "中止原因验证",
      project: "回归",
      url,
      version: 1,
      sourceRunId: "fixture",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      operations: [
        op("goto", ""),
        op("click", "#wait-forever"),
        op("click", "#after"),
      ],
      variables: [],
    },
  });
  liveId = interrupted.id;
  const deadline = Date.now() + 10000;
  while (
    interrupted.operations.at(-1)?.status !== "RUNNING" ||
    interrupted.operations.length < 2
  ) {
    assert(Date.now() < deadline, "等待中的步骤未启动");
    await new Promise((r) => setTimeout(r, 50));
  }
  await stopSession(interrupted.id);
  liveId = "";
  assert.equal(interrupted.status, "INTERRUPTED");
  assert.equal(interrupted.interruption?.sequence, 2);
  assert.match(interrupted.interruption?.reason || "", /用户手动中止/);
  assert.equal(interrupted.operations[1].status, "FAILED");
  assert.deepEqual(
    actualOperations(interrupted).map((o) => o.sequence),
    [1, 2],
  );
  console.log("主动中止时保存原因和准确步骤，操作路径只含实际尝试步骤，通过。");
} finally {
  if (liveId) await stopSession(liveId).catch(() => {});
  writeFileSync(
    resolve(dataRoot, "results.json"),
    JSON.stringify(results, null, 2),
  );
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
