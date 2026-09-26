import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin, { type Snooze } from "./server";
import { CHANGED_CHANNEL } from "./shared";

type Visibility = "visible" | "hidden";

interface FakeThread {
  parentThreadId: string | null;
  visibility: Visibility;
}

// Saturday, September 26, 2026, 2:30 PM.
const NOW = new Date(2026, 8, 26, 14, 30).getTime();
const HOUR = 3_600_000;

/** A snoozable thread `a` with children `b` and `d` (already hidden) and a grandchild `c`, plus an unrelated `x`. */
function family(): Record<string, FakeThread> {
  return {
    a: { parentThreadId: null, visibility: "visible" },
    b: { parentThreadId: "a", visibility: "visible" },
    c: { parentThreadId: "b", visibility: "visible" },
    d: { parentThreadId: "a", visibility: "hidden" },
    x: { parentThreadId: null, visibility: "visible" },
  };
}

async function setup(threads = family()) {
  const response = (id: string) =>
    makeThreadResponse({
      id,
      title: `Thread ${id}`,
      parentThreadId: threads[id]?.parentThreadId ?? null,
      visibility: threads[id]?.visibility ?? "visible",
    });
  const { bb, harness } = createFakePluginHost({
    pluginId: "snooze",
    sdk: {
      threads: {
        get: (async ({ threadId }: { threadId: string }) =>
          response(threadId)) as never,
        list: (async ({ parentThreadId }: { parentThreadId: string }) =>
          Object.keys(threads)
            .filter((id) => threads[id]?.parentThreadId === parentThreadId)
            .map(response)) as never,
        update: (async (args: { threadId: string; visibility: Visibility }) => {
          const thread = threads[args.threadId];
          if (thread) thread.visibility = args.visibility;
          return response(args.threadId);
        }) as never,
        markUnread: (async () => ({})) as never,
      },
    },
  });
  await plugin(bb);

  const snooze = (threadId: string, until: number, choice: unknown = null) =>
    harness.behavior.callRpc("snooze", { threadId, until, choice }) as Promise<{
      previous: number | null;
      hidden: string[];
    }>;
  const list = () =>
    harness.behavior.callRpc("list", null) as Promise<{
      snoozes: Snooze[];
      last: unknown;
    }>;
  const visibility = () =>
    Object.fromEntries(
      Object.entries(threads).map(([id, thread]) => [id, thread.visibility]),
    );
  const updates = () =>
    harness.inspection.sdk
      .callsTo("threads.update")
      .map(([args]) => args as { threadId: string; visibility: Visibility });
  const unread = () =>
    harness.inspection.sdk
      .callsTo("threads.markUnread")
      .map(([args]) => (args as { threadId: string }).threadId);
  const emit = (
    event: "thread.idle" | "thread.failed" | "thread.archived",
    threadId: string,
  ) =>
    harness.behavior.emitThreadEvent(event, {
      thread: response(threadId),
      lastAssistantText: null,
      error: null,
    } as never);
  return { harness, snooze, list, visibility, updates, unread, emit, response };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("snoozing", () => {
  it("hides the thread and its visible descendants, deepest first", async () => {
    const { harness, snooze, list, visibility, updates } = await setup();
    const result = await snooze("a", NOW + HOUR, {
      kind: "preset",
      id: "later",
    });

    expect(result).toEqual({ previous: null, hidden: ["a", "b", "c"] });
    expect(updates()).toEqual([
      { threadId: "c", visibility: "hidden" },
      { threadId: "b", visibility: "hidden" },
      { threadId: "a", visibility: "hidden" },
    ]);
    expect(visibility()).toMatchObject({
      a: "hidden",
      d: "hidden",
      x: "visible",
    });
    expect(await list()).toEqual({
      snoozes: [{ threadId: "a", title: "Thread a", until: NOW + HOUR }],
      last: { kind: "preset", id: "later" },
    });
    expect(harness.inspection.realtimeSignals).toContainEqual({
      channel: CHANGED_CHANNEL,
      payload: null,
    });
    await harness.lifecycle.dispose();
  });

  it("returns the previous time when snoozing again and keeps the last choice", async () => {
    const { harness, snooze, list } = await setup();
    const text = { kind: "text", text: "fri 3pm" };
    await snooze("a", NOW + HOUR, text);

    const again = await snooze("a", NOW + 2 * HOUR);
    expect(again).toEqual({ previous: NOW + HOUR, hidden: ["a", "b", "c"] });
    expect((await list()).last).toEqual(text);
    await harness.lifecycle.dispose();
  });

  it("lists the snoozes soonest first", async () => {
    const { harness, snooze, list } = await setup();
    await snooze("a", NOW + 3 * HOUR);
    await snooze("x", NOW + HOUR);

    const { snoozes } = await list();
    expect(snoozes.map((row) => row.threadId)).toEqual(["x", "a"]);
    await harness.lifecycle.dispose();
  });

  it("unsnoozes parents first without marking the thread unread", async () => {
    const { harness, snooze, list, visibility, updates, unread } =
      await setup();
    await snooze("a", NOW + HOUR);
    await harness.behavior.callRpc("unsnooze", { threadId: "a" });

    expect(updates().slice(3)).toEqual([
      { threadId: "a", visibility: "visible" },
      { threadId: "b", visibility: "visible" },
      { threadId: "c", visibility: "visible" },
    ]);
    expect(visibility()).toMatchObject({
      a: "visible",
      c: "visible",
      d: "hidden",
    });
    expect(unread()).toEqual([]);
    expect((await list()).snoozes).toEqual([]);
    await harness.lifecycle.dispose();
  });
});

describe("waking on activity", () => {
  it.each(["thread.idle", "thread.failed"] as const)(
    "wakes the thread on %s",
    async (event) => {
      const { harness, snooze, list, visibility, unread, emit } = await setup();
      await snooze("a", NOW + HOUR);
      await emit(event, "x");
      expect((await list()).snoozes).toHaveLength(1);

      await emit(event, "a");
      expect((await list()).snoozes).toEqual([]);
      expect(visibility()).toMatchObject({ a: "visible", b: "visible" });
      expect(unread()).toEqual([]);
      await harness.lifecycle.dispose();
    },
  );

  it("wakes the thread when a hidden child needs an answer", async () => {
    const { harness, snooze, list, visibility, emit, response } = await setup();
    await snooze("a", NOW + HOUR);
    // A child's finished turn doesn't wake its parent.
    await emit("thread.idle", "c");
    expect((await list()).snoozes).toHaveLength(1);

    await harness.behavior.emitThreadEvent("interaction.pending", {
      thread: response("c"),
      interaction: {} as never,
    });
    expect((await list()).snoozes).toEqual([]);
    expect(visibility()).toMatchObject({ a: "visible", c: "visible" });
    await harness.lifecycle.dispose();
  });

  it("drops the snooze of an archived thread", async () => {
    const { harness, snooze, list, visibility, emit } = await setup();
    await snooze("a", NOW + HOUR);
    await emit("thread.archived", "a");

    expect((await list()).snoozes).toEqual([]);
    expect(visibility()).toMatchObject({ a: "visible", b: "visible" });
    await harness.lifecycle.dispose();
  });
});

describe("waking on time", () => {
  it("wakes the snoozes missed while BB was not running, marked unread", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(NOW);
    const { harness, snooze, list, visibility, unread } = await setup();
    await snooze("a", NOW + HOUR);
    await snooze("x", NOW + 3 * HOUR);

    vi.setSystemTime(NOW + 2 * HOUR);
    const service = harness.behavior.runService("wake");
    await vi.advanceTimersByTimeAsync(0);

    expect((await list()).snoozes.map((row) => row.threadId)).toEqual(["x"]);
    expect(visibility()).toMatchObject({ a: "visible", x: "hidden" });
    expect(unread()).toEqual(["a"]);
    service.controller.abort();
    await service.done;
    await harness.lifecycle.dispose();
  });

  it("wakes a snooze at its time", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(NOW);
    const { harness, snooze, list, unread } = await setup();
    const service = harness.behavior.runService("wake");
    await vi.advanceTimersByTimeAsync(0);
    await snooze("a", NOW + 90 * 60_000);

    await vi.advanceTimersByTimeAsync(89 * 60_000);
    expect((await list()).snoozes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await list()).snoozes).toEqual([]);
    expect(unread()).toEqual(["a"]);
    service.controller.abort();
    await service.done;
    await harness.lifecycle.dispose();
  });

  it("stops at once when BB stops it during a pass", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const { harness } = await setup();
    const service = harness.behavior.runService("wake");
    service.controller.abort();
    let stopped = false;
    void service.done.then(() => {
      stopped = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(true);
    await harness.lifecycle.dispose();
  });
});
