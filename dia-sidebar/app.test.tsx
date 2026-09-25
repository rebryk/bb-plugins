// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { mountNavigationLabels } from "./navigation-labels";

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
    disposers.push(mountNavigationLabels(document));

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
    const dispose = mountNavigationLabels(document);
    disposers.push(dispose);
    const { metrics } = fixture();
    await vi.waitFor(() => expect(metrics.title).toBe("Metrics"));
    metrics.querySelector(".truncate")!.textContent = "Metrics updated";
    await vi.waitFor(() => expect(metrics.title).toBe("Metrics updated"));
    metrics.parentElement!.remove();
    await vi.waitFor(() => expect(metrics.hasAttribute("title")).toBe(false));
  });

  it("leaves the customization editor alone and resumes when it closes", async () => {
    const { navigation, metrics } = fixture();
    disposers.push(mountNavigationLabels(document));
    navigation.setAttribute("data-sidebar-navigation-customize-mode", "true");
    await vi.waitFor(() => expect(metrics.hasAttribute("title")).toBe(false));
    navigation.removeAttribute("data-sidebar-navigation-customize-mode");
    await vi.waitFor(() => expect(metrics.title).toBe("Metrics"));
  });

  it("restores only its own changes and stops observing after disposal", async () => {
    const { newThread, metrics } = fixture();
    newThread.title = "Host tooltip";
    const dispose = mountNavigationLabels(document);
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
    const dispose = mountNavigationLabels(document);
    metrics.title = "Live status from another plugin";
    dispose();
    expect(metrics.title).toBe("Live status from another plugin");
  });
});
