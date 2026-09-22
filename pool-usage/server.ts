import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

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

// Parse only the fields rendered here. Account Pooler is experimental, so
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
});

const poolConfigSchema = z.object({
  switchThreshold: z.number(),
});

const usageAccountSchema = z.object({
  id: z.string().min(1),
  provider: poolProviderSchema,
  label: z.string().min(1),
  tier: z.string().min(1),
  enabled: z.boolean(),
  status: poolAccountStatusSchema,
  inFlight: z.number().int().nonnegative(),
  utilization: z.number().nullable(),
  resetAt: z.number().int().nullable(),
  windowLabel: z.string().min(1).nullable(),
  blocked: z.boolean(),
  observedAt: z.number().int().nullable(),
  error: z.string().nullable(),
});

export type UsageAccount = z.infer<typeof usageAccountSchema>;
export type PoolAccount = z.infer<typeof poolAccountSchema>;

export const rpcContract = defineRpcContract({
  usage_get: {
    input: z.null(),
    output: z.object({
      accounts: z.array(usageAccountSchema),
      fetchedAt: z.number().int().nonnegative(),
      error: z.string().nullable(),
    }),
  },
});

/** Account Pooler's default; the live value comes from its `config.get` RPC. */
const DEFAULT_SWITCH_THRESHOLD = 0.98;

interface QuotaWindow {
  utilization: number | null;
  resetAt: number | null;
  status: string | null;
  label: string;
  durationMinutes: number | null;
}

