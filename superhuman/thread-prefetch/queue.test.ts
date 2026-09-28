import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrefetchQueue, type PrefetchThread } from "./queue";

const queues: ReturnType<typeof createPrefetchQueue>[] = [];
const tick = () => vi.advanceTimersByTimeAsync(0);
const thread = (id: string, updatedAt = 1, rest: Partial<PrefetchThread> = {}): PrefetchThread => ({
  id, status: "idle", updatedAt, latestAttentionAt: 0, isUnread: false,
  isArchived: false, isHidden: false, ...rest,
});

function fixture({ cached = [] as string[], honorAbort = true, cacheLimit = Infinity } = {}) {
  const data = new Set(cached);
  const state = { foreground: false, allowed: true, running: 0, maxRunning: 0 };
  const requests: { id: string; signal: AbortSignal; resolve(): void; reject(): void }[] = [];
  const remember = (id: string) => {
    data.delete(id);
    data.add(id);
    while (data.size > cacheLimit) data.delete(data.values().next().value!);
  };
  const warm = vi.fn((id: string, signal: AbortSignal) => {
    state.maxRunning = Math.max(state.maxRunning, ++state.running);
    return new Promise<void>((resolve, reject) => {
      requests.push({ id, signal, resolve, reject: () => reject(new Error("Unavailable")) });
      if (honorAbort) signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }).then(() => {
      if (!signal.aborted) remember(id);
    }).finally(() => { state.running--; });
  });
  const queue = createPrefetchQueue({
    hasData: (id) => data.has(id), warm,
    isForegroundBusy: () => state.foreground,
    canRun: () => state.allowed,
  });
  queues.push(queue);
  let finished = 0;
  const drain = async () => {
    await tick();
    while (finished < requests.length) {
      if (finished > 100) throw new Error("Unbounded prefetch loop");
      requests[finished++]!.resolve();
      await tick();
    }
  };
  return { queue, warm, data, state, requests, remember, drain };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const queue of queues.splice(0)) queue.dispose();
  vi.useRealTimers();
});

