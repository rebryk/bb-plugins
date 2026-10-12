import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type { Overview, PluginRow, rpcContract } from "./server";
import { CHANGED_CHANNEL } from "./shared";

const UPDATE_STATUS: Partial<Record<string, string>> = {
  "update-available": "Update available",
  incompatible: "Update needs a newer BB",
  unavailable: "Can't check for updates",
};

const when = (at: number) =>
  new Date(at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** What a row says after its version, most pressing first. */
function statusOf({ updating, checking, update, lastFailure }: PluginRow) {
  if (updating) return "Updating…";
  if (checking) return "Checking…";
  if (update === "update-available" && lastFailure !== null) {
    return `Update failed: ${lastFailure}`;
  }
  return UPDATE_STATUS[update ?? ""];
}

function PluginItem({
  plugin,
  onToggle,
}: {
  plugin: PluginRow;
  onToggle: () => void;
}) {
  const status = statusOf(plugin);
  const on = plugin.autoUpdate;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
        {plugin.iconUrl === null ? (
          <Icon name={plugin.icon ?? "Zap"} className="size-4" aria-hidden />
        ) : (
          // SVG branding icons take the text color, as in BB's own lists.
          <span
            className="size-4 bg-current"
            style={{
              mask: `url(${JSON.stringify(plugin.iconUrl)}) center / contain no-repeat`,
            }}
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground">{plugin.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {plugin.version}
          {status && ` · ${status}`}
        </div>
      </div>
      {/* BB's switch markup, which themes such as San Francisco restyle. */}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`Auto-update ${plugin.name}`}
        data-state={on ? "checked" : "unchecked"}
        onClick={onToggle}
        className={`inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? "border-transparent bg-foreground" : "border-input bg-muted"}`}
      >
        <span
          data-state={on ? "checked" : "unchecked"}
          className={`block size-4 rounded-full transition-transform ${on ? "translate-x-4 bg-background" : "bg-foreground"}`}
        />
      </button>
    </li>
  );
}

function AutoUpdates() {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const connection = useRealtimeConnectionState();
  const [overview, setOverview] = useState<Overview>();
  const [error, setError] = useState<string>();
  const fail = (cause: Error) => setError(cause.message);

  const refetch = useCallback(() => {
    rpc.call("listAutoUpdates", null).then(setOverview, fail);
  }, [rpc]);
  // On mount, and once a dropped connection is back.
  useEffect(() => {
    if (connection !== "reconnecting") refetch();
  }, [connection, refetch]);
  // Then the server checks stale plugins and publishes as each check ends.
  useEffect(() => {
    rpc.call("refreshAutoUpdates", null).then(refetch, fail);
  }, [rpc, refetch]);
  useRealtime(CHANGED_CHANNEL, refetch);
  useEffect(
    () =>
      sdk.subscribe({
        event: "system:changed",
        callback: ({ changes }) => {
          if (
            changes.some(
              (change) =>
                change === "plugins-changed" ||
                change === "plugin-update-jobs-changed",
            )
          ) {
            refetch();
          }
        },
      }),
    [sdk, refetch],
  );

  // A failed save shows its error, and the refetch puts the switch back.
  const save = (call: Promise<unknown>) =>
    call.then(() => setError(undefined), fail).finally(refetch);
  const toggle = (pluginId: string, enabled: boolean) => {
    const flip = (plugin: PluginRow) =>
      plugin.id === pluginId ? { ...plugin, autoUpdate: enabled } : plugin;
    setOverview(
      (current) =>
        current && {
          ...current,
          groups: current.groups.map((group) => ({
            ...group,
            plugins: group.plugins.map(flip),
          })),
        },
    );
    save(rpc.call("setAutoUpdate", { pluginId, enabled }));
  };
  const checkNow = () => {
    setOverview((current) => current && { ...current, checking: true });
    save(rpc.call("checkForUpdates", null));
  };

  const errorNote = error && (
    <p role="alert" className="text-xs text-destructive">
      {error}
    </p>
  );
  if (!overview) {
    return (
      errorNote || (
        <p className="text-xs text-muted-foreground">Loading plugins…</p>
      )
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {overview.checking
            ? "Checking for updates…"
            : overview.lastCheckAt === null
              ? "Not checked yet."
              : `Last checked ${when(overview.lastCheckAt)}.`}
        </p>
        <button
          type="button"
          disabled={overview.checking}
          onClick={checkNow}
          className="inline-flex h-8 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md border border-input px-3 text-xs font-medium transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          Check Now
        </button>
      </div>
      {errorNote}
      {overview.groups.map((group) => (
        <section key={group.id} aria-label={group.label} className="space-y-2">
          <h3 className="px-1 text-xs font-medium text-muted-foreground">
            {group.label}
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {group.plugins.map((plugin) => (
              <PluginItem
                key={plugin.id}
                plugin={plugin}
                onToggle={() => toggle(plugin.id, !plugin.autoUpdate)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "autoUpdates",
    title: "Plugins",
    description: "Turn on the plugins BB should keep up to date.",
    component: AutoUpdates,
  });
});
