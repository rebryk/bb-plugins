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
  const settings = bb.settings.define({
    threadEta: { type: "boolean", label: "Thread ETA", default: true },
  });
  await registerThreadEtaServer(bb, settings);
  const set = (threadId: string, input: object) =>
    harness.behavior.callAgentTool("set_thread_eta", input, { threadId });
  const list = async () =>
    (
      (await harness.behavior.callRpc("listThreadEtas", null)) as {
        etas: object;
      }
    ).etas;
  const published = () =>
    harness.inspection.realtimeSignals.filter(
      ({ channel }) => channel === ETA_CHANNEL,
    ).length;
  return { harness, settings, set, list, published };
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
  expect(await harness.behavior.callRpc("listThreadEtas", null)).toMatchObject({
    now: NOW,
  });

  await set("a", { seconds: 600 });
  expect(await set("b", { seconds: 0 })).toBe("Countdown removed.");
  expect(await list()).toEqual({ a: { until: NOW + 600_000, label: null } });
  await harness.lifecycle.dispose();
});

it("forgets countdowns that ran out or whose thread was archived, and skips no-op changes", async () => {
  const { harness, set, list, published } = await setup();
  await set("a", { seconds: 60 });
  await set("b", { seconds: 600 });
  await set("c", { seconds: 600 });
  vi.setSystemTime(NOW + 120_000);
  const before = published();
  await harness.behavior.emitThreadEvent("thread.archived", {
    thread: makeThreadResponse({ id: "x" }),
  } as never);
  await set("x", { seconds: 0 });
  expect(published()).toBe(before);
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

it("gives agents the tool only while the setting is on", async () => {
  const { harness, settings } = await setup();
  const tools = () =>
    harness.inspection.registrations.agentConfigurationProvider!({} as never)
      .tools;
  expect(tools()).toEqual(["set_thread_eta"]);
  await settings.experimental_set({ threadEta: false });
  expect(tools()).toEqual([]);
  await harness.lifecycle.dispose();
});
