import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CHANGED_CHANNEL } from "./shared";
import { readCandidateVersion } from "./candidate-version";

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

type VersionCheck = {
  source: string;
  candidate: string;
  version?: string;
  error?: string;
};
const sourceKey = (p: Installed) => JSON.stringify([p.source, p.rootDir]);

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
  checked?: VersionCheck,
) {
  const { outcome, lastFailure } = p.updateState;
  return {
    id: p.id,
    name: p.name ?? p.id,
    version: p.version,
    icon: p.icon,
    iconUrl: p.iconUrl,
    autoUpdate,
    update: checked?.error
      ? "unavailable"
      : checked?.version === p.version
        ? "unchanged"
        : (outcome ?? null),
    versionCheckError: checked?.error ?? null,
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
  // One immutable candidate per plugin; a new source or commit invalidates it.
  const versions = new Map<string, VersionCheck>();
  const checkedVersion = (p: Installed) => {
    const checked = versions.get(p.id);
    return checked?.source === sourceKey(p) &&
      checked.candidate === (p.updateState.availableVersion ?? "")
      ? checked
      : undefined;
  };
  let running: Promise<void> | null = null;
  let updating: string | null = null;

  // One check per plugin, side by side: BB's check of every plugin runs them
  // one after another and outlasts the SDK's request timeout.
  function check(p: Installed) {
    const pluginId = p.id;
    let pending = checks.get(pluginId);
    if (pending === undefined) {
      pending = bb.sdk.plugins
        .checkUpdates({ pluginId })
        .then(async (entries) => {
          const entry = entries.find((e) => e.id === pluginId);
          if (entry?.outcome !== "update-available") {
            versions.delete(pluginId);
            return false;
          }
          const candidate = entry.candidate?.version;
          const source = sourceKey(p);
          try {
            if (!candidate || !p.version.trim())
              throw new Error("BB did not report the versions to compare.");
            let checked = versions.get(pluginId);
            if (
              checked?.source !== source ||
              checked.candidate !== candidate ||
              checked.version === undefined
            ) {
              const origin = p.source.startsWith("npm:")
                ? { requested: p.source }
                : await bb.sdk.plugins.getSource({ pluginId });
              checked = {
                source,
                candidate,
                version: await readCandidateVersion(origin, candidate),
              };
              versions.set(pluginId, checked);
            }
            return checked.version !== p.version;
          } catch (error) {
            const detail =
              error instanceof Error ? error.message : "Unknown error.";
            versions.set(pluginId, {
              source,
              candidate: candidate ?? "",
              error: detail,
            });
            bb.log.warn(
              `Skipped ${pluginId}: could not verify its package version. ${detail}`,
            );
            return false;
          }
        })
        .catch((error) => {
          versions.delete(pluginId);
          bb.log.warn(`Could not check ${pluginId}: ${error}`);
          return false;
        })
        .finally(() => {
          checks.delete(pluginId);
          publish();
        });
      checks.set(pluginId, pending);
    }
    return pending;
  }

  function checkAll(plugins: Installed[]) {
    const all = Promise.all(plugins.map(check));
    publish();
    return all;
  }

  async function shouldInstall(pluginId: string) {
    const [plugins, on] = await Promise.all([updatable(), readOn()]);
    const p = plugins.find((p) => p.id === pluginId);
    const checked = p && checkedVersion(p);
    return (
      p !== undefined &&
      on.has(pluginId) &&
      checked?.version !== undefined &&
      checked.version !== p.version
    );
  }

  /** Check, then install the updates of plugins switched on; one run at a time. */
  function run(onlySwitchedOn: boolean) {
    running ??= (async () => {
      await kv.set(LAST_RUN_KEY, Date.now());
      const on = await readOn();
      const plugins = (await updatable()).filter(
        (p) => !onlySwitchedOn || on.has(p.id),
      );
      const available = await checkAll(plugins);
      const install = plugins.filter((_, i) => available[i]).map((p) => p.id);
      for (const pluginId of install.filter((id) => id !== bb.pluginId)) {
        // Earlier installs can take minutes; recheck immediately before each one.
        if (!(await shouldInstall(pluginId))) continue;
        updating = pluginId;
        publish();
        await bb.sdk.plugins
          .applyUpdate({ pluginId })
          .catch((error) =>
            bb.log.warn(`Could not update ${pluginId}: ${error}`),
          );
      }
      // Updating this plugin reloads it, so it goes last, as a job BB runs on.
      if (install.includes(bb.pluginId) && (await shouldInstall(bb.pluginId))) {
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
            toRow(
              p,
              on.has(p.id),
              checks.has(p.id),
              updating === p.id,
              checkedVersion(p),
            ),
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
        (p) =>
          (p.updateState.lastCheckAt ?? 0) < since ||
          (p.updateState.outcome === "update-available" &&
            checkedVersion(p) === undefined),
      );
      void checkAll(stale);
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
