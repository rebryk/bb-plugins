import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CHANGED_CHANNEL } from "./shared";

type Installed = Awaited<
  ReturnType<BbPluginApi["sdk"]["plugins"]["list"]>
>["plugins"][number];

/** Each frequency option: its label and the hours between runs. */
const FREQUENCIES: Record<string, [label: string, hours: number]> = {
  hourly: ["Every hour", 1],
  "every-6-hours": ["Every 6 hours", 6],
  daily: ["Every day", 24],
  weekly: ["Every week", 168],
};
/** One kv key per plugin whose switch is on. */
const ON = "on:";
const LAST_RUN_KEY = "lastRunAt";

/** Built-in plugins update with BB; pinned and local ones never update. */
const takesUpdates = (p: Installed) =>
  p.provenance !== "builtin" &&
  !p.source.startsWith("path:") &&
  p.updateState.outcome !== "pinned";

/** BB's own marketplaces first, then the others, direct installs last. */
const rank = (source: string) =>
  ["bb-official", "bb-community"].indexOf(source) + 1 ||
  (source === "direct" ? 4 : 3);

function toRow(
  p: Installed,
  autoUpdate: boolean,
  checking: boolean,
  updating: boolean,
) {
  const { outcome, lastFailure } = p.updateState;
  return {
    id: p.id,
    name: p.name ?? p.id,
    version: p.version,
    icon: p.icon,
    iconUrl: p.iconUrl,
    autoUpdate,
    update: outcome ?? null,
    /** Why the last update BB tried was rolled back; BB records it itself. */
    lastFailure: lastFailure?.detail ?? null,
    checking,
    updating,
  };
}

export type PluginRow = ReturnType<typeof toRow>;
export type SourceGroup = { id: string; label: string; plugins: PluginRow[] };
export type Overview = {
  checking: boolean;
  lastCheckAt: number | null;
  groups: SourceGroup[];
};

export const rpcContract = defineRpcContract({
  listAutoUpdates: { input: z.null(), output: z.custom<Overview>() },
  setAutoUpdate: {
    input: z.object({
      pluginId: z.string().min(1).max(200),
      enabled: z.boolean(),
    }),
    output: z.null(),
  },
  /** Check, without installing, the plugins BB hasn't checked in 2 minutes. */
  refreshAutoUpdates: { input: z.null(), output: z.null() },
  checkForUpdates: { input: z.null(), output: z.null() },
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    frequency: {
      type: "select",
      label: "Check for Updates",
      description:
        "How often BB looks for new versions of the plugins turned on below and installs them.",
      options: Object.keys(FREQUENCIES),
      experimental_optionLabels: Object.fromEntries(
        Object.entries(FREQUENCIES).map(([value, [label]]) => [value, label]),
      ),
      default: "hourly",
    },
  });
  const kv = bb.storage.kv;
  const publish = () => bb.realtime.publish(CHANGED_CHANNEL, null);
  const updatable = async () =>
    (await bb.sdk.plugins.list()).plugins.filter(takesUpdates);
  const readOn = async () =>
    new Set((await kv.list(ON)).map((key) => key.slice(ON.length)));

  const checks = new Map<string, Promise<boolean>>();
  let running: Promise<void> | null = null;
  let updating: string | null = null;

  // One check per plugin, side by side: BB's check of every plugin runs them
  // one after another and outlasts the SDK's request timeout.
  function check(pluginId: string) {
    let pending = checks.get(pluginId);
    if (pending === undefined) {
      pending = bb.sdk.plugins
        .checkUpdates({ pluginId })
        .then(
          (entries) =>
            entries.some(
              (e) => e.id === pluginId && e.outcome === "update-available",
            ),
          (error) => {
            bb.log.warn(`Could not check ${pluginId}: ${error}`);
            return false;
          },
        )
        .finally(() => {
          checks.delete(pluginId);
          publish();
        });
      checks.set(pluginId, pending);
    }
    return pending;
  }

  function checkAll(pluginIds: string[]) {
    const all = Promise.all(pluginIds.map(check));
    publish();
    return all;
  }

  /** Check, then install the updates of plugins switched on; one run at a time. */
  function run(onlySwitchedOn: boolean) {
    running ??= (async () => {
      await kv.set(LAST_RUN_KEY, Date.now());
      const on = await readOn();
      const ids = (await updatable())
        .map((p) => p.id)
        .filter((id) => !onlySwitchedOn || on.has(id));
      const available = await checkAll(ids);
      const install = ids.filter((id, i) => available[i] && on.has(id));
      for (const pluginId of install.filter((id) => id !== bb.pluginId)) {
        updating = pluginId;
        publish();
        await bb.sdk.plugins
          .applyUpdate({ pluginId })
          .catch((error) =>
            bb.log.warn(`Could not update ${pluginId}: ${error}`),
          );
      }
      // Updating this plugin reloads it, so it goes last, as a job BB runs on.
      if (install.includes(bb.pluginId)) {
        await bb.sdk.plugins.experimental_startUpdate({
          pluginId: bb.pluginId,
        });
      }
    })()
      .catch((error) => bb.log.warn(`Update run failed: ${error}`))
      .finally(() => {
        running = null;
        updating = null;
        publish();
      });
    publish();
    return running;
  }

  bb.rpc.register(rpcContract, {
    async listAutoUpdates() {
      const [{ plugins }, on, lastCheckAt] = await Promise.all([
        bb.sdk.plugins.list(),
        readOn(),
        kv.get<number>(LAST_RUN_KEY),
      ]);
      const listed = plugins
        .filter(takesUpdates)
        .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
      const groups = new Map<string, SourceGroup>();
      for (const p of listed) {
        const id = p.catalogMarketplaceName || "direct";
        const label =
          id === "direct" ? "Installed Directly" : (p.publisherLabel ?? id);
        if (!groups.has(id)) groups.set(id, { id, label, plugins: [] });
        groups
          .get(id)!
          .plugins.push(
            toRow(p, on.has(p.id), checks.has(p.id), updating === p.id),
          );
      }
      return {
        checking: running !== null,
        lastCheckAt: lastCheckAt ?? null,
        groups: [...groups.values()].sort(
          (a, b) => rank(a.id) - rank(b.id) || a.label.localeCompare(b.label),
        ),
      };
    },
    async setAutoUpdate({ pluginId, enabled }) {
      await (enabled ? kv.set(ON + pluginId, true) : kv.delete(ON + pluginId));
      publish();
      return null;
    },
    async refreshAutoUpdates() {
      const since = Date.now() - 2 * 60 * 1000;
      const stale = (await updatable()).filter(
        (p) => (p.updateState.lastCheckAt ?? 0) < since,
      );
      void checkAll(stale.map((p) => p.id));
      return null;
    },
    checkForUpdates() {
      void run(false);
      return null;
    },
  });

  bb.background.schedule("checkForUpdates", "*/5 * * * *", async () => {
    const [{ frequency }, lastRunAt, on] = await Promise.all([
      settings.get(),
      kv.get<number>(LAST_RUN_KEY),
      readOn(),
    ]);
    // A minute of slack: a tick that lands early still counts, so hourly is hourly.
    const interval =
      (FREQUENCIES[frequency]?.[1] ?? 1) * 60 * 60 * 1000 - 60 * 1000;
    if (on.size > 0 && Date.now() - (lastRunAt ?? 0) >= interval)
      await run(true);
  });
}
