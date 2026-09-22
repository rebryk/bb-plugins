import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, {
  accountTier,
  bindingWindow,
  normalizeAccount,
  type PoolAccount,
} from "./server";

function account(overrides: Partial<PoolAccount> = {}): PoolAccount {
  return {
    id: "6d4a6287-16cb-42eb-9977-69132be5fddb",
    provider: "claude",
    kind: "oauth",
    label: "Personal",
    email: "account@example.com",
    subscriptionType: "max",
    rateLimitTier: "default_claude_max_20x",
    enabled: true,
    priority: 0,
    fiveHourUtilization: 0.42,
    fiveHourResetAt: 1_800_000,
    fiveHourStatus: "allowed",
    sevenDayUtilization: 0.81,
    sevenDayResetAt: 604_800_000,
    sevenDayStatus: "allowed",
    limitWindows: [],
    observedAt: 123_000,
    heldUntil: null,
    error: null,
    inFlight: 0,
    status: "ready",
    ...overrides,
  };
}

describe("quota normalization", () => {
  const options = { threshold: 0.95, now: 0 };

  it("uses the window closest to its limit while every window has room", () => {
    expect(bindingWindow(account(), 0.95, 0)).toMatchObject({
      utilization: 0.81,
      resetAt: 604_800_000,
      label: "Weekly",
    });
  });

  it("uses the spent window even when a shorter window is empty", () => {
    const normalized = normalizeAccount(
      account({
        fiveHourUtilization: 0,
        sevenDayUtilization: 0.95,
        status: "exhausted",
      }),
      options,
    );

    expect(normalized.windowLabel).toBe("Weekly");
    expect(normalized.utilization).toBe(0.95);
    expect(normalized.resetAt).toBe(604_800_000);
    expect(normalized.blocked).toBe(true);
  });

  it("treats a rejected window as spent whatever its utilization reads", () => {
    const normalized = normalizeAccount(
      account({
        fiveHourUtilization: 0.1,
        sevenDayUtilization: 0.2,
        sevenDayStatus: "rejected",
        status: "exhausted",
      }),
      options,
    );

    expect(normalized.windowLabel).toBe("Weekly");
    expect(normalized.blocked).toBe(true);
  });

  it("reports the spent window that clears last", () => {
    expect(
      bindingWindow(
        account({ fiveHourUtilization: 0.99, sevenDayUtilization: 0.99 }),
        0.95,
        0,
      ),
    ).toMatchObject({ label: "Weekly", resetAt: 604_800_000 });
  });

  it("ignores a window that has already reset", () => {
    const normalized = normalizeAccount(
      account({ fiveHourUtilization: 0.99, fiveHourResetAt: 1_000 }),
      { threshold: 0.95, now: 2_000 },
    );

    expect(normalized.windowLabel).toBe("Weekly");
    expect(normalized.blocked).toBe(false);
  });

  it("normalizes Codex limit windows", () => {
    const normalized = normalizeAccount(
      account({
        provider: "codex",
        fiveHourUtilization: null,
        fiveHourResetAt: null,
        fiveHourStatus: null,
        sevenDayUtilization: null,
        sevenDayResetAt: null,
        sevenDayStatus: null,
        limitWindows: [
          {
            slot: "primary",
            windowMinutes: 10_080,
            utilization: 0.67,
            resetAt: 900_000,
            status: null,
          },
          {
            slot: "secondary",
            windowMinutes: null,
            utilization: 0.22,
            resetAt: 300_000,
            status: null,
          },
        ],
      }),
      options,
    );

    expect(normalized.utilization).toBe(0.67);
    expect(normalized.windowLabel).toBe("Weekly");
    expect(normalized.resetAt).toBe(900_000);
    expect(normalized.blocked).toBe(false);
  });

  it("formats the provider's actual subscription tier", () => {
    expect(accountTier(account())).toBe("Max (20x)");
    expect(
      accountTier(
        account({
          subscriptionType: "claude_team",
          rateLimitTier: "default_claude_max_5x",
        }),
      ),
    ).toBe("Max (5x)");
    expect(
      accountTier(
        account({
          subscriptionType: "pro",
          rateLimitTier: "default_claude_pro",
        }),
      ),
    ).toBe("Pro");
    expect(
      accountTier(
        account({ subscriptionType: "claude_team", rateLimitTier: null }),
      ),
    ).toBe("Team");
    expect(
      accountTier(
        account({ subscriptionType: null, rateLimitTier: null }),
      ),
    ).toBe("—");
    expect(
      accountTier(
        account({ kind: "api-key", subscriptionType: null, rateLimitTier: null }),
      ),
    ).toBe("API");
  });

  it("uses the hold expiry as the actionable reset", () => {
    const normalized = normalizeAccount(
      account({ status: "held", heldUntil: 999_000 }),
      options,
    );

    expect(normalized.resetAt).toBe(999_000);
    expect(normalized.blocked).toBe(true);
  });
});

