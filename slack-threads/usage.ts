import { z } from "zod";

/** The part of the Account Pooler's `status.get` the footer reads. */
const windowSchema = z.looseObject({
  windowMinutes: z.number().nullable(),
  utilization: z.number().nullable(),
  resetAt: z.number().nullable(),
});
export const poolStatusSchema = z.looseObject({
  routing: z.looseObject({
    claude: z.boolean().optional(),
    codex: z.boolean().optional(),
  }),
  accounts: z.array(
    z.looseObject({
      provider: z.string(),
      enabled: z.boolean(),
      priority: z.number(),
      status: z.string(),
      lastUsedAt: z.number().nullable().optional(),
      limitWindows: z.array(windowSchema),
    }),
  ),
});
export type PoolStatus = z.infer<typeof poolStatusSchema>;

/** The pool's provider for a bb provider, or null when it is not pooled. */
const POOL_PROVIDERS: Record<string, "claude" | "codex"> = {
  "claude-code": "claude",
  codex: "codex",
};

const windowName = (minutes: number | null) =>
  minutes === 300
    ? "5h"
    : minutes === 1440
      ? "day"
      : minutes === 10080
        ? "week"
        : minutes === null
          ? "limit"
          : minutes % 1440 === 0
            ? `${minutes / 1440}d`
            : minutes % 60 === 0
              ? `${minutes / 60}h`
              : `${minutes}m`;

const FIVE_HOURS = 300;
const WEEK = 10080;
/** The weekly window takes over the footer from this utilization on. */
const WEEK_ALERT = 0.95;

/** "45m", "1h 40m", "2d 5h": the time left until `resetAt`. */
const timeLeft = (ms: number) => {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  return `${rest}m`;
};

/**
 * One usage window of the account that most likely served the thread's last
 * turn (the provider's most recently used enabled account, else its first
 * ready one): "5h usage 42% · resets in 1h 40m", or the weekly window once it
 * reaches 95% or when there is no five-hour window. Null when the provider is
 * not routed through the pool or the account reports no windows.
 */
export function describeUsage(
  status: PoolStatus,
  providerId: string,
  now = Date.now(),
): string | null {
  const provider = POOL_PROVIDERS[providerId];
  if (!provider || status.routing[provider] !== true) return null;
  const accounts = status.accounts
    .filter((account) => account.provider === provider && account.enabled)
    .sort((a, b) => a.priority - b.priority);
  const recent = accounts
    .filter((candidate) => candidate.lastUsedAt)
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))[0];
  const account =
    recent ?? accounts.find((candidate) => candidate.status === "ready");
  const windows = (account?.limitWindows ?? [])
    .filter((window) => window.utilization !== null)
    .map((window) => {
      // A window past its reset has started over.
      const over = window.resetAt !== null && window.resetAt <= now;
      return {
        ...window,
        utilization: over ? 0 : (window.utilization ?? 0),
        resetAt: over ? null : window.resetAt,
      };
    })
    .sort((a, b) => (a.windowMinutes ?? 0) - (b.windowMinutes ?? 0));
  const five = windows.find((window) => window.windowMinutes === FIVE_HOURS);
  const week = windows.find((window) => window.windowMinutes === WEEK);
  const shown =
    week && (week.utilization >= WEEK_ALERT || !five)
      ? week
      : (five ?? windows[0]);
  if (!shown) return null;
  const usage = `${windowName(shown.windowMinutes)} usage ${Math.round(shown.utilization * 100)}%`;
  return shown.resetAt
    ? `${usage} · resets in ${timeLeft(shown.resetAt - now)}`
    : usage;
}
