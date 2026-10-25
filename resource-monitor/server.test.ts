import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { beforeEach, expect, it, vi } from "vitest";

// launchd and the guard home stay untouched: the guard is a fake.
const guard = vi.hoisted(() => {
  const info = (enabled: boolean, pauseAll = false) => ({
    enabled,
    running: false,
    pauseAll,
    status: null,
  });
  return {
    supported: true,
    apply: vi.fn(async (_on: boolean) => {}),
    info: vi.fn(async (enabled: boolean) => info(enabled)),
    setPauseAll: vi.fn(async (paused: boolean, enabled: boolean) =>
      info(enabled, paused),
    ),
  };
});
vi.mock("./guard-install", () => ({ createGuard: () => guard }));

import plugin from "./server";

beforeEach(() => {
  vi.clearAllMocks();
  guard.supported = true;
});

const load = (settings: Record<string, boolean> = {}) => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "resource-monitor",
    settings,
  });
  plugin(bb);
  return harness;
};

it("installs Guard and turns it off with the setting", async () => {
  const harness = load();
  const { controller, done } = harness.runService("guard");
  await vi.waitFor(() => expect(guard.apply).toHaveBeenCalledWith(true));
  await harness.setSettings({ guard: false });
  await vi.waitFor(() => expect(guard.apply).toHaveBeenLastCalledWith(false));
  controller.abort();
  await done;
});

it("refuses Pause all while Guard is off, but always resumes", async () => {
  const harness = load({ guard: false });
  expect(await harness.callRpc("guardStatus", null)).toMatchObject({
    enabled: false,
  });
  await expect(
    harness.callRpc("setPauseAll", { paused: true }),
  ).rejects.toThrow("Guard is off");
  expect(await harness.callRpc("setPauseAll", { paused: false })).toMatchObject(
    { pauseAll: false },
  );
  await harness.setSettings({ guard: true });
  expect(await harness.callRpc("setPauseAll", { paused: true })).toMatchObject({
    pauseAll: true,
  });
});

it("runs no guard where it is unsupported", () => {
  guard.supported = false;
  expect(() => load().runService("guard")).toThrow();
});
