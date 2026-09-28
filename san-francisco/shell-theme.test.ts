// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COLLAPSED_ATTRIBUTE, SHELL_ATTRIBUTE, SIDEBAR_ATTRIBUTE } from "./shell-state";
import { watchShellTheme } from "./shell-theme";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const css = read("./themes/san-francisco.css");
const mutations = () => new Promise((resolve) => setTimeout(resolve, 0));
const disposers: (() => void)[] = [];
const start = (signal?: AbortSignal) => {
  const dispose = watchShellTheme(document, signal);
  disposers.push(dispose);
  return dispose;
};

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

function theme(text = css, id = "bb-app-theme") {
  const style = document.createElement("style");
  style.id = id;
  style.textContent = text;
  document.head.append(style);
  return style;
}

function shell() {
  const root = document.createElement("div");
  root.dataset.testid = "app-layout-root";
  root.innerHTML = `
    <aside data-sidebar="sidebar"><div data-testid="app-sidebar-top-reserve-row"></div></aside>
    <main data-sidebar="inset"><div data-thread-window></div></main>
    <div data-testid="app-sidebar-trigger-overlay"><button data-sidebar="trigger" aria-expanded="false"></button></div>`;
  document.body.append(root);
  return { root, sidebar: root.querySelector("aside")!, overlay: root.lastElementChild! };
}

function rules(list: CSSRuleList): CSSStyleRule[] {
  return [...list].flatMap((rule) => [
    ...(rule.type === 1 ? [rule as CSSStyleRule] : []),
    ...("cssRules" in rule ? rules((rule as CSSGroupingRule).cssRules) : []),
  ]);
}

const selectors = (style: HTMLStyleElement) => rules(style.sheet!.cssRules).map((rule) => rule.selectorText);
const changed = (before: string[], after: string[]) => after.filter((selector, index) => selector !== before[index]);

