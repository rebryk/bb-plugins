// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginRow, SourceGroup } from "./server";
import { CHANGED_CHANNEL } from "./shared";

afterEach(cleanup);

const row = (name: string, extra: Partial<PluginRow> = {}): PluginRow => ({
  id: name.toLowerCase(),
  name,
  version: "0.1.0",
  icon: "Zap",
  iconUrl: null,
  autoUpdate: false,
  update: "current",
  lastFailure: null,
  versionCheckError: null,
  checking: false,
  updating: false,
  ...extra,
});

const GROUPS: SourceGroup[] = [
  { id: "bb-community", label: "BB Community", plugins: [row("Chime")] },
  {
    id: "sf-plugins",
    label: "San Francisco Plugins",
    plugins: [
      row("Bookmarks", { update: "update-available", autoUpdate: true }),
    ],
  },
];

const overview = (groups = GROUPS, checking = false) => ({
  checking,
  lastCheckAt: null,
  groups,
});

type Notify = (event: { changes: string[] }) => void;

async function renderPage(rpc: Record<string, (input: never) => unknown> = {}) {
  const app = await loadPluginApp(() => import("./app"));
  const subscribers: Notify[] = [];
  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        listAutoUpdates: () => overview(),
        setAutoUpdate: () => null,
        refreshAutoUpdates: () => null,
        checkForUpdates: () => null,
        ...rpc,
      } as never,
      sdk: {
        subscribe: ({ callback }: { callback: Notify }) => {
          subscribers.push(callback);
          return () => {};
        },
      } as never,
    },
  );
  await slot.findByText("Bookmarks");
  const notify: Notify = (event) =>
    subscribers.forEach((callback) => callback(event));
  return Object.assign(slot, { notify });
}

const switchOf = (slot: Awaited<ReturnType<typeof renderPage>>, name: string) =>
  slot.getByRole("switch", { name: `Auto-update ${name}` });

it("adds one section to the plugin's settings page", async () => {
  const app = await loadPluginApp(() => import("./app"));
  expect(app.settingsSections.map((s) => [s.id, s.title])).toEqual([
    ["autoUpdates", "Plugins"],
  ]);
});

it("lists plugins under their source with a switch each", async () => {
  const slot = await renderPage();
  expect(
    slot.getAllByRole("region").map((s) => s.getAttribute("aria-label")),
  ).toEqual(["BB Community", "San Francisco Plugins"]);
  expect(slot.getByText("0.1.0 · Update available")).toBeTruthy();
  expect(switchOf(slot, "Bookmarks").getAttribute("aria-checked")).toBe("true");
  expect(switchOf(slot, "Chime").getAttribute("aria-checked")).toBe("false");
  expect(slot.getByText("Not checked yet.")).toBeTruthy();
});

it("explains why a candidate was skipped", async () => {
  const slot = await renderPage({
    listAutoUpdates: () =>
      overview([
        {
          ...GROUPS[1]!,
          plugins: [
            row("Bookmarks", { update: "unchanged" }),
            row("Canvas", {
              update: "unavailable",
              versionCheckError: "Cannot read package.json.",
            }),
          ],
        },
      ]),
  });
  expect(slot.getByText("0.1.0 · Version unchanged")).toBeTruthy();
  expect(
    slot.getByText("0.1.0 · Update skipped: Cannot read package.json."),
  ).toBeTruthy();
});

it("shows the list at once, then each row checks until the server says it's done", async () => {
  let checking = true;
  const slot = await renderPage({
    listAutoUpdates: () =>
      overview([{ ...GROUPS[1]!, plugins: [row("Bookmarks", { checking })] }]),
    refreshAutoUpdates: () => null,
  });
  await waitFor(() =>
    expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain(
      "refreshAutoUpdates",
    ),
  );
  expect(slot.getByText("0.1.0 · Checking…")).toBeTruthy();
  checking = false;
  await slot.behavior.emitRealtime(CHANGED_CHANNEL, null);
  await waitFor(() => expect(slot.queryByText(/Checking…/)).toBeNull());
});

it("flips a switch right away and saves it", async () => {
  const slot = await renderPage();
  fireEvent.click(switchOf(slot, "Chime"));
  expect(switchOf(slot, "Chime").getAttribute("aria-checked")).toBe("true");
  await waitFor(() =>
    expect(slot.inspection.rpcCalls).toContainEqual({
      method: "setAutoUpdate",
      input: { pluginId: "chime", enabled: true },
    }),
  );
});

it("puts a switch back and says why when saving fails", async () => {
  const slot = await renderPage({
    setAutoUpdate: () => {
      throw new Error("Storage is full.");
    },
  });
  fireEvent.click(switchOf(slot, "Chime"));
  expect((await slot.findByRole("alert")).textContent).toBe("Storage is full.");
  await waitFor(() =>
    expect(switchOf(slot, "Chime").getAttribute("aria-checked")).toBe("false"),
  );
});

it("disables Check Now while a run is going", async () => {
  let checking = false;
  const slot = await renderPage({
    listAutoUpdates: () => overview(GROUPS, checking),
    checkForUpdates: () => {
      checking = true;
      return null;
    },
  });
  const button = slot.getByRole("button", {
    name: "Check Now",
  }) as HTMLButtonElement;
  fireEvent.click(button);
  expect(button.disabled).toBe(true);
  expect(await slot.findByText("Checking for updates…")).toBeTruthy();
  checking = false;
  await slot.behavior.emitRealtime(CHANGED_CHANNEL, null);
  await waitFor(() => expect(button.disabled).toBe(false));
});

it("refetches when plugins change in BB and after a reconnect", async () => {
  let groups = GROUPS;
  const slot = await renderPage({ listAutoUpdates: () => overview(groups) });
  groups = [
    { id: "direct", label: "Installed Directly", plugins: [row("Notes")] },
  ];
  slot.notify({ changes: ["plugins-changed"] });
  expect(await slot.findByText("Notes")).toBeTruthy();
  groups = [
    { id: "direct", label: "Installed Directly", plugins: [row("Tasks")] },
  ];
  await slot.behavior.setRealtimeConnectionState("reconnecting");
  await slot.behavior.setRealtimeConnectionState("connected");
  expect(await slot.findByText("Tasks")).toBeTruthy();
});
