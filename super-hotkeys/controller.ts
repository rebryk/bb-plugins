import type { useSdk } from "@get-bb/plugin-sdk/app";

type Bindings = Awaited<
  ReturnType<ReturnType<typeof useSdk>["system"]["config"]>
>["keybindings"];
type Modifier = "ctrlKey" | "altKey" | "shiftKey" | "metaKey";
type Chord = Record<Modifier, boolean> & { key: string };

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const desktop = !!Reflect.get(window, "bbDesktop");
const SYMBOLS: Record<Modifier, string> = mac
  ? { ctrlKey: "⌃", altKey: "⌥", shiftKey: "⇧", metaKey: "⌘" }
  : { ctrlKey: "Ctrl", altKey: "Alt", shiftKey: "Shift", metaKey: "Meta" };
const MODIFIERS = Object.keys(SYMBOLS) as Modifier[];
const NONE = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
const PANEL =
  ':is([role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"])';
const HIDDEN = `[inert], [aria-hidden="true"], ${PANEL}[data-state="closed"]`;
const EDITABLE =
  'input, textarea, select, iframe, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], .monaco-editor, [data-app-terminal], [data-app-browser]';
const ITEM =
  '[role="option"], [role="menuitem"], [role="menuitemradio"], button';
const ROW = "[data-sidebar-thread-shortcut-target]";
// The new-thread project, model, machine and branch controls, in number order.
const CONTROLS = [
  "[data-promptbox-project-control]",
  'button[aria-label^="Provider, model and reasoning"]',
  'button[aria-label="Environment"][data-promptbox-shrinkable-control], button[aria-label="Machine"]',
  'button[aria-label="Worktree"], button[aria-label="Branch"], button[aria-label="Environment"][data-promptbox-icon-only-control]',
];
const MODEL = CONTROLS[1];
const [KEY, MODE, ANCHOR] = ["key", "mode", "anchor"].map(
  (name) => `data-super-hotkeys-${name}`,
);

let settings: Record<string, unknown> = {};
let bindings: Bindings = [];
let running = false;
let mods: Record<Modifier, boolean> = NONE;
let tagged: HTMLElement[] = [];
let frame = 0;
let dismissed: Element | null = null;

/** Receives the plugin settings and BB's resolved keybindings. */
export function update(next: {
  settings?: typeof settings;
  bindings?: Bindings;
}) {
  settings = next.settings ?? settings;
  bindings = next.bindings ?? bindings;
  paint();
}

const shown = (element: Element) => element.getClientRects().length > 0;
const usable = (element: Element) =>
  shown(element) &&
  !element.matches(':disabled, [aria-disabled="true"]') &&
  !element.closest(HIDDEN);
const editable = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest(EDITABLE);

/** Open menus and dialogs, the most recent last. */
function panels() {
  const open = [...document.querySelectorAll(PANEL)].filter(usable);
  return open.filter(
    (panel) => !open.some((other) => other !== panel && other.contains(panel)),
  );
}

function composer() {
  const find = (root: ParentNode, selector: string) =>
    [...root.querySelectorAll<HTMLElement>(selector)].find(shown);
  const shell = find(document, CONTROLS[0])?.closest("[data-promptbox-shell]");
  if (!shell) return;
  const controls = CONTROLS.map((selector) => find(shell, selector)).filter(
    (control): control is HTMLElement =>
      !!control && !control.matches(":disabled"),
  );
  const open = controls.find((control) => control.ariaExpanded === "true");
  return {
    controls,
    open,
    prompt: shell.querySelector<HTMLElement>('[contenteditable="true"]'),
  };
}

