export type UsageTone = "neutral" | "warning" | "critical";

export function usageTone(percent: number): UsageTone {
  if (percent >= 90) return "critical";
  if (percent >= 75) return "warning";
  return "neutral";
}

export function usagePercent(utilization: number | null): number | null {
  if (utilization === null || !Number.isFinite(utilization)) return null;
  return Math.round(Math.max(0, Math.min(1, utilization)) * 100);
}

export function formatReset(resetAt: number | null, now: number): string {
  if (resetAt === null) return "no reset time";
  const remainingMs = resetAt - now;
  if (remainingMs <= 0) return "resetting";
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  if (remainingMinutes < 60) return `reset ${remainingMinutes}m`;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  if (hours < 24) {
    return `reset ${hours}h${minutes === 0 ? "" : ` ${minutes}m`}`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `reset ${days}d${remainingHours === 0 ? "" : ` ${remainingHours}h`}`;
}
