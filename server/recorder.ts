import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
  type Frame,
  type Locator,
  type Dialog,
} from "playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { put, get, dataRoot } from "./store";
import type {
  Run,
  Operation,
  NetworkCall,
  Flow,
  LocatorHint,
} from "../shared/types";
import { installCollector } from "./collector";
import { ReplayNetwork } from "./replay-network";
import { redactBody, redactHeaders, redactText, redactUrl } from "./redact";
import { finalizeReport } from "./report";
import {
  captureLog,
  finishRequest,
  isStaticAssetUrl,
} from "./evidence-quality";

interface Session {
  run: Run;
  browser: Browser;
  context: BrowserContext;
  pages: Map<Page, string>;
  current?: Operation;
  closing: boolean;
  tasks: Set<Promise<unknown>>;
  dirty: boolean;
  flushTimer: ReturnType<typeof setInterval>;
  eventChain: Promise<unknown>;
  variables: Record<string, string>;
  started: number;
  canceled: boolean;
  dialogs: Map<Page, { dialog: Dialog; id: string; recorded: boolean }>;
  expectedDialog?: Operation;
  handledDialogs: Set<string>;
  deliveredClicks: Set<string>;
  replayNetwork: ReplayNetwork<Request>;
}
const sessions = new Map<string, Session>();
let launching = false;
export function activeRuns() {
  return [...sessions.values()].map((s) => ({
    id: s.run.id,
    status: s.run.status,
  }));
}
export function readRun(id: string) {
  const run = sessions.get(id)?.run || get<Run>("run", id);
  if (run) finalizeReport(run);
  return run;
}
export function getActivePage(id: string) {
  const s = sessions.get(id);
  return s?.context.pages().find((p) => !p.isClosed());
}
const now = () => new Date().toISOString();
function describeRequest(
  op: Operation | undefined,
  method: string,
  category: NetworkCall["category"],
  module: string,
) {
  if (category === "resource") return "页面静态资源";
  if (category === "background") return "后台心跳 / 遥测";
  if (category === "initialization") return `加载${module}页面数据`;
  const object = op?.module || module;
  const label = op?.label || "";
  if (/查询|搜索|筛选|刷新/.test(label)) return `查询${object}关联数据`;
  if (/导出|下载/.test(label)) return `导出${object}数据`;
  if (/删除|移除/.test(label)) return `删除${object}记录`;
  if (/保存|提交/.test(label)) return `保存${object}信息`;
  if (/下发|控制/.test(label)) return `下发${object}指令`;
  return `${label} · ${method === "GET" ? "获取关联数据" : "提交业务请求"}`;
}
const actionLabel = (op: Partial<Operation>) =>
  ({
    goto: "打开页面",
    click: "点击",
    hover: "鼠标悬浮",
    fill: "输入",
    press: "按键",
    check: op.checked ? "勾选" : "取消勾选",
    select: "选择",
    scroll: "滚动",
    assert: "验证",
    upload: "上传文件",
    dialog: "处理对话框",
  })[op.kind!] +
  " · " +
  (op.label || op.url || "控件");
