import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { UsageAccount, rpcContract } from "./server";
import { formatReset, usagePercent, usageTone } from "./presentation";
import "./app.css";

const REFRESH_INTERVAL_MS = 30_000;
const CLOCK_INTERVAL_MS = 15_000;

function ClaudeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 149 149"
      fill="currentColor"
      className="size-[14px] shrink-0"
    >
      <path d="M29.05 98.54 58.19 82.19l.49-1.42-.49-.79h-1.42l-21.52-.75-28.43-1.35-3.52-.75L0 72.78l.34-2.17 2.96-1.99 53.47 4.15h1.91l.34-.97-1.46-1.2-38.55-26.28-4.46-3.04-2.25-2.85-.97-6.22 4.05-4.46 5.44.37 34.04 25.04 3.15 2.23.11-1.45-23.31-42.36-.64-4.5L38.78.82 41.33 0l6.15.82 2.59 2.25 22.42 46.76 2.06 6.71h.97l2.25-24.38 1.91-21.34L82 5.2l4.61-3.04 3.6 1.72 2.96 4.24-7.87 44.1h1.31l31.9-35.62h6.37l4.69 6.97-27.78 42.14.45.67 39.66-8.2 5.14 2.4.56 2.44-2.02 4.99-47.62 10.87-.26.19.3.37 23.66 1.12 18.64 1.39 4.87 3.22 2.92 3.94-.49 3-7.5 3.82-42.96-10.04v.67l34.61 31.73.79 3.56-1.99 2.81-2.1-.3-30.75-24.86h-.79v1.05l17.96 31.76.75 6.67-1.05 2.17-3.75 1.31-4.12-.75-25.12-37.28-.86.49-4.16 44.81-1.95 2.29-4.5 1.72-3.75-2.85-1.99-4.61 9.15-46.35-.07-.26-.86.11-34.86 47.75-2.55 1.01-4.42-2.29.41-4.09 32.82-41.69-.04-.97h-.34l-39.15 25.42-6.97.9-3-2.81.37-4.61 1.42-1.5 11.63-8.06Z" />
    </svg>
  );
}

function CodexIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      className="size-[14px] shrink-0"
    >
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.911 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.182a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.096 5.98 5.98 0 0 0 .511 4.911 6.051 6.051 0 0 0 6.514 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.989 5.989 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073Zm-9.022 12.608a4.476 4.476 0 0 1-2.877-1.041l4.92-2.839a.795.795 0 0 0 .393-.681v-6.736l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494Zm-9.661-4.125a4.47 4.47 0 0 1-.535-3.014l4.926 2.843a.771.771 0 0 0 .78 0l5.843-3.368v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.499 4.499 0 0 1-6.141-1.646ZM2.341 7.896a4.485 4.485 0 0 1 2.365-1.973V11.6a.766.766 0 0 0 .388.677l5.815 3.354-2.02 1.168a.076.076 0 0 1-.071 0l-4.831-2.786a4.504 4.504 0 0 1-1.646-6.117Zm16.596 3.855-5.833-3.387 2.015-1.164a.076.076 0 0 1 .071 0l4.831 2.791a4.494 4.494 0 0 1-.677 8.104v-5.677a.79.79 0 0 0-.407-.667Zm2.011-3.023-4.916-2.867a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.831-2.787a4.499 4.499 0 0 1 6.68 4.679ZM8.307 12.863l-2.02-1.164a.08.08 0 0 1-.038-.056V6.074a4.499 4.499 0 0 1 7.375-3.453l-4.92 2.838a.795.795 0 0 0-.392.681Zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5Z" />
    </svg>
  );
}

function ProviderIcon({ provider }: { provider: UsageAccount["provider"] }) {
  return provider === "claude" ? <ClaudeIcon /> : <CodexIcon />;
}

function statusLine(account: UsageAccount, now: number): string {
  if (!account.enabled || account.status === "disabled") return "disabled";
  if (account.status === "error") return "unavailable";
  if (account.status === "held") {
    return formatReset(account.resetAt, now).replace("reset", "retry");
  }
  return formatReset(account.resetAt, now);
}

