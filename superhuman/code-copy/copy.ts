import { toast } from "sonner";

// BB's message and markdown markers keep file previews and tool output out.
const MESSAGE =
  '[data-timeline-row-id*=":assistant:"] [data-message-column] ' +
  "[data-markdown-preview]";
const INLINE = `${MESSAGE} code:not(pre code)`;
const MARKER = "data-superhuman-code-copy-inline";
const CONTROL =
  `a, button, input, textarea, select, [role="button"]:not([${MARKER}]), ` +
  '[contenteditable]:not([contenteditable="false"])';

export function startCodeCopy(doc: Document) {
  const win = doc.defaultView!;
  let active = true;
  let gesture: {
    block: HTMLElement;
    x: number;
    y: number;
    started: number;
    cancelled: boolean;
  } | null = null;

  function blockAt(target: EventTarget | null) {
    if (!(target instanceof win.Element) || target.closest(CONTROL)) return null;
    return target.closest<HTMLElement>(`${MESSAGE} pre, ${INLINE}`);
  }

  // Inline code has no native Copy button. Give it keyboard access and restore
  // the host's attributes on disable, including nodes removed by virtualization.
  const decorated = new Map<HTMLElement, Map<string, string | null>>();
  function restore(code: HTMLElement, attributes: Map<string, string | null>) {
    for (const [name, value] of attributes) {
      if (value === null) code.removeAttribute(name);
      else code.setAttribute(name, value);
    }
  }
  function decorate(root: Element) {
    const codes = root.matches(INLINE) ? [root] : root.querySelectorAll(INLINE);
    for (const element of codes) {
      const code = element as HTMLElement;
      if (decorated.has(code) || code.closest(CONTROL)) continue;
      const attributes = new Map<string, string | null>();
      for (const [name, value] of Object.entries({
        [MARKER]: "",
        role: "button",
        tabindex: "0",
        title: "Click to copy",
      })) {
        attributes.set(name, code.getAttribute(name));
        code.setAttribute(name, value);
      }
      decorated.set(code, attributes);
    }
  }
  // Each decoration restyles its code, so new code waits until the page is
  // idle: a thread switch paints first. Clicks copy undecorated code as well.
  let added: Element[] = [];
  let removed = false;
  let idle = 0;
  function flush() {
    idle = 0;
    if (!active) return;
    // Streaming replies mostly add nodes; check the decorated codes only when
    // something left the page.
    if (removed) {
      removed = false;
      for (const [code, attributes] of decorated) {
        if (code.isConnected) continue;
        restore(code, attributes);
        decorated.delete(code);
      }
    }
    const roots = added;
    added = [];
    for (const root of roots) if (root.isConnected) decorate(root);
  }
  const whenIdle = (run: () => void) =>
    win.requestIdleCallback
      ? win.requestIdleCallback(run, { timeout: 1000 })
      : win.requestAnimationFrame(() => win.setTimeout(run));
  const observer = new win.MutationObserver((records) => {
    for (const record of records) {
      if (record.removedNodes.length) removed = true;
      for (const node of record.addedNodes) {
        if (node instanceof win.Element) added.push(node);
      }
    }
    if (!idle && (removed || added.length)) idle = whenIdle(flush);
  });
  decorate(doc.documentElement);
  observer.observe(doc.documentElement, { childList: true, subtree: true });

  function pointerDown(event: PointerEvent) {
    const block = blockAt(event.target);
    gesture = block
      ? {
          block,
          x: event.clientX,
          y: event.clientY,
          started: event.timeStamp,
          cancelled: event.button !== 0 || !event.isPrimary,
        }
      : null;
  }

  function pointerMove(event: PointerEvent) {
    if (
      gesture &&
      Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6
    ) {
      gesture.cancelled = true;
    }
  }

  function cancelGesture() {
    if (gesture) gesture.cancelled = true;
  }

  async function copy(text: string) {
    try {
      // Start in the click handler so Safari keeps the user activation.
      await win.navigator.clipboard.writeText(text);
      if (active) toast.success("Copied", { id: "superhuman-code-copy" });
    } catch {
      if (active) {
        toast.error("Could not copy. Select the text and copy it manually.", {
          id: "superhuman-code-copy",
        });
      }
    }
  }

  function click(event: MouseEvent) {
    const previous = gesture;
    gesture = null;
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.detail > 1 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      doc.getSelection()?.isCollapsed === false
    ) {
      return;
    }
    const block = blockAt(event.target);
    if (!block) return;
    if (
      previous &&
      (previous.cancelled ||
        previous.block !== block ||
        event.timeStamp - previous.started > 500)
    ) {
      return;
    }
    // textContent preserves indentation/newlines through syntax highlighting.
    const text = (block.matches("pre") ? block.querySelector("code") : block)
      ?.textContent;
    if (text) void copy(text);
  }

  function keyDown(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      (event.key !== "Enter" && event.key !== " ")
    ) {
      return;
    }
    const code = blockAt(event.target);
    if (!code?.hasAttribute(MARKER) || !code.textContent) return;
    event.preventDefault();
    void copy(code.textContent);
  }

  doc.documentElement.setAttribute("data-superhuman-code-copy", "");
  doc.addEventListener("pointerdown", pointerDown, true);
  doc.addEventListener("pointermove", pointerMove, true);
  doc.addEventListener("pointercancel", cancelGesture, true);
  // Touch scrolling cancels its pointer. A scroll event alone can instead
  // come from BB following a streaming reply, which should not cancel a click.
  doc.addEventListener("wheel", cancelGesture, { capture: true, passive: true });
  doc.addEventListener("click", click);
  doc.addEventListener("keydown", keyDown);
  return () => {
    active = false;
    gesture = null;
    doc.documentElement.removeAttribute("data-superhuman-code-copy");
    doc.removeEventListener("pointerdown", pointerDown, true);
    doc.removeEventListener("pointermove", pointerMove, true);
    doc.removeEventListener("pointercancel", cancelGesture, true);
    doc.removeEventListener("wheel", cancelGesture, true);
    doc.removeEventListener("click", click);
    doc.removeEventListener("keydown", keyDown);
    observer.disconnect();
    for (const [code, attributes] of decorated) restore(code, attributes);
    decorated.clear();
    toast.dismiss("superhuman-code-copy");
  };
}
