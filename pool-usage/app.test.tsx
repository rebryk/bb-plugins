// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import {
  loadPluginApp,
  renderSlot,
  type RenderedSlot,
} from "@get-bb/plugin-sdk/testing/app";
import type { UsageSnapshot } from "./server";

const NOW = Date.UTC(2026, 8, 25, 12);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const snapshot: UsageSnapshot = {
  providers: [
    { id: "codex", switchThreshold: 0.98 },
    { id: "claude-code", switchThreshold: 0.98 },
  ],
  accounts: [
    {
      id: "claude-max",
      provider: "claude-code",
      weight: 20,
      disabled: false,
      offline: null,
      heldUntil: null,
      blocked: false,
      windows: [
        {
          minutes: 300,
          utilization: 0.64,
          resetAt: NOW + 85 * MINUTE,
          rejected: false,
        },
        {
          minutes: 10_080,
          utilization: 0.72,
          resetAt: NOW + 3 * DAY,
          rejected: false,
        },
      ],
    },
    {
      id: "claude-pro",
      provider: "claude-code",
      weight: 1,
      disabled: false,
      offline: "login error",
      heldUntil: null,
      blocked: false,
      windows: [],
    },
    {
      id: "codex-pro",
      provider: "codex",
      weight: 20,
      disabled: false,
      offline: null,
      heldUntil: null,
      blocked: false,
      windows: [
        {
          minutes: 10_080,
          utilization: 0.9,
          resetAt: NOW + 2 * DAY,
          rejected: false,
        },
      ],
    },
  ],
};

const empty: UsageSnapshot = { providers: [], accounts: [] };

/** bb's provider picker order: Claude before Codex. */
const providers = {
  status: "ready" as const,
  providers: [
    { id: "claude-code", displayName: "Claude Code" },
    { id: "codex", displayName: "Codex" },
  ] as never,
};

const rendered: RenderedSlot[] = [];

const pause = (ms: number) =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

async function loadApp() {
  const app = await loadPluginApp(() => import("./app"));
  const disclosure = app.experimentalSidebarFooterItems[0];
  const overlay = app.appOverlays[0];
  if (disclosure?.kind !== "disclosure" || overlay === undefined) {
    throw new Error("Pool Usage registered no disclosure or overlay");
  }
  return { app, disclosure, overlay };
}

async function renderDisclosure(
  usage: () => UsageSnapshot | Promise<UsageSnapshot>,
  settings?: Record<string, number>,
) {
  const { disclosure } = await loadApp();
  const slot = renderSlot(
    disclosure,
    { dismiss: () => undefined },
    { rpc: { usage_get: usage }, settings, providers },
  );
  rendered.push(slot);
  return slot;
}

async function renderOverlay(
  usage: () => UsageSnapshot | Promise<UsageSnapshot>,
) {
  const { disclosure, overlay } = await loadApp();
  const slot = renderSlot(
    overlay,
    {},
    { rpc: { usage_get: usage }, providers },
  );
  rendered.push(slot);
  return { slot, disclosure };
}

