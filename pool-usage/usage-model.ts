import type { UsageAccount, UsageSnapshot, UsageWindow } from "./server";

export const DEFAULT_RED_THRESHOLD = 80;

/** How many five-hour windows a weekly allowance holds. */
const WEEK_IN_FIVE_HOUR_WINDOWS = 5.5;

const RESET_HORIZON_MS = 7 * 24 * 60 * 60_000;

/** Changes smaller than this round away on screen. */
const VISIBLE_CHANGE = 0.005;

export interface UsageStep {
  at: number;
  /** Share of capacity still used right after this reset. */
  used: number;
}

export interface ProviderUsage {
  /** bb's provider id. */
  provider: string;
  /**
   * Share of capacity that can't serve a request now: spent quota plus
   * accounts without a trustworthy reading. Null when no account counts.
   */
  used: number | null;
  /** The spent-quota part of `used`, the only part a reset frees. */
  spent: number;
  /** Resets that lower `used` within a week, soonest first. */
  steps: UsageStep[];
  accounts: UsageAccount[];
}

function usedAt(window: UsageWindow, time: number): number | null {
  if (window.resetAt !== null && window.resetAt <= time) return 0;
  if (window.rejected) return 1;
  if (window.utilization === null) return null;
  return Math.min(1, Math.max(0, window.utilization));
}

export function countsTowardCapacity(account: UsageAccount): boolean {
  return !account.disabled && account.weight > 0;
}

/**
 * The share of one short window the account could serve at `time`, assuming
 * nobody uses it meanwhile. A weekly allowance holds several five-hour
 * windows, so it binds only once it runs low.
 */
function availableAt(
  account: UsageAccount,
  time: number,
  switchThreshold: number,
): number {
  if (account.heldUntil !== null && account.heldUntil > time) return 0;
  const cleared =
    (account.heldUntil !== null && account.heldUntil <= time) ||
    account.windows.some(({ resetAt }) => resetAt !== null && resetAt <= time);
  if (account.blocked && !cleared) return 0;
  const hasFiveHour = account.windows.some(({ minutes }) => minutes === 300);
  let available = 1;
  for (const window of account.windows) {
    const used = usedAt(window, time) ?? 0;
    const remaining = used >= switchThreshold ? 0 : 1 - used;
    const scale =
      hasFiveHour && window.minutes === 10_080 ? WEEK_IN_FIVE_HOUR_WINDOWS : 1;
    available = Math.min(available, remaining * scale);
  }
  return available;
}

function share(part: number, total: number): number {
  const value = part / total;
  // Weighted sums leave float dust that would render as "<1%".
  return value < 1e-9 ? 0 : Math.min(1, value);
}

function usageAt(
  accounts: readonly UsageAccount[],
  time: number,
  switchThreshold: number,
): { used: number; spent: number } | null {
  let total = 0;
  let offline = 0;
  let free = 0;
  for (const account of accounts) {
    if (!countsTowardCapacity(account)) continue;
    total += account.weight;
    if (account.offline !== null) offline += account.weight;
    else free += account.weight * availableAt(account, time, switchThreshold);
  }
  if (total === 0) return null;
  return {
    used: share(total - free, total),
    spent: share(total - offline - free, total),
  };
}

function resetSteps(
  accounts: readonly UsageAccount[],
  used: number,
  switchThreshold: number,
  now: number,
): UsageStep[] {
  const times = new Set<number>();
  for (const account of accounts) {
    if (!countsTowardCapacity(account) || account.offline !== null) continue;
    for (const time of [
      account.heldUntil,
      ...account.windows.map(({ resetAt }) => resetAt),
    ]) {
      if (time !== null && time > now && time <= now + RESET_HORIZON_MS) {
        times.add(time);
      }
    }
  }
  const steps: UsageStep[] = [];
  let previous = used;
  for (const time of [...times].sort((a, b) => a - b)) {
    const next = usageAt(accounts, time, switchThreshold)?.used ?? previous;
    if (previous - next >= VISIBLE_CHANGE) {
      steps.push({ at: time, used: next });
      previous = next;
    }
  }
  return steps;
}

/** One entry per provider that has accounts, in the snapshot's order. */
export function summarizeUsage(
  snapshot: UsageSnapshot,
  now: number,
): ProviderUsage[] {
  return snapshot.providers.flatMap(({ id: provider, switchThreshold }) => {
    const own = snapshot.accounts.filter(
      (account) => account.provider === provider,
    );
    if (own.length === 0) return [];
    const current = usageAt(own, now, switchThreshold);
    return [
      {
        provider,
        used: current?.used ?? null,
        spent: current?.spent ?? 0,
        steps:
          current === null
            ? []
            : resetSteps(own, current.used, switchThreshold, now),
        accounts: own,
      },
    ];
  });
}

/** Whether the summary has spent quota worth a reset forecast. */
export function hasSpentQuota(usage: ProviderUsage): boolean {
  return usage.spent >= VISIBLE_CHANGE;
}

export function formatPercent(fraction: number): string {
  if (fraction > 0 && fraction < 0.005) return "<1%";
  return `${Math.round(fraction * 100)}%`;
}

/** Compares what the user reads, so "80%" is red at an 80% threshold. */
export function isHot(fraction: number, threshold: number): boolean {
  return Math.round(fraction * 100) >= threshold;
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
}

export function redThreshold(
  values: Record<string, unknown> | undefined,
): number {
  const value = values?.redThreshold;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(1, Math.round(value)))
    : DEFAULT_RED_THRESHOLD;
}
