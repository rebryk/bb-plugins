import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { DEFAULT_RED_THRESHOLD } from "./usage-model";

const poolProviderSchema = z.enum(["claude", "codex"]);
const poolAccountStatusSchema = z.enum([
  "disabled",
  "ready",
  "held",
  "exhausted",
  "error",
]);

const poolLimitWindowSchema = z.object({
  slot: z.enum(["primary", "secondary"]),
  windowMinutes: z.number().int().positive().nullable(),
  utilization: z.number().nullable(),
  resetAt: z.number().int().nullable(),
  status: z.string().nullable(),
});

// Parse only the fields used here. Account Pooler is experimental, so
// accepting additive fields keeps this companion resilient to small changes.
const poolAccountSchema = z.object({
  id: z.string().min(1),
  provider: poolProviderSchema,
  kind: z.enum(["oauth", "api-key"]),
  label: z.string().min(1),
  email: z.string().email().nullable(),
  subscriptionType: z.string().nullable(),
  rateLimitTier: z.string().nullable(),
  enabled: z.boolean(),
  priority: z.number().int(),
  fiveHourUtilization: z.number().nullable(),
  fiveHourResetAt: z.number().int().nullable(),
  fiveHourStatus: z.string().nullable(),
  sevenDayUtilization: z.number().nullable(),
  sevenDayResetAt: z.number().int().nullable(),
  sevenDayStatus: z.string().nullable(),
  limitWindows: z.array(poolLimitWindowSchema),
  observedAt: z.number().int().nullable(),
  heldUntil: z.number().int().nullable(),
  error: z.string().nullable(),
  inFlight: z.number().int().nonnegative(),
  status: poolAccountStatusSchema,
});

const poolStatusSchema = z.object({
  accounts: z.array(poolAccountSchema),
  /** Whether bb routes each provider's threads through the pool. */
  routing: z.record(z.string(), z.boolean()).optional().catch(undefined),
  /** A parent bb server's pool, which serves instead when proxying. */
  parent: z
    .object({
      mode: z.string(),
      availability: z.record(z.string(), z.boolean()),
    })
    .nullable()
    .optional()
    .catch(null),
});

const poolConfigSchema = z.object({
  switchThreshold: z.number(),
});

const usageWindowSchema = z.object({
  /** Window length; null when the provider does not say. */
  minutes: z.number().int().positive().nullable(),
  utilization: z.number().nullable(),
  resetAt: z.number().int().nullable(),
  /** The provider refused requests in this window until it resets. */
  rejected: z.boolean(),
});

// bb's provider-usage.v1 source contract, read leniently: an odd field
// falls back to a safe value instead of failing the whole source.
const sourceResourceSchema = z.object({
  id: z.string().min(1),
  accountKey: z.string().min(1).nullable().catch(null),
  providerId: z.string().min(1),
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("shared") }),
    z.object({ kind: z.literal("host"), hostId: z.string().min(1) }),
  ]),
});

const sourceListSchema = z.object({
  resources: z.array(sourceResourceSchema),
});

const sourceWindowSchema = z.object({
  kind: z.enum(["five-hour", "daily", "weekly", "custom"]).catch("custom"),
  usedPercent: z.number(),
  resetsAt: z.string().nullable().catch(null),
  /** The model family the window limits; null for all models. */
  model: z.string().nullable().catch(null),
});

const sourcePlanSchema = z.object({
  id: z.string(),
  multiplier: z.number().positive().nullable(),
});

const sourceMeasurementSchema = z.object({
  accountKey: z.string().min(1).nullable().catch(null),
  usage: z.object({
    status: z.string(),
    plan: sourcePlanSchema.nullable().catch(null),
    windows: z.array(sourceWindowSchema).catch([]),
  }),
});

