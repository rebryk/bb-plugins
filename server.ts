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

interface CandidateWindow {
  utilization: number | null;
  resetAt: number | null;
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

/** Pick the shortest shared quota window Account Pooler has observed. */
export function shortestWindow(account: PoolAccount): CandidateWindow | null {
  const candidates: CandidateWindow[] = [
    {
      utilization: account.fiveHourUtilization,
      resetAt: account.fiveHourResetAt,
      label: "5 hours",
      durationMinutes: 300,
    },
    {
      utilization: account.sevenDayUtilization,
      resetAt: account.sevenDayResetAt,
      label: "Weekly",
      durationMinutes: 10_080,
    },
    ...account.limitWindows.map((window) => ({
      utilization: window.utilization,
      resetAt: window.resetAt,
      label: windowLabel(window.windowMinutes, window.slot),
      durationMinutes: window.windowMinutes,
    })),
  ].filter(
    (candidate) =>
      candidate.utilization !== null || candidate.resetAt !== null,
  );

  if (candidates.length === 0) return null;
  return candidates.reduce((selected, candidate) => {
    const selectedDuration =
      selected.durationMinutes ?? Number.POSITIVE_INFINITY;
    const candidateDuration =
      candidate.durationMinutes ?? Number.POSITIVE_INFINITY;
    if (candidateDuration !== selectedDuration) {
      return candidateDuration < selectedDuration ? candidate : selected;
    }
    if (selected.utilization === null && candidate.utilization !== null) {
      return candidate;
    }
    return selected;
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
  tierFallback: string | null = null,
): UsageAccount {
  const selected = shortestWindow(account);
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
        return {
          accounts: status.accounts.map((account) =>
            normalizeAccount(
              account,
              account.email === null
                ? null
                : (codexTiers.get(normalizedEmail(account.email)) ?? null),
            ),
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
