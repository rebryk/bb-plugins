// The part of Annotate that runs in the Browser tab. BB evaluates
// `installPage` in the tab's isolated world, which shares the page's DOM but
// not its globals, so the function must use nothing outside its own body.

import type { Note, PageMessage } from "./shared";

/** A note's pin, as the toolbar control asks the page to draw it. */
export interface Pin {
  id: string;
  number: number;
  comment: string;
  selector: string;
}

/** A key with its modifiers, as `KeyboardEvent` reports them. */
export interface Shortcut {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * What the page shows: the picker, the number of the next note, and the pins;
 * and the shortcut that turns the picker on and off.
 */
export interface PageState {
  picking: boolean;
  next: number;
  pins: Pin[];
  shortcut: Shortcut | null;
}

/** Installs the page side once per document; later calls do nothing. */
export function installPage(bb: { postMessage(data: unknown): void }): void {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope.__bbAnnotate) return;
  // An SVG or XML document has no place for the overlay.
  if (!(document.documentElement instanceof HTMLElement)) {
    scope.__bbAnnotate = { sync: () => true };
    return;
  }

  const ATTRIBUTES = [
    "id",
    "class",
    "role",
    "aria-label",
    "name",
    "type",
    "href",
    "src",
    "alt",
    "placeholder",
    "title",
    "data-testid",
  ];
  const STYLES = [
    "display",
    "position",
    "width",
    "height",
    "margin",
    "padding",
    "color",
    "background-color",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "border",
    "border-radius",
  ];
  const STYLESHEET = `
    * { box-sizing: border-box; }
    .shield { position: fixed; inset: 0; display: none; pointer-events: auto; cursor: crosshair; outline: none; }
    .picking .shield { display: block; }
    .box, .outline { position: fixed; border-radius: 3px; display: none; }
    .box { border: 2px solid #007aff; background: #007aff1f; }
    .outline { border: 1.5px solid #007aff; }
    .tip { position: fixed; display: none; padding: 2px 6px; border-radius: 4px; background: #1d1d1f; color: #fff; font: 500 11px/16px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; white-space: nowrap; max-width: 360px; overflow: hidden; text-overflow: ellipsis; }
    .pin { position: fixed; display: none; pointer-events: auto; cursor: pointer; width: 20px; height: 20px; padding: 0; border: 1.5px solid #fff; border-radius: 10px; background: #007aff; color: #fff; font: 600 11px/17px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; text-align: center; box-shadow: 0 1px 4px #0000004d; }
    .editor { position: fixed; display: none; pointer-events: auto; width: 300px; padding: 10px; border-radius: 12px; background: #fff; color: #1d1d1f; border: 1px solid #0000001a; box-shadow: 0 8px 28px #00000033; font: 13px/18px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; }
    .editor.open { display: block; }
    .editor .label { margin: 0 0 6px; color: #6e6e73; font-size: 11px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .editor textarea { display: block; width: 100%; min-height: 64px; max-height: 200px; resize: vertical; margin: 0; padding: 6px 8px; border: 1px solid #0000001f; border-radius: 8px; background: transparent; color: inherit; font: inherit; outline: none; }
    .editor textarea:focus { border-color: #007aff; box-shadow: 0 0 0 3px #007aff33; }
    .editor .row { display: flex; gap: 6px; margin-top: 8px; align-items: center; }
    .editor .row span { flex: 1; }
    .editor button { height: 26px; padding: 0 10px; border: 0; border-radius: 13px; background: #0000000d; color: inherit; font: 500 12px/26px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; cursor: pointer; }
    .editor button.save { background: #007aff; color: #fff; }
    .editor button.save:disabled { opacity: 0.4; cursor: default; }
    .editor button.delete { background: transparent; color: #ff3b30; padding: 0 4px; }
    @media (prefers-color-scheme: dark) {
      .editor { background: #2c2c2e; color: #f5f5f7; border-color: #ffffff1f; }
      .editor .label { color: #98989d; }
      .editor textarea { border-color: #ffffff26; }
      .editor button { background: #ffffff1a; }
      .editor button.delete { color: #ff453a; }
    }
  `;

  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    parent: Node,
    text = "",
  ): HTMLElementTagNameMap[K] => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  };

  // The closed shadow root keeps page scripts and styles out; styles set
  // through the CSSOM and an adopted sheet work under strict page CSPs.
  const host = document.createElement("bb-annotate");
  host.style.cssText =
    "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block";
  const root = host.attachShadow({ mode: "closed" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(STYLESHEET);
  root.adoptedStyleSheets = [sheet];
  const layer = make("div", "", root);
  const shield = make("div", "shield", layer);
  shield.tabIndex = -1;
  const box = make("div", "box", layer);
  const tip = make("div", "tip", layer);
  const pinLayer = make("div", "", layer);
  const editor = make("form", "editor", layer);
  const label = make("p", "label", editor);
  const input = make("textarea", "", editor);
  input.placeholder = "A note for the agent";
  input.maxLength = 4000;
  const row = make("div", "row", editor);
  const remove = make("button", "delete", row, "Delete");
  remove.type = "button";
  make("span", "", row);
  const cancel = make("button", "cancel", row, "Cancel");
  cancel.type = "button";
  const save = make("button", "save", row, "Add");
  save.type = "submit";

  // Keys, clicks, and focus inside the overlay stay out of the page's own
  // handlers, so typing a note never triggers the page's shortcuts, and the
  // page's menus do not close when the overlay takes the focus.
  for (const type of [
    "focusin",
    "focusout",
    "keydown",
    "keyup",
    "keypress",
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "contextmenu",
  ])
    host.addEventListener(type, (event) => event.stopPropagation());

  let state: PageState = {
    picking: false,
    next: 1,
    pins: [],
    shortcut: null,
  };
  // `pointed` is the element under the pointer; `hovered` is it or, after ↑,
  // one of its ancestors.
  let pointed: Element | null = null;
  let hovered: Element | null = null;
  let editing: { id: string | null; target: Element } | null = null;
  const marks = new Map<
    string,
    { outline: HTMLElement; pin: HTMLElement; element?: Element }
  >();

  const post = (message: PageMessage) => bb.postMessage(message);
  const clean = (value: string, max: number) =>
    value.replace(/\s+/g, " ").trim().slice(0, max);
  const textOf = (element: Element) =>
    clean((element as HTMLElement).innerText ?? element.textContent ?? "", 300);
  const unique = (selector: string) => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };
  const selectorOf = (element: Element) => {
    const parts: string[] = [];
    for (
      let node: Element | null = element;
      node && node !== document.documentElement && parts.length < 12;
      node = node.parentElement
    ) {
      if (node.id && unique(`#${CSS.escape(node.id)}`)) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      const testId = node.getAttribute("data-testid");
      const byTestId = testId && `[data-testid="${CSS.escape(testId)}"]`;
      if (byTestId && unique(byTestId)) {
        parts.unshift(byTestId);
        break;
      }
      const tag = node.localName;
      const siblings = node.parentElement
        ? Array.from(node.parentElement.children).filter(
            (child) => child.localName === tag,
          )
        : [];
      parts.unshift(
        siblings.length > 1
          ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})`
          : tag,
      );
    }
    return parts.join(" > ");
  };
  const nameOf = (element: Element) => {
    const classes = Array.from(element.classList)
      .slice(0, 2)
      .map((name) => `.${name}`)
      .join("");
    const text = clean(textOf(element), 40);
    return (
      `${element.localName}${element.id ? `#${element.id}` : ""}${classes}`.slice(
        0,
        300,
      ) + (text ? ` "${text}"` : "")
    );
  };
  const describe = (element: Element): Note["element"] => {
    const rect = element.getBoundingClientRect();
    const attributes: Record<string, string> = {};
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value) attributes[name] = clean(value, 200);
    }
    const computed = getComputedStyle(element);
    const styles: Record<string, string> = {};
    for (const name of STYLES) {
      const value = computed.getPropertyValue(name);
      if (value) styles[name] = clean(value, 200);
    }
    return {
      name: nameOf(element),
      // A longer selector is no use to anyone; the pin then stays hidden
      // after a reload.
      selector: ((selector) => (selector.length > 2000 ? "" : selector))(
        selectorOf(element),
      ),
      text: textOf(element),
      attributes,
      styles,
      rect: {
        x: Math.round(rect.left + scrollX),
        y: Math.round(rect.top + scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      view: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      viewport: { width: innerWidth, height: innerHeight },
    };
  };
  // A pin keeps its element; after a reload, its selector finds it again.
  const find = (pin: Pin) => {
    const mark = marks.get(pin.id);
    if (mark?.element?.isConnected) return mark.element;
    try {
      const found = document.querySelector(pin.selector);
      if (mark && found) mark.element = found;
      return found;
    } catch {
      return null;
    }
  };
  const place = (element: HTMLElement, rect: DOMRect | null) => {
    const visible = !!rect && (rect.width > 0 || rect.height > 0);
    element.style.display = visible ? "block" : "none";
    if (!visible) return;
    Object.assign(element.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  };

  // Positions everything from the live layout, every frame while anything
  // shows, so pins follow scrolling, resizing, and animations. It reads the
  // layout before it writes styles, so a frame costs one layout.
  let frame = 0;
  let tipFor: Element | null = null;
  let tipWidth = 0;
  const layout = () => {
    frame = 0;
    const target = editing?.target ?? (state.picking ? hovered : null);
    const targetRect = target?.isConnected
      ? target.getBoundingClientRect()
      : null;
    const pinRects = state.pins.map(
      (pin) => find(pin)?.getBoundingClientRect() ?? null,
    );
    const editorSize = editing && [editor.offsetWidth, editor.offsetHeight];
    place(box, editing?.id ? null : targetRect);
    if (targetRect && hovered && !editing) {
      tip.style.display = "block";
      if (tipFor !== hovered) {
        tipFor = hovered;
        tip.textContent = `${nameOf(hovered)}  ${Math.round(targetRect.width)}×${Math.round(targetRect.height)}`;
        tipWidth = tip.offsetWidth;
      }
      const above = targetRect.top - 22;
      tip.style.left = `${Math.max(4, Math.min(targetRect.left, innerWidth - tipWidth - 4))}px`;
      tip.style.top = `${above >= 4 ? above : Math.min(targetRect.bottom + 4, innerHeight - 22)}px`;
    } else tip.style.display = "none";
    state.pins.forEach((pin, index) => {
      const mark = marks.get(pin.id)!;
      const rect = pinRects[index] ?? null;
      place(mark.outline, rect);
      mark.pin.style.display = mark.outline.style.display;
      if (!rect) return;
      mark.pin.style.left = `${Math.max(2, Math.min(rect.left - 10, innerWidth - 22))}px`;
      mark.pin.style.top = `${Math.max(2, Math.min(rect.top - 10, innerHeight - 22))}px`;
    });
    if (editorSize && targetRect) {
      const [width, height] = editorSize;
      const below = targetRect.bottom + 8;
      const top =
        below + height <= innerHeight - 8 ? below : targetRect.top - 8 - height;
      editor.style.left = `${Math.max(8, Math.min(targetRect.left, innerWidth - width - 8))}px`;
      editor.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8))}px`;
    }
    if (state.pins.length || state.picking || editing)
      frame = requestAnimationFrame(layout);
  };
  const relayout = () => {
    if (frame) cancelAnimationFrame(frame);
    layout();
  };

  const drawPins = () => {
    for (const [id, mark] of marks)
      if (!state.pins.some((pin) => pin.id === id)) {
        mark.outline.remove();
        mark.pin.remove();
        marks.delete(id);
      }
    for (const pin of state.pins) {
      let mark = marks.get(pin.id);
      if (!mark) {
        mark = {
          outline: make("div", "outline", pinLayer),
          pin: make("button", "pin", pinLayer),
        };
        (mark.pin as HTMLButtonElement).type = "button";
        const id = pin.id;
        mark.pin.addEventListener("click", () => {
          const target = state.pins.find((item) => item.id === id);
          const element = target && find(target);
          if (target && element) open(element, target);
        });
        marks.set(pin.id, mark);
      }
      mark.pin.textContent = String(pin.number);
      mark.pin.title = pin.comment;
    }
  };

  const open = (target: Element, pin: Pin | null) => {
    editing = { id: pin?.id ?? null, target };
    hovered = null;
    label.textContent = `${pin ? pin.number : state.next} · ${nameOf(target)}`;
    input.value = pin?.comment ?? "";
    save.textContent = pin ? "Save" : "Add";
    remove.style.display = pin ? "" : "none";
    save.disabled = !input.value.trim();
    editor.classList.add("open");
    relayout();
    input.focus({ preventScroll: true });
  };
  const stopPicking = () => {
    state = { ...state, picking: false };
    layer.classList.remove("picking");
    pointed = hovered = null;
  };
  const close = () => {
    const added = editing?.id === null;
    editing = null;
    editor.classList.remove("open");
    // One pick makes one note: closing a new note's editor ends the pick.
    if (added && state.picking) {
      stopPicking();
      post({ kind: "stop" });
    } else if (state.picking) shield.focus({ preventScroll: true });
    relayout();
  };
  const submit = () => {
    const comment = input.value.trim();
    if (!editing || !comment) return;
    const { id, target } = editing;
    let message: PageMessage;
    if (id) {
      state = {
        ...state,
        pins: state.pins.map((pin) =>
          pin.id === id ? { ...pin, comment } : pin,
        ),
      };
      message = { kind: "edit", id, comment };
    } else {
      const element = describe(target);
      const pin: Pin = {
        id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
        number: state.next,
        comment,
        selector: element.selector,
      };
      state = { ...state, next: state.next + 1, pins: [...state.pins, pin] };
      message = {
        kind: "add",
        id: pin.id,
        number: pin.number,
        comment,
        url: location.href,
        title: document.title.slice(0, 500),
        element,
      };
    }
    // The pin is drawn and the editor gone before the toolbar control takes
    // its screenshot.
    drawPins();
    if (!id) {
      marks.get(message.id)!.element = target;
      stopPicking();
    }
    close();
    post(message);
  };

  editor.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  input.addEventListener("input", () => {
    save.disabled = !input.value.trim();
  });
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  cancel.addEventListener("click", close);
  remove.addEventListener("click", () => {
    const id = editing?.id;
    if (!id) return;
    state = { ...state, pins: state.pins.filter((pin) => pin.id !== id) };
    drawPins();
    close();
    post({ kind: "delete", id });
  });

  const hit = (x: number, y: number) => {
    shield.style.pointerEvents = "none";
    try {
      let element = document.elementFromPoint(x, y);
      while (element?.shadowRoot) {
        const inner = element.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === element) break;
        element = inner;
      }
      return element === host ? null : element;
    } finally {
      shield.style.pointerEvents = "";
    }
  };
  shield.addEventListener("pointermove", (event) => {
    if (editing) return;
    const element = hit(event.clientX, event.clientY);
    if (element === pointed) return;
    pointed = hovered = element;
    relayout();
  });
  shield.addEventListener("click", (event) => {
    event.preventDefault();
    if (editing) {
      // A click beside an empty editor dismisses it; a written note stays.
      if (!input.value.trim()) close();
      else input.focus({ preventScroll: true });
      return;
    }
    const element = hit(event.clientX, event.clientY);
    const target = hovered?.contains(element) ? hovered : (element ?? hovered);
    if (target) open(target, null);
  });
  shield.addEventListener("keydown", (event) => {
    event.preventDefault();
    if (event.key === "Escape") {
      stopPicking();
      relayout();
      post({ kind: "stop" });
    } else if (event.key === "ArrowUp" && hovered?.parentElement) {
      hovered = hovered.parentElement;
      relayout();
    }
  });

  /**
   * Shows `next`: the picker on or off, the pins, and the next number. True
   * tells the toolbar control that the page side is still installed.
   */
  const sync = (next: Partial<PageState>) => {
    const wasPicking = state.picking;
    state = { ...state, ...next };
    // The overlay joins the page once it has something to show. The page may
    // also remove it, for example when it re-renders <html>.
    if ((state.picking || state.pins.length) && !host.isConnected)
      document.documentElement.appendChild(host);
    if (next.pins) drawPins();
    if (
      editing &&
      (editing.id
        ? !state.pins.some((pin) => pin.id === editing?.id)
        : !state.picking)
    )
      close();
    layer.classList.toggle("picking", state.picking);
    if (!state.picking) pointed = hovered = null;
    if (state.picking && !wasPicking && !editing)
      shield.focus({ preventScroll: true });
    relayout();
    return true;
  };

  // The shortcut also works while the page has the focus, where BB does not
  // see keys. Keys match the way BB matches them; a key that is no Latin
  // letter or digit, as in another keyboard layout or with Alt, matches by
  // its physical key.
  const SHIFTED: Record<string, string> = {
    "!": "1",
    "@": "2",
    "#": "3",
    $: "4",
    "%": "5",
    "^": "6",
    "&": "7",
    "*": "8",
    "(": "9",
    ")": "0",
    _: "-",
    "+": "=",
    "{": "[",
    "}": "]",
    "|": "\\",
    ":": ";",
    '"': "'",
    "<": ",",
    ">": ".",
    "?": "/",
    "~": "`",
  };
  const keyOf = (event: KeyboardEvent) => {
    if (event.key === " " || event.key === "Spacebar") return "space";
    const physical = /^[a-z0-9]$/i.test(event.key)
      ? undefined
      : /^(?:Key|Digit)(.)$/.exec(event.code)?.[1];
    if (physical) return physical.toLowerCase();
    return (
      event.shiftKey ? (SHIFTED[event.key] ?? event.key) : event.key
    ).toLowerCase();
  };
  addEventListener(
    "keydown",
    (event) => {
      const shortcut = state.shortcut;
      if (
        !shortcut ||
        event.repeat ||
        event.isComposing ||
        event.ctrlKey !== shortcut.ctrlKey ||
        event.altKey !== shortcut.altKey ||
        event.shiftKey !== shortcut.shiftKey ||
        event.metaKey !== shortcut.metaKey
      )
        return;
      if (keyOf(event) !== shortcut.key.toLowerCase()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      post({ kind: "toggle" });
    },
    true,
  );

  scope.__bbAnnotate = { sync, root };
}

/** The expression that installs the page side and shows `state`, a JSON
 * `PageState`, in it. */
export function pageExpression(state: string): string {
  return `((${installPage.toString()})(bb), globalThis.__bbAnnotate.sync(${state}), null)`;
}