const usageAccountSchema = z.object({
  id: z.string().min(1),
  /** bb's provider id, such as `claude-code`. */
  provider: z.string().min(1),
  /** Relative capacity within the provider; 0 keeps it out of the total. */
  weight: z.number().nonnegative(),
  disabled: z.boolean(),
  /** Why the account's quota can't be trusted right now. */
  offline: z.enum(["login error", "error", "no data"]).nullable(),
  /** Account Pooler won't route to it until a hold ends or a window resets. */
  blocked: z.boolean(),
  heldUntil: z.number().int().nullable(),
  windows: z.array(usageWindowSchema),
});

const usageProviderSchema = z.object({
  id: z.string().min(1),
  /** Utilization at which a window stops taking requests. */
  switchThreshold: z.number(),
});

const usageSnapshotSchema = z.object({
  /** Providers with accounts, the ones Account Pooler serves first. */
  providers: z.array(usageProviderSchema),
  accounts: z.array(usageAccountSchema),
});

export type UsageWindow = z.infer<typeof usageWindowSchema>;
export type UsageAccount = z.infer<typeof usageAccountSchema>;
export type UsageProvider = z.infer<typeof usageProviderSchema>;
export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>;
export type PoolAccount = z.infer<typeof poolAccountSchema>;
type PoolProvider = z.infer<typeof poolProviderSchema>;
type PoolStatus = z.infer<typeof poolStatusSchema>;
type SourceResource = z.infer<typeof sourceResourceSchema>;
type SourceWindow = z.infer<typeof sourceWindowSchema>;
type SourceUsage = z.infer<typeof sourceMeasurementSchema>["usage"];

export const rpcContract = defineRpcContract({
  usage_get: {
    input: z.null(),
    output: usageSnapshotSchema,
  },
});

const POOL_PLUGIN_ID = "account-pool";

/** bb's ids for the providers Account Pooler serves. */
const POOL_PROVIDERS: Record<PoolProvider, string> = {
  claude: "claude-code",
  codex: "codex",
};

/** Account Pooler's default; the live value comes from its `config.get` RPC. */
const DEFAULT_SWITCH_THRESHOLD = 0.98;

/** A provider's own login serves until a window is full. */
const SOURCE_SWITCH_THRESHOLD = 1;

/** Account Pooler polls every five minutes, so older readings are lost. */
const STALE_OBSERVATION_MS = 30 * 60_000;

const LOGIN_ERROR =
  /auth|api key|(?:access|refresh|id) token|token (?:expired|revoked)|invalid token|log ?in|sign ?in|\b40[13]\b|unauthori[sz]ed|credential/iu;

interface Plan {
  tier: string;
  weight: number;
}

/**
 * Capacity relative to Plus, as OpenAI states it: Pro $100 is 5x, Pro $200 is
 * 20x. Plans without a stated multiplier count as 1x.
 */
const CODEX_PLANS = new Map<string, Plan>([
  ["pro", { tier: "Pro 20x", weight: 20 }],
  ["prolite", { tier: "Pro 5x", weight: 5 }],
  ["self_serve_business_prolite", { tier: "Biz Pro Lite", weight: 1 }],
  ["plus", { tier: "Plus", weight: 1 }],
  ["team", { tier: "Team", weight: 1 }],
  ["business", { tier: "Business", weight: 1 }],
  ["enterprise", { tier: "Enterprise", weight: 1 }],
  ["edu", { tier: "Edu", weight: 1 }],
  ["free", { tier: "Free", weight: 1 }],
  ["go", { tier: "Go", weight: 1 }],
]);

const CODEX_PLAN_WORDS = new Map([
  ["business", "Biz"],
  ["prolite", "Pro Lite"],
]);

function codexPlan(value: string | null): Plan | null {
  if (value === null) return null;
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, "");
  const known = CODEX_PLANS.get(key);
  if (known !== undefined) return known;
  const words = key
    .split("_")
    .filter((word) => word !== "" && word !== "self" && word !== "serve")
    .map(
      (word) =>
        CODEX_PLAN_WORDS.get(word) ?? word[0].toUpperCase() + word.slice(1),
    );
  return words.length === 0 ? null : { tier: words.join(" "), weight: 1 };
}

