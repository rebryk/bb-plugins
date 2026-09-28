// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLLAPSED_ATTRIBUTE,
  SHELL_ATTRIBUTE,
  SIDEBAR_ATTRIBUTE,
  watchShellState,
} from "./shell-state";

const disposers: (() => void)[] = [];
const mutations = () => new Promise((resolve) => setTimeout(resolve, 0));
const start = (signal?: AbortSignal) => {
  const dispose = watchShellState(document, signal);
  disposers.push(dispose);
  return dispose;
};

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function shell() {
  const root = document.createElement("div");
  root.dataset.testid = "app-layout-root";
  root.innerHTML = `
    <aside data-sidebar="sidebar"><div data-testid="app-sidebar-top-reserve-row"></div></aside>
    <main><div data-thread-window></div></main>
    <div data-testid="app-sidebar-trigger-overlay"><button data-sidebar="trigger" aria-expanded="true"></button></div>`;
  document.body.append(root);
  return {
    root,
    sidebar: root.querySelector("aside")!,
    reserve: root.querySelector("aside > div")!,
    content: root.querySelector("[data-thread-window]")!,
    overlay: root.lastElementChild!,
    trigger: root.querySelector("button")!,
  };
}

function desktop(root: Element, trafficLights = false) {
  const trigger = document.createElement("div");
  trigger.dataset.testid = "app-desktop-sidebar-trigger";
  trigger.className = trafficLights ? "fixed left-[84px]" : "fixed left-0";
  root.append(trigger);
  return trigger;
}

function home() {
  const sentinel = document.createElement("div");
  sentinel.dataset.testid = "root-compose-main-window-drag-strip";
  return sentinel;
}

