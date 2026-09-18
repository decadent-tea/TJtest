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
  page.on("framenavigated", (frame) => {
    if (
      frame !== page.mainFrame() ||
      s.run.mode !== "record" ||
      s.run.status !== "RECORDING" ||
      frame.url() === "about:blank"
    )
      return;
    const last = s.run.operations.at(-1);
    if (
      last?.kind === "click" &&
      last.pageId === id &&
      Date.now() - Date.parse(last.timestamp) < 1500
    )
      return;
    s.eventChain = s.eventChain.then(() =>
      addOperation(s, page, frame, {
        kind: "goto",
        url: frame.url(),
        label: frame.url(),
        module: s.run.scene,
      }),
    );
    tracked(s, s.eventChain);
  });
  page.on("crash", () => {
    s.run.notes.push(`浏览器页面 ${id} 崩溃。`);
    s.dirty = true;
  });
}
function setupNetwork(s: Session) {
  const calls = new Map<Request, NetworkCall>();
  s.context.on("request", (req) => {
    if (s.closing || s.run.status === "PAUSED") return;
    if (s.run.captureStats) s.run.captureStats.requests++;
    const type = req.resourceType();
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
    if ((res.headers()["content-type"] || "").includes("text/event-stream"))
      call.bodyNote =
        "SSE 流响应，消息采样见日志（每连接最多 500 条，每条最多 2000 字符）。";
    s.dirty = true;
  });
  s.context.on("requestfinished", (req) => {
    const call = calls.get(req);
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
    const context = await browser.newContext({
      viewport: null,
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
        void finishSession(s, "INTERRUPTED");
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
        await finishSession(s, "INTERRUPTED");
      });
    } else {
      const page = await context.newPage();
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
async function finishSession(s: Session, status: Run["status"]) {
  if (s.closing) return;
  s.closing = true;
  s.canceled = true;
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
export async function stopSession(id: string) {
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
async function resolveLocator(page: Page, op: Operation): Promise<Locator> {
  let scope: Page | ReturnType<Page["frameLocator"]> = page;
  for (const css of op.framePath) scope = scope.frameLocator(css);
  const deadline = Date.now() + op.timeout;
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
          break;
        case "label":
          loc = scope.getByLabel(hint.value, { exact: true });
          break;
        default:
          loc = scope.locator(hint.value);
      }
      loc = loc.filter({ visible: true });
      if (
        (await loc.count().catch(() => 0)) === 1 &&
        (await loc.isEnabled().catch(() => false))
      )
        return loc;
    }
    if (page.isClosed()) throw new Error("目标页签已关闭。");
    await page.waitForTimeout(100);
  } while (Date.now() < deadline && op.locators.length);
  throw new Error("没有唯一匹配的控件；请编辑定位器或检查页面状态。");
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
async function replay(s: Session, flow: Flow) {
  const mapping = new Map<string, Page>();
  const results = new Map<string, Operation>();
  const blockedScenes = new Set<string>();
  for (const [index, definition] of flow.operations.entries()) {
    if (s.canceled) break;
    const op: Operation = {
      ...structuredClone(definition),
      timestamp: now(),
      status: "EXECUTED",
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
        : "本场景关键步骤失败，跳过剩余步骤；继续下一场景。";
      results.set(op.id, op);
      s.dirty = true;
      continue;
    }
    let page = mapping.get(op.pageId);
    if (!page) {
      page =
        s.context
          .pages()
          .find(
            (p) => !Array.from(mapping.values()).includes(p) && !p.isClosed(),
          ) || (await s.context.newPage());
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
        await page.goto(variableValue(s, op.value || op.url), {
          waitUntil: "domcontentloaded",
          timeout: op.timeout,
        });
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
        if (page.url() === "about:blank")
          await page.goto(op.url, {
            waitUntil: "domcontentloaded",
            timeout: op.timeout,
          });
        const loc = await resolveLocator(page, op);
        switch (op.kind) {
          case "hover":
            await loc.hover({
              timeout: op.timeout,
              position: op.hoverPosition,
            });
            break;
          case "click":
            s.deliveredClicks.delete(op.id);
            await loc.click({
              timeout: op.timeout,
              position: op.clickPosition,
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
      if (op.assertion && op.kind !== "assert") {
        await page
          .getByText(variableValue(s, op.assertion))
          .filter({ visible: true })
          .first()
          .waitFor({ state: "visible", timeout: op.timeout });
        op.status = "PASSED";
      }
      // Small bounded settle period for callbacks; does not serve as a success assertion.
      await page.waitForTimeout(350);
    } catch (e) {
      op.status = "FAILED";
      op.error = redactText(e instanceof Error ? e.message : String(e));
      if (op.effect === "write" || op.kind === "goto" || op.kind === "click")
        blockedScenes.add(op.scene);
    }
    op.duration = Date.now() - started;
    results.set(op.id, op);
    await screenshot(s, page, op);
    s.dirty = true;
    finalizeReport(s.run);
    put("run", s.run);
  }
  if (!s.closing) {
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
