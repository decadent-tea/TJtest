// Runs inside every page/frame. Keep this function self-contained for addInitScript.
export function installCollector() {
  const win = window as unknown as {
    __healthEmit: (event: unknown) => Promise<void>;
    __healthFlush?: () => void;
  };
  if (win.__healthFlush) return;
  const css = (el: Element): string => {
    if (
      el.id &&
      document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1
    )
      return `#${CSS.escape(el.id)}`;
    const testId = el.getAttribute("data-testid");
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && parts.length < 8) {
      let part = node.tagName.toLowerCase();
      const parent: Element | null = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (s) => s.tagName === node!.tagName,
        );
        if (siblings.length > 1)
          part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (node.id) {
        parts[0] = `#${CSS.escape(node.id)}`;
        break;
      }
      node = parent;
    }
    return parts.join(" > ");
  };
  const text = (el: Element) =>
    (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      (el as HTMLElement).innerText ||
      el.textContent ||
      ""
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 90);
  const snapshot = (el: Element) => {
    const input = el as HTMLInputElement;
    const label =
      input.labels?.[0]?.textContent?.trim() ||
      el.getAttribute("placeholder") ||
      "";
    const explicit = el.getAttribute("role");
    const role =
      explicit ||
      (
        {
          BUTTON: "button",
          A: "link",
          TEXTAREA: "textbox",
          SELECT: "combobox",
        } as Record<string, string>
      )[el.tagName] ||
      (el.tagName === "INPUT"
        ? ["checkbox", "radio"].includes(input.type)
          ? input.type
          : "textbox"
        : "");
    const name = text(el) || label || input.name || el.tagName.toLowerCase();
    const hints: { kind: string; value: string; name?: string }[] = [];
    if (el.getAttribute("data-testid"))
      hints.push({ kind: "testId", value: el.getAttribute("data-testid")! });
    if (role && name && !["textbox", "combobox"].includes(role))
      hints.push({ kind: "role", value: role, name });
    if (label) hints.push({ kind: "label", value: label });
    hints.push({ kind: "css", value: css(el) });
    const active = Array.from(
      document.querySelectorAll(
        'nav [aria-current],aside [aria-selected="true"],.ant-menu-item-selected,.el-menu-item.is-active',
      ),
    )
      .map(text)
      .filter(Boolean);
    const bread = Array.from(
      document.querySelectorAll(
        '[aria-label*="breadcrumb"] li,.ant-breadcrumb,.el-breadcrumb',
      ),
    )
      .map(text)
      .filter(Boolean);
    const heading = document.querySelector("main h1,main h2,h1,h2");
    const rect = el.getBoundingClientRect();
    return {
      locators: hints,
      label: name,
      module:
        [...active, ...bread].join(" / ") ||
        (heading ? text(heading) : document.title),
      url: location.href,
      position: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    };
  };
  const emit = (data: Record<string, unknown>) =>
    void win
      .__healthEmit({ ...data, timestamp: new Date().toISOString() })
      .catch(() => {});
  let pending: Element | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let composing = false;
  const flush = () => {
    if (timer) clearTimeout(timer);
    if (!pending) return;
    const el = pending as HTMLInputElement;
    pending = undefined;
    const secret =
      el.type === "password" ||
      /password|passwd|pwd|token|secret/i.test(`${el.name} ${el.id}`);
    emit({
      kind: "fill",
      ...snapshot(el),
      value: secret ? undefined : el.value,
      variable: secret ? "LOGIN_PASSWORD" : undefined,
    });
  };
  win.__healthFlush = flush;
  document.addEventListener(
    "compositionstart",
    () => {
      composing = true;
    },
    true,
  );
  document.addEventListener(
    "compositionend",
    () => {
      composing = false;
    },
    true,
  );
  document.addEventListener(
    "input",
    (e) => {
      const el = e.composedPath()[0];
      if (
        !(
          el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ) ||
        ["checkbox", "radio", "file"].includes((el as HTMLInputElement).type)
      )
        return;
      if (pending && pending !== el) flush();
      pending = el;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!composing) flush();
      }, 450);
    },
    true,
  );
  document.addEventListener("blur", flush, true);
  document.addEventListener("pointerdown", flush, true);
  // Capture entry, not mouse movement: even a quick pass can open a submenu.
  // Use semantic triggers plus CSS :hover rules for custom menu implementations.
  let hoverSelectors: string[] = [];
  let stylesCheckedAt = 0;
  const hoverTarget = (original: Element) => {
    if (Date.now() - stylesCheckedAt > 1000) {
      stylesCheckedAt = Date.now();
      hoverSelectors = [];
      const scan = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if (
            rule instanceof CSSStyleRule &&
            rule.selectorText.includes(":hover")
          ) {
            for (const selector of rule.selectorText.split(",")) {
              const prefix = selector.split(":hover")[0].trim();
              if (prefix) hoverSelectors.push(prefix);
            }
          }
          if ("cssRules" in rule) scan((rule as CSSGroupingRule).cssRules);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          scan(sheet.cssRules);
        } catch {
          /* Cross-origin stylesheet. */
        }
      }
    }
    let el: Element | null = original;
    while (el && !["BODY", "HTML"].includes(el.tagName)) {
      if (
        el.matches(
          'button,a,[role="button"],[role="menuitem"],[aria-haspopup]:not([aria-haspopup="false"]),[aria-expanded],nav li,aside li,.el-sub-menu__title,.el-submenu__title,.ant-menu-submenu-title,[onmouseenter],[onmouseover]',
        ) ||
        hoverSelectors.some((selector) => {
          try {
            return el!.matches(selector);
          } catch {
            return false;
          }
        })
      )
        return el;
      el = el.parentElement;
    }
    return undefined;
  };
  document.addEventListener(
    "mouseover",
    (e) => {
      const original = e.composedPath()[0];
      if (!(original instanceof Element)) return;
      const el = hoverTarget(original);
      if (
        !el ||
        (e.relatedTarget instanceof Node && el.contains(e.relatedTarget))
      )
        return;
      flush();
      const data = snapshot(el);
      const style = getComputedStyle(el);
      emit({
        kind: "hover",
        ...data,
        // Playwright positions are relative to the padding box, not the viewport.
        hoverPosition: {
          x: Math.max(
            0,
            e.clientX -
              data.position.x -
              (parseFloat(style.borderLeftWidth) || 0),
          ),
          y: Math.max(
            0,
            e.clientY -
              data.position.y -
              (parseFloat(style.borderTopWidth) || 0),
          ),
        },
      });
    },
    true,
  );
  document.addEventListener(
    "click",
    (e) => {
      if (!e.isTrusted) return;
      // Keyboard activation already has a press operation. Recording the browser's
      // synthesized click as well would submit/toggle the control twice on replay.
      if (e.detail === 0 && Date.now() - lastActivation < 800) return;
      const original = e.composedPath()[0];
      if (!(original instanceof Element)) return;
      const el =
        original.closest(
          'button,a,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"]',
        ) || original;
      if (
        el instanceof HTMLInputElement &&
        ["checkbox", "radio", "file"].includes(el.type)
      )
        return;
      if (
        el
          .closest("label")
          ?.querySelector('input[type="checkbox"],input[type="radio"]')
      )
        return;
      if (
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLInputElement
      )
        return;
      if (el.tagName === "HTML" || el.tagName === "BODY") return;
      const data = snapshot(el);
      const style = getComputedStyle(el);
      const click = {
        clickPosition: e.detail
          ? {
              x: Math.max(
                0,
                e.clientX -
                  data.position.x -
                  (parseFloat(style.borderLeftWidth) || 0),
              ),
              y: Math.max(
                0,
                e.clientY -
                  data.position.y -
                  (parseFloat(style.borderTopWidth) || 0),
              ),
            }
          : undefined,
        clickButton: "left",
        clickModifiers: [
          e.altKey && "Alt",
          e.ctrlKey && "Control",
          e.metaKey && "Meta",
          e.shiftKey && "Shift",
        ].filter(Boolean),
      };
      const menu = el.closest('nav,aside,[role="menu"]');
      if (menu && data.label) {
        data.module = data.label;
        emit({ kind: "click", ...data, ...click, scene: data.label });
      } else emit({ kind: "click", ...data, ...click });
    },
    true,
  );
  document.addEventListener(
    "change",
    (e) => {
      const el = e.composedPath()[0];
      if (el instanceof HTMLSelectElement)
        emit({ kind: "select", ...snapshot(el), value: el.value });
      else if (
        el instanceof HTMLInputElement &&
        ["checkbox", "radio"].includes(el.type)
      )
        emit({ kind: "check", ...snapshot(el), checked: el.checked });
      else if (el instanceof HTMLInputElement && el.type === "file")
        emit({
          kind: "upload",
          ...snapshot(el),
          value: Array.from(el.files || [])
            .map((f) => f.name)
            .join(", "),
        });
      else flush();
    },
    true,
  );
  let lastActivation = 0;
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.isComposing) return;
      const el = e.composedPath()[0];
      if (!(el instanceof Element)) return;
      if (
        e.key === " " &&
        !el.matches(
          'button,a,[role="button"],[role="checkbox"],[role="switch"],input[type="checkbox"],input[type="radio"]',
        )
      )
        return;
      if (e.key === "Enter" || e.key === " ") lastActivation = Date.now();
      if (
        [
          "Enter",
          " ",
          "Tab",
          "Escape",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(e.key) ||
        ((e.ctrlKey || e.metaKey || e.altKey) && e.key.length === 1)
      ) {
        flush();
        emit({
          kind: "press",
          ...snapshot(el),
          key: [
            e.ctrlKey ? "Control" : "",
            e.metaKey ? "Meta" : "",
            e.altKey ? "Alt" : "",
            e.shiftKey ? "Shift" : "",
            e.key,
          ]
            .filter(Boolean)
            .join("+"),
        });
      }
    },
    true,
  );
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener(
    "scroll",
    (e) => {
      if (scrollTimer) clearTimeout(scrollTimer);
      const target = e.target;
      scrollTimer = setTimeout(() => {
        const el =
          target instanceof Element ? target : document.documentElement;
        emit({
          kind: "scroll",
          ...snapshot(el),
          scroll: {
            x: el.scrollLeft || window.scrollX,
            y: el.scrollTop || window.scrollY,
          },
        });
      }, 400);
    },
    true,
  );
  window.addEventListener("unhandledrejection", (e) =>
    emit({
      kind: "log",
      level: "unhandledrejection",
      text: String(
        e.reason?.stack || e.reason || "Unhandled promise rejection",
      ),
    }),
  );
}