describe("plugin RPC", () => {
  it("reads Account Pooler's status through cross-plugin RPC", async () => {
    const source = account({
      fiveHourResetAt: Date.now() + 60 * 60_000,
      sevenDayResetAt: Date.now() + 5 * 24 * 60 * 60_000,
    });
    const { bb, harness } = createFakePluginHost({
      pluginId: "pool-usage",
      sdk: {
        plugins: {
          callRpc: async (request: { method: string }) =>
            request.method === "config.get"
              ? { switchThreshold: 0.95 }
              : { accounts: [source] },
        },
      },
    });
    await plugin(bb);

    const result = (await harness.behavior.callRpc("usage_get")) as {
      accounts: Array<{ label: string; utilization: number | null }>;
      error: string | null;
    };

    expect(result.error).toBeNull();
    expect(result.accounts).toMatchObject([
      {
        label: "Personal",
        tier: "Max (20x)",
        utilization: 0.81,
        windowLabel: "Weekly",
      },
    ]);
    expect(harness.inspection.sdk.callsTo("plugins.callRpc")).toHaveLength(2);
    await harness.lifecycle.dispose();
  });

  it("uses official Codex usage as a tier fallback matched by email", async () => {
    const source = account({
      provider: "codex",
      subscriptionType: null,
      rateLimitTier: null,
    });
    const { bb, harness } = createFakePluginHost({
      pluginId: "pool-usage",
      sdk: {
        plugins: {
          callRpc: async (request: { method: string }) =>
            request.method === "config.get"
              ? { switchThreshold: 0.95 }
              : { accounts: [source] },
        },
        hosts: {
          list: async () =>
            [{ id: "host-1", status: "connected" }] as never,
        },
        system: {
          usageLimits: async () => ({
            codex: {
              status: "ok" as const,
              accountEmail: "ACCOUNT@example.com",
              planLabel: "Pro",
              windows: [],
            },
          }),
        },
      },
    });
    await plugin(bb);

    const result = (await harness.behavior.callRpc("usage_get")) as {
      accounts: Array<{ tier: string }>;
    };

    expect(result.accounts[0]?.tier).toBe("Pro");
    expect(harness.inspection.sdk.callsTo("system.usageLimits")).toHaveLength(1);
    await harness.lifecycle.dispose();
  });

  it("returns a bounded empty state when Account Pooler is unavailable", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "pool-usage",
      sdk: {
        plugins: {
          callRpc: async () => {
            throw new Error("missing plugin");
          },
        },
      },
    });
    await plugin(bb);

    const result = (await harness.behavior.callRpc("usage_get")) as {
      accounts: unknown[];
      error: string | null;
    };
    expect(result.accounts).toEqual([]);
    expect(result.error).toContain("Account Pooler is unavailable");
    await harness.lifecycle.dispose();
  });
});
