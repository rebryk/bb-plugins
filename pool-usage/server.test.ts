import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, {
  accountPlan,
  normalizeAccount,
  sourceAccount,
  type PoolAccount,
  type UsageSnapshot,
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

const codexAccount = (overrides: Partial<PoolAccount> = {}) =>
  account({
    provider: "codex",
    subscriptionType: "pro",
    rateLimitTier: null,
    fiveHourUtilization: null,
    fiveHourResetAt: null,
    fiveHourStatus: null,
    sevenDayUtilization: null,
    sevenDayResetAt: null,
    sevenDayStatus: null,
    ...overrides,
  });

describe("accountPlan", () => {
  it("weighs Claude plans by their usage multiplier", () => {
    expect(accountPlan(account())).toEqual({ tier: "Max 20x", weight: 20 });
    expect(
      accountPlan(account({ subscriptionType: "max", rateLimitTier: null })),
    ).toEqual({ tier: "Max", weight: 5 });
    expect(
      accountPlan(
        account({
          subscriptionType: "pro",
          rateLimitTier: "default_claude_pro",
        }),
      ),
    ).toEqual({ tier: "Pro", weight: 1 });
  });

  it("weighs Team seats at 1.25x Pro, premium seats at 5x that", () => {
    expect(
      accountPlan(
        account({
          subscriptionType: "claude_team",
          rateLimitTier: "default_claude_max_5x",
        }),
      ),
    ).toEqual({ tier: "Team Premium", weight: 6.25 });
    expect(
      accountPlan(
        account({ subscriptionType: "claude_team", rateLimitTier: null }),
      ),
    ).toEqual({ tier: "Team", weight: 1.25 });
  });

  it("weighs Codex plans by OpenAI's multipliers", () => {
    expect(accountPlan(codexAccount())).toEqual({
      tier: "Pro 20x",
      weight: 20,
    });
    expect(accountPlan(codexAccount({ subscriptionType: "prolite" }))).toEqual({
      tier: "Pro 5x",
      weight: 5,
    });
    expect(accountPlan(codexAccount({ subscriptionType: "Plus" }))).toEqual({
      tier: "Plus",
      weight: 1,
    });
    expect(
      accountPlan(
        codexAccount({ subscriptionType: "self_serve_business_prolite" }),
      ),
    ).toEqual({ tier: "Biz Pro Lite", weight: 1 });
  });

  it("keeps API keys out of the subscription total", () => {
    expect(
      accountPlan(
        account({
          kind: "api-key",
          subscriptionType: null,
          rateLimitTier: null,
        }),
      ),
    ).toEqual({ tier: "API", weight: 0 });
  });

  it("returns null for an unknown plan", () => {
    expect(
      accountPlan(account({ subscriptionType: null, rateLimitTier: null })),
    ).toBeNull();
    expect(accountPlan(codexAccount({ subscriptionType: null }))).toBeNull();
  });
});

describe("normalizeAccount", () => {
  const options = { now: 123_000 };

  it("keeps each window's reading", () => {
    expect(normalizeAccount(account(), options)).toEqual({
      id: "6d4a6287-16cb-42eb-9977-69132be5fddb",
      provider: "claude-code",
      weight: 20,
      disabled: false,
      offline: null,
      heldUntil: null,
      blocked: false,
      windows: [
        {
          minutes: 300,
          utilization: 0.42,
          resetAt: 1_800_000,
          rejected: false,
        },
        {
          minutes: 10_080,
          utilization: 0.81,
          resetAt: 604_800_000,
          rejected: false,
        },
      ],
    });
  });

  it("marks a rejected window and drops an unreported one", () => {
    const normalized = normalizeAccount(
      account({
        fiveHourUtilization: null,
        fiveHourResetAt: null,
        fiveHourStatus: null,
        sevenDayStatus: "rejected",
        status: "exhausted",
      }),
      options,
    );

    expect(normalized.blocked).toBe(true);
    expect(normalized.windows).toEqual([
      {
        minutes: 10_080,
        utilization: 0.81,
        resetAt: 604_800_000,
        rejected: true,
      },
    ]);
  });

  it("adds Codex limit windows without repeating a known length", () => {
    const normalized = normalizeAccount(
      codexAccount({
        sevenDayUtilization: 0.5,
        sevenDayResetAt: 700_000,
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

    expect(normalized.windows).toEqual([
      { minutes: 10_080, utilization: 0.5, resetAt: 700_000, rejected: false },
      { minutes: null, utilization: 0.22, resetAt: 300_000, rejected: false },
    ]);
  });

  it("says why an account's quota can't be trusted", () => {
    expect(
      normalizeAccount(
        account({ status: "error", error: "OAuth token expired" }),
        options,
      ).offline,
    ).toBe("login error");
    expect(
      normalizeAccount(
        account({ status: "error", error: "upstream returned 500" }),
        options,
      ).offline,
    ).toBe("error");
    expect(
      normalizeAccount(account({ observedAt: null }), options).offline,
    ).toBe("no data");
    expect(
      normalizeAccount(account({ observedAt: 0 }), { now: 31 * 60_000 })
        .offline,
    ).toBe("no data");
  });

  it("doesn't flag accounts that stay out of the total", () => {
    const disabled = normalizeAccount(
      account({ enabled: false, observedAt: null }),
      options,
    );
    const apiKey = normalizeAccount(
      account({
        kind: "api-key",
        subscriptionType: null,
        rateLimitTier: null,
        status: "error",
        error: "invalid api key",
      }),
      options,
    );

    expect(disabled).toMatchObject({ disabled: true, offline: null });
    expect(apiKey).toMatchObject({ weight: 0, offline: null });
  });

  it("falls back to a known plan, then to an unnamed single seat", () => {
    const source = codexAccount({ subscriptionType: null });

    expect(
      normalizeAccount(source, {
        ...options,
        planFallback: { tier: "Pro 20x", weight: 20 },
      }),
    ).toMatchObject({ weight: 20 });
    expect(normalizeAccount(source, options)).toMatchObject({ weight: 1 });
  });
});

describe("sourceAccount", () => {
  const usage = {
    status: "ok",
    plan: { id: "max", multiplier: 20 },
    windows: [
      {
        kind: "five-hour" as const,
        usedPercent: 40,
        resetsAt: "2026-01-01T05:00:00.000Z",
        model: null,
      },
      {
        kind: "weekly" as const,
        usedPercent: 90,
        resetsAt: null,
        model: "opus",
      },
    ],
  };

  it("keeps the account-wide windows, weighted by the plan", () => {
    expect(sourceAccount("a", "claude-code", usage)).toEqual({
      id: "a",
      provider: "claude-code",
      weight: 20,
      disabled: false,
      offline: null,
      heldUntil: null,
      blocked: false,
      windows: [
        {
          minutes: 300,
          utilization: 0.4,
          resetAt: Date.parse("2026-01-01T05:00:00.000Z"),
          rejected: false,
        },
      ],
    });
  });

  it("falls back to the plan's official multiplier, then to 1x", () => {
    const plan = (id: string) => ({ ...usage, plan: { id, multiplier: null } });

    expect(sourceAccount("a", "codex", plan("prolite"))?.weight).toBe(5);
    expect(sourceAccount("a", "cursor", plan("ultra"))?.weight).toBe(1);
  });

  it("flags an expired login and skips anything unreadable", () => {
    expect(
      sourceAccount("a", "codex", { ...usage, status: "expired" }),
    ).toMatchObject({ offline: "login error", windows: [] });
    expect(
      sourceAccount("a", "codex", { ...usage, status: "unsupported" }),
    ).toBeNull();
    expect(sourceAccount("a", "codex", { ...usage, windows: [] })).toBeNull();
  });
});

function poolerRpc(accounts: PoolAccount[], switchThreshold = 0.95) {
  return async (request: { method: string }) =>
    request.method === "config.get" ? { switchThreshold } : { accounts };
}

const cursorUsage = {
  status: "ok",
  plan: null,
  windows: [{ kind: "custom", usedPercent: 30, resetsAt: null, model: null }],
};

/** Account Pooler plus one usage source with a Codex and a Cursor account. */
function hostWithSource(status: Record<string, unknown>) {
  return createFakePluginHost({
    pluginId: "pool-usage",
    sdk: {
      plugins: {
        experimental_discoverRpc: async () =>
          [{ pluginId: "account-pool" }, { pluginId: "provider-acp" }] as never,
        callRpc: async (request: {
          method: string;
          input?: unknown;
          outputSchema: { parse: (value: unknown) => unknown };
        }) => {
          const value =
            request.method === "config.get"
              ? { switchThreshold: 0.95 }
              : request.method === "status.get"
                ? status
                : request.method === "provider-usage.v1.listResources"
                  ? {
                      resources: ["codex", "cursor"].map((providerId) => ({
                        id: providerId,
                        accountKey: providerId,
                        providerId,
                        scope: { kind: "shared" },
                      })),
                    }
                  : {
                      accountKey: (request.input as { resourceId: string })
                        .resourceId,
                      usage: cursorUsage,
                    };
          return request.outputSchema.parse(value);
        },
      },
    },
  });
}

describe("plugin", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads Account Pooler's status and switch threshold", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "pool-usage",
      sdk: {
        plugins: { callRpc: poolerRpc([account({ observedAt: Date.now() })]) },
      },
    });
    await plugin(bb);

    const result = (await harness.behavior.callRpc(
      "usage_get",
    )) as UsageSnapshot;

    expect(result.providers).toEqual([
      { id: "claude-code", switchThreshold: 0.95 },
    ]);
    expect(result.accounts).toMatchObject([{ weight: 20, offline: null }]);
    expect(harness.inspection.sdk.callsTo("plugins.callRpc")).toHaveLength(2);
    await harness.lifecycle.dispose();
  });

  it("serves every caller within 15 seconds from one read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { bb, harness } = createFakePluginHost({
      pluginId: "pool-usage",
      sdk: {
        plugins: { callRpc: poolerRpc([account({ observedAt: Date.now() })]) },
      },
    });
    await plugin(bb);

    await Promise.all([
      harness.behavior.callRpc("usage_get"),
      harness.behavior.callRpc("usage_get"),
    ]);
    vi.advanceTimersByTime(14_000);
    await harness.behavior.callRpc("usage_get");
    expect(harness.inspection.sdk.callsTo("plugins.callRpc")).toHaveLength(2);

    vi.advanceTimersByTime(2_000);
    await harness.behavior.callRpc("usage_get");
    expect(harness.inspection.sdk.callsTo("plugins.callRpc")).toHaveLength(4);
    await harness.lifecycle.dispose();
  });

  it("assumes Account Pooler's default threshold when it can't be read", async () => {
    const source = account({ observedAt: Date.now() });
    const { bb, harness } = createFakePluginHost({
      pluginId: "pool-usage",
      sdk: {
        plugins: {
          callRpc: async (request: { method: string }) => {
            if (request.method === "config.get")
              throw new Error("unknown method");
            return { accounts: [source] };
          },
        },
      },
    });
    await plugin(bb);

    const result = (await harness.behavior.callRpc(
      "usage_get",
    )) as UsageSnapshot;

    expect(result.providers).toEqual([
      { id: "claude-code", switchThreshold: 0.98 },
    ]);
    expect(result.accounts).toHaveLength(1);
    await harness.lifecycle.dispose();
  });

  it("uses official Codex usage as a tier fallback matched by email", async () => {
    const source = codexAccount({ subscriptionType: null });
    const { bb, harness } = createFakePluginHost({
      pluginId: "pool-usage",
      sdk: {
        plugins: { callRpc: poolerRpc([source]) },
        hosts: {
          list: async () => [{ id: "host-1", status: "connected" }] as never,
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

    const result = (await harness.behavior.callRpc(
      "usage_get",
    )) as UsageSnapshot;

    expect(result.accounts[0]).toMatchObject({ weight: 20 });
    expect(harness.inspection.sdk.callsTo("system.usageLimits")).toHaveLength(
      1,
    );
    await harness.lifecycle.dispose();
  });

  it("returns an empty state when Account Pooler is unavailable", async () => {
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

    const result = (await harness.behavior.callRpc(
      "usage_get",
    )) as UsageSnapshot;

    expect(result).toEqual({ providers: [], accounts: [] });
    await harness.lifecycle.dispose();
  });

  it("adds providers Account Pooler doesn't serve from usage sources", async () => {
    const { bb, harness } = hostWithSource({
      accounts: [codexAccount({ observedAt: Date.now() })],
    });
    await plugin(bb);

    const result = (await harness.behavior.callRpc(
      "usage_get",
    )) as UsageSnapshot;

    expect(result.providers).toEqual([
      { id: "codex", switchThreshold: 0.95 },
      { id: "cursor", switchThreshold: 1 },
    ]);
    expect(result.accounts.map(({ provider }) => provider)).toEqual([
      "codex",
      "cursor",
    ]);
    await harness.lifecycle.dispose();
  });

  it("reads every provider from its source when routing is off", async () => {
    const { bb, harness } = hostWithSource({
      accounts: [codexAccount({ observedAt: Date.now() })],
      routing: { claude: true, codex: false },
    });
    await plugin(bb);

    const result = (await harness.behavior.callRpc(
      "usage_get",
    )) as UsageSnapshot;

    expect(result.providers.map(({ id }) => id)).toEqual(["codex", "cursor"]);
    expect(result.accounts).toMatchObject([
      { provider: "codex", weight: 1, windows: [{ utilization: 0.3 }] },
      { provider: "cursor" },
    ]);
    await harness.lifecycle.dispose();
  });

  it("defines one setting: the red threshold", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "pool-usage" });
    await plugin(bb);

    const descriptors = harness.inspection.registrations.settingsDescriptors;
    expect(Object.keys(descriptors)).toEqual(["redThreshold"]);
    expect(descriptors.redThreshold).toMatchObject({
      type: "number",
      label: "Red at, %",
      default: 80,
    });
    await expect(
      harness.behavior.setSettings({ redThreshold: 70 }),
    ).resolves.toBeUndefined();
    await expect(
      harness.behavior.setSettings({ redThreshold: 150 }),
    ).rejects.toThrow();
    await harness.lifecycle.dispose();
  });
});
