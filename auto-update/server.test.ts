import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, { type Overview } from "./server";

type Installed = Record<string, unknown> & { id: string };
const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-12T12:00:00Z");
const installed = (o: Installed) => ({
  name: o.id,
  version: "0.1.0",
  source: `git:https://x/${o.id}.git@main`,
  provenance: "catalog",
  catalogMarketplaceName: "bb-community",
  publisherLabel: "BB Community",
  icon: null,
  iconUrl: null,
  updateState: { outcome: "current" },
  ...o,
});
const PLUGINS = [
  installed({
    id: "memory",
    provenance: "builtin",
    catalogMarketplaceName: "bb-official",
    updateState: { outcome: "pinned" },
  }),
  installed({ id: "chime", name: "Chime" }),
  installed({
    id: "bookmarks",
    name: "Bookmarks",
    catalogMarketplaceName: "sf-plugins",
    publisherLabel: "San Francisco Plugins",
    updateState: { outcome: "update-available" },
  }),
  installed({
    id: "fluently",
    name: "Fluently",
    catalogMarketplaceName: "stasbel",
    publisherLabel: "stasbel/bb-plugins",
    updateState: { outcome: "update-available" },
  }),
  installed({
    id: "pr",
    name: "PR Review Tree",
    provenance: "direct",
    catalogMarketplaceName: undefined,
    publisherLabel: null,
    updateState: {
      outcome: "incompatible",
      blockedReasons: ["Needs bb >=0.47."],
    },
  }),
  installed({
    id: "local",
    source: "path:/x",
    provenance: "direct",
    catalogMarketplaceName: undefined,
  }),
  installed({
    id: "e",
    name: "e",
    catalogMarketplaceName: "bb-official",
    publisherLabel: "BB Official",
  }),
  installed({ id: "a", name: "alpha", catalogMarketplaceName: "bb-community" }),
];
async function setup(
  o: {
    checkUpdates?: (a: { pluginId: string }) => Promise<unknown>;
    applyUpdate?: (a: { pluginId: string }) => Promise<unknown>;
    settings?: Record<string, string>;
    plugins?: unknown[];
  } = {},
) {
  const avail = new Set(["bookmarks", "fluently"]);
  const { bb, harness } = createFakePluginHost({
    pluginId: "auto-update",
    settings: o.settings,
    sdk: {
      plugins: {
        list: (async () => ({ plugins: o.plugins ?? PLUGINS })) as never,
        checkUpdates: (o.checkUpdates ??
          (async ({ pluginId }: { pluginId: string }) => [
            {
              id: pluginId,
              outcome: avail.has(pluginId) ? "update-available" : "current",
            },
          ])) as never,
        applyUpdate: (o.applyUpdate ??
          (async () => ({
            applied: true,
            outcome: "updated",
            from: { display: "", version: "" },
          }))) as never,
        experimental_startUpdate: (async () => ({})) as never,
      },
    },
  });
  await plugin(bb);
  const overview = async () =>
    (await harness.behavior.callRpc("listAutoUpdates", null)) as Overview;
  const rows = async () => (await overview()).groups.flatMap((g) => g.plugins);
  const toggle = (pluginId: string, enabled: boolean) =>
    harness.behavior.callRpc("setAutoUpdate", { pluginId, enabled });
  const ids = (path: string) =>
    harness.sdk
      .callsTo(path)
      .map(([a]) => (a as { pluginId: string }).pluginId);
  return {
    harness,
    overview,
    rows,
    toggle,
    ids,
    tick: () => harness.behavior.runSchedule("checkForUpdates"),
  };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

it("lists updatable plugins by source, sorted, switches off", async () => {
  const { overview } = await setup();
  const r = await overview();
  expect(r.lastCheckAt).toBeNull();
  expect(r.groups.map((g) => [g.label, g.plugins.map((p) => p.name)])).toEqual([
    ["BB Official", ["e"]],
    ["BB Community", ["alpha", "Chime"]],
    ["San Francisco Plugins", ["Bookmarks"]],
    ["stasbel/bb-plugins", ["Fluently"]],
    ["Installed Directly", ["PR Review Tree"]],
  ]);
  const pr = r.groups.at(-1)!.plugins[0]!;
  expect(pr).toMatchObject({
    autoUpdate: false,
    update: "incompatible",
    checking: false,
    updating: false,
  });
});
it("remembers switches and publishes", async () => {
  const { harness, rows, toggle } = await setup();
  await toggle("bookmarks", true);
  await toggle("chime", true);
  await toggle("chime", false);
  expect((await rows()).filter((p) => p.autoUpdate).map((p) => p.id)).toEqual([
    "bookmarks",
  ]);
  expect(harness.inspection.realtimeSignals).toHaveLength(3);
});
it("schedule: nothing while all off; checks and installs only switched-on; waits for frequency", async () => {
  const { toggle, ids, tick, overview } = await setup({
    settings: { frequency: "daily" },
  });
  await tick();
  expect(ids("plugins.checkUpdates")).toEqual([]);
  await toggle("bookmarks", true);
  await toggle("chime", true);
  await toggle("memory", true);
  await tick();
  expect(ids("plugins.checkUpdates").sort()).toEqual(["bookmarks", "chime"]);
  expect(ids("plugins.applyUpdate")).toEqual(["bookmarks"]);
  expect((await overview()).lastCheckAt).toBe(NOW);
  vi.setSystemTime(NOW + 5 * HOUR);
  await tick();
  expect(ids("plugins.checkUpdates")).toHaveLength(2);
  vi.setSystemTime(NOW + 24 * HOUR - 30_000);
  await tick();
  expect(ids("plugins.checkUpdates")).toHaveLength(4);
});
it("keeps installing after a failure; failed check logs, no install", async () => {
  const { toggle, ids, tick } = await setup({
    applyUpdate: async ({ pluginId }) => {
      if (pluginId === "bookmarks") throw new Error("Build failed.");
      return {
        applied: true,
        outcome: "updated",
        from: { display: "", version: "" },
      };
    },
  });
  await toggle("bookmarks", true);
  await toggle("fluently", true);
  await tick();
  expect(ids("plugins.applyUpdate")).toEqual(["bookmarks", "fluently"]);
});
it("updates itself last via startUpdate", async () => {
  const { harness, toggle, ids, tick } = await setup({
    plugins: [
      ...PLUGINS,
      installed({ id: "auto-update", updateState: { outcome: "current" } }),
    ],
    checkUpdates: async ({ pluginId }) => [
      { id: pluginId, outcome: "update-available" },
    ],
  });
  await toggle("auto-update", true);
  await toggle("bookmarks", true);
  await tick();
  expect(ids("plugins.applyUpdate")).toEqual(["bookmarks"]);
  expect(ids("plugins.experimental_startUpdate")).toEqual(["auto-update"]);
  expect(
    harness.sdk.calls
      .map((c) => c.path)
      .filter((p) => p.includes("Update"))
      .slice(-2),
  ).toEqual(["plugins.applyUpdate", "plugins.experimental_startUpdate"]);
});
it("opening the page checks stale plugins once, shows checking at once, never installs", async () => {
  const releases = new Map<string, () => void>();
  const { harness, rows, toggle, ids } = await setup({
    plugins: PLUGINS.map((p) =>
      p.id === "chime"
        ? {
            ...p,
            updateState: { outcome: "current", lastCheckAt: NOW - 30_000 },
          }
        : p,
    ),
    checkUpdates: ({ pluginId }) =>
      new Promise((resolve) =>
        releases.set(pluginId, () =>
          resolve([{ id: pluginId, outcome: "update-available" }]),
        ),
      ),
  });
  await toggle("bookmarks", true);
  await harness.behavior.callRpc("refreshAutoUpdates", null);
  const checking = async () =>
    (await rows())
      .filter((p) => p.checking)
      .map((p) => p.id)
      .sort();
  expect(await checking()).toEqual(["a", "bookmarks", "e", "fluently", "pr"]);
  await harness.behavior.callRpc("refreshAutoUpdates", null);
  releases.get("fluently")!();
  await vi.waitFor(async () =>
    expect(await checking()).toEqual(["a", "bookmarks", "e", "pr"]),
  );
  for (const r of releases.values()) r();
  await vi.waitFor(async () => expect(await checking()).toEqual([]));
  expect(ids("plugins.checkUpdates").sort()).toEqual([
    "a",
    "bookmarks",
    "e",
    "fluently",
    "pr",
  ]);
  expect(ids("plugins.applyUpdate")).toEqual([]);
});
it("Check Now checks all listed with switches off, one run at a time", async () => {
  const releases: (() => void)[] = [];
  const { harness, overview, ids } = await setup({
    checkUpdates: ({ pluginId }) =>
      new Promise((resolve) =>
        releases.push(() => resolve([{ id: pluginId, outcome: "current" }])),
      ),
  });
  await harness.behavior.callRpc("checkForUpdates", null);
  await harness.behavior.callRpc("checkForUpdates", null);
  expect((await overview()).checking).toBe(true);
  await vi.waitFor(() => expect(releases).toHaveLength(6));
  expect(
    (await overview()).groups
      .flatMap((g) => g.plugins)
      .every((p) => p.checking),
  ).toBe(true);
  releases.forEach((r) => r());
  await vi.waitFor(async () => expect((await overview()).checking).toBe(false));
  expect(ids("plugins.checkUpdates")).toHaveLength(6);
  expect(ids("plugins.applyUpdate")).toEqual([]);
});