/**
 * Capacity relative to Pro, as Anthropic states it: Max is 5x or 20x, a
 * standard Team seat 1.25x and a premium one 5x a standard seat. Enterprise
 * has no stated multiplier and counts as 1x unless its tier names one.
 */
function claudePlan(
  subscriptionType: string | null,
  rateLimitTier: string | null,
): Plan | null {
  const type = subscriptionType?.trim().toLowerCase() ?? "";
  const limit = rateLimitTier?.trim().toLowerCase() ?? "";
  const multiplier = /max_(\d+)x/u.exec(limit)?.[1];
  const weight = multiplier === undefined ? null : Number(multiplier);
  if (type.includes("enterprise")) {
    return { tier: "Enterprise", weight: weight ?? 1 };
  }
  if (type.includes("team")) {
    return weight === null
      ? { tier: "Team", weight: 1.25 }
      : { tier: "Team Premium", weight: 1.25 * weight };
  }
  if (weight !== null) return { tier: `Max ${weight}x`, weight };
  if (type === "max" || limit.includes("max"))
    return { tier: "Max", weight: 5 };
  if (type === "pro" || limit.includes("pro"))
    return { tier: "Pro", weight: 1 };
  if (type === "free") return { tier: "Free", weight: 1 };
  return null;
}

/** The subscription's display name and its capacity relative to its peers. */
export function accountPlan(
  account: Pick<
    PoolAccount,
    "provider" | "kind" | "subscriptionType" | "rateLimitTier"
  >,
): Plan | null {
  if (account.kind === "api-key") return { tier: "API", weight: 0 };
  return account.provider === "claude"
    ? claudePlan(account.subscriptionType, account.rateLimitTier)
    : codexPlan(account.subscriptionType);
}

function quotaWindow(
  minutes: number | null,
  utilization: number | null,
  resetAt: number | null,
  status: string | null,
): UsageWindow {
  return {
    minutes,
    utilization,
    resetAt,
    rejected: status?.toLowerCase() === "rejected",
  };
}

function accountWindows(account: PoolAccount): UsageWindow[] {
  const windows = [
    quotaWindow(
      300,
      account.fiveHourUtilization,
      account.fiveHourResetAt,
      account.fiveHourStatus,
    ),
    quotaWindow(
      10_080,
      account.sevenDayUtilization,
      account.sevenDayResetAt,
      account.sevenDayStatus,
    ),
  ].filter((window) => window.utilization !== null || window.rejected);
  for (const window of account.limitWindows) {
    if (
      window.windowMinutes !== null &&
      windows.some(({ minutes }) => minutes === window.windowMinutes)
    ) {
      continue;
    }
    const normalized = quotaWindow(
      window.windowMinutes,
      window.utilization,
      window.resetAt,
      window.status,
    );
    if (normalized.utilization !== null || normalized.rejected) {
      windows.push(normalized);
    }
  }
  return windows;
}

function offlineReason(
  account: PoolAccount,
  now: number,
): UsageAccount["offline"] {
  if (account.status === "error") {
    return account.error !== null && LOGIN_ERROR.test(account.error)
      ? "login error"
      : "error";
  }
  if (
    account.observedAt === null ||
    now - account.observedAt > STALE_OBSERVATION_MS
  ) {
    return "no data";
  }
  return null;
}

export function normalizeAccount(
  account: PoolAccount,
  options: { now: number; planFallback?: Plan | null },
): UsageAccount {
  const plan = accountPlan(account) ?? options.planFallback ?? null;
  const weight = plan?.weight ?? 1;
  const disabled = !account.enabled || account.status === "disabled";
  return {
    id: account.id,
    provider: POOL_PROVIDERS[account.provider],
    weight,
    disabled,
    offline:
      disabled || weight === 0 ? null : offlineReason(account, options.now),
    heldUntil: account.heldUntil,
    blocked: account.status === "held" || account.status === "exhausted",
    windows: accountWindows(account),
  };
}

