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

const resetTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * "5h 23% · week 41% · resets Fri 4:00 PM PT" for the account that most
 * likely served the thread's last turn: the provider's most recently used
 * enabled account, else its first ready one. Null when the provider is not
 * routed through the pool or the account reports no windows.
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
    .map((window) => ({
      ...window,
      // A window past its reset has started over.
      utilization:
        window.resetAt !== null && window.resetAt <= now
          ? 0
          : (window.utilization ?? 0),
    }))
    .sort((a, b) => (a.windowMinutes ?? 0) - (b.windowMinutes ?? 0));
  if (windows.length === 0) return null;
  const parts = windows.map(
    (window) =>
      `${windowName(window.windowMinutes)} ${Math.round(window.utilization * 100)}%`,
  );
  const closest = [...windows].sort((a, b) => b.utilization - a.utilization)[0];
  if (closest?.resetAt && closest.resetAt > now) {
    parts.push(`resets ${resetTime.format(closest.resetAt)} PT`);
  }
  return parts.join(" · ");
}
