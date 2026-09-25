// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { enhanceNavigation } from "./navigation";

// Layout is exercised in Chrome; jsdom has no ResizeObserver.
vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

function enhance() {
  return enhanceNavigation(document.querySelector<HTMLElement>("[data-dia-sidebar]")!);
}

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  cleanup();
  document.body.replaceChildren();
});

function fixture() {
  document.body.innerHTML = `
    <div data-dia-sidebar>
      <div data-testid="plugin-nav-sidebar-items">
        <div data-sidebar-navigation-item="__bb__/new-thread">
          <button aria-label="New thread (⌘N)" aria-keyshortcuts="Meta+N">
            <svg aria-hidden="true"></svg><span><span class="truncate">New thread</span></span>
          </button>
        </div>
        <div data-sidebar-navigation-item="metrics/panel">
          <button aria-current="page"><svg aria-hidden="true"></svg><span><span class="truncate">Metrics</span></span></button>
          <span data-plugin-nav-sidebar-accessory><span role="status">Running</span></span>
          <div data-sidebar-hover-actions-mobile="always"><button aria-label="Metrics panel options">…</button></div>
        </div>
      </div>
    </div>
    <div data-sidebar-navigation-item="outside"><button><span class="truncate">Outside</span></button></div>`;
  const navigation = document.querySelector<HTMLElement>(
    '[data-testid="plugin-nav-sidebar-items"]',
  )!;
  const [newThread, metrics] = navigation.querySelectorAll<HTMLButtonElement>(
    "[data-sidebar-navigation-item] > button",
  );
  return { navigation, newThread: newThread!, metrics: metrics! };
}

describe("native navigation delegation", () => {
  it("keeps the original controls and accessory alive inside the replacement", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const activate = vi.fn();
    const slot = renderSlot(
      app.experimentalSidebarNavigations[0]!,
      {
        items: [],
        activeItemId: null,
        isCompactViewport: false,
        experimental_activate: vi.fn(),
        experimental_Original: () => (
          <div>
            <button onClick={activate}>Original destination</button>
            <span role="status">Live accessory</span>
          </div>
        ),
      },
    );
    disposers.push(() => slot.lifecycle.unmount());
    fireEvent.click(slot.getByRole("button", { name: "Original destination" }));
    expect(activate).toHaveBeenCalledOnce();
    expect(slot.getByRole("status").textContent).toBe("Live accessory");
  });
});

describe("icon labels", () => {
  it("preserves native activation, accessible names, shortcuts and live indicators", () => {
    const { newThread, metrics } = fixture();
    const activate = vi.fn();
    const menu = vi.fn();
    metrics.addEventListener("click", activate);
    metrics.parentElement!.addEventListener("contextmenu", menu);
    const accessory = document.querySelector("[data-plugin-nav-sidebar-accessory]");
    disposers.push(enhance());

    fireEvent.click(metrics, { metaKey: true });
    fireEvent.contextMenu(metrics);
    expect(activate).toHaveBeenCalledOnce();
    expect(menu).toHaveBeenCalledOnce();
    expect(newThread.title).toBe("New thread (⌘N)");
    expect(newThread.getAttribute("aria-keyshortcuts")).toBe("Meta+N");
    expect(metrics.title).toBe("Metrics");
    expect(metrics.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector("[data-plugin-nav-sidebar-accessory]")).toBe(accessory);
    expect(document.querySelector('[aria-label="Metrics panel options"]')!.hasAttribute("title")).toBe(false);
    expect(document.querySelector('[data-sidebar-navigation-item="outside"] button')!.hasAttribute("title")).toBe(false);
  });

  it("handles late mounts, renamed panels and removal without retaining titles", async () => {
    const { navigation, metrics } = fixture();
    const row = metrics.parentElement!;
    row.remove();
    disposers.push(enhance());
    navigation.append(row);
    await vi.waitFor(() => expect(metrics.title).toBe("Metrics"));
    metrics.querySelector(".truncate")!.textContent = "Metrics updated";
    await vi.waitFor(() => expect(metrics.title).toBe("Metrics updated"));
    metrics.parentElement!.remove();
    await vi.waitFor(() => expect(metrics.hasAttribute("title")).toBe(false));
  });

  it("leaves the customization editor alone and resumes when it closes", async () => {
    const { navigation, metrics } = fixture();
    disposers.push(enhance());
    navigation.setAttribute("data-sidebar-navigation-customize-mode", "true");
    await vi.waitFor(() => expect(metrics.hasAttribute("title")).toBe(false));
    navigation.removeAttribute("data-sidebar-navigation-customize-mode");
    await vi.waitFor(() => expect(metrics.title).toBe("Metrics"));
  });

  it("restores only its own changes and stops observing after disposal", async () => {
    const { newThread, metrics } = fixture();
    newThread.title = "Host tooltip";
    const dispose = enhance();
    metrics.querySelector(".truncate")!.textContent = "Renamed";
    await vi.waitFor(() => expect(metrics.title).toBe("Renamed"));
    dispose();
    expect(newThread.title).toBe("Host tooltip");
    expect(metrics.hasAttribute("title")).toBe(false);
    metrics.querySelector(".truncate")!.textContent = "After disposal";
    await Promise.resolve();
    expect(metrics.hasAttribute("title")).toBe(false);
  });

  it("does not overwrite a title another owner supplies while mounted", () => {
    const { metrics } = fixture();
    const dispose = enhance();
    metrics.title = "Live status from another plugin";
    dispose();
    expect(metrics.title).toBe("Live status from another plugin");
  });
});

describe("native menus and sorting", () => {
  it("opens each native menu with Shift+F10 or the Context Menu key", () => {
    const { newThread, metrics } = fixture();
    const menu = vi.fn();
    for (const button of [newThread, metrics]) {
      button.parentElement!.addEventListener("contextmenu", menu);
    }
    disposers.push(enhance());
    fireEvent.keyDown(newThread, { key: "F10", shiftKey: true });
    fireEvent.keyDown(metrics, { key: "ContextMenu" });
    fireEvent.keyDown(metrics, { key: "F10" });
    fireEvent.keyDown(metrics, { key: "Enter" });
    expect(menu).toHaveBeenCalledTimes(2);
    expect(menu.mock.calls.map(([event]) => event.target)).toEqual([newThread, metrics]);
  });

  it("blocks list sorting in the grid but preserves split gestures, clicks and Customize", () => {
    const { navigation, metrics } = fixture();
    const sort = vi.fn();
    const split = vi.fn();
    const select = vi.fn();
    metrics.addEventListener("mousedown", sort);
    metrics.addEventListener("touchstart", sort);
    metrics.addEventListener("pointerdown", split);
    metrics.addEventListener("click", select);
    const dispose = enhance();
    fireEvent.mouseDown(metrics);
    fireEvent.touchStart(metrics);
    fireEvent.pointerDown(metrics);
    fireEvent.click(metrics);
    expect(sort).not.toHaveBeenCalled();
    expect(split).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledOnce();

    navigation.setAttribute("data-sidebar-navigation-customize-mode", "true");
    fireEvent.mouseDown(metrics);
    fireEvent.touchStart(metrics);
    expect(sort).toHaveBeenCalledTimes(2);
    navigation.removeAttribute("data-sidebar-navigation-customize-mode");
    dispose();
    fireEvent.mouseDown(metrics);
    expect(sort).toHaveBeenCalledTimes(3);
    const menu = vi.fn();
    metrics.addEventListener("contextmenu", menu);
    fireEvent.keyDown(metrics, { key: "ContextMenu" });
    expect(menu).not.toHaveBeenCalled();
  });
});