/**
 * Who serves a provider's threads, as Account Pooler decides it: its own
 * accounts, a parent bb server's pool, or, when null, the provider's own
 * login.
 */
function poolRoute(
  status: PoolStatus,
  provider: PoolProvider,
): "accounts" | "parent" | null {
  if (status.routing?.[provider] === false) return null;
  if (status.parent?.mode === "proxy") {
    return status.parent.availability[provider] === true ? "parent" : null;
  }
  return status.accounts.some(
    (account) => account.enabled && account.provider === provider,
  )
    ? "accounts"
    : null;
}

const WINDOW_MINUTES = {
  "five-hour": 300,
  daily: 1_440,
  weekly: 10_080,
  custom: null,
} as const;

function sourceWindow(window: SourceWindow): UsageWindow {
  const resetAt =
    window.resetsAt === null ? Number.NaN : Date.parse(window.resetsAt);
  return {
    minutes: WINDOW_MINUTES[window.kind],
    utilization: window.usedPercent / 100,
    resetAt: Number.isFinite(resetAt) ? resetAt : null,
    rejected: false,
  };
}

/** Sources name a plan but not its rate-limit tier; weigh it like the pool. */
function sourceWeight(provider: string, plan: SourceUsage["plan"]): number {
  if (plan === null) return 1;
  if (plan.multiplier !== null) return plan.multiplier;
  const known =
    provider === POOL_PROVIDERS.claude
      ? claudePlan(plan.id, null)
      : provider === POOL_PROVIDERS.codex
        ? codexPlan(plan.id)
        : null;
  return known?.weight ?? 1;
}

/** What a source's measurement says about quota; null when it says nothing. */
export function sourceAccount(
  id: string,
  provider: string,
  usage: SourceUsage,
): UsageAccount | null {
  const account = {
    id,
    provider,
    weight: sourceWeight(provider, usage.plan),
    disabled: false,
    heldUntil: null,
    blocked: false,
  };
  if (usage.status === "expired") {
    return { ...account, offline: "login error", windows: [] };
  }
  if (usage.status !== "ok") return null;
  // A model's own window limits only that model.
  const windows = usage.windows
    .filter(({ model }) => model === null)
    .map(sourceWindow);
  return windows.length === 0 ? null : { ...account, offline: null, windows };
}

interface SourceReading {
  account: UsageAccount;
  accountKey: string | null;
  shared: boolean;
}

/** One reading per quota account, preferring a shared source's. */
function distinctReadings(readings: readonly SourceReading[]): UsageAccount[] {
  const result: SourceReading[] = [];
  const known = new Map<string, number>();
  for (const reading of readings) {
    // An unknown account may be anyone's, so it never merges.
    if (reading.accountKey === null) {
      result.push(reading);
      continue;
    }
    const key = JSON.stringify([reading.account.provider, reading.accountKey]);
    const index = known.get(key);
    if (index === undefined) {
      known.set(key, result.length);
      result.push(reading);
    } else if (reading.shared && !result[index]!.shared) {
      result[index] = reading;
    }
  }
  return result.map(({ account }) => account);
}

const CODEX_PLAN_CACHE_MS = 5 * 60_000;

/** A fresh read serves every client polling within this window. */
const SNAPSHOT_TTL_MS = 15_000;

const USAGE_LIST_METHOD = "provider-usage.v1.listResources";
const USAGE_GET_METHOD = "provider-usage.v1.getResource";