describe("thread prefetch queue", () => {
  it("warms a fixed recent window sequentially, skipping cached and ineligible threads", async () => {
    const f = fixture({ cached: ["t10"] });
    const threads = Array.from({ length: 10 }, (_, i) => thread(`t${i + 1}`, i + 1));
    threads.push(thread("active", 100, { status: "active" }), thread("starting", 100, { status: "starting" }),
      thread("stopping", 100, { status: "stopping" }), thread("hidden", 100, { isHidden: true }),
      thread("archived", 100, { isArchived: true }));
    f.queue.updateThreads(threads, "t9");
    await tick();
    expect(f.requests.map((request) => request.id)).toEqual(["t8"]);
    await f.drain();
    expect(f.requests.map((request) => request.id)).toEqual(["t8", "t7", "t6", "t5", "t4"]);
    expect(f.state.maxRunning).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not cycle older histories through an eight-thread cache on navigation or resume", async () => {
    const f = fixture({ cacheLimit: 8 });
    const threads = Array.from({ length: 30 }, (_, i) => thread(`t${i + 1}`, i + 1));
    f.queue.updateThreads(threads, "t30");
    f.remember("t30");
    await f.drain();
    for (const currentId of ["t29", "t28", "t30", "t29", "t28", "t30"]) {
      f.remember(currentId);
      f.queue.updateThreads(threads, currentId);
      f.queue.resume();
      await f.drain();
    }
    expect(f.requests.map((request) => request.id)).toEqual(["t29", "t28", "t27", "t26", "t25", "t24"]);
    expect(f.data.size).toBe(7);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for a running thread to settle, then refreshes its cached history once", async () => {
    const f = fixture({ cached: ["a"] });
    f.queue.updateThreads([thread("a", 1, { status: "active" })]);
    f.queue.changed("a", ["events-appended", "interactions-changed"]);
    f.queue.changed("a", ["history-rewritten"]);
    await tick();
    expect(f.warm).not.toHaveBeenCalled();
    f.queue.updateThreads([thread("a", 2, { status: "stopping" })]);
    await tick();
    expect(f.warm).not.toHaveBeenCalled();
    f.queue.updateThreads([thread("a", 3, { latestAttentionAt: 3 })]);
    f.queue.changed("a", ["status-changed"]);
    await tick();
    expect(f.warm).toHaveBeenCalledTimes(1);
    f.queue.updateThreads([thread("a", 4, { latestAttentionAt: 3, isUnread: true })]);
    f.queue.resume();
    await tick();
    expect(f.requests[0]!.signal.aborted).toBe(false);
    await f.drain();
    expect(f.warm).toHaveBeenCalledTimes(1);
  });

  it("does not refresh history for title, read-state, order, or updatedAt changes alone", async () => {
    const f = fixture({ cached: ["a"] });
    f.queue.updateThreads([thread("a")]);
    f.queue.changed("a", ["title-changed", "read-state-changed", "order-changed", "status-changed"]);
    f.queue.updateThreads([thread("a", 100, { isUnread: true })]);
    f.queue.resume();
    await tick();
    expect(f.warm).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("detects completion from a status snapshot even if the content event was missed", async () => {
    const f = fixture({ cached: ["a"] });
    const item = thread("a", 1, { status: "active" });
    f.queue.updateThreads([item]);
    // The caller may reuse its object; the queue must retain the old status.
    item.status = "idle";
    f.queue.updateThreads([item]);
    await f.drain();
    expect(f.warm).toHaveBeenCalledTimes(1);
    f.queue.updateThreads([item]);
    f.queue.resume();
    await tick();
    expect(f.warm).toHaveBeenCalledTimes(1);
  });

  it("prioritizes and coalesces content changes before initial warming", async () => {
    const f = fixture({ cached: ["finished"] });
    f.state.foreground = true;
    f.queue.updateThreads([thread("recent", 10), thread("finished")]);
    f.queue.changed("finished", ["events-appended"]);
    f.queue.changed("finished", ["history-rewritten", "environment-changed"]);
    await tick();
    f.state.foreground = false;
    f.queue.resume();
    await tick();
    expect(f.requests.map((request) => request.id)).toEqual(["finished"]);
    await f.drain();
    expect(f.requests.map((request) => request.id)).toEqual(["finished", "recent"]);
  });

  it("preempts initial warming when a completed thread needs a refresh", async () => {
    const f = fixture({ cached: ["finished"] });
    f.queue.updateThreads([thread("recent", 10), thread("finished")]);
    await tick();
    f.queue.changed("finished", ["events-appended"]);
    await tick();
    expect(f.requests[0]!.signal.aborted).toBe(true);
    expect(f.requests.map((request) => request.id)).toEqual(["recent", "finished"]);
    await f.drain();
    expect(f.requests.map((request) => request.id)).toEqual(["recent", "finished", "recent"]);
    expect(f.state.maxRunning).toBe(1);
  });

  it("aborts obsolete results immediately and waits for cancellation before retrying", async () => {
    const f = fixture({ honorAbort: false });
    f.queue.updateThreads([thread("a")]);
    await tick();
    f.queue.changed("a", ["events-appended"]);
    expect(f.requests[0]!.signal.aborted).toBe(true);
    f.queue.changed("a", ["events-appended", "history-rewritten"]);
    await tick();
    expect(f.warm).toHaveBeenCalledTimes(1);
    f.requests[0]!.resolve();
    await tick();
    expect(f.data.has("a")).toBe(false);
    expect(f.warm).toHaveBeenCalledTimes(2);
    expect(f.requests[1]!.signal.aborted).toBe(false);
    await f.drain();
    expect(f.data.has("a")).toBe(true);
    expect(f.state.maxRunning).toBe(1);
  });

  it("yields on navigation and lets the foreground fill the selected thread", async () => {
    const f = fixture();
    const threads = [thread("a", 3), thread("b", 2), thread("c")];
    f.queue.updateThreads(threads, "c");
    await tick();
    f.state.foreground = true;
    f.queue.updateThreads(threads, "a");
    expect(f.requests[0]!.signal.aborted).toBe(true);
    await tick();
    expect(f.warm).toHaveBeenCalledTimes(1);
    f.remember("a");
    f.state.foreground = false;
    f.queue.resume();
    await f.drain();
    expect(f.requests.map((request) => request.id)).toEqual(["a", "b", "c"]);
    expect(f.requests.filter((request) => request.id === "a")).toHaveLength(1);
  });

  it("requeues an interrupted background thread when navigation selects a different one", async () => {
    const f = fixture();
    const threads = [thread("a", 3), thread("b", 2), thread("c")];
    f.queue.updateThreads(threads, "c");
    await tick();
    f.state.foreground = true;
    f.queue.updateThreads(threads, "b");
    expect(f.requests[0]!.signal.aborted).toBe(true);
    await tick();
    f.state.foreground = false;
    f.queue.resume();
    await f.drain();
    expect(f.requests.map((request) => request.id)).toEqual(["a", "a", "c"]);
  });

  it("retains invalidations while offline or hidden without a retry timer", async () => {
    const f = fixture({ cached: ["a"] });
    f.queue.updateThreads([thread("a")]);
    f.queue.changed("a", ["events-appended"]);
    await tick();
    f.state.allowed = false;
    f.queue.resume();
    expect(f.requests[0]!.signal.aborted).toBe(true);
    await tick();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.warm).toHaveBeenCalledTimes(1);
    f.state.allowed = true;
    f.queue.resume();
    await f.drain();
    expect(f.warm).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rechecks foreground work only while background work is pending", async () => {
    const f = fixture();
    f.state.foreground = true;
    f.queue.updateThreads([thread("a")]);
    await tick();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(750);
    expect(f.warm).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    f.state.foreground = false;
    await vi.advanceTimersByTimeAsync(250);
    await f.drain();
    expect(f.warm).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.warm).toHaveBeenCalledTimes(1);
  });

  it("does not retry failures until an explicit resume or new content", async () => {
    const f = fixture();
    f.queue.updateThreads([thread("a")]);
    await tick();
    f.requests[0]!.reject();
    await tick();
    f.queue.updateThreads([thread("a", 2, { isUnread: true })]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.warm).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    f.queue.resume();
    await f.drain();
    expect(f.warm).toHaveBeenCalledTimes(2);
    f.queue.resume();
    await tick();
    expect(f.warm).toHaveBeenCalledTimes(2);
  });

  it("cancels on archive or deletion and waits for a fresh visibility snapshot", async () => {
    const f = fixture();
    f.queue.updateThreads([thread("a")]);
    await tick();
    f.queue.changed("a", ["archived-changed"]);
    expect(f.requests[0]!.signal.aborted).toBe(true);
    f.queue.resume();
    await tick();
    expect(f.warm).toHaveBeenCalledTimes(1);
    f.queue.updateThreads([thread("a", 2, { isArchived: true })]);
    f.queue.changed("a", ["archived-changed"]);
    f.queue.updateThreads([thread("a", 3)]);
    await tick();
    expect(f.warm).toHaveBeenCalledTimes(2);
    f.queue.changed("a", ["thread-deleted", "events-appended"]);
    expect(f.requests[1]!.signal.aborted).toBe(true);
    f.queue.resume();
    await tick();
    expect(f.warm).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a burst of completion refreshes and does not drain every old thread", async () => {
    const threads = Array.from({ length: 20 }, (_, i) => thread(`t${i}`, i));
    const f = fixture({ cached: threads.map((item) => item.id) });
    f.state.foreground = true;
    f.queue.updateThreads(threads);
    for (const item of threads) f.queue.changed(item.id, ["events-appended"]);
    await tick();
    f.state.foreground = false;
    await vi.advanceTimersByTimeAsync(250);
    await f.drain();
    expect(f.requests.map((request) => request.id)).toEqual(threads.slice(-8).map((item) => item.id));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disposes the retry and active request, ignoring later events and snapshots", async () => {
    const f = fixture();
    f.state.foreground = true;
    f.queue.updateThreads([thread("a")]);
    await tick();
    f.queue.dispose();
    expect(vi.getTimerCount()).toBe(0);
    f.state.foreground = false;
    f.queue.resume();
    f.queue.updateThreads([thread("b")]);
    f.queue.changed("b", ["events-appended"]);
    await tick();
    expect(f.warm).not.toHaveBeenCalled();

    const active = fixture();
    active.queue.updateThreads([thread("a")]);
    await tick();
    active.queue.dispose();
    active.queue.dispose();
    expect(active.requests[0]!.signal.aborted).toBe(true);
    await tick();
    expect(vi.getTimerCount()).toBe(0);
  });
});