/** The setup controls, or the options of the menu one of them opened. */
function numbered(setup = composer()): HTMLElement[] {
  const focus = document.activeElement;
  if (focus !== dismissed) dismissed = null;
  if (!setup || settings.numberedSetup === false) return [];
  if (mods.ctrlKey || mods.altKey || mods.metaKey) return [];
  const panel = panels().at(-1);
  if (setup.open) {
    // Typed filters and forms such as New project keep their keys.
    const typed = focus instanceof HTMLInputElement && !!focus.value;
    if (!panel || typed || panel.querySelector("form")) return [];
    // In the model picker, numbers choose the provider.
    if (setup.open.matches(MODEL))
      return [...panel.querySelectorAll<HTMLElement>("button[title]")].filter(
        (tab) => usable(tab) && !tab.textContent?.trim(),
      );
    return [...panel.querySelectorAll<HTMLElement>(ITEM)].filter(
      (item) => usable(item) && !item.parentElement?.closest(ITEM),
    );
  }
  const { prompt } = setup;
  const empty = prompt && !prompt.textContent && !prompt.querySelector("img");
  const elsewhere = editable(focus) && !prompt?.contains(focus);
  return empty && !panel && !dismissed && !elsewhere ? setup.controls : [];
}

/** BB's current shortcut for a command on this platform and surface. */
function binding(command: string): Chord | undefined {
  const context: Record<string, boolean> = {
    macPlatform: mac,
    webSurface: !desktop,
    desktopSurface: desktop,
  };
  const shortcut = bindings.find(
    (item) =>
      item.command === command &&
      item.shortcut &&
      (desktop || !item.desktopOnly) &&
      item.when.all.every((key) => context[key] ?? true) &&
      !item.when.none.some((key) => context[key]),
  )?.shortcut;
  if (!shortcut) return;
  const { key, mod, control, alt, shift, meta } = shortcut;
  return {
    key,
    ctrlKey: control || (mod && !mac),
    altKey: alt,
    shiftKey: shift,
    metaKey: meta || (mod && mac),
  };
}

/** Reads `aria-keyshortcuts`, such as "Shift+Meta+M". */
const parse = (value: string): Chord[] =>
  value
    .split(" ")
    .filter(Boolean)
    .map((chord) => ({
      key: chord.split("+").at(-1) || "+",
      ctrlKey: chord.includes("Control+"),
      altKey: chord.includes("Alt+"),
      shiftKey: chord.includes("Shift+"),
      metaKey: chord.includes("Meta+"),
    }));

/** The keys still needed while the held modifiers stay down, like "⇧ M". */
function remaining(chord?: Chord) {
  if (!chord || MODIFIERS.some((key) => mods[key] && !chord[key])) return;
  const keys = MODIFIERS.filter((key) => chord[key] && !mods[key]).map(
    (key) => SYMBOLS[key],
  );
  keys.push(chord.key.length > 1 ? chord.key : chord.key.toUpperCase());
  return keys.join(mac ? " " : " + ");
}

/** Hints for the visible shortcuts while a modifier is held. */
function hints(pills: Map<HTMLElement, string>) {
  if (settings.hints === false || !MODIFIERS.some((key) => mods[key])) return;
  const top = panels().at(-1);
  const add = (element: HTMLElement, chords: (Chord | undefined)[]) => {
    const keys = [...new Set(chords.map(remaining).filter(Boolean))];
    const inactive = element.closest(
      '[data-split-pane-id][data-focused="false"]',
    );
    if (
      keys.length &&
      usable(element) &&
      (!top || top.contains(element)) &&
      !inactive
    )
      pills.set(element, keys.join(" / "));
  };
  for (const element of document.querySelectorAll<HTMLElement>(
    "[aria-keyshortcuts]",
  ))
    add(element, parse(element.getAttribute("aria-keyshortcuts")!));
  // BB labels the rows itself while its own hints show, and split panes take the numbers.
  const rows = [...document.querySelectorAll<HTMLElement>(ROW)].filter(
    (row) => !row.closest('[data-sidebar-overflow="true"]'),
  );
  if (rows.some((row) => row.hasAttribute("aria-keyshortcuts"))) return;
  if (document.querySelectorAll("[data-split-pane-id]").length > 1) return;
  rows
    .slice(0, 9)
    .forEach((row, i) => add(row, [binding(`thread.jump.${i + 1}`)]));
}