/** Sources may ask the provider, so they are read less often than the pool. */
const SOURCE_TTL_MS = 60_000;
const SOURCE_TIMEOUT_MS = 10_000;
const SOURCE_BATCH_SIZE = 3;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function inBatches<T, R>(
  items: readonly T[],
  read: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += SOURCE_BATCH_SIZE) {
    results.push(
      ...(await Promise.all(
        items.slice(start, start + SOURCE_BATCH_SIZE).map(read),
      )),
    );
  }
  return results;
}

/**
 * Reads the accounts that bb's usage sources report, such as the Claude
 * Code, Codex and ACP providers' own logins, except for the providers
 * Account Pooler serves.
 */
function createSourceReader(
  bb: BbPluginApi,
): (served: ReadonlySet<string>) => Promise<UsageAccount[]> {
  /** Each source's last inventory, for a listing that fails. */
  const inventories = new Map<string, SourceResource[]>();
  /** Each resource's last reading, for a measurement that fails. */
  const readings = new Map<string, SourceReading>();
  let cache: {
    served: string;
    readAt: number;
    accounts: UsageAccount[];
  } | null = null;
  let pending: { served: string; promise: Promise<UsageAccount[]> } | null =
    null;

  async function sourcePlugins(): Promise<string[]> {
    try {
      const methods = await bb.sdk.plugins.experimental_discoverRpc({
        method: USAGE_LIST_METHOD,
      });
      // Account Pooler's accounts come from its status, with more detail.
      return [...new Set(methods.map(({ pluginId }) => pluginId))].filter(
        (pluginId) => pluginId !== POOL_PLUGIN_ID,
      );
    } catch (cause) {
      bb.log.debug(`Could not discover usage sources: ${errorMessage(cause)}`);
      return [...inventories.keys()];
    }
  }

  /** Connected, persistent hosts; null when they can't be listed. */
  async function usableHosts(): Promise<Set<string> | null> {
    try {
      const hosts = await bb.sdk.hosts.list();
      return new Set(
        hosts
          .filter(
            (host) => host.status === "connected" && host.type !== "ephemeral",
          )
          .map(({ id }) => id),
      );
    } catch (cause) {
      bb.log.debug(`Could not list hosts: ${errorMessage(cause)}`);
      return null;
    }
  }

  async function listResources(pluginId: string): Promise<SourceResource[]> {
    try {
      const { resources } = await bb.sdk.plugins.callRpc({
        pluginId,
        method: USAGE_LIST_METHOD,
        input: {},
        outputSchema: sourceListSchema,
        signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      });
      inventories.set(pluginId, resources);
      return resources;
    } catch (cause) {
      bb.log.debug(`Could not list ${pluginId} usage: ${errorMessage(cause)}`);
      return inventories.get(pluginId) ?? [];
    }
  }

  async function measure(
    pluginId: string,
    resource: SourceResource,
  ): Promise<SourceReading | null> {
    const id = `${pluginId}:${resource.id}`;
    try {
      const { accountKey, usage } = await bb.sdk.plugins.callRpc({
        pluginId,
        method: USAGE_GET_METHOD,
        input: { resourceId: resource.id, refresh: false },
        outputSchema: sourceMeasurementSchema,
        signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      });
      // A failed collection keeps the last reading, as bb's usage panel does.
      if (usage.status === "error") return readings.get(id) ?? null;
      const account = sourceAccount(id, resource.providerId, usage);
      if (account === null) {
        readings.delete(id);
        return null;
      }
      const reading = {
        account,
        accountKey: accountKey ?? resource.accountKey,
        shared: resource.scope.kind === "shared",
      };
      readings.set(id, reading);
      return reading;
    } catch (cause) {
      bb.log.debug(`Could not read ${id} usage: ${errorMessage(cause)}`);
      return readings.get(id) ?? null;
    }
  }

  async function readAccounts(
    served: ReadonlySet<string>,
  ): Promise<UsageAccount[]> {
    const pluginIds = await sourcePlugins();
    for (const pluginId of inventories.keys()) {
      if (!pluginIds.includes(pluginId)) inventories.delete(pluginId);
    }
    const listed = (
      await inBatches(pluginIds, async (pluginId) =>
        (await listResources(pluginId)).map((resource) => ({
          pluginId,
          resource,
        })),
      )
    ).flat();
    const ids = new Set(
      listed.map(({ pluginId, resource }) => `${pluginId}:${resource.id}`),
    );
    for (const id of readings.keys()) {
      if (!ids.has(id)) readings.delete(id);
    }
    const idle = listed.filter(
      ({ resource }) => !served.has(resource.providerId),
    );
    const hosts = idle.some(({ resource }) => resource.scope.kind === "host")
      ? await usableHosts()
      : null;
    const wanted = idle.filter(
      ({ resource }) =>
        resource.scope.kind === "shared" ||
        hosts === null ||
        hosts.has(resource.scope.hostId),
    );
    const measured = await inBatches(wanted, ({ pluginId, resource }) =>
      measure(pluginId, resource),
    );
    return distinctReadings(measured.filter((reading) => reading !== null));
  }

  return (served) => {
    const key = [...served].sort().join(" ");
    if (cache?.served === key && Date.now() - cache.readAt < SOURCE_TTL_MS) {
      return Promise.resolve(cache.accounts);
    }
    let current = pending;
    if (current?.served !== key) {
      const promise = readAccounts(served)
        .then((accounts) => {
          cache = { served: key, readAt: Date.now(), accounts };
          return accounts;
        })
        .finally(() => {
          if (pending?.promise === promise) pending = null;
        });
      current = { served: key, promise };
      pending = current;
    }
    return current.promise;
  };
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function fetchOfficialCodexPlans(
  bb: BbPluginApi,
  accounts: readonly PoolAccount[],
): Promise<Map<string, Plan>> {
  const unresolvedEmails = new Set(
    accounts.flatMap((account) =>
      account.provider === "codex" &&
      account.email !== null &&
      accountPlan(account) === null
        ? [normalizedEmail(account.email)]
        : [],
    ),
  );
  if (unresolvedEmails.size === 0) return new Map();

  const hosts = (await bb.sdk.hosts.list()).filter(
    (host) => host.status === "connected",
  );
  const results = await Promise.allSettled(
    hosts.map((host) =>
      bb.sdk.system.usageLimits({ hostId: host.id, providerId: "codex" }),
    ),
  );
  const candidates = new Map<string, Map<string, Plan>>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const usage = result.value.codex;
    if (
      usage?.status !== "ok" ||
      usage.accountEmail === null ||
      usage.planLabel === null
    ) {
      continue;
    }
    const email = normalizedEmail(usage.accountEmail);
    if (!unresolvedEmails.has(email)) continue;
    const plan = codexPlan(usage.planLabel);
    if (plan === null) continue;
    const plans = candidates.get(email) ?? new Map<string, Plan>();
    plans.set(plan.tier, plan);
    candidates.set(email, plans);
  }

  return new Map(
    [...candidates].flatMap(([email, plans]) =>
      plans.size === 1 ? [[email, [...plans.values()][0] as Plan]] : [],
    ),
  );
}

