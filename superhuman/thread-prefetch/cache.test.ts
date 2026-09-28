// @vitest-environment jsdom
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createThreadCache, type ThreadCache } from "./cache";
import { createPrefetchQueue } from "./queue";

type Key = readonly unknown[];
class Query {
  observers = 0;
  state = {
    data: undefined as unknown,
    dataUpdatedAt: 0,
    dataUpdateCount: 0,
    isInvalidated: false,
    status: "pending",
    fetchStatus: "idle",
  };
  getObserversCount() { return this.observers; }
}

/** Models cache identity, immutable states and synchronous notifications. */
class Client {
  queries = new Map<string, Query>();
  listeners = new Set<(event: { type: string; query: Query }) => void>();
  writes: Key[] = [];
  onWrite?: (key: Key) => void;
  constructor() {
    this.setQueryData(["systemConfig"], {});
    this.setQueryData(["sidebarNavigation"], {});
    this.writes = [];
  }
  getQueryCache() { return this; }
  find({ queryKey }: { queryKey?: Key }) { return this.queries.get(JSON.stringify(queryKey)); }
  findAll({ type, fetchStatus }: { type?: string; fetchStatus?: string }) {
    return [...this.queries.values()].filter((query) => (!type || query.observers > 0)
      && (!fetchStatus || query.state.fetchStatus === fetchStatus));
  }
  subscribe(listener: (event: { type: string; query: Query }) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  notify(type: string, query: Query) {
    for (const listener of this.listeners) listener({ type, query });
  }
  setQueryData(key: Key, data: unknown, options = { updatedAt: Date.now() }) {
    const hash = JSON.stringify(key);
    let query = this.queries.get(hash);
    if (!query) {
      query = new Query();
      this.queries.set(hash, query);
      this.notify("added", query);
    }
    query.state = { ...query.state, data, dataUpdatedAt: options.updatedAt,
      dataUpdateCount: query.state.dataUpdateCount + 1, isInvalidated: false, status: "success" };
    this.writes.push(key);
    this.notify("updated", query);
    this.onWrite?.(key);
    return data;
  }
  removeQueries({ queryKey }: { queryKey?: Key }) {
    const hash = JSON.stringify(queryKey);
    const query = this.queries.get(hash);
    this.queries.delete(hash);
    if (query) this.notify("removed", query);
  }
  data(key: Key) { return this.find({ queryKey: key })?.state.data; }
  observe(key: Key) {
    const query = this.find({ queryKey: key })!;
    query.observers++;
    this.notify("observerAdded", query);
    return () => { query.observers--; this.notify("observerRemoved", query); };
  }
}

const metadata = (id: string) => ({
  id, projectId: "project", environmentId: "env", status: "idle", title: "Thread",
  archivedAt: null, deletedAt: null, visibility: "visible", lastReadAt: null, latestAttentionAt: 100,
  environment: { id: "env", hostId: "host", path: "/checkout" },
  host: { id: "host", name: "Server" },
});
const latest = (padding = "") => ({
  rows: padding ? [{ id: "row", text: padding }] : [], maxSeq: 10,
  timelinePage: { kind: "latest", segmentLimit: 4, hasOlderRows: true,
    olderCursor: { anchorSeq: 1, anchorId: "timeline-window:1" } },
});
function fixture(client = new Client()) {
  const anchor = document.createElement("span");
  document.body.append(anchor);
  Object.defineProperty(anchor, "__reactFiber$test", { configurable: true, value: {
    memoizedProps: {}, return: { memoizedProps: { value: client }, return: null },
  } });
  const reads = {
    get: vi.fn(async ({ threadId }: { threadId: string }) => metadata(threadId)),
    timeline: vi.fn(async (_args: unknown) => latest()),
    interactions: { list: vi.fn(async (_args: unknown) => [] as unknown[]) },
  };
  const options = { document, anchor, version: "0.44.0", sdk: { threads: reads } as unknown as PluginBrowserBbSdk };
  const cache = createThreadCache(options)!;
  disposers.push(() => cache?.dispose());
  return { cache, client, reads, options };
}
const warm = (cache: ThreadCache, id = "thread") => cache.warm(id, new AbortController().signal);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("private cache discovery", () => {
  it("requires the audited version and both core cache sentinels", () => {
    const { options, client } = fixture();
    expect(createThreadCache({ ...options, version: "0.44.1" })).toBeNull();
    client.removeQueries({ queryKey: ["sidebarNavigation"] });
    expect(createThreadCache(options)).toBeNull();
  });

  it("fails closed without a connected React anchor and bounds ancestor traversal", () => {
    const { options } = fixture();
    options.anchor.remove();
    expect(createThreadCache(options)).toBeNull();
    document.body.append(options.anchor);
    const cycle: { return?: unknown } = {};
    cycle.return = cycle;
    Object.defineProperty(options.anchor, "__reactFiber$test", { value: cycle });
    const scans = vi.spyOn(document, "querySelectorAll");
    expect(createThreadCache(options)).toBeNull();
    expect(scans).not.toHaveBeenCalled();
  });
});

describe("prefetch cache commits", () => {
  it("starts all public reads in parallel and publishes bootstrap last without changing read state", async () => {
    const { cache, client, reads } = fixture();
    const get = deferred<ReturnType<typeof metadata>>();
    const timeline = deferred<ReturnType<typeof latest>>();
    reads.get.mockReturnValueOnce(get.promise);
    reads.timeline.mockReturnValueOnce(timeline.promise);
    const pending = warm(cache);
    expect(reads.get).toHaveBeenCalledOnce();
    expect(reads.timeline).toHaveBeenCalledOnce();
    expect(reads.interactions.list).toHaveBeenCalledOnce();
    expect(client.writes).toEqual([]);
    get.resolve(metadata("thread"));
    timeline.resolve(latest());
    expect(await pending).toBe("stored");

    expect(client.writes.at(-1)).toEqual(["threadDetailBootstrap", "thread"]);
    const { environment, host, ...thread } = metadata("thread");
    expect(client.data(["thread", "thread"])).toEqual(thread);
    expect(client.data(["threadTimeline", "thread"])).toStrictEqual({ ...latest(), maxSeq: undefined });
    expect(client.data(["threadPendingInteractions", "thread"])).toEqual([]);
    expect(client.data(["environment", "env"])).toEqual(environment);
    expect(client.data(["host", "host"])).toEqual(host);
    expect(client.data(["hosts"])).toBeUndefined();
    expect(client.data(["sidebarNavigation"])).toEqual({});
    expect(cache.hasData("thread")).toBe(true);
    expect(await warm(cache)).toBe("skipped");
    expect(reads.get).toHaveBeenCalledOnce();
  });

  it.each([false, true])("requests a short tail with older pagination but no native delta base (phone: %s)", async (phone) => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: phone })));
    const { cache, reads, client } = fixture();
    await warm(cache);
    expect(reads.timeline).toHaveBeenCalledExactlyOnceWith({ threadId: "thread", segmentLimit: "4", signal: expect.any(AbortSignal) });
    expect(client.data(["threadTimeline", "thread"])).toStrictEqual({ ...latest(), maxSeq: undefined });
    expect(reads.get).toHaveBeenCalledWith({ threadId: "thread", include: "environment,host", signal: expect.any(AbortSignal) });
    expect(reads.interactions.list).toHaveBeenCalledWith({ threadId: "thread", signal: expect.any(AbortSignal) });
  });

  it("preserves existing shared metadata, including an active host query", async () => {
    const client = new Client();
    client.setQueryData(["host", "host"], { id: "host", name: "New name" });
    client.setQueryData(["environment", "env"], { id: "env", path: "/new-path" });
    client.observe(["host", "host"]);
    const { cache } = fixture(client);
    expect(await warm(cache)).toBe("stored");
    expect(client.data(["host", "host"])).toEqual({ id: "host", name: "New name" });
    expect(client.data(["environment", "env"])).toEqual({ id: "env", path: "/new-path" });
  });

  it("refuses observed targets and reports foreground fetching without counting inactive fetches", async () => {
    const { cache, client, reads } = fixture();
    client.setQueryData(["thread", "thread"], metadata("thread"));
    client.observe(["thread", "thread"]);
    expect(await warm(cache)).toBe("skipped");
    expect(reads.get).not.toHaveBeenCalled();
    const query = client.find({ queryKey: ["thread", "thread"] })!;
    query.state = { ...query.state, fetchStatus: "fetching" };
    expect(cache.isForegroundBusy()).toBe(true);
    query.observers = 0;
    expect(cache.isForegroundBusy()).toBe(false);
    expect(await warm(cache)).toBe("skipped");
  });

  it("drops in-flight reads when an existing query changes or a foreground query appears", async () => {
    for (const existing of [false, true]) {
      const { cache, client, reads } = fixture();
      if (existing) client.setQueryData(["thread", "thread"], metadata("thread"));
      const get = deferred<ReturnType<typeof metadata>>();
      reads.get.mockReturnValueOnce(get.promise);
      const pending = warm(cache);
      const newer = { ...metadata("thread"), lastReadAt: 200 };
      client.setQueryData(["thread", "thread"], newer);
      get.resolve(metadata("thread"));
      expect(await pending).toBe("superseded");
      expect(client.data(["thread", "thread"])).toBe(newer);
      expect(client.data(["threadDetailBootstrap", "thread"])).toBeUndefined();
    }
  });

  it("drops a request when a foreground observer appears and leaves before the response", async () => {
    const { cache, client, reads } = fixture();
    client.setQueryData(["thread", "thread"], metadata("thread"));
    const get = deferred<ReturnType<typeof metadata>>();
    reads.get.mockReturnValueOnce(get.promise);
    const pending = warm(cache);
    client.observe(["thread", "thread"])();
    get.resolve(metadata("thread"));
    expect(await pending).toBe("superseded");
    expect(client.data(["threadDetailBootstrap", "thread"])).toBeUndefined();
  });

  it("rejects responses across thread/config epochs even when native state was already invalidated", async () => {
    for (const global of [false, true]) {
      const { cache, client, reads } = fixture();
      client.setQueryData(["threadTimeline", "thread"], latest());
      client.find({ queryKey: ["threadTimeline", "thread"] })!.state.isInvalidated = true;
      const get = deferred<ReturnType<typeof metadata>>();
      reads.get.mockReturnValueOnce(get.promise);
      const pending = warm(cache);
      cache.invalidate(global ? undefined : "thread");
      get.resolve(metadata("thread"));
      expect(await pending).toBe("superseded");
      expect(client.data(["threadDetailBootstrap", "thread"])).toBeUndefined();
    }
  });

  it("stops a commit if a synchronous cache subscriber resets the adapter", async () => {
    const { cache, client } = fixture();
    client.onWrite = (key) => {
      if (key[0] === "thread") cache.invalidate(undefined, true);
    };
    expect(await warm(cache)).toBe("superseded");
    expect(client.data(["thread", "thread"])).toBeUndefined();
    expect(client.data(["threadTimeline", "thread"])).toBeUndefined();
    expect(client.data(["threadDetailBootstrap", "thread"])).toBeUndefined();
  });

  it("waits for an aborted predecessor when a reset starts the same thread again", async () => {
    const { cache, reads, client } = fixture();
    const get = deferred<ReturnType<typeof metadata>>();
    reads.get.mockReturnValueOnce(get.promise);
    const first = warm(cache);
    cache.invalidate(undefined, true);
    const second = warm(cache);
    expect(reads.get).toHaveBeenCalledOnce();
    get.resolve(metadata("thread"));
    expect(await first).toBe("superseded");
    expect(await second).toBe("stored");
    expect(reads.get).toHaveBeenCalledTimes(2);
    expect(client.data(["threadTimeline", "thread"])).toBeDefined();
  });

  it("lets a duplicate caller abort while waiting for the first request", async () => {
    const { cache, reads } = fixture();
    const get = deferred<ReturnType<typeof metadata>>();
    reads.get.mockReturnValueOnce(get.promise);
    const first = warm(cache);
    const controller = new AbortController();
    const second = cache.warm("thread", controller.signal);
    controller.abort();
    expect(await second).toBe("superseded");
    expect(reads.get).toHaveBeenCalledOnce();
    get.resolve(metadata("thread"));
    expect(await first).toBe("stored");
  });

  it("does not clean up a partially written seed that a synchronous subscriber adopted", async () => {
    const { cache, client } = fixture();
    client.onWrite = (key) => {
      if (key[0] === "threadTimeline") {
        client.observe(["thread", "thread"])();
      }
    };
    expect(await warm(cache)).toBe("superseded");
    expect(client.data(["thread", "thread"])).toBeDefined();
    expect(client.data(["threadTimeline", "thread"])).toBeUndefined();
    expect(client.data(["threadDetailBootstrap", "thread"])).toBeUndefined();
  });

  it("does not overwrite a core replacement made synchronously during a seed", async () => {
    const { cache, client } = fixture();
    const newer = { ...metadata("thread"), title: "Newer" };
    client.onWrite = (key) => {
      if (key[0] === "thread") {
        client.onWrite = undefined;
        client.setQueryData(key, newer);
      }
    };
    expect(await warm(cache)).toBe("superseded");
    expect(client.data(["thread", "thread"])).toBe(newer);
    expect(client.data(["threadDetailBootstrap", "thread"])).toBeUndefined();
  });

  it("preserves response completion times instead of renewing freshness at commit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { cache, client, reads } = fixture();
    const timeline = deferred<ReturnType<typeof latest>>();
    reads.timeline.mockReturnValueOnce(timeline.promise);
    const pending = warm(cache);
    await Promise.resolve();
    vi.setSystemTime(5_000);
    timeline.resolve(latest());
    await pending;
    expect(client.find({ queryKey: ["threadDetailBootstrap", "thread"] })!.state.dataUpdatedAt).toBe(1_000);
    expect(client.find({ queryKey: ["threadTimeline", "thread"] })!.state.dataUpdatedAt).toBe(5_000);
  });
});