function AccountRow({ account, now }: { account: UsageAccount; now: number }) {
  const percent = usagePercent(account.utilization);
  const unavailable = !account.enabled || account.status === "error";
  const blocked = account.blocked && !unavailable;
  const tone = blocked
    ? "critical"
    : percent === null
      ? "neutral"
      : usageTone(percent);
  const reset = statusLine(account, now);
  const providerName = account.provider === "claude" ? "Claude" : "Codex";

  return (
    <li
      aria-label={`${providerName} ${account.label}, ${account.tier}${
        blocked ? `, ${account.windowLabel ?? "quota"} limit reached` : ""
      }`}
      className={`pool-usage-row ${unavailable ? "opacity-50" : ""}`}
    >
      <span className="pool-usage-provider flex size-4 items-center justify-center text-muted-foreground">
        <ProviderIcon provider={account.provider} />
      </span>
      <span className="pool-usage-plan min-w-0 truncate text-xs text-foreground">
        {account.tier}
      </span>
      <div className="pool-usage-meter min-w-0">
        <div className="flex items-center gap-1.5">
          <div
            className="pool-usage-track h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
            role="progressbar"
            aria-label={`${providerName} ${account.label} usage`}
            aria-valuemin={0}
            aria-valuemax={100}
            {...(percent === null
              ? { "aria-valuetext": "Usage unavailable" }
              : { "aria-valuenow": percent })}
          >
            <div
              className={`pool-usage-fill pool-usage-fill--${tone} h-full rounded-full`}
              style={{ width: `${percent ?? (blocked ? 100 : 0)}%` }}
            />
          </div>
          <span className="w-7 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
            {percent === null ? "—" : `${percent}%`}
          </span>
        </div>
        <div
          className={`pool-usage-meta ${
            blocked ? "pool-usage-meta--blocked" : ""
          } flex min-w-0 items-center justify-between gap-2 text-[9px] leading-none text-muted-foreground/75`}
        >
          <span className="truncate">{account.windowLabel ?? "Usage"}</span>
          <span className="shrink-0">{reset}</span>
        </div>
      </div>
    </li>
  );
}

function UsageDisclosure() {
  const rpc = useRpc<typeof rpcContract>();
  const [accounts, setAccounts] = useState<UsageAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refetch = useCallback(() => {
    let current = true;
    void rpc.call("usage_get").then(
      (result) => {
        if (!current) return;
        setAccounts(result.accounts);
        setError(result.error);
        setNow(Date.now());
      },
      () => {
        if (current) setError("Usage could not be loaded.");
      },
    );
    return () => {
      current = false;
    };
  }, [rpc]);

  useEffect(() => {
    let cancelPending = refetch();
    const refreshTimer = window.setInterval(() => {
      cancelPending();
      cancelPending = refetch();
    }, REFRESH_INTERVAL_MS);
    const clockTimer = window.setInterval(
      () => setNow(Date.now()),
      CLOCK_INTERVAL_MS,
    );
    return () => {
      cancelPending();
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [refetch]);

  return (
    <div className="pool-usage-root">
      {accounts === null && error === null ? (
        <span className="sr-only" role="status">
          Loading account usage…
        </span>
      ) : error !== null && (accounts === null || accounts.length === 0) ? (
        <p
          className="px-2 py-2 text-[11px] leading-snug text-muted-foreground"
          role="status"
        >
          {error}
        </p>
      ) : accounts !== null && accounts.length === 0 ? (
        <p
          className="px-2 py-2 text-[11px] text-muted-foreground"
          role="status"
        >
          No pooled accounts.
        </p>
      ) : (
        <ul
          className={`pool-usage-list ${
            accounts !== null && accounts.length > 8
              ? "pool-usage-list--scrollable"
              : ""
          }`}
        >
          {accounts?.map((account) => (
            <AccountRow key={account.id} account={account} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.experimental_sidebarFooter.register({
    kind: "disclosure",
    id: "pool-usage",
    label: "Account usage",
    icon: "ChartColumn",
    component: UsageDisclosure,
  });
});