async function fetchSwitchThreshold(bb: BbPluginApi): Promise<number> {
  try {
    const config = await bb.sdk.plugins.callRpc({
      pluginId: POOL_PLUGIN_ID,
      method: "config.get",
      input: null,
      outputSchema: poolConfigSchema,
    });
    const threshold = config.switchThreshold;
    return typeof threshold === "number" && threshold > 0 && threshold <= 1
      ? threshold
      : DEFAULT_SWITCH_THRESHOLD;
  } catch (cause) {
    bb.log.debug(
      `Could not read Account Pooler's switch threshold, assuming ${DEFAULT_SWITCH_THRESHOLD}: ${errorMessage(cause)}`,
    );
    return DEFAULT_SWITCH_THRESHOLD;
  }
}

export default function plugin(bb: BbPluginApi): void {
  bb.settings.define({
    redThreshold: {
      type: "number",
      label: "Red at, %",
      description:
        "Usage at or above this percentage turns red in the footer and on the usage cards.",
      experimental_schema: z.number().int().min(1).max(100),
      default: DEFAULT_RED_THRESHOLD,
    },
  });

  const readSources = createSourceReader(bb);
  let codexPlanCache: { expiresAt: number; plans: Map<string, Plan> } | null =
    null;
  let snapshot: { readAt: number; value: UsageSnapshot } | null = null;
  let pending: Promise<UsageSnapshot> | null = null;

  async function codexPlans(
    accounts: readonly PoolAccount[],
  ): Promise<Map<string, Plan>> {
    const now = Date.now();
    if (codexPlanCache !== null && codexPlanCache.expiresAt > now) {
      return codexPlanCache.plans;
    }
    let plans = new Map<string, Plan>();
    try {
      plans = await fetchOfficialCodexPlans(bb, accounts);
    } catch (cause) {
      bb.log.debug(
        `Could not supplement Codex tiers from provider usage: ${errorMessage(cause)}`,
      );
    }
    codexPlanCache = { expiresAt: now + CODEX_PLAN_CACHE_MS, plans };
    return plans;
  }

  /**
   * Account Pooler's accounts for the providers they serve. `served` also
   * names the providers a parent bb server's pool serves, whose accounts
   * this server can't see.
   */
  async function readPool(): Promise<UsageSnapshot & { served: Set<string> }> {
    let status: PoolStatus;
    try {
      status = await bb.sdk.plugins.callRpc({
        pluginId: POOL_PLUGIN_ID,
        method: "status.get",
        input: null,
        outputSchema: poolStatusSchema,
      });
    } catch (cause) {
      bb.log.debug(
        `Could not read Account Pooler status: ${errorMessage(cause)}`,
      );
      return { providers: [], accounts: [], served: new Set() };
    }
    const routes = poolProviderSchema.options.map((provider) => ({
      provider,
      route: poolRoute(status, provider),
    }));
    const served = new Set(
      routes
        .filter(({ route }) => route !== null)
        .map(({ provider }) => POOL_PROVIDERS[provider]),
    );
    const pooled = routes
      .filter(({ route }) => route === "accounts")
      .map(({ provider }) => provider);
    const accounts = status.accounts.filter((account) =>
      pooled.includes(account.provider),
    );
    if (accounts.length === 0) return { providers: [], accounts: [], served };
    const plans = await codexPlans(accounts);
    const switchThreshold = await fetchSwitchThreshold(bb);
    return {
      served,
      providers: pooled.map((provider) => ({
        id: POOL_PROVIDERS[provider],
        switchThreshold,
      })),
      accounts: accounts.map((account) =>
        normalizeAccount(account, {
          now: Date.now(),
          planFallback:
            account.provider === "codex" && account.email !== null
              ? (plans.get(normalizedEmail(account.email)) ?? null)
              : null,
        }),
      ),
    };
  }

  async function readSnapshot(): Promise<UsageSnapshot> {
    const pool = await readPool();
    const accounts = await readSources(pool.served);
    const providers = [...new Set(accounts.map(({ provider }) => provider))];
    return {
      providers: [
        ...pool.providers,
        ...providers.map((id) => ({
          id,
          switchThreshold: SOURCE_SWITCH_THRESHOLD,
        })),
      ],
      accounts: [...pool.accounts, ...accounts],
    };
  }

  bb.rpc.register(rpcContract, {
    usage_get: async () => {
      if (snapshot !== null && Date.now() - snapshot.readAt < SNAPSHOT_TTL_MS) {
        return snapshot.value;
      }
      pending ??= readSnapshot()
        .then((value) => {
          snapshot = { readAt: Date.now(), value };
          return value;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  });
}