describe("watchShellTheme", () => {
  it("only observes the shell on desktop and removes its breakpoint listener on disposal", () => {
    let wide = false;
    const events = new EventTarget();
    const query = {
      get matches() { return wide; },
      addEventListener: vi.fn(events.addEventListener.bind(events)),
      removeEventListener: vi.fn(events.removeEventListener.bind(events)),
    };
    const matchMedia = vi.fn(() => query);
    vi.stubGlobal("matchMedia", matchMedia);
    const { root, sidebar, overlay } = shell();
    const style = theme();
    const original = selectors(style);
    const dispose = start();
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 768px)");
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
    expect(selectors(style)).toEqual(original);

    wide = true;
    events.dispatchEvent(new Event("change"));
    expect(root.getAttribute(SHELL_ATTRIBUTE)).toBe("toggle compact");
    expect(changed(original, selectors(style))).toHaveLength(9);

    wide = false;
    events.dispatchEvent(new Event("change"));
    expect(selectors(style)).toEqual(original);
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
    expect(sidebar.hasAttribute(SIDEBAR_ATTRIBUTE)).toBe(false);
    expect(overlay.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(false);

    dispose();
    expect(query.removeEventListener).toHaveBeenCalledWith("change", query.addEventListener.mock.calls[0]![1]);
    wide = true;
    events.dispatchEvent(new Event("change"));
    expect(selectors(style)).toEqual(original);
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
  });

  it("marks before changing exactly nine shipped selectors, preserving source and declarations", () => {
    const { root, sidebar, overlay } = shell();
    const style = theme();
    const other = theme(css, "another-plugin-theme");
    const before = selectors(style);
    const originals = rules(style.sheet!.cssRules);
    const declarations = originals.map((rule) => rule.style.cssText);
    const structural = originals.filter((rule) =>
      rule.selectorText.startsWith('[data-testid="app-layout-root"]:has(')
      || rule.selectorText.startsWith('[data-testid="app-sidebar-trigger-overlay"]:has('));
    expect(structural).toHaveLength(9);
    for (const rule of structural) {
      let value = rule.selectorText;
      Object.defineProperty(rule, "selectorText", {
        configurable: true,
        get: () => value,
        set: (next: string) => {
          expect(root.getAttribute(SHELL_ATTRIBUTE)).toBe("toggle compact");
          expect(sidebar.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("app");
          expect(overlay.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(true);
          value = next;
        },
      });
    }

    const dispose = start();
    const replacements = changed(before, selectors(style));
    expect(replacements).toHaveLength(9);
    expect(replacements.every((selector) => selector.includes("data-sf-"))).toBe(true);
    expect(originals.map((rule) => rule.style.cssText)).toEqual(declarations);
    expect(style.textContent).toBe(css);
    expect(selectors(other)).toEqual(before);

    // The same setter assertions ensure fallback selectors return before the
    // markers disappear, including cleanup while this palette remains active.
    dispose();
    expect(selectors(style)).toEqual(before);
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
    expect(sidebar.hasAttribute(SIDEBAR_ATTRIBUTE)).toBe(false);
    expect(overlay.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(false);
  });

  it("ignores unrelated head changes and never reads computed style or geometry", async () => {
    const { root } = shell();
    const style = theme();
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => { throw new Error("style read"); });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => { throw new Error("geometry read"); });
    start();
    const before = selectors(style);
    const findTheme = vi.spyOn(document, "getElementById");
    const scanDocument = vi.spyOn(document, "querySelectorAll");
    document.title = "Thread is running";
    theme("button { color: red; }", "another-plugin");
    root.querySelector("[data-thread-window]")!.append(document.createElement("p"));
    await mutations();
    document.title = "Thread finished";
    await mutations();

    expect(findTheme).not.toHaveBeenCalled();
    expect(scanDocument).not.toHaveBeenCalled();
    expect(selectors(style)).toEqual(before);
  });

  it("handles theme text replacement with fresh rule objects and releases the old rules", async () => {
    shell();
    const style = theme();
    const oldRules = rules(style.sheet!.cssRules);
    const original = selectors(style);
    start();
    const replacement = css + "\n:root { --sf-accent-light: purple; }";
    style.textContent = replacement;
    await mutations();

    expect(oldRules.map((rule) => rule.selectorText)).toEqual(original);
    expect(changed(original, selectors(style).slice(0, original.length))).toHaveLength(9);
    expect(style.textContent).toBe(replacement);
  });

  it("clears markers when previewing another theme and marks a replaced shell before reactivation", async () => {
    const first = shell();
    const style = theme();
    const oldRules = rules(style.sheet!.cssRules);
    const original = selectors(style);
    start();
    style.textContent = ":root { --background: white; }";
    await mutations();
    expect(oldRules.map((rule) => rule.selectorText)).toEqual(original);
    expect(first.root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
    expect(first.sidebar.hasAttribute(SIDEBAR_ATTRIBUTE)).toBe(false);

    first.root.remove();
    const second = shell();
    style.textContent = css;
    await mutations();
    expect(second.root.getAttribute(SHELL_ATTRIBUTE)).toBe("toggle compact");
    expect(second.overlay.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(true);
    expect(changed(original, selectors(style))).toHaveLength(9);
  });

  it("waits for its own theme, follows style element replacement, and restores removed sheets", async () => {
    const { root } = shell();
    start();
    theme(css, "another-plugin-theme");
    await mutations();
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);

    const first = theme();
    const oldRules = rules(first.sheet!.cssRules);
    const original = selectors(first);
    await mutations();
    expect(changed(original, selectors(first))).toHaveLength(9);
    const next = document.createElement("style");
    next.id = "bb-app-theme";
    next.textContent = css;
    first.replaceWith(next);
    await mutations();
    expect(oldRules.map((rule) => rule.selectorText)).toEqual(original);
    expect(changed(original, selectors(next))).toHaveLength(9);

    next.remove();
    await mutations();
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
    document.head.append(next);
    await mutations();
    expect(changed(original, selectors(next))).toHaveLength(9);
  });

  it("does not treat a different palette containing one similarly named token as San Francisco", () => {
    const { root } = shell();
    const style = theme(':root { --sf-accent-light: red; } [data-testid="app-layout-root"]:has(> div) { color: red; }');
    const original = selectors(style);
    start();
    expect(selectors(style)).toEqual(original);
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
  });

  it("restores on disable or id changes and resumes when its theme becomes available again", async () => {
    const { root } = shell();
    const style = theme();
    const original = selectors(style);
    start();
    style.setAttribute("disabled", "");
    await mutations();
    expect(selectors(style)).toEqual(original);
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
    style.removeAttribute("disabled");
    await mutations();
    expect(changed(original, selectors(style))).toHaveLength(9);

    style.id = "former-theme";
    await mutations();
    expect(selectors(style)).toEqual(original);
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
    style.id = "bb-app-theme";
    await mutations();
    expect(changed(original, selectors(style))).toHaveLength(9);
  });

  it("respects an already aborted signal and restores synchronously on abort or repeated disposal", async () => {
    const { root } = shell();
    const style = theme();
    const original = selectors(style);
    const controller = new AbortController();
    controller.abort();
    start(controller.signal);
    expect(selectors(style)).toEqual(original);
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);

    const running = new AbortController();
    const dispose = start(running.signal);
    expect(changed(original, selectors(style))).toHaveLength(9);
    running.abort();
    expect(selectors(style)).toEqual(original);
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
    dispose();
    style.textContent = css;
    await mutations();
    expect(selectors(style)).toEqual(original);
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);

    start();
    expect(changed(original, selectors(style))).toHaveLength(9);
  });

  it("does not overwrite a later owner's selector or declaration changes during cleanup", () => {
    shell();
    const style = theme();
    const dispose = start();
    const rule = rules(style.sheet!.cssRules).find((entry) => entry.selectorText.includes("data-sf-shell"))!;
    rule.selectorText = ".later-owner";
    rule.style.setProperty("padding-left", "99px");
    dispose();
    expect(rule.selectorText).toBe(".later-owner");
    expect(rule.style.getPropertyValue("padding-left")).toBe("99px");
  });
});