describe("watchShellState", () => {
  it("marks the existing shell synchronously, preserving simultaneous states", () => {
    const { root, sidebar, overlay, trigger, content } = shell();
    desktop(root, true);
    content.append(home());
    trigger.setAttribute("aria-expanded", "false");
    start();

    expect(root.getAttribute(SHELL_ATTRIBUTE)).toBe("toggle compact window home");
    expect(sidebar.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("app");
    expect(overlay.getAttribute(COLLAPSED_ATTRIBUTE)).toBe("");
  });

  it("follows desktop traffic lights, direct trigger removal and aria changes", async () => {
    const { root, overlay, trigger } = shell();
    const mac = desktop(root, true);
    start();
    trigger.setAttribute("aria-expanded", "false");
    await mutations();
    expect(overlay.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(true);

    overlay.remove();
    await mutations();
    expect(root.getAttribute(SHELL_ATTRIBUTE)).toBe("toggle window");
    expect(overlay.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(false);

    mac.className = "fixed left-0";
    await mutations();
    expect(root.getAttribute(SHELL_ATTRIBUTE)).toBe("toggle compact");

    mac.remove();
    await mutations();
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
  });

  it("ignores nested triggers and reserve rows and follows direct replacements", async () => {
    const { root, sidebar, reserve, overlay, trigger, content } = shell();
    content.append(overlay);
    const wrapper = document.createElement("div");
    sidebar.append(wrapper);
    wrapper.append(reserve);
    start();
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
    expect(sidebar.hasAttribute(SIDEBAR_ATTRIBUTE)).toBe(false);

    root.append(overlay);
    sidebar.append(reserve);
    reserve.setAttribute("data-testid", "settings-sidebar-top-reserve-row");
    await mutations();
    expect(root.getAttribute(SHELL_ATTRIBUTE)).toBe("toggle compact");
    expect(sidebar.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("settings");

    const nested = document.createElement("span");
    overlay.append(nested);
    nested.append(trigger);
    trigger.setAttribute("aria-expanded", "false");
    await mutations();
    expect(overlay.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(false);

    const replacement = document.createElement("button");
    replacement.dataset.sidebar = "trigger";
    replacement.setAttribute("aria-expanded", "false");
    overlay.append(replacement);
    await mutations();
    expect(overlay.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(true);
    replacement.setAttribute("aria-expanded", "true");
    await mutations();
    expect(overlay.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(false);
  });

  it("tracks home sentinels added, moved between roots, renamed and removed", async () => {
    const first = shell();
    const second = shell();
    const sentinel = home();
    start();
    first.content.append(sentinel);
    await mutations();
    expect(first.root.getAttribute(SHELL_ATTRIBUTE)).toContain("home");

    second.content.append(sentinel);
    await mutations();
    expect(first.root.getAttribute(SHELL_ATTRIBUTE)).toBe("toggle compact");
    expect(second.root.getAttribute(SHELL_ATTRIBUTE)).toContain("home");

    sentinel.dataset.testid = "different";
    await mutations();
    expect(second.root.getAttribute(SHELL_ATTRIBUTE)).toBe("toggle compact");
    sentinel.dataset.testid = "root-compose-main-window-drag-strip";
    await mutations();
    expect(second.root.getAttribute(SHELL_ATTRIBUTE)).toContain("home");
    sentinel.remove();
    await mutations();
    expect(second.root.getAttribute(SHELL_ATTRIBUTE)).toBe("toggle compact");
  });

  it("keeps a moved overlay's state when its destination was dirtied first", async () => {
    const first = shell();
    const second = shell();
    first.trigger.setAttribute("aria-expanded", "false");
    start();
    second.root.append(document.createElement("div"));
    second.root.append(first.overlay);
    await mutations();
    expect(first.root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
    expect(first.overlay.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(true);
    first.trigger.setAttribute("aria-expanded", "true");
    await mutations();
    expect(first.overlay.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(false);
  });

  it("keeps Settings priority while both reserve rows coexist", async () => {
    const { sidebar } = shell();
    const settings = document.createElement("div");
    settings.dataset.testid = "settings-sidebar-top-reserve-row";
    sidebar.prepend(settings);
    start();
    expect(sidebar.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("settings");
    sidebar.append(settings);
    await mutations();
    expect(sidebar.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("settings");
    settings.remove();
    await mutations();
    expect(sidebar.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("app");
  });

  it("discovers late shells and sidebars and cleans detached references", async () => {
    start();
    const previous = shell();
    previous.trigger.setAttribute("aria-expanded", "false");
    await mutations();
    expect(previous.root.getAttribute(SHELL_ATTRIBUTE)).toBe("toggle compact");

    previous.root.remove();
    const current = shell();
    await mutations();
    expect(current.root.getAttribute(SHELL_ATTRIBUTE)).toBe("toggle compact");
    expect(previous.root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
    expect(previous.sidebar.hasAttribute(SIDEBAR_ATTRIBUTE)).toBe(false);
    expect(previous.overlay.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(false);

    const newSidebar = current.sidebar.cloneNode(true) as Element;
    newSidebar.removeAttribute(SIDEBAR_ATTRIBUTE);
    current.sidebar.replaceWith(newSidebar);
    await mutations();
    expect(newSidebar.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("app");
    expect(current.sidebar.hasAttribute(SIDEBAR_ATTRIBUTE)).toBe(false);

    previous.trigger.setAttribute("aria-expanded", "true");
    previous.trigger.setAttribute("aria-expanded", "false");
    await mutations();
    expect(previous.overlay.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(false);
  });

  it("follows identity attributes reused by the host", async () => {
    const { root, sidebar, reserve, overlay, trigger } = shell();
    start();
    reserve.setAttribute("data-testid", "settings-sidebar-top-reserve-row");
    trigger.dataset.sidebar = "other";
    trigger.setAttribute("aria-expanded", "false");
    await mutations();
    expect(sidebar.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("settings");
    expect(overlay.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(false);

    overlay.setAttribute("data-testid", "app-desktop-sidebar-trigger");
    overlay.className = "left-[84px]";
    await mutations();
    expect(root.getAttribute(SHELL_ATTRIBUTE)).toBe("toggle window");

    sidebar.setAttribute("data-sidebar", "other");
    root.dataset.testid = "other";
    await mutations();
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
    expect(sidebar.hasAttribute(SIDEBAR_ATTRIBUTE)).toBe(false);
  });

  it("does not scan the document or root, read layout, or rewrite markers during streaming", async () => {
    const { root, content } = shell();
    start();
    const documentQuery = vi.spyOn(document, "querySelectorAll");
    const rootQuery = vi.spyOn(root, "querySelectorAll");
    const styles = vi.spyOn(window, "getComputedStyle");
    const geometry = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const frames = vi.spyOn(window, "requestAnimationFrame");
    const rootWrites = vi.spyOn(root, "setAttribute");

    for (let index = 0; index < 20; index++) {
      const row = document.createElement("div");
      row.innerHTML = "<p><strong>Streamed</strong> text</p>";
      content.append(row);
    }
    await mutations();
    content.firstElementChild!.classList.add("updated");
    content.firstElementChild!.textContent = "Updated text";
    await mutations();

    expect(documentQuery).not.toHaveBeenCalled();
    expect(rootQuery).not.toHaveBeenCalled();
    expect(styles).not.toHaveBeenCalled();
    expect(geometry).not.toHaveBeenCalled();
    expect(frames).not.toHaveBeenCalled();
    expect(rootWrites).not.toHaveBeenCalled();
    expect(root.getAttribute(SHELL_ATTRIBUTE)).toBe("toggle compact");
  });

  it("cleans up on abort and makes manual disposal idempotent", async () => {
    const { root, sidebar, overlay, trigger } = shell();
    trigger.setAttribute("aria-expanded", "false");
    const controller = new AbortController();
    const dispose = start(controller.signal);
    controller.abort();
    dispose();
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
    expect(sidebar.hasAttribute(SIDEBAR_ATTRIBUTE)).toBe(false);
    expect(overlay.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(false);

    desktop(root, true);
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-expanded", "false");
    await mutations();
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
    expect(overlay.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(false);
  });

  it("does not start when its signal was already aborted", () => {
    const { root, sidebar } = shell();
    const controller = new AbortController();
    controller.abort();
    const query = vi.spyOn(document, "querySelectorAll");
    start(controller.signal);
    expect(query).not.toHaveBeenCalled();
    expect(root.hasAttribute(SHELL_ATTRIBUTE)).toBe(false);
    expect(sidebar.hasAttribute(SIDEBAR_ATTRIBUTE)).toBe(false);
  });
});
