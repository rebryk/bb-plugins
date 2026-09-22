// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  loadPluginApp,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { formatReset, usagePercent, usageTone } from "./presentation";

describe("compact usage presentation", () => {
  it("uses the requested color thresholds", () => {
    expect(usageTone(74)).toBe("neutral");
    expect(usageTone(75)).toBe("warning");
    expect(usageTone(89)).toBe("warning");
    expect(usageTone(90)).toBe("critical");
  });

  it("formats quota fractions and reset countdowns", () => {
    expect(usagePercent(0.816)).toBe(82);
    expect(formatReset(8_220_000, 0)).toBe("reset 2h 17m");
  });

  it("registers one footer disclosure and renders one row per account", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.experimentalSidebarFooterItems).toHaveLength(1);
    const item = app.experimentalSidebarFooterItems[0];
    if (item === undefined || item.kind !== "disclosure") {
      throw new Error("Expected the Pool Usage disclosure");
    }

    const slot = renderSlot(
      item,
      { dismiss: () => undefined },
      {
        rpc: {
          usage_get: () => ({
            accounts: [
              {
                id: "account-1",
                provider: "codex" as const,
                label: "Work",
                tier: "Max (20x)",
                enabled: true,
                status: "ready" as const,
                inFlight: 0,
                utilization: 0.81,
                resetAt: Date.now() + 60 * 60_000,
                windowLabel: "Weekly",
                blocked: false,
                observedAt: Date.now(),
                error: null,
              },
            ],
            fetchedAt: Date.now(),
            error: null,
          }),
        },
      },
    );

    await slot.findByText("Max (20x)");
    expect(slot.getByText("Weekly")).toBeTruthy();
    expect(slot.getAllByRole("progressbar")).toHaveLength(1);
    expect(slot.getByText("81%")).toBeTruthy();
    expect(slot.container.querySelectorAll("li")).toHaveLength(1);
    expect(slot.container.querySelector("[title]")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("marks a row whose binding window is spent", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const item = app.experimentalSidebarFooterItems[0];
    if (item === undefined || item.kind !== "disclosure") {
      throw new Error("Expected the Pool Usage disclosure");
    }

    const slot = renderSlot(
      item,
      { dismiss: () => undefined },
      {
        rpc: {
          usage_get: () => ({
            accounts: [
              {
                id: "account-1",
                provider: "claude" as const,
                label: "Personal",
                tier: "Max (20x)",
                enabled: true,
                status: "exhausted" as const,
                inFlight: 0,
                utilization: 0.95,
                resetAt: Date.now() + 3 * 24 * 60 * 60_000,
                windowLabel: "Weekly",
                blocked: true,
                observedAt: Date.now(),
                error: null,
              },
            ],
            fetchedAt: Date.now(),
            error: null,
          }),
        },
      },
    );

    await slot.findByText("Weekly");
    expect(slot.getByText("reset 3d")).toBeTruthy();
    expect(
      slot.container.querySelector(".pool-usage-fill--critical"),
    ).toBeTruthy();
    expect(
      slot.container.querySelector(".pool-usage-meta--blocked"),
    ).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("does not reserve a visible row before the first usage result", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const item = app.experimentalSidebarFooterItems[0];
    if (item === undefined || item.kind !== "disclosure") {
      throw new Error("Expected the Pool Usage disclosure");
    }

    const slot = renderSlot(
      item,
      { dismiss: () => undefined },
      {
        rpc: {
          usage_get: () => new Promise(() => undefined),
        },
      },
    );

    expect(slot.getByRole("status")).toBeTruthy();
    expect(slot.container.querySelector(".pool-usage-list")).toBeNull();
    expect(slot.container.querySelector(".pool-usage-row")).toBeNull();
    slot.lifecycle.unmount();
  });
});