/** Marks the controls that get a pill; app.css draws it. */
function paint() {
  if (!running) return;
  const setup = composer();
  const items = numbered(setup).slice(0, 10);
  const tabs = items.length > 0 && !!setup?.open?.matches(MODEL);
  const pills = new Map(items.map((item, i) => [item, `${(i + 1) % 10}`]));
  if (!pills.size) hints(pills);
  const hosts = [...pills].map(([element, key]) => {
    const host =
      (element.matches(ROW) &&
        element.closest<HTMLElement>("[data-sidebar-rename-row]")) ||
      element;
    const { width, height } = host.getBoundingClientRect();
    const chevron = host.lastElementChild?.matches('svg[data-icon^="Chevron"]');
    const mode = tabs
      ? "tab"
      : chevron
        ? "chevron"
        : width <= 44 && height <= 44
          ? "icon"
          : "end";
    // A pill laid over its control needs a positioned host.
    const anchor =
      host.hasAttribute(ANCHOR) || getComputedStyle(host).position === "static";
    host.setAttribute(KEY, key);
    host.setAttribute(MODE, mode);
    host.toggleAttribute(ANCHOR, anchor && (mode === "icon" || mode === "end"));
    return host;
  });
  for (const element of tagged) if (!hosts.includes(element)) clear(element);
  tagged = hosts;
}

function clear(element: Element) {
  for (const name of [KEY, MODE, ANCHOR]) element.removeAttribute(name);
}

function schedule() {
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    paint();
  });
}

function keydown(event: KeyboardEvent) {
  // Skip our own search shortcut.
  if (!event.isTrusted) return;
  mods = event;
  if (!event.isComposing && !event.defaultPrevented && handle(event)) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  paint();
}

function handle(event: KeyboardEvent): boolean {
  const { key } = event;
  if (key === "/") {
    const plain =
      !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat;
    const allowed = settings.slashSearch !== false && !editable(event.target);
    return plain && allowed && !panels().length && search();
  }
  if (key !== "Escape" && !/^[0-9]$/.test(key)) return false;
  const setup = composer();
  const items = numbered(setup);
  if (key === "Escape") {
    // Hide the numbers so the prompt can start with a digit.
    if (!items.length || setup?.open) return false;
    dismissed = document.activeElement ?? document.body;
    return true;
  }
  const target = items[(Number(key) + 9) % 10];
  if (target && !event.repeat) {
    target.click();
    // A provider is the whole model choice, so close its picker.
    if (setup?.open?.matches(MODEL)) setup.open.click();
  }
  return !!target;
}

/** Presses BB's Search threads shortcut, or picks it in the command palette. */
function search() {
  const direct = binding("thread.search");
  const chord = direct ?? binding("palette.open");
  if (!chord) return false;
  const code =
    chord.key.length > 1 ? chord.key : `Key${chord.key.toUpperCase()}`;
  const init = { ...chord, code, bubbles: true, cancelable: true };
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", init));
  const until = Date.now() + 1000;
  const pick = () => {
    const entry = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-palette-action-kind="drill-in"]',
      ),
    ].find((item) => item.textContent?.startsWith("Search threads"));
    if (entry) entry.click();
    else if (running && Date.now() < until) requestAnimationFrame(pick);
  };
  if (!direct) pick();
  return true;
}

function release(event: Event) {
  mods = event instanceof KeyboardEvent ? event : NONE;
  paint();
}

function focusin(event: FocusEvent) {
  // Closed menus return focus to their control, but typing continues in the prompt.
  const setup = composer();
  const control = setup?.controls.includes(event.target as HTMLElement);
  if (control && !event.relatedTarget && !setup?.open) setup?.prompt?.focus();
  schedule();
}

export function start({ signal }: { signal: AbortSignal }) {
  // Phones and tablets have no keys to show or press.
  if (matchMedia("(pointer: coarse)").matches) return;
  const options = { capture: true, signal };
  window.addEventListener("keydown", keydown, options);
  window.addEventListener("keyup", release, options);
  // Not captured, since every element blur would release the modifiers.
  window.addEventListener("blur", release, { signal });
  document.addEventListener("focusin", focusin, options);
  document.addEventListener("focusout", schedule, options);
  document.addEventListener("input", schedule, options);
  const observer = new MutationObserver(schedule);
  const attributeFilter = ["aria-expanded", "aria-keyshortcuts", "data-state"];
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributeFilter,
  });
  running = true;
  paint();
  return () => {
    running = false;
    observer.disconnect();
    cancelAnimationFrame(frame);
    frame = 0;
    tagged.forEach(clear);
    tagged = [];
    mods = NONE;
    dismissed = null;
  };
}