const tracked = (s: Session, promise: Promise<unknown>) => {
  s.tasks.add(promise);
  void promise
    .catch((e) => {
      // Closing the browser cancels pending header/body reads. This is expected
      // cleanup, not an executor failure, and must not obscure the real cause.
      if (
        s.closing &&
        /Target page, context or browser has been closed/.test(String(e))
      )
        return;
      s.run.notes.push(`采集任务异常：${redactText(String(e))}`);
      s.dirty = true;
    })
    .finally(() => s.tasks.delete(promise));
};
function pageId(s: Session, page: Page) {
  let id = s.pages.get(page);
  if (!id) {
    id = `page-${s.pages.size + 1}`;
    s.pages.set(page, id);
  }
  return id;
}
function latest(s: Session, id: string) {
  const op =
    s.run.mode === "replay"
      ? s.current
      : [...s.run.operations].reverse().find((o) => o.pageId === id);
  return op && Date.now() - Date.parse(op.timestamp) < 10000 ? op : undefined;
}
async function framePath(frame: Frame) {
  const paths: string[] = [];
  let f: Frame | null = frame;
  while (f?.parentFrame()) {
    const handle = await f.frameElement();
    const css = await handle.evaluate((node) => {
      const el = node as Element;
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts: string[] = [];
      let current: Element | null = el;
      while (current) {
        let part = current.tagName.toLowerCase();
        const parent: Element | null = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (s) => s.tagName === current!.tagName,
          );
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
        parts.unshift(part);
        current = parent;
      }
      return parts.join(" > ");
    });
    paths.unshift(css);
    f = f.parentFrame();
  }
  return paths;
}
async function screenshot(s: Session, page: Page, op: Operation) {
  if (page.isClosed()) return;
  try {
    const file = `${op.id}.png`;
    await page.screenshot({
      path: resolve(dataRoot, "artifacts", s.run.id, file),
      mask: page
        .frames()
        .map((frame) =>
          frame.locator('input[type="password"],[data-sensitive]'),
        ),
      timeout: 3000,
    });
    op.screenshot = `/artifacts/${s.run.id}/${file}`;
    s.dirty = true;
  } catch {
    /* screenshot may be unavailable during navigation */
  }
}
async function addOperation(
  s: Session,
  page: Page,
  frame: Frame,
  event: Partial<Operation> & { text?: string; level?: string },
) {
  if (s.closing || s.run.status !== "RECORDING") return;
  if ((event.kind as string) === "log") {
    captureLog(s.run, {
      id: randomUUID(),
      timestamp: now(),
      pageId: pageId(s, page),
      stepId: latest(s, pageId(s, page))?.id,
      level: event.level || "error",
      text: redactText(event.text || ""),
    });
    s.dirty = true;
    return;
  }
  if (event.scene) s.run.scene = redactText(event.scene);
  const op: Operation = {
    id: randomUUID(),
    sequence: s.run.operations.length + 1,
    pageId: pageId(s, page),
    framePath: [],
    navigationMode: event.navigationMode,
    timestamp: event.timestamp || now(),
    kind: event.kind || "click",
    label: actionLabel(event),
    module: redactText(event.module || s.run.scene),
    scene: s.run.scene,
    url: redactUrl(event.url || page.url()),
    locators: event.locators || [],
    value: redactBody(event.value),
    variable: event.variable,
    key: event.key,
    checked: event.checked,
    position: event.position,
    hoverPosition: event.hoverPosition,
    clickPosition: event.clickPosition,
    clickButton: event.clickButton,
    clickModifiers: event.clickModifiers,
    scroll: event.scroll,
    status: "RECORDED",
    dependsOn: [],
    timeout: 8000,
    effect:
      event.kind !== "hover" &&
      /新增|保存|删除|下发|提交|修改/.test(event.label || "")
        ? "write"
        : "read",
    enabled: true,
  };
  // Plain text input must retain its exact replay value, not JSON pretty-printing.
  if (event.value !== undefined) op.value = redactText(event.value);
  const opener = await page.opener();
  if (opener) op.openerPageId = pageId(s, opener);
  s.run.operations.push(op);
  s.current = op;
  s.dirty = true;
  if (op.kind === "upload")
    s.run.notes.push(
      "录制包含文件上传：仅保存文件名；请在回放前提供对应测试文件变量。",
    );
  tracked(
    s,
    (async () => {
      op.framePath = await framePath(frame);
      await screenshot(s, page, op);
    })(),
  );
}
function setupPage(s: Session, page: Page) {
  const id = pageId(s, page);
  const ensureCollector = () =>
    tracked(
      s,
      page
        .evaluate(
          `(() => { const __name = (fn) => fn; (${installCollector.toString()})(); })();`,
        )
        .catch(() => {}),
    );
  page.on("domcontentloaded", ensureCollector);
  ensureCollector();
  page.on("domcontentloaded", () =>
    tracked(
      s,
      (async () => {
        if (s.run.mode !== "record" || s.closing) return;
        const title = await page
          .locator("main h1,h1")
          .first()
          .textContent({ timeout: 1000 })
          .catch(() => page.title());
        const module = redactText(title || s.run.project);
        const op = [...s.run.operations]
          .reverse()
          .find((o) => o.kind === "goto" && o.pageId === id);
        if (op) {
          op.module = module;
          op.label = `打开页面 · ${module}`;
          for (const req of s.run.requests)
            if (
              req.pageId === id &&
              (req.stepId === op.id || req.category === "initialization")
            ) {
              req.module = module;
              req.description = describeRequest(
                op,
                req.method,
                "initialization",
                module,
              );
              req.category = "initialization";
            }
        }
        s.dirty = true;
      })(),
    ),
  );
  page.on("console", (message) => {
    if (s.closing || s.run.status === "PAUSED") return;
    captureLog(s.run, {
      id: randomUUID(),
      timestamp: now(),
      pageId: id,
      stepId: latest(s, id)?.id,
      level: message.type(),
      text: redactText(message.text()),
      location: `${redactUrl(message.location().url || page.url())}:${message.location().lineNumber}`,
    });
    s.dirty = true;
  });
  page.on("pageerror", (error) => {
    if (s.closing || s.run.status === "PAUSED") return;
    captureLog(s.run, {
      id: randomUUID(),
      timestamp: now(),
      pageId: id,
      stepId: latest(s, id)?.id,
      level: "pageerror",
      text: redactText(error.stack || error.message),
    });
    s.dirty = true;
  });
  page.on("dialog", (dialog) => {
    if (s.run.mode === "record") {
      const dialogId = randomUUID();
      s.dialogs.set(page, { dialog, id: dialogId, recorded: false });
      s.run.pendingDialog = {
        id: dialogId,
        pageId: id,
        type: dialog.type(),
        message: redactText(dialog.message()),
      };
      s.dirty = true;
    } else {
      tracked(
        s,
        (async () => {
          const policy = s.expectedDialog;
          if (policy) {
            if (policy.value === "accept")
              await dialog.accept(
                variableValue(s, policy.key, policy.variable),
              );
            else await dialog.dismiss();
            s.handledDialogs.add(policy.id);
          } else {
            await dialog.dismiss();
            s.run.notes.push(
              "回放中出现未录制的原生对话框，执行器已取消，请核查页面变化。",
            );
            s.dirty = true;
          }
        })(),
      );
    }
  });
  tracked(
    s,
    (async () => {
      const cdp = await s.context.newCDPSession(page);
      await cdp.send("Page.enable");
      const { frameTree } = await cdp.send("Page.getFrameTree");
      let rendererNavigation = false;
      cdp.on("Page.frameRequestedNavigation", (event) => {
        if (
          event.frameId === frameTree.frame.id &&
          event.disposition === "currentTab"
        )
          rendererNavigation = true;
      });
      cdp.on("Page.frameStartedNavigating", (event) => {
        if (event.frameId !== frameTree.frame.id) return;
        const automatic = rendererNavigation;
        rendererNavigation = false;
        if (
          automatic ||
          event.navigationType === "sameDocument" ||
          s.run.mode !== "record" ||
          s.run.status !== "RECORDING" ||
          !s.run.operations.some((op) => op.pageId === id)
        )
          return;
        // Address-bar navigation, reload and browser history remain explicit
        // actions. Renderer redirects and router transitions are only effects.
        s.eventChain = s.eventChain.then(() =>
          addOperation(s, page, page.mainFrame(), {
            kind: "goto",
            url: event.url,
            label: event.url,
            navigationMode: "navigate",
            module: s.run.scene,
          }),
        );
        tracked(s, s.eventChain);
      });
      await cdp.send("Log.enable");
      await cdp.send("Network.enable");
      const urls = new Map<string, string>();
      const counts = new Map<string, number>();
      cdp.on("Network.requestWillBeSent", (event) =>
        urls.set(event.requestId, redactUrl(event.request.url)),
      );
      cdp.on("Network.loadingFinished", (event) => {
        urls.delete(event.requestId);
        counts.delete(event.requestId);
      });
      cdp.on("Network.loadingFailed", (event) => {
        urls.delete(event.requestId);
        counts.delete(event.requestId);
      });
      cdp.on("Network.eventSourceMessageReceived", (event) => {
        if (s.closing || s.run.status === "PAUSED") return;
        const count = (counts.get(event.requestId) || 0) + 1;
        counts.set(event.requestId, count);
        if (count > 500) {
          if (count === 501)
            s.run.notes.push(
              `SSE 消息已达 500 条采样上限：${urls.get(event.requestId) || event.requestId}`,
            );
          return;
        }
        const url = urls.get(event.requestId) || event.requestId;
        captureLog(s.run, {
          id: randomUUID(),
          timestamp: now(),
          pageId: id,
          stepId: latest(s, id)?.id,
          level: "sse",
          text: `[SSE ${url}] ${event.eventName || "message"} ${(redactBody(event.data) || "").slice(0, 2000)}`,
        });
        s.dirty = true;
      });
      cdp.on("Page.javascriptDialogClosed", (event) =>
        recordDialogResult(s, page, event.result, event.userInput),
      );
      cdp.on("Log.entryAdded", ({ entry }) => {
        if (s.closing || s.run.status === "PAUSED") return;
        if (["warning", "error"].includes(entry.level)) {
          captureLog(s.run, {
            id: randomUUID(),
            timestamp: now(),
            pageId: id,
            stepId: latest(s, id)?.id,
            level: entry.level,
            text: redactText(`[浏览器 ${entry.source}] ${entry.text}`),
            location: entry.url ? redactUrl(entry.url) : undefined,
          });
          s.dirty = true;
        }
      });
    })(),
  );
  page.on("download", (download) => {
    captureLog(s.run, {
      id: randomUUID(),
      timestamp: now(),
      pageId: id,
      stepId: latest(s, id)?.id,
      level: "info",
      text: `触发下载：${redactText(download.suggestedFilename())}`,
    });
    s.dirty = true;
    tracked(
      s,
      download.saveAs(
        resolve(
          dataRoot,
          "artifacts",
          s.run.id,
          `${randomUUID()}-${download.suggestedFilename().replace(/[^\w.\u4e00-\u9fa5-]/g, "_")}`,
        ),
      ),
    );
  });
  const recordNavigation = (frame: Frame) => {
    if (
      frame !== page.mainFrame() ||
      s.run.mode !== "record" ||
      s.run.status !== "RECORDING" ||
      frame.url() === "about:blank"
    )
      return;
    // Capture the URL now: a queued callback may run after another redirect.
    const url = frame.url();
    s.eventChain = s.eventChain.then(async () => {
      const previous = s.run.operations.findLast((op) => op.pageId === id);
      const opener = await page.opener();
      // Redirects/router transitions are effects of the preceding action, not
      // another command to load the document. Retain only the first page entry.
      if (previous) return;
      await addOperation(s, page, frame, {
        kind: "goto",
        url,
        label: url,
        navigationMode: opener ? "observe" : "navigate",
        module: s.run.scene,
      });
    });
    tracked(s, s.eventChain);
  };
  page.on("framenavigated", recordNavigation);
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame() && s.run.mode === "replay")
      s.replayNetwork.navigated(pageId(s, page), s.current?.id);
  });
  // The first popup document may have committed before context's page event.
  recordNavigation(page.mainFrame());
  page.on("crash", () => {
    s.run.notes.push(`浏览器页面 ${id} 崩溃。`);
    s.dirty = true;
  });
}
function setupNetwork(s: Session) {
  const calls = new Map<Request, NetworkCall>();
  const finishBusiness = (req: Request, successful = false) =>
    s.replayNetwork.finish(req, successful);
  s.context.on("request", (req) => {
    if (s.closing || s.run.status === "PAUSED") return;
    if (s.run.captureStats) s.run.captureStats.requests++;
    const type = req.resourceType();
    if (type === "document" && req.isNavigationRequest()) {
      try {
        const frame = req.frame();
        if (!frame.parentFrame())
          s.replayNetwork.clearPage(pageId(s, frame.page()));
      } catch {
        // Service-worker requests have no owning frame.
      }
    }
    // Match the browser's Fetch/XHR scope before storing or reading any payload.
    if ((type !== "fetch" && type !== "xhr") || isStaticAssetUrl(req.url())) {
      if (s.run.captureStats) s.run.captureStats.filteredRequests++;
      s.dirty = true;
      return;
    }
    let page: Page | undefined;
    try {
      page = req.frame().page();
    } catch {
      /* Service worker has no frame */
    }
    const id = page ? pageId(s, page) : "worker";
    const op = latest(s, id);
    const background = /heartbeat|\/ping\b|metrics|analytics|telemetry/.test(
      req.url(),
    );
    const category = isStaticAssetUrl(req.url())
      ? "resource"
      : background
        ? "background"
        : op && op.kind !== "goto"
          ? "business"
          : "initialization";
    const module = op?.module || s.run.scene;
    const call: NetworkCall = {
      id: randomUUID(),
      pageId: id,
      stepId: op?.id,
      startedAt: now(),
      method: req.method(),
      url: redactUrl(req.url()),
      resourceType: type,
      requestHeaders: redactHeaders(req.headers()),
      requestBody: (req.headers()["content-type"] || "").includes(
        "multipart/form-data",
      )
        ? "[multipart 请求：不保存上传文件正文，请结合上传操作的文件名查看。]"
        : redactBody(req.postData() || undefined),
      description: describeRequest(op, req.method(), category, module),
      module,
      category,
      confidence: op && !background ? 0.65 : 0.3,
    };
    // Startup requests can belong to an intermediate document that redirects
    // away without finishing. Gate replay on action-triggered business calls;
    // navigation itself is covered by document load and locator readiness.
    if (category === "business") {
      s.replayNetwork.start(req, id, op!.id, req.method(), req.url());
    }
    s.run.requests.push(call);
    calls.set(req, call);
    tracked(
      s,
      req.allHeaders().then((headers) => {
        call.requestHeaders = redactHeaders(headers);
        s.dirty = true;
      }),
    );
    s.dirty = true;
  });
  s.context.on("response", (res) => {
    const call = calls.get(res.request());
    if (!call) return;
    call.status = res.status();
    call.responseHeaders = redactHeaders(res.headers());
    tracked(
      s,
      res.allHeaders().then((headers) => {
        call.responseHeaders = redactHeaders(headers);
        s.dirty = true;
      }),
    );
    if ((res.headers()["content-type"] || "").includes("text/event-stream")) {
      finishBusiness(res.request());
      call.bodyNote =
        "SSE 流响应，消息采样见日志（每连接最多 500 条，每条最多 2000 字符）。";
    }
    s.dirty = true;
  });
  s.context.on("requestfinished", (req) => {
    const call = calls.get(req);
    finishBusiness(req, !!call?.status && call.status >= 200 && call.status < 400);
    if (!call) return;
    tracked(
      s,
      (async () => {
        call.duration = Date.now() - Date.parse(call.startedAt);
        const res = await req.response();
        if (res) {
          const type = res.headers()["content-type"] || "";
          if (/json|text\//.test(type)) {
            const size = await req.sizes().catch(() => undefined);
            if (size && size.responseBodySize > 262144)
              call.bodyNote = "正文超过 256KB，仅保留元数据。";
            else {
              const body = await res.body().catch(() => undefined);
              if (body) {
                call.responseBody = redactBody(
                  body.toString("utf8").slice(0, 262144),
                );
                if (body.length > 262144)
                  call.bodyNote = "正文已截断至 256KB。";
              } else call.bodyNote = "响应正文不可读取。";
            }
          } else call.bodyNote = "非 JSON/文本响应，仅保留元数据。";
        }
        s.dirty = true;
        finishRequest(s.run, call);
        calls.delete(req);
      })(),
    );
  });
  s.context.on("requestfailed", (req) => {
    finishBusiness(req);
    const call = calls.get(req);
    if (!call) return;
    call.failure = redactText(req.failure()?.errorText || "请求失败");
    if (s.closing && call.failure.includes("ERR_ABORTED")) {
      call.failure = undefined;
      call.bodyNote = "结束采集时主动中断未结束连接，不作为请求失败。";
    }
    call.duration = Date.now() - Date.parse(call.startedAt);
    finishRequest(s.run, call);
    calls.delete(req);
    s.dirty = true;
  });
}
export async function startSession(input: {
  name: string;
  project: string;
  environment: string;
  url: string;
  headless?: boolean;
  flow?: Flow;
  variables?: Record<string, string>;
}) {
  if (sessions.size || launching)
    throw new Error("本机已有活动体检，请先停止当前任务。");
  launching = true;
  let browserRef: Browser | undefined;
  let createdId: string | undefined;
  try {
    const browser = await chromium.launch({
      headless: input.headless ?? false,
      args: input.headless ? [] : ["--start-maximized"],
    });
    browserRef = browser;
    const replayViewport =
      input.flow?.viewport ||
      (input.headless ? { width: 1920, height: 1080 } : null);
    const context = await browser.newContext({
      viewport: replayViewport,
      acceptDownloads: true,
    });
    const run: Run = {
      id: randomUUID(),
      name: input.name,
      project: input.project,
      environment: input.environment,
      url: redactUrl(input.url),
      mode: input.flow ? "replay" : "record",
      status: input.flow ? "REPLAYING" : "RECORDING",
      startedAt: now(),
      flowId: input.flow?.id,
      flowVersion: input.flow?.version,
      viewport: replayViewport || undefined,
      scene: "默认场景",
      archived: false,
      operations: [],
      requests: [],
      logs: [],
      notes: [
        "接口请求仅录制 Fetch/XHR；页面文档、静态资源、WebSocket 和 EventSource 请求不纳入接口列表。",
        "采集范围为本次独立 Chromium 上下文；Service Worker 保持原行为，流式消息按限额采样，并非服务器全链路采集。",
        "人工截图为动作后的可用画面，不是严格同步的动作前截图。",
        "接口归属为页面与时间上下文规则推断，置信度偏低的关联需人工核对。",
      ],
      findings: [],
      cases: [],
      captureStats: {
        requests: 0,
        logs: 0,
        filteredRequests: 0,
        filteredLogs: 0,
        mergedRequests: 0,
        mergedLogs: 0,
      },
      analysis: { status: "NONE", findings: [] },
    };
    mkdirSync(resolve(dataRoot, "artifacts", run.id), { recursive: true });
    const s: Session = {
      run,
      browser,
      context,
      pages: new Map(),
      closing: false,
      tasks: new Set(),
      dirty: false,
      flushTimer: setInterval(() => {}, 1000),
      eventChain: Promise.resolve(),
      variables: input.variables || {},
      started: Date.now(),
      canceled: false,
      dialogs: new Map(),
      handledDialogs: new Set(),
      deliveredClicks: new Set(),
      replayNetwork: new ReplayNetwork(),
    };
    clearInterval(s.flushTimer);
    s.flushTimer = setInterval(() => {
      if (s.dirty) {
        finalizeReport(run);
        put("run", run);
        s.dirty = false;
      }
    }, 750);
    sessions.set(run.id, s);
    createdId = run.id;
    put("run", run);
    context.on("page", (page) => setupPage(s, page));
    setupNetwork(s);
    browser.on("disconnected", () => {
      if (!s.closing) {
        s.run.notes.push("浏览器已关闭，录制/执行中断。");
        s.canceled = true;
        void finishSession(s, "INTERRUPTED", "浏览器意外关闭，复检中断。");
      }
    });
    await context.exposeBinding("__healthEmit", (source, event) => {
      if (run.mode === "replay") {
        if (
          event.kind === "click" &&
          s.current?.kind === "click" &&
          source.page ===
            [...s.pages.entries()].find(
              ([, id]) => id === s.current!.pageId,
            )?.[0]
        )
          s.deliveredClicks.add(s.current.id);
        return;
      }
      s.eventChain = s.eventChain.then(() =>
        addOperation(s, source.page, source.frame, event),
      );
      tracked(s, s.eventChain);
    });
    await context.addInitScript({
      content: `(() => { const __name = (fn) => fn; (${installCollector.toString()})(); })();`,
    });
    if (input.flow) {
      void replay(s, input.flow).catch(async (error) => {
        run.notes.push(`执行器异常：${redactText(String(error))}`);
        await finishSession(
          s,
          "INTERRUPTED",
          `执行器异常：${redactText(String(error))}`,
        );
      });
    } else {
      const page = await context.newPage();
      run.viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
      void page
        .goto(input.url, { waitUntil: "domcontentloaded", timeout: 30000 })
        .catch((e) => {
          run.notes.push(`起始地址未加载：${redactText(String(e))}`);
          s.dirty = true;
        });
    }
    return run;
  } catch (error) {
    const s = createdId ? sessions.get(createdId) : undefined;
    if (s) await finishSession(s, "INTERRUPTED");
    else await browserRef?.close().catch(() => {});
    throw error;
  } finally {
    launching = false;
  }
}
async function finishSession(
  s: Session,
  status: Run["status"],
  reason?: string,
) {
  if (s.closing) return;
  s.closing = true;
  s.canceled = true;
  if (status === "INTERRUPTED" && s.run.mode === "replay") {
    const running = [...s.run.operations]
      .reverse()
      .find((op) => op.status === "RUNNING");
    const location =
      running ||
      [...s.run.operations]
        .reverse()
        .find((op) => op.status !== "BLOCKED" && op.status !== "SKIPPED");
    const message = reason || "复检中断。";
    s.run.interruption = {
      reason: message,
      at: now(),
      stepId: location?.id,
      sequence: location?.sequence,
      label: location?.label,
    };
    if (running) {
      running.status = "FAILED";
      running.error = message;
      running.duration = Date.now() - Date.parse(running.timestamp);
    }
  }
  clearInterval(s.flushTimer);
  await Promise.allSettled(
    [...s.dialogs.values()].map((d) => d.dialog.dismiss()),
  );
  s.run.pendingDialog = undefined;
  await Promise.race([
    Promise.allSettled([...s.tasks]),
    new Promise((r) => setTimeout(r, 3500)),
  ]);
  for (const req of s.run.requests)
    if (!req.status && !req.failure) req.bodyNote = "停止时请求未结束。";
  await s.browser.close().catch(() => {});
  s.run.status = status;
  s.run.endedAt = now();
  finalizeReport(s.run);
  if (status === "COMPLETED" && s.run.findings.length)
    s.run.status = "COMPLETED_WITH_ISSUES";
  put("run", s.run);
  sessions.delete(s.run.id);
  s.variables = {};
}
export async function stopSession(id: string, reason?: string) {
  const s = sessions.get(id);
  if (!s) throw new Error("该体检不是活动任务。");
  if (s.run.mode === "record") {
    if (s.run.pendingDialog) {
      s.run.notes.push("结束录制时取消了尚未处理的浏览器对话框。");
      await Promise.allSettled(
        [...s.dialogs.values()]
          .filter((d) => !d.recorded)
          .map((d) => d.dialog.dismiss()),
      );
    }
    const flushing = Promise.allSettled(
      s.context.pages().flatMap((p) =>
        p.frames().map((f) =>
          f
            .evaluate(() => {
              (
                window as unknown as { __healthFlush?: () => void }
              ).__healthFlush?.();
            })
            .catch(() => {}),
        ),
      ),
    );
    await Promise.race([
      flushing,
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    await Promise.race([
      s.eventChain,
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  }
  await finishSession(
    s,
    s.run.mode === "replay"
      ? "INTERRUPTED"
      : s.run.findings.length
        ? "COMPLETED_WITH_ISSUES"
        : "COMPLETED",
    s.run.mode === "replay" ? reason || "用户手动中止复检。" : undefined,
  );
  return s.run;
}
export function pauseSession(id: string) {
  const s = sessions.get(id);
  if (!s || s.run.mode !== "record") throw new Error("仅人工录制可暂停。");
  s.run.status = s.run.status === "PAUSED" ? "RECORDING" : "PAUSED";
  s.run.notes.push(
    `${now()} ${s.run.status === "PAUSED" ? "暂停全部采集（动作、网络和日志）" : "恢复采集"}`,
  );
  put("run", s.run);
  return s.run;
}
export function setScene(id: string, scene: string) {
  const s = sessions.get(id);
  if (!s) throw new Error("没有活动体检。");
  s.run.scene = scene;
  s.dirty = true;
  return s.run;
}
function recordDialogResult(
  s: Session,
  page: Page,
  accepted: boolean,
  input: string,
) {
  const state = s.dialogs.get(page);
  if (!state || state.recorded) return;
  state.recorded = true;
  s.run.pendingDialog = undefined;
  if (s.closing || s.run.status !== "RECORDING") return;
  const op: Operation = {
    id: randomUUID(),
    sequence: s.run.operations.length + 1,
    pageId: pageId(s, page),
    framePath: [],
    timestamp: now(),
    kind: "dialog",
    label: `${accepted ? "确认" : "取消"}浏览器 ${state.dialog.type()} 对话框`,
    module: s.run.scene,
    scene: s.run.scene,
    url: redactUrl(page.url()),
    locators: [],
    value: accepted ? "accept" : "dismiss",
    key: /password|密码|token|secret/i.test(state.dialog.message())
      ? undefined
      : redactText(input || ""),
    variable:
      /password|密码|token|secret/i.test(state.dialog.message()) &&
      state.dialog.type() === "prompt"
        ? "DIALOG_INPUT"
        : undefined,
    status: "RECORDED",
    dependsOn: [],
    timeout: 8000,
    effect: "read",
    enabled: true,
  };
  s.run.operations.push(op);
  s.dirty = true;
  tracked(s, screenshot(s, page, op));
}
export async function answerDialog(
  id: string,
  accepted: boolean,
  input: string,
) {
  const s = sessions.get(id);
  if (!s || !s.run.pendingDialog) throw new Error("没有待处理的浏览器对话框。");
  const entry = [...s.dialogs.entries()].find(
    ([, state]) => state.id === s.run.pendingDialog?.id,
  );
  if (!entry) throw new Error("对话框已关闭。");
  const [page, state] = entry;
  if (accepted) await state.dialog.accept(input);
  else await state.dialog.dismiss();
  recordDialogResult(s, page, accepted, input);
  return s.run;
}
async function resolveLocator(
  page: Page,
  op: Operation,
  restoreHover?: () => Promise<void>,
): Promise<Locator> {
  let scope: Page | ReturnType<Page["frameLocator"]> = page;
  for (const css of op.framePath) scope = scope.frameLocator(css);
  const structuralImage =
    op.kind === "click" && op.position
      ? op.locators.find(
          (hint) => hint.kind === "css" && /\s*>\s*img\s*$/.test(hint.value),
        )
      : undefined;
  const imageRoot = structuralImage?.value.match(/^(#[\w-]+)\s*>/)?.[1];
  const deadline =
    Date.now() + (imageRoot ? Math.max(op.timeout, 20_000) : op.timeout);
  const recoveryAt = Date.now() + Math.min(1000, op.timeout / 3);
  let recovered = false;
  let ambiguousImage = false;
  const matches = new Map<string, number>();
  do {
    for (const hint of op.locators) {
      let loc: Locator;
      switch (hint.kind) {
        case "testId":
          loc = scope.getByTestId(hint.value);
          break;
        case "role":
          loc = scope.getByRole(
            hint.value as Parameters<Page["getByRole"]>[0],
            {
              name: hint.name,
              exact: true,
            },
          );
          // CSS icon-font pseudo content can be part of the accessible name
          // although it was absent from the recorded DOM text. Keep the role
          // and exact visible text instead of falling back to a random CSS ID.
          if (
            hint.name &&
            (await loc
              .filter({ visible: true })
              .count()
              .catch(() => 0)) === 0
          ) {
            const textPattern = hint.name
              .trim()
              .split(/\s+/)
              .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
              .join("\\s+");
            loc = scope
              .getByRole(hint.value as Parameters<Page["getByRole"]>[0])
              .filter({ hasText: new RegExp(`^\\s*${textPattern}\\s*$`) });
          }
          break;
        case "label":
          loc = scope.getByLabel(hint.value, { exact: true });
          break;
        case "placeholder":
          loc = scope.getByPlaceholder(hint.value, { exact: true });
          break;
        case "text":
          loc = scope.getByText(hint.value, { exact: true });
          break;
        case "xpath":
          loc = scope.locator(
            hint.value.startsWith("xpath=")
              ? hint.value
              : `xpath=${hint.value}`,
          );
          break;
        default:
          loc = scope.locator(hint.value);
      }
      if (
        op.kind === "check" &&
        (await loc.count().catch(() => 0)) === 1 &&
        (await loc.isChecked().catch(() => undefined)) === !!op.checked
      )
        return loc; // A preceding label click may have checked a now-hidden radio.
      loc = loc.filter({ visible: true });
      const count = await loc.count().catch(() => -1);
      matches.set(`${hint.kind}: ${hint.value}`, count);
      if (
        count === 1 &&
        (op.kind === "hover" || op.kind === "scroll" ||
          (await loc.isEnabled().catch(() => false)))
      ) return loc;
    }
    if (imageRoot && op.position) {
      const images = scope.locator(`${imageRoot} img`);
      const candidates = await images
        .evaluateAll(
          (nodes, recorded) =>
            nodes.flatMap((node, index) => {
              const rect = node.getBoundingClientRect();
              const style = getComputedStyle(node);
              if (
                !rect.width ||
                !rect.height ||
                style.visibility === "hidden" ||
                style.display === "none"
              )
                return [];
              const sameSize =
                Math.abs(rect.width - recorded.width) <=
                  Math.max(8, recorded.width * 0.25) &&
                Math.abs(rect.height - recorded.height) <=
                  Math.max(8, recorded.height * 0.25);
              const nearby =
                Math.abs(rect.x - recorded.x) <=
                  Math.max(100, recorded.width * 2) &&
                Math.abs(rect.y - recorded.y) <=
                  Math.max(120, recorded.height * 4);
              return sameSize && nearby ? [index] : [];
            }),
          op.position,
        )
        .catch(() => []);
      ambiguousImage ||= candidates.length > 1;
      if (candidates.length === 1) {
        const recovered = images.nth(candidates[0]).filter({ visible: true });
        if ((await recovered.count().catch(() => 0)) === 1) return recovered;
      }
    }
    if (page.isClosed()) throw new Error("目标页签已关闭。");
    if (restoreHover && !recovered && Date.now() >= recoveryAt) {
      recovered = true;
      await restoreHover();
    }
    await page.waitForTimeout(100);
  } while (Date.now() < deadline && op.locators.length);
  throw new Error(
    ambiguousImage
      ? "原图片定位器失效，附近存在多个尺寸相近的图片；请编辑定位器，避免误点。"
      : `没有唯一可操作的控件；可使用 XPath、文本或属性定位器。候选匹配：${[...matches].map(([hint, count]) => `${hint}（${count < 0 ? "定位表达式无效或页面未就绪" : `${count} 个可见匹配`}）`).join("；") || "未配置定位器"}`,
  );
}
function variableValue(
  s: Session,
  value: string | undefined,
  variable?: string,
) {
  if (variable) {
    if (s.variables[variable] === undefined)
      throw new Error(`缺少运行变量 ${variable}`);
    return s.variables[variable];
  }
  return (value || "").replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (s.variables[key] === undefined) throw new Error(`缺少运行变量 ${key}`);
    return s.variables[key];
  });
}
async function pointerPosition(
  loc: Locator,
  position: Operation["clickPosition"],
  timeout: number,
) {
  if (!position) return undefined;
  const { width, height } = await loc.evaluate(
    (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // Playwright adds the top/left border to supplied coordinates. Keep them
      // inside the current padding box, including when layout shrank since recording.
      const width =
        rect.width -
        (parseFloat(style.borderLeftWidth) || 0) -
        (parseFloat(style.borderRightWidth) || 0);
      const height =
        rect.height -
        (parseFloat(style.borderTopWidth) || 0) -
        (parseFloat(style.borderBottomWidth) || 0);
      return { width, height };
    },
    undefined,
    { timeout },
  );
  const inside = (value: number, size: number) => {
    if (size <= 0) throw new Error("目标控件没有可用的点击区域。");
    // A two-pixel inset avoids fractional-layout rounding at the boundary.
    // Preserve interior offsets: an icon inside a button may have its own handler.
    const inset = Math.min(2, size / 2);
    return Math.min(Math.max(value, inset), size - inset);
  };
  return { x: inside(position.x, width), y: inside(position.y, height) };
}
async function hoverPosition(
  loc: Locator,
  recorded: Operation["hoverPosition"],
  timeout: number,
) {
  const original = await pointerPosition(loc, recorded, timeout);
  return loc.evaluate(
    (el, position) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const left = parseFloat(style.borderLeftWidth) || 0;
      const top = parseFloat(style.borderTopWidth) || 0;
      const width =
        rect.width - left - (parseFloat(style.borderRightWidth) || 0);
      const height =
        rect.height - top - (parseFloat(style.borderBottomWidth) || 0);
      const candidates = [
        position,
        { x: width / 2, y: height / 2 },
        { x: width / 4, y: height / 2 },
        { x: (width * 3) / 4, y: height / 2 },
        { x: width / 2, y: height / 4 },
        { x: width / 2, y: (height * 3) / 4 },
      ];
      for (const candidate of candidates) {
        if (!candidate) continue;
        const hit = document.elementFromPoint(
          rect.left + left + candidate.x,
          rect.top + top + candidate.y,
        );
        if (hit && el.contains(hit)) return candidate;
      }
      return position;
    },
    original,
    { timeout },
  );
}
async function waitForBusinessIdle(s: Session, page: Page, op: Operation) {
  // Network idle is unsuitable here: telemetry and event streams can stay open.
  // Wait for this page's action-triggered Fetch/XHR calls and a quiet render window.
  const quietMs = 1000;
  const timeoutMs = Math.max(30_000, op.timeout);
  const deadline = Date.now() + timeoutMs;
  let lastActivity = Date.now();
  let loadingMask = false;
  while (!s.canceled) {
    if (page.isClosed()) throw new Error("等待页面就绪时目标页签已关闭。");
    const network = s.replayNetwork.state(op.pageId);
    const pending = network.pending;
    lastActivity = Math.max(
      lastActivity,
      network.lastActivity,
    );
    const state = await page
      .evaluate(() => ({
        loaded: document.readyState === "complete",
        loadingMask: [
          ...document.querySelectorAll(
            ".el-loading-mask.is-fullscreen, .el-loading-mask.init-app",
          ),
        ].some((node) => node.getClientRects().length > 0),
      }))
      .catch(() => ({ loaded: false, loadingMask: false }));
    loadingMask = state.loadingMask;
    if (
      state.loaded &&
      !loadingMask &&
      pending === 0 &&
      Date.now() - lastActivity >= quietMs
    )
      return;
    if (Date.now() >= deadline)
      throw new Error(
        `等待页面与接口响应超时（${timeoutMs / 1000} 秒）；${loadingMask ? "页面加载遮罩仍未消失；" : ""}仍有 ${pending} 个业务请求未结束。${network.urls.length ? `未结束请求：${network.urls.slice(0, 3).map(redactUrl).join("；")}` : ""}`,
      );
    await page.waitForTimeout(100);
  }
  throw new Error("复检已中止，等待页面与接口响应终止。");
}
async function replay(s: Session, flow: Flow) {
  const mapping = new Map<string, Page>();
  const results = new Map<string, Operation>();
  const blockedScenes = new Map<string, Operation>();
  const lastHover = new Map<Page, Operation>();
  for (const [index, definition] of flow.operations.entries()) {
    if (s.canceled) break;
    const op: Operation = {
      ...structuredClone(definition),
      timestamp: now(),
      status: "RUNNING",
      error: undefined,
      screenshot: undefined,
      sequence: s.run.operations.length + 1,
    };
    s.run.operations.push(op);
    s.current = op;
    s.run.scene = op.scene;
    if (!op.enabled) {
      op.status = "SKIPPED";
      results.set(op.id, op);
      s.dirty = true;
      continue;
    }
    const explicitDependency = op.dependsOn.some(
      (id) =>
        !results.has(id) ||
        ["FAILED", "BLOCKED", "SKIPPED"].includes(results.get(id)!.status),
    );
    if (explicitDependency || blockedScenes.has(op.scene)) {
      op.status = "BLOCKED";
      op.error = explicitDependency
        ? "前置步骤未成功，跳过依赖步骤。"
        : `本场景第 ${blockedScenes.get(op.scene)!.sequence} 步“${blockedScenes.get(op.scene)!.label}”失败，跳过剩余步骤；继续下一场景。`;
      results.set(op.id, op);
      s.dirty = true;
      continue;
    }
    let page = mapping.get(op.pageId);
    if (!page) {
      // A popup can be created asynchronously after its opener's click returns.
      // Never substitute an unrelated tab or create an empty one for it.
      if (op.openerPageId) {
        const deadline = Date.now() + op.timeout;
        do {
          for (const candidate of s.context.pages()) {
            if (
              !candidate.isClosed() &&
              ![...mapping.values()].includes(candidate) &&
              (await candidate.opener()) === mapping.get(op.openerPageId)
            ) {
              page = candidate;
              break;
            }
          }
          if (page || s.canceled) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        } while (Date.now() < deadline);
        if (!page) {
          op.status = "FAILED";
          op.error = "未出现预期的新标签页，请检查打开标签页的前置步骤。";
          results.set(op.id, op);
          blockedScenes.set(op.scene, op);
          s.dirty = true;
          continue;
        }
      }
      page =
        page ||
        s.context
          .pages()
          .find(
            (p) => !Array.from(mapping.values()).includes(p) && !p.isClosed(),
          ) ||
        (await s.context.newPage());
      mapping.set(op.pageId, page);
      s.pages.set(page, op.pageId);
    }
    const started = Date.now();
    page.setDefaultTimeout(op.timeout);
    s.expectedDialog =
      flow.operations[index + 1]?.kind === "dialog"
        ? flow.operations[index + 1]
        : undefined;
    try {
      if (page.isClosed()) throw new Error("目标页签已关闭。");
      if (op.kind === "goto") {
        const destination = variableValue(s, op.value || op.url);
        // Old recordings also contain navigation effects. Reuse an already
        // loaded matching document instead of re-submitting its initialization.
        if (
          op.navigationMode === "observe" ||
          (op.navigationMode !== "navigate" &&
            redactUrl(page.url()) === redactUrl(destination))
        ) {
          await page.waitForLoadState("domcontentloaded", {
            timeout: op.timeout,
          });
        } else {
          // A popup can start requests under the preceding click. Navigating it
          // replaces that document, so its orphaned requests must not block this goto.
          s.replayNetwork.clearPage(op.pageId);
          await page.goto(destination, {
            waitUntil: "domcontentloaded",
            timeout: op.timeout,
          });
        }
      } else if (op.kind === "dialog") {
        if (!s.handledDialogs.has(op.id))
          throw new Error("没有出现录制时的浏览器对话框。");
      } else if (op.kind === "assert") {
        await page
          .getByText(variableValue(s, op.assertion || op.value), {
            exact: false,
          })
          .filter({ visible: true })
          .first()
          .waitFor({ state: "visible", timeout: op.timeout });
        op.status = "PASSED";
      } else {
        if (page.url() === "about:blank" && !op.openerPageId)
          await page.goto(op.url, {
            waitUntil: "domcontentloaded",
            timeout: op.timeout,
          });
        // Login can redirect after the previous click's quiet window. Wait for
        // the recorded document before resolving a similarly named old control.
        if (!op.framePath.length && /^https?:/.test(op.url)) {
          const expected = new URL(op.url);
          await page.waitForURL(
            (actual) =>
              actual.origin === expected.origin &&
              actual.pathname === expected.pathname,
            { waitUntil: "domcontentloaded", timeout: op.timeout },
          );
        }
        const previousHover = lastHover.get(page);
        const restoreHover =
          previousHover &&
          previousHover.scene === op.scene &&
          JSON.stringify(previousHover.framePath) ===
            JSON.stringify(op.framePath)
            ? async () => {
                const trigger = await resolveLocator(page!, {
                  ...previousHover,
                  timeout: Math.min(1000, op.timeout),
                });
                // Some menus close on a delayed mouseleave callback from their
                // sibling. Re-enter once if the next recorded target is missing.
                // This retries only hover, never a business click/submission.
                await page!.mouse.move(0, 0);
                await trigger.hover({
                  timeout: Math.min(1500, op.timeout),
                  position: await hoverPosition(
                    trigger,
                    previousHover.hoverPosition,
                    op.timeout,
                  ),
                });
              }
            : undefined;
        const loc = await resolveLocator(page, op, restoreHover);
        switch (op.kind) {
          case "hover":
            await loc.hover({
              timeout: op.timeout,
              position: await hoverPosition(loc, op.hoverPosition, op.timeout),
            });
            lastHover.set(page, op);
            break;
          case "click":
            s.deliveredClicks.delete(op.id);
            await loc.click({
              timeout: op.timeout,
              position: await pointerPosition(
                loc,
                op.clickPosition,
                op.timeout,
              ),
              button: op.clickButton,
              modifiers: op.clickModifiers,
            });
            for (
              let attempt = 0;
              attempt < 10 && !s.deliveredClicks.has(op.id);
              attempt++
            )
              await new Promise((resolve) => setTimeout(resolve, 50));
            if (!s.deliveredClicks.has(op.id))
              throw new Error(
                "点击未获得浏览器真实事件确认，已停止当前场景以避免后续操作偏离。",
              );
            break;
          case "fill":
            await loc.fill(variableValue(s, op.value, op.variable));
            break;
          case "press":
            await loc.press(op.key || "Enter");
            break;
          case "check":
            await loc.setChecked(!!op.checked);
            break;
          case "select":
            await loc.selectOption(variableValue(s, op.value));
            break;
          case "scroll":
            await loc.evaluate(
              (el, p) => el.scrollTo(p.x, p.y),
              op.scroll || { x: 0, y: 0 },
            );
            break;
          case "upload":
            if (!op.variable)
              throw new Error("上传步骤缺少测试文件变量，请编辑流程。");
            await loc.setInputFiles(variableValue(s, undefined, op.variable));
            break;
        }
      }
      if (
        [
          "goto",
          "click",
          "press",
          "fill",
          "check",
          "select",
          "upload",
        ].includes(op.kind)
      )
        await waitForBusinessIdle(s, page, op);
      if (op.assertion && op.kind !== "assert") {
        await page
          .getByText(variableValue(s, op.assertion))
          .filter({ visible: true })
          .first()
          .waitFor({ state: "visible", timeout: op.timeout });
        op.status = "PASSED";
      }
      if (
        ![
          "goto",
          "click",
          "press",
          "fill",
          "check",
          "select",
          "upload",
        ].includes(op.kind)
      )
        await page.waitForTimeout(350);
      if (op.status === "RUNNING") op.status = "EXECUTED";
      if (op.kind !== "hover") lastHover.delete(page);
    } catch (e) {
      if (!s.closing) {
        op.status = "FAILED";
        op.error = redactText(e instanceof Error ? e.message : String(e));
        if (op.effect === "write" || op.kind === "goto" || op.kind === "click")
          blockedScenes.set(op.scene, op);
      }
    }
    if (s.closing) break;
    op.duration = Date.now() - started;
    results.set(op.id, op);
    await screenshot(s, page, op);
    s.dirty = true;
    finalizeReport(s.run);
    put("run", s.run);
  }
  if (!s.closing) {
    const failed = s.run.operations.filter((op) => op.status === "FAILED");
    const blocked = s.run.operations.filter((op) => op.status === "BLOCKED");
    if (failed.length || blocked.length)
      s.run.notes.push(
        `复检步骤执行结束：${failed.length} 步失败，${blocked.length} 步因前置失败而阻塞。首个失败：第 ${failed[0]?.sequence ?? blocked[0]?.sequence} 步“${failed[0]?.label ?? blocked[0]?.label}”；请查看该步骤错误和截图。`,
      );
    finalizeReport(s.run);
    await finishSession(
      s,
      s.canceled
        ? "INTERRUPTED"
        : s.run.findings.length ||
            s.run.operations.some((o) =>
              ["FAILED", "BLOCKED"].includes(o.status),
            )
          ? "COMPLETED_WITH_ISSUES"
          : "COMPLETED",
    );
  }
}
