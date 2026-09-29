/** Realtime channel the server publishes on after every change to the ETAs. */
export const ETA_CHANNEL = "threadEtas";

/** Time left as `M:SS`, or `H:MM:SS` from an hour up, rounded up to a second. */
export function formatEta(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = pad(total % 60);
  return hours > 0
    ? `${hours}:${pad(minutes)}:${seconds}`
    : `${minutes}:${seconds}`;
}
