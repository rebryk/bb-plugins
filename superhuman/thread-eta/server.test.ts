import { afterEach, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import registerThreadEtaServer from "./server";
import { ETA_CHANNEL } from "./shared";

const NOW = new Date(2026, 8, 28, 14, 30).getTime();

async function setup() {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const { bb, harness } = createFakePluginHost({ pluginId: "superhuman" });
  registerThreadEtaServer(bb);
  const set = (threadId: string, input: object) =>
    harness.behavior.callAgentTool("set_thread_eta", input, { threadId });
  const list = () => harness.behavior.callRpc("listThreadEtas", null);
  return { harness, set, list };
}

afterEach(() => {
  vi.useRealTimers();
});

it("sets, replaces, and removes a thread's countdown", async () => {
  const { harness, set, list } = await setup();
  expect(await set("a", { seconds: 90, label: "Tests" })).toBe(
    "Countdown set to 1:30.",
  );
  await set("b", { seconds: 3725 });
  expect(await list()).toEqual({
    a: { until: NOW + 90_000, label: "Tests" },
    b: { until: NOW + 3_725_000, label: null },
  });
  expect(harness.inspection.realtimeSignals).toContainEqual({
    channel: ETA_CHANNEL,
    payload: null,
  });

  await set("a", { seconds: 600 });
  expect(await set("b", { seconds: 0 })).toBe("Countdown removed.");
  expect(await list()).toEqual({ a: { until: NOW + 600_000, label: null } });
  await harness.lifecycle.dispose();
});

it("forgets countdowns that ran out or whose thread was archived", async () => {
  const { harness, set, list } = await setup();
  await set("a", { seconds: 60 });
  await set("b", { seconds: 600 });
  await set("c", { seconds: 600 });
  vi.setSystemTime(NOW + 120_000);
  await harness.behavior.emitThreadEvent("thread.archived", {
    thread: makeThreadResponse({ id: "b" }),
  } as never);
  expect(await list()).toEqual({ c: { until: NOW + 600_000, label: null } });
  await harness.lifecycle.dispose();
});

it("rejects a countdown longer than a day", async () => {
  const { harness, set, list } = await setup();
  await expect(set("a", { seconds: 90_000 })).rejects.toThrow();
  expect(await list()).toEqual({});
  await harness.lifecycle.dispose();
});
