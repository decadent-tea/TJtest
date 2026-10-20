// This function is serialized into every document/frame. Keep it self-contained.
export function installFeedbackCollector() {
  const win = window as unknown as {
    __healthFeedback?: (event: unknown) => Promise<void>;
    __healthFeedbackDocument?: Document;
    __healthFeedbackFlush?: () => Promise<void>;
    __healthFeedbackDispose?: () => void;
  };
  if (win.__healthFeedbackDocument === document) return;
  win.__healthFeedbackDocument = document;
  const selectors = {
    message:
      '[role="alert"],[role="status"],.el-message,.el-notification,.ant-message-notice,.ant-notification-notice',
    dialog:
      '[role="dialog"],[role="alertdialog"],.el-dialog,.el-message-box,.ant-modal-content',
    loading:
      '[aria-busy="true"],.el-loading-mask,.ant-spin-spinning,.ant-btn-loading,[data-inspection-loading]',
    empty: ".el-empty,.ant-empty,[data-inspection-empty]",
  };
  const selector = Object.values(selectors).join(",");
  type Kind = keyof typeof selectors;
  type State = {
    kind: Kind;
    visible: boolean;
    text: string;
    level: string;
    target: string;
    truncated: boolean;
  };
  const tracked = new Map<Element, State>();
  const pending = new Set<Element>();
  const emissions = new Set<Promise<unknown>>();
  const prefix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let sequence = 0;
  let enabled = true;
  let limited = false;
  let scanLimited = false;
  let textLimited = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const emit = (data: Record<string, unknown>) => {
    if (!enabled || !win.__healthFeedback) return;
    if (sequence >= 5000) {
      if (!limited) {
        limited = true;
        void win
          .__healthFeedback({
            kind: "limit",
            reason: "单文档页面反馈达到5000次观察上限。",
          })
          .catch(() => {});
      }
      return;
    }
    const task = win
      .__healthFeedback({
        ...data,
        eventId: `${prefix}-${++sequence}`,
        timestamp: new Date().toISOString(),
      })
      .catch(() => {});
    emissions.add(task);
    void task.finally(() => emissions.delete(task));
  };
  const safeText = (root: Element, limit = 500, excludeForms = false) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let value = "";
    let inspected = 0;
    while (walker.nextNode() && inspected++ < 150 && value.length <= limit) {
      const parent = walker.currentNode.parentElement;
      if (
        !parent ||
        parent.closest(
          'input,textarea,select,script,style,[contenteditable],[data-sensitive],[hidden],[aria-hidden="true"]',
        ) ||
        (excludeForms && parent.closest("form,table"))
      )
        continue;
      if (!parent.getClientRects().length) continue;
      if (
        getComputedStyle(parent).display === "none" ||
        getComputedStyle(parent).visibility === "hidden"
      )
        continue;
      const piece = walker.currentNode.textContent || "";
      if (piece.length > limit) textLimited = true;
      value += " " + piece.slice(0, limit + 1);
    }
    if (value.length > limit || inspected > 150) textLimited = true;
    return value.replace(/\s+/g, " ").trim().slice(0, limit);
  };
  const target = (el: Element) => {
    if (el.id) return `#${el.id.slice(0, 120)}`;
    const testId = el.getAttribute("data-testid");
    if (testId) return `[data-testid=${testId.slice(0, 120)}]`;
    return `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}.${Array.from(el.classList).slice(0, 3).join(".")}`.slice(
      0,
      200,
    );
  };
  const classify = (el: Element): Kind | undefined => {
    for (const kind of ["dialog", "loading", "empty", "message"] as Kind[])
      if (el.matches(selectors[kind])) return kind;
    return tracked.get(el)?.kind;
  };
  const visible = (el: Element) => {
    if (!el.isConnected || el.closest('[hidden],[aria-hidden="true"]'))
      return false;
    const style = getComputedStyle(el);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      el.getClientRects().length > 0
    );
  };
  const read = (el: Element): State | undefined => {
    textLimited = false;
    const kind = classify(el);
    if (!kind) return undefined;
    const shown =
      visible(el) && (kind !== "loading" || el.matches(selectors.loading));
    let text = "";
    let level = "unknown";
    if (shown) {
      if (kind === "dialog") {
        const labelled = el.getAttribute("aria-labelledby");
        const heading =
          (labelled && document.getElementById(labelled)) ||
          el.querySelector(
            '.el-dialog__title,.el-message-box__title,.ant-modal-title,[role="heading"],h1,h2',
          );
        const described = el.getAttribute("aria-describedby");
        const description =
          (described && document.getElementById(described)) ||
          el.querySelector(
            ".el-message-box__message,.ant-modal-confirm-content,[data-inspection-description]",
          );
        text = [
          heading
            ? safeText(heading, 120, true)
            : el.getAttribute("aria-label") || "网页弹窗",
          description ? safeText(description, 300, true) : "",
        ]
          .filter(Boolean)
          .join("；");
      } else if (kind === "loading")
        text = el.getAttribute("aria-label") || "加载状态出现";
      else if (kind === "empty")
        text =
          safeText(
            el.querySelector(".el-empty__description,.ant-empty-description") ||
              el,
            300,
          ) || "空数据状态出现";
      else {
        text = safeText(el);
        if (
          el.matches('[role="status"]') &&
          !el.matches(
            ".el-message,.el-notification,.ant-message-notice,.ant-notification-notice",
          ) &&
          !/成功|失败|错误|警告|校验|不能为空|暂无|无数据|success|fail|error|warning|loading|no data/i.test(
            text,
          )
        )
          return undefined;
        for (const type of ["error", "success", "warning", "info"]) {
          if (
            el.classList.contains(`el-message--${type}`) ||
            el.classList.contains(`el-notification--${type}`) ||
            el.querySelector(
              `.ant-message-${type},.ant-notification-notice-${type}`,
            )
          ) {
            level = type;
            break;
          }
        }
      }
    }
    return {
      kind,
      visible: shown,
      text: text.slice(0, 500),
      level,
      target: target(el),
      truncated: textLimited,
    };
  };
  const inspect = (el: Element) => {
    const old = tracked.get(el);
    const state = read(el);
    if (!state) return;
    if (!old && tracked.size >= 200) {
      if (!limited) {
        limited = true;
        emit({
          kind: "limit",
          reason: "单文档可观察反馈区域超过200个，保留限额内样本。",
        });
      }
      return;
    }
    tracked.set(el, state);
    if (
      state.visible &&
      (!old?.visible || state.text !== old.text || state.level !== old.level)
    ) {
      if (!state.text && state.kind === "message") return;
      emit({
        kind: state.kind,
        change: old?.visible ? "changed" : "appeared",
        text: state.text,
        level: state.level,
        target: state.target,
        truncated: state.truncated,
      });
    } else if (
      old?.visible &&
      !state.visible &&
      ["dialog", "loading", "empty"].includes(state.kind)
    )
      emit({
        kind: state.kind,
        change: "disappeared",
        text: state.kind === "loading" ? "加载状态消失" : old.text,
        level: old.level,
        target: old.target,
      });
    if (!el.isConnected) tracked.delete(el);
  };
  let url = location.href;
  let title = document.title;
  const locationState = () => {
    if (location.href !== url) {
      const before = url;
      url = location.href;
      emit({ kind: "url", change: "changed", before, after: url });
    }
    if (document.title !== title) {
      const before = title;
      title = document.title;
      emit({ kind: "title", change: "changed", before, after: title });
    }
  };
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    for (const el of pending) inspect(el);
    pending.clear();
    for (const [el, state] of tracked)
      if (
        !el.isConnected ||
        !visible(el) ||
        (state.kind === "loading" && !el.matches(selectors.loading))
      )
        inspect(el);
    locationState();
  };
  const queue = (node: Node) => {
    const el = node instanceof Element ? node : node.parentElement;
    if (!el) return;
    const parent = el.closest(selector);
    if (parent) pending.add(parent);
    if (tracked.has(el)) pending.add(el);
    if (el.matches(selector)) pending.add(el);
    // Query only the changed subtree, never serialize or repeatedly walk the page.
    for (const child of Array.from(el.querySelectorAll(selector)).slice(
      0,
      200,
    )) {
      const ancestor = child.parentElement?.closest(selector);
      if (!ancestor || classify(ancestor) !== classify(child))
        pending.add(child);
    }
  };
  const observer = new MutationObserver((records) => {
    if (!enabled) return;
    if (records.length > 200 && !scanLimited) {
      scanLimited = true;
      emit({
        kind: "limit",
        reason: "页面单批变化超过200项，反馈为限额观察，不代表全量DOM验证。",
      });
    }
    for (const mutation of records.slice(0, 200)) {
      if (mutation.type === "childList")
        for (const node of Array.from(mutation.addedNodes).slice(0, 100))
          queue(node);
      // For text/attribute changes inspect matching ancestors only.
      const el =
        mutation.target instanceof Element
          ? mutation.target
          : mutation.target.parentElement;
      if (el) {
        const matched = el.closest(selector);
        if (matched) pending.add(matched);
        if (tracked.has(el)) pending.add(el);
      }
      if (el && mutation.type === "attributes")
        for (const target of tracked.keys())
          if (el.contains(target)) pending.add(target);
    }
    // Transient messages can disappear before the settled snapshot. Observe
    // targeted visible additions now; the later flush deduplicates the same state.
    for (const target of pending)
      if (target.isConnected && visible(target)) inspect(target);
    if (!timer) timer = setTimeout(flush, 30);
  });
  const start = () => {
    if (!enabled || !document.documentElement) return;
    observer.observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden", "aria-busy"],
    });
    queue(document.documentElement);
    flush();
  };
  emit({ kind: "url", change: "initial", after: url });
  if (title) emit({ kind: "title", change: "initial", after: title });
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
  window.addEventListener("hashchange", locationState);
  window.addEventListener("popstate", locationState);
  // pushState can change a URL without touching the DOM. Reading two strings
  // avoids modifying the application history methods or scanning its page.
  const interval = setInterval(locationState, 750);
  win.__healthFeedbackFlush = async () => {
    flush();
    await Promise.allSettled([...emissions]);
  };
  win.__healthFeedbackDispose = () => {
    enabled = false;
    observer.disconnect();
    clearInterval(interval);
    if (timer) clearTimeout(timer);
    window.removeEventListener("hashchange", locationState);
    window.removeEventListener("popstate", locationState);
    tracked.clear();
    pending.clear();
  };
}