function windowLabel(minutes: number | null, slot: "primary" | "secondary") {
  if (minutes === null) return slot === "primary" ? "Primary" : "Secondary";
  if (minutes === 300) return "5 hours";
  if (minutes === 10_080) return "Weekly";
  if (minutes % 10_080 === 0) return `${minutes / 10_080} weeks`;
  if (minutes % 1_440 === 0) return `${minutes / 1_440} days`;
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

function sharedWindows(account: PoolAccount): QuotaWindow[] {
  return [
    {
      utilization: account.fiveHourUtilization,
      resetAt: account.fiveHourResetAt,
      status: account.fiveHourStatus,
      label: "5 hours",
      durationMinutes: 300,
    },
    {
      utilization: account.sevenDayUtilization,
      resetAt: account.sevenDayResetAt,
      status: account.sevenDayStatus,
      label: "Weekly",
      durationMinutes: 10_080,
    },
    ...account.limitWindows.map((window) => ({
      utilization: window.utilization,
      resetAt: window.resetAt,
      status: window.status,
      label: windowLabel(window.windowMinutes, window.slot),
      durationMinutes: window.windowMinutes,
    })),
  ].filter(
    (window) =>
      window.utilization !== null ||
      window.resetAt !== null ||
      window.status !== null,
  );
}

/** Mirrors the rule Account Pooler uses to hold an account back. */
function isBlocking(
  window: QuotaWindow,
  threshold: number,
  now: number,
): boolean {
  if (window.resetAt !== null && window.resetAt <= now) return false;
  return (
    window.status?.toLowerCase() === "rejected" ||
    (window.utilization !== null && window.utilization >= threshold)
  );
}

/**
 * Pick the window that decides whether the account can serve a request now:
 * the spent window that clears last, or else the one closest to its limit.
 */
export function bindingWindow(
  account: PoolAccount,
  threshold: number,
  now: number,
): QuotaWindow | null {
  const windows = sharedWindows(account);
  if (windows.length === 0) return null;

  const blocking = windows.filter((window) =>
    isBlocking(window, threshold, now),
  );
  if (blocking.length > 0) {
    return blocking.reduce((selected, window) => {
      if (selected.resetAt === null) return selected;
      if (window.resetAt === null) return window;
      return window.resetAt > selected.resetAt ? window : selected;
    });
  }

  // A window past its reset has rolled over, so its utilization is stale.
  const current = windows.filter(
    (window) => window.resetAt === null || window.resetAt > now,
  );
  if (current.length === 0) return null;

  return current.reduce((selected, window) => {
    const selectedUtilization = selected.utilization ?? -1;
    const utilization = window.utilization ?? -1;
    if (utilization !== selectedUtilization) {
      return utilization > selectedUtilization ? window : selected;
    }
    return (window.durationMinutes ?? 0) > (selected.durationMinutes ?? 0)
      ? window
      : selected;
  });
}

const NAMED_TIERS = new Map([
  ["pro", "Pro"],
  ["plus", "Plus"],
  ["team", "Team"],
  ["business", "Business"],
  ["enterprise", "Enterprise"],
  ["edu", "Edu"],
  ["free", "Free"],
]);

function tierFromMetadata(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  const max = normalized.match(/(?:^|[^a-z0-9])max[^a-z0-9]*(\d+)x(?:$|[^a-z0-9])/u);
  if (max?.[1] !== undefined) return `Max (${max[1]}x)`;

  const tokens = normalized.split(/[^a-z0-9]+/u).filter(Boolean);
  if (tokens.includes("max")) return "Max";
  for (const token of tokens) {
    const label = NAMED_TIERS.get(token);
    if (label !== undefined) return label;
  }
  return null;
}

export function accountTier(
  account: Pick<
    PoolAccount,
    "kind" | "subscriptionType" | "rateLimitTier"
  >,
): UsageAccount["tier"] {
  if (account.kind === "api-key") return "API";
  return (
    tierFromMetadata(account.rateLimitTier) ??
    tierFromMetadata(account.subscriptionType) ??
    "—"
  );
}

export function normalizeAccount(
  account: PoolAccount,
  options: {
    threshold: number;
    now: number;
    tierFallback?: string | null;
  },
): UsageAccount {
  const { threshold, now, tierFallback = null } = options;
  const selected = bindingWindow(account, threshold, now);
  const metadataTier = accountTier(account);
  return {
    id: account.id,
    provider: account.provider,
    label: account.label,
    tier:
      metadataTier === "—" && tierFallback !== null
        ? tierFallback
        : metadataTier,
    enabled: account.enabled,
    status: account.status,
    inFlight: account.inFlight,
    utilization: selected?.utilization ?? null,
    resetAt:
      account.status === "held" && account.heldUntil !== null
        ? account.heldUntil
        : (selected?.resetAt ?? null),
    windowLabel: selected?.label ?? null,
    blocked:
      account.status === "exhausted" ||
      account.status === "held" ||
      (selected !== null && isBlocking(selected, threshold, now)),
    observedAt: account.observedAt,
    error: account.error,
  };
}

const ACCOUNT_POOL_UNAVAILABLE =
  "Account Pooler is unavailable. Enable it and add at least one account.";

const CODEX_TIER_CACHE_MS = 5 * 60_000;

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function fetchOfficialCodexTiers(
  bb: BbPluginApi,
  accounts: readonly PoolAccount[],
): Promise<Map<string, string>> {
  const unresolvedEmails = new Set(
    accounts.flatMap((account) =>
      account.provider === "codex" &&
      account.email !== null &&
      accountTier(account) === "—"
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
  const candidates = new Map<string, Set<string>>();
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
    const tier = tierFromMetadata(usage.planLabel);
    if (tier === null) continue;
    const labels = candidates.get(email) ?? new Set<string>();
    labels.add(tier);
    candidates.set(email, labels);
  }

  return new Map(
    [...candidates].flatMap(([email, labels]) =>
      labels.size === 1 ? [[email, [...labels][0] as string]] : [],
    ),
  );
}

async function fetchSwitchThreshold(bb: BbPluginApi): Promise<number> {
  try {
    const config = await bb.sdk.plugins.callRpc({
      pluginId: "account-pool",
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
      `Could not read Account Pooler's switch threshold, assuming ${DEFAULT_SWITCH_THRESHOLD}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return DEFAULT_SWITCH_THRESHOLD;
  }
}

export default function plugin(bb: BbPluginApi): void {
  let codexTierCache: { expiresAt: number; tiers: Map<string, string> } | null =
    null;

  bb.rpc.register(rpcContract, {
    usage_get: async () => {
      const fetchedAt = Date.now();
      try {
        const status = await bb.sdk.plugins.callRpc({
          pluginId: "account-pool",
          method: "status.get",
          input: null,
          outputSchema: poolStatusSchema,
        });
        let codexTiers = codexTierCache?.tiers ?? new Map<string, string>();
        if (codexTierCache === null || codexTierCache.expiresAt <= fetchedAt) {
          try {
            codexTiers = await fetchOfficialCodexTiers(bb, status.accounts);
          } catch (cause) {
            bb.log.debug(
              `Could not supplement Codex tiers from provider usage: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
            );
            codexTiers = new Map();
          }
          codexTierCache = {
            expiresAt: fetchedAt + CODEX_TIER_CACHE_MS,
            tiers: codexTiers,
          };
        }
        const threshold = await fetchSwitchThreshold(bb);
        return {
          accounts: status.accounts.map((account) =>
            normalizeAccount(account, {
              threshold,
              now: Date.now(),
              tierFallback:
                account.email === null
                  ? null
                  : (codexTiers.get(normalizedEmail(account.email)) ?? null),
            }),
          ),
          fetchedAt,
          error: null,
        };
      } catch (cause) {
        bb.log.debug(
          `Could not read Account Pooler status: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
        return { accounts: [], fetchedAt, error: ACCOUNT_POOL_UNAVAILABLE };
      }
    },
  });
}