/** bb's footer row: the plugin's own icon, a spacer, then the update badges. */
function renderFooter() {
  const row = document.createElement("ul");
  row.dataset.sidebar = "menu";
  const icon = document.createElement("li");
  icon.dataset.footerItem = "";
  const button = document.createElement("button");
  button.dataset.testid = "plugin-sidebar-footer-item-pool-usage-pool-usage";
  button.setAttribute("aria-label", "Account usage");
  icon.append(button);
  const spacer = document.createElement("li");
  spacer.setAttribute("aria-hidden", "true");
  spacer.className = "min-w-0 flex-1";
  const badges = document.createElement("li");
  row.append(icon, spacer, badges);
  document.body.append(row);
  return { row, icon, spacer, badges };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  for (const slot of rendered.splice(0)) slot.lifecycle.unmount();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("registration", () => {
  it("registers the footer disclosure and the footer summary", async () => {
    const { app, disclosure, overlay } = await loadApp();

    expect(app.experimentalSidebarFooterItems).toHaveLength(1);
    expect(disclosure).toMatchObject({
      id: "pool-usage",
      label: "Account usage",
    });
    expect(app.appOverlays).toHaveLength(1);
    expect(overlay.id).toBe("footer-summary");
  });
});

describe("usage panel", () => {
  it("shows each provider's total and what it drops to at each reset", async () => {
    const slot = await renderDisclosure(() => snapshot);

    const claude = await slot.findByRole("region", { name: "Claude usage" });
    const codex = slot.getByRole("region", { name: "Codex usage" });
    expect(claude.compareDocumentPosition(codex)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(within(claude).getByRole("banner").textContent).toBe("Claude2x66%");
    expect(within(claude).getByText("66%").className).toBe("");
    const resets = within(claude).getByRole("list", {
      name: "Upcoming resets",
    });
    expect(
      within(resets)
        .getAllByRole("listitem")
        .map((step) => step.textContent),
    ).toEqual(["1h 25m5%"]);

    expect(codex.textContent).toBe("Codex90%2d0%");
    expect(within(codex).getByText("90%").className).toBe("pool-usage-hot");
  });

  it("lists at most four resets", async () => {
    const accounts = [1, 2, 3, 4, 5].map((hours) => ({
      ...snapshot.accounts[0]!,
      id: `claude-${hours}`,
      windows: [
        {
          minutes: 300,
          utilization: 0.9,
          resetAt: NOW + hours * 60 * MINUTE,
          rejected: false,
        },
      ],
    }));
    const slot = await renderDisclosure(() => ({ ...snapshot, accounts }));

    const claude = await slot.findByRole("region", { name: "Claude usage" });
    expect(
      within(claude)
        .getAllByRole("listitem")
        .map((step) => step.textContent),
    ).toEqual(["1h72%", "2h54%", "3h36%", "4h18%"]);
  });

  it("turns usage red at the configured threshold", async () => {
    const slot = await renderDisclosure(() => snapshot, { redThreshold: 60 });

    const claude = await slot.findByRole("region", { name: "Claude usage" });
    expect(within(claude).getByText("66%").className).toBe("pool-usage-hot");
    expect(within(claude).getByText("5%").className).toBe("");
  });

  it("announces loading", async () => {
    const slot = await renderDisclosure(() => new Promise(() => undefined));

    expect(slot.getByRole("status").textContent).toBe("Loading account usage…");
  });

  it("says when usage can't be loaded", async () => {
    const slot = await renderDisclosure(() => {
      throw new Error("offline");
    });

    expect(
      (await slot.findByText("Usage could not be loaded.")).getAttribute(
        "role",
      ),
    ).toBe("status");
  });

  it("says when there is no usage to show", async () => {
    const slot = await renderDisclosure(() => empty);

    expect(await slot.findByText(/^No usage to show\./u)).toBeTruthy();
  });
});

describe("footer summary", () => {
  it("stands in for the footer icon between the spacer and bb's badges", async () => {
    const { row, icon, spacer, badges } = renderFooter();
    const { slot, disclosure } = await renderOverlay(() => snapshot);

    const claude = await slot.findByRole("button", {
      name: "Claude: 66% used",
    });
    const codex = slot.getByRole("button", { name: "Codex: 90% used" });
    const summary = spacer.nextElementSibling;
    expect(summary?.className).toBe("pool-usage-footer");
    expect(summary?.nextElementSibling).toBe(badges);
    expect(summary?.contains(claude) && summary.contains(codex)).toBe(true);
    expect(icon.hasAttribute("data-pool-usage-anchor")).toBe(true);
    expect(within(codex).getByText("90%").className).toBe("pool-usage-hot");
    expect(within(claude).getByText("66%").className).toBe("");
    expect(disclosure.runtime.getSnapshot().command).toBeNull();

    slot.lifecycle.unmount();
    expect(row.querySelector(".pool-usage-footer")).toBeNull();
    expect(icon.hasAttribute("data-pool-usage-anchor")).toBe(false);
  });

  it("moves back behind the spacer when bb replaces it", async () => {
    const { row, spacer, badges } = renderFooter();
    const { slot } = await renderOverlay(() => snapshot);
    await slot.findByRole("button", { name: "Claude: 66% used" });

    const replacement = spacer.cloneNode() as HTMLElement;
    spacer.remove();
    row.insertBefore(replacement, badges);

    await waitFor(() =>
      expect(replacement.nextElementSibling?.className).toBe(
        "pool-usage-footer",
      ),
    );
  });

  it("goes last in a row without a spacer", async () => {
    const { row, spacer } = renderFooter();
    spacer.remove();
    const { slot } = await renderOverlay(() => snapshot);

    await slot.findByRole("button", { name: "Claude: 66% used" });
    expect(row.lastElementChild?.className).toBe("pool-usage-footer");
  });

  it("opens one provider's card on click until Escape or a press outside", async () => {
    renderFooter();
    const { slot } = await renderOverlay(() => snapshot);
    const codex = await slot.findByRole("button", { name: "Codex: 90% used" });

    fireEvent.click(codex);
    const card = slot.getByRole("dialog", { name: "Codex usage" });
    expect(codex.getAttribute("aria-expanded")).toBe("true");
    expect(within(card).queryByText("Claude")).toBeNull();
    expect(
      within(card).getByRole("list", { name: "Upcoming resets" }),
    ).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(slot.queryByRole("dialog")).toBeNull();

    fireEvent.click(codex);
    fireEvent.pointerDown(document.body);
    expect(slot.queryByRole("dialog")).toBeNull();

    fireEvent.click(codex);
    fireEvent.click(slot.getByRole("button", { name: "Claude: 66% used" }));
    expect(slot.getByRole("dialog").getAttribute("aria-label")).toBe(
      "Claude usage",
    );
    fireEvent.click(slot.getByRole("button", { name: "Claude: 66% used" }));
    expect(slot.queryByRole("dialog")).toBeNull();
  });

  it("keeps the footer icon when usage can't be summarized", async () => {
    const { row, icon } = renderFooter();
    const { slot } = await renderOverlay(() => empty);

    await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(1));
    await pause(50);
    expect(row.querySelector(".pool-usage-footer")).toBeNull();
    expect(icon.hasAttribute("data-pool-usage-anchor")).toBe(false);
  });

  it("attaches once the footer icon appears", async () => {
    const { slot } = await renderOverlay(() => snapshot);
    await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(1));
    await pause(50);
    expect(slot.queryByRole("button", { name: /used$/u })).toBeNull();

    const { spacer } = renderFooter();

    await slot.findByRole("button", { name: "Claude: 66% used" });
    expect(spacer.nextElementSibling?.className).toBe("pool-usage-footer");
  });
});