describe("ownership, bounds and cleanup", () => {
  it("retains at most eight speculative pages and does not evict shared metadata", async () => {
    const { cache, client } = fixture();
    for (let index = 0; index < 9; index++) await warm(cache, String(index));
    expect(client.data(["threadTimeline", "0"])).toBeUndefined();
    expect(client.data(["threadDetailBootstrap", "0"])).toBeUndefined();
    expect(client.data(["threadTimeline", "1"])).toBeDefined();
    expect(client.data(["environment", "env"])).toBeDefined();
    expect(client.data(["host", "host"])).toBeDefined();
  });

  it("enforces the combined byte budget before the eight-page limit", async () => {
    const { cache, client, reads } = fixture();
    reads.timeline.mockImplementation(async () => latest("x".repeat(1_500_000)));
    for (let index = 0; index < 6; index++) expect(await warm(cache, String(index))).toBe("stored");
    expect(client.data(["threadTimeline", "0"])).toBeUndefined();
    expect(client.data(["threadTimeline", "1"])).toBeDefined();
    expect(client.data(["threadTimeline", "5"])).toBeDefined();
  });

  it("keeps the newest pages under memory pressure without redownloading evicted history on resume", async () => {
    vi.useFakeTimers();
    const { cache, client, reads } = fixture();
    reads.get.mockImplementation(async ({ threadId }) => ({ ...metadata(threadId), latestAttentionAt: Number(threadId) }));
    reads.timeline.mockImplementation(async () => latest("x".repeat(1_500_000)));
    const queue = createPrefetchQueue({
      hasData: cache.hasData, isForegroundBusy: cache.isForegroundBusy, canRun: () => true,
      warm: async (id, signal) => { await cache.warm(id, signal); },
    });
    disposers.push(() => queue.dispose());
    queue.updateThreads(Array.from({ length: 6 }, (_, index) => ({
      id: String(index + 1), updatedAt: index + 1, latestAttentionAt: index + 1,
      status: "idle", isUnread: false, isArchived: false, isHidden: false,
    })));
    await vi.advanceTimersByTimeAsync(0);
    expect(reads.get.mock.calls.map(([args]) => args.threadId)).toEqual(["6", "5", "4", "3", "2", "1"]);
    expect(client.data(["threadTimeline", "6"])).toBeDefined();
    expect(client.data(["threadTimeline", "2"])).toBeDefined();
    expect(client.data(["threadTimeline", "1"])).toBeUndefined();
    for (let index = 0; index < 6; index++) {
      queue.resume();
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(reads.timeline).toHaveBeenCalledTimes(6);
    // A fresh completion makes the previously evicted thread useful again.
    reads.get.mockImplementation(async ({ threadId }) => ({ ...metadata(threadId), latestAttentionAt: 100 }));
    cache.invalidate("1");
    queue.changed("1", ["events-appended"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(reads.timeline).toHaveBeenCalledTimes(7);
    expect(client.data(["threadTimeline", "1"])).toBeDefined();
    expect(client.data(["threadTimeline", "6"])).toBeDefined();
    expect(client.data(["threadTimeline", "2"])).toBeUndefined();
    queue.resume();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reads.timeline).toHaveBeenCalledTimes(7);
  });

  it("never removes a user-owned, observed, or subsequently updated cache entry", async () => {
    const { cache, client } = fixture();
    client.setQueryData(["thread", "thread"], metadata("thread"));
    expect(await warm(cache)).toBe("stored");
    client.observe(["threadTimeline", "thread"])();
    client.setQueryData(["threadPendingInteractions", "thread"], [{ id: "new" }]);
    cache.invalidate(undefined, true);
    expect(client.data(["thread", "thread"])).toBeDefined();
    expect(client.data(["threadTimeline", "thread"])).toBeDefined();
    expect(client.data(["threadPendingInteractions", "thread"])).toEqual([{ id: "new" }]);
    expect(client.data(["threadDetailBootstrap", "thread"])).toBeUndefined();
  });

  it("keeps ownership across a safe refresh and drops all speculative thread keys on disposal", async () => {
    const { cache, client } = fixture();
    await warm(cache);
    cache.invalidate("thread");
    expect(cache.hasData("thread")).toBe(false);
    expect(await warm(cache)).toBe("stored");
    cache.dispose();
    cache.dispose();
    expect(client.data(["thread", "thread"])).toBeUndefined();
    expect(client.data(["threadTimeline", "thread"])).toBeUndefined();
    expect(client.listeners.size).toBe(0);
  });

  it("cools down failed reads and malformed delta responses without caching them", async () => {
    vi.useFakeTimers();
    for (const kind of ["failure", "delta"] as const) {
      const { cache, client, reads } = fixture();
      if (kind === "failure") reads.timeline.mockRejectedValue(new Error("offline"));
      if (kind === "delta") reads.timeline.mockResolvedValue({ ...latest(), delta: { upsertRows: [] } } as ReturnType<typeof latest>);
      expect(await warm(cache)).toBe("skipped");
      expect(cache.hasData("thread")).toBe(true);
      expect(await warm(cache)).toBe("skipped");
      expect(reads.timeline).toHaveBeenCalledOnce();
      expect(client.data(["threadTimeline", "thread"])).toBeUndefined();
      vi.advanceTimersByTime(30_001);
      expect(cache.hasData("thread")).toBe(false);
    }
  });

  it("does not repeatedly download an oversized page until the thread changes", async () => {
    vi.useFakeTimers();
    const { cache, client, reads } = fixture();
    reads.timeline.mockResolvedValueOnce(latest("é".repeat(1_100_000)));
    expect(await warm(cache)).toBe("skipped");
    expect(client.data(["threadTimeline", "thread"])).toBeUndefined();
    vi.advanceTimersByTime(60_000);
    expect(await warm(cache)).toBe("skipped");
    expect(reads.timeline).toHaveBeenCalledOnce();
    cache.invalidate("thread");
    expect(await warm(cache)).toBe("stored");
    expect(reads.timeline).toHaveBeenCalledTimes(2);
  });

  it("briefly suppresses a thread that resumed while the request was in flight", async () => {
    vi.useFakeTimers();
    const { cache, reads, client } = fixture();
    reads.get.mockResolvedValue({ ...metadata("thread"), status: "active" });
    expect(await warm(cache)).toBe("skipped");
    expect(client.data(["threadTimeline", "thread"])).toBeUndefined();
    expect(cache.hasData("thread")).toBe(true);
    vi.advanceTimersByTime(1_001);
    expect(cache.hasData("thread")).toBe(false);
  });

  it("aborts owned requests and prevents writes after cancellation or disposal", async () => {
    for (const dispose of [false, true]) {
      const { cache, client, reads } = fixture();
      const get = deferred<ReturnType<typeof metadata>>();
      reads.get.mockReturnValueOnce(get.promise);
      const controller = new AbortController();
      const pending = cache.warm("thread", controller.signal);
      if (dispose) cache.dispose();
      else controller.abort();
      get.resolve(metadata("thread"));
      expect(await pending).toBe("superseded");
      expect(client.data(["threadTimeline", "thread"])).toBeUndefined();
    }
  });
});
