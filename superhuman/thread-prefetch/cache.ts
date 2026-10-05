import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";

type Key = readonly [string, string];
type QueryState = {
  data: unknown;
  dataUpdatedAt: number;
  dataUpdateCount: number;
  isInvalidated: boolean;
  status: "pending" | "success" | "error";
  fetchStatus: "idle" | "fetching" | "paused";
};
type Query = { state: QueryState; getObserversCount(): number };
type Filters = { queryKey?: readonly unknown[]; exact?: boolean; type?: "active"; fetchStatus?: "fetching" };
type CacheEvent = { type: string; query: Query };
type QueryCache = {
  get?(queryHash: string): Query | undefined;
  find(filters: Filters): Query | undefined;
  findAll(filters: Filters): Query[];
  subscribe(listener: (event: CacheEvent) => void): () => void;
};
type QueryClient = {
  getQueryCache(): QueryCache;
  setQueryData(key: Key, data: unknown, options: { updatedAt: number }): unknown;
  removeQueries(filters: Filters): void;
};

export interface ThreadCache {
  /** Also suppresses failed reads briefly and unaffordable pages until changed. */
  hasData(id: string): boolean;
  isForegroundBusy(): boolean;
  warm(id: string, signal: AbortSignal): Promise<"stored" | "superseded" | "skipped">;
  invalidate(id?: string, discard?: boolean): void;
  dispose(): void;
}

const LIMIT = 8;
const BYTE_LIMIT = 8 * 1024 * 1024;
const PAGE_LIMIT = 2 * 1024 * 1024;
const SEGMENT_LIMIT = "4";
const COOLDOWN_MS = 30_000;
const BOOKKEEPING_LIMIT = 128;
const names = ["thread", "threadTimeline", "threadPendingInteractions", "threadDetailBootstrap"] as const;
const keys = (id: string): Key[] => names.map((name) => [name, id]);
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nullableNumber = (value: unknown) => value === null || finite(value);

function isQuery(value: unknown): value is Query {
  if (!object(value) || typeof value.getObserversCount !== "function" || !object(value.state)) return false;
  const state = value.state;
  return "data" in state && finite(state.dataUpdatedAt) && finite(state.dataUpdateCount)
    && typeof state.isInvalidated === "boolean"
    && ["pending", "success", "error"].includes(String(state.status))
    && ["idle", "fetching", "paused"].includes(String(state.fetchStatus));
}

function isClient(value: unknown): value is QueryClient {
  if (!object(value) || typeof value.getQueryCache !== "function"
    || typeof value.setQueryData !== "function" || typeof value.removeQueries !== "function") return false;
  try {
    const cache = value.getQueryCache();
    return object(cache) && typeof cache.find === "function" && typeof cache.findAll === "function"
      && typeof cache.subscribe === "function"
      && isQuery(cache.find({ queryKey: ["systemConfig"], exact: true }))
      && isQuery(cache.find({ queryKey: ["sidebarNavigation"], exact: true }));
  } catch {
    return false;
  }
}

/** BB 0.44.0 only: inspect the overlay's ancestors, never the application tree. */
function discover(anchor: HTMLElement): QueryClient | null {
  try {
    const property = Object.getOwnPropertyNames(anchor).find((name) => name.startsWith("__reactFiber$"));
    if (!property) return null;
    let fiber: unknown = (anchor as unknown as Record<string, unknown>)[property];
    const seen = new Set<unknown>();
    for (let depth = 0; depth < 128 && object(fiber) && !seen.has(fiber); depth++) {
      seen.add(fiber);
      const props = fiber.memoizedProps;
      if (object(props)) {
        if (isClient(props.client)) return props.client;
        if (isClient(props.value)) return props.value;
      }
      fiber = fiber.return;
    }
  } catch {
    // React's private shape changed. Normal BB navigation remains the fallback.
  }
  return null;
}

type OwnedQuery = { key: Key; query: Query; dataUpdateCount: number; updatedAt: number };
type Page = { bytes: number; priority: number; queries: OwnedQuery[] };
type Job = { controller: AbortController; invalidated: boolean; done: Promise<void>; finish(): void };

async function settled(job: Job, signal: AbortSignal) {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      signal.removeEventListener("abort", finish);
      resolve();
    };
    signal.addEventListener("abort", finish, { once: true });
    void job.done.then(finish);
  });
}

export function createThreadCache({ document: doc, anchor, version, sdk }: {
  document: Document;
  anchor: HTMLElement;
  version: string;
  sdk: PluginBrowserBbSdk;
}): ThreadCache | null {
  if (version !== "0.44.0" || anchor.ownerDocument !== doc || !anchor.isConnected) return null;
  const client = discover(anchor);
  if (!client) return null;
  const cache = client.getQueryCache();
  const pages = new Map<string, Page>();
  const jobs = new Map<string, Job>();
  const cooldowns = new Map<string, number>();
  const validated = new Map<string, number>();
  const dirty = new Set<string>();
  const claimed = new WeakSet<Query>();
  let generation = 0;
  let disposed = false;
  let writing = false;

  // An exact find scans and re-hashes BB's whole cache. The default hash of a
  // string key is its JSON, so a matching probe allows a direct map lookup.
  const probe = cache.find({ queryKey: ["systemConfig"], exact: true });
  const find: (key: Key) => Query | undefined = probe && typeof cache.get === "function"
    && cache.get(JSON.stringify(["systemConfig"])) === probe
    ? (key) => cache.get!(JSON.stringify(key))
    : (key) => cache.find({ queryKey: key, exact: true });
  const idle = (query: Query | undefined) => !query || (isQuery(query)
    && query.getObserversCount() === 0 && query.state.fetchStatus === "idle");
  const remember = (map: Map<string, number>, id: string, value: number) => {
    map.delete(id);
    map.set(id, value);
    if (map.size > BOOKKEEPING_LIMIT) map.delete(map.keys().next().value!);
  };
  const stillOwned = (owned: OwnedQuery) => find(owned.key) === owned.query && idle(owned.query)
    && !claimed.has(owned.query)
    && owned.query.state.dataUpdateCount === owned.dataUpdateCount
    && owned.query.state.dataUpdatedAt === owned.updatedAt;

  function discard(id: string) {
    const page = pages.get(id);
    pages.delete(id);
    if (!page) return;
    for (const owned of page.queries) {
      if (stillOwned(owned)) client!.removeQueries({ queryKey: owned.key, exact: true });
    }
  }

  const unsubscribe = cache.subscribe((event) => {
    if (event.type === "observerAdded" || event.query.state.fetchStatus !== "idle") {
      claimed.add(event.query);
      for (const [id, job] of jobs) {
        if (keys(id).some((key) => find(key) === event.query)) {
          job.invalidated = true;
          job.controller.abort();
        }
      }
    }
    if (writing && event.type === "updated") return;
    for (const [id, page] of pages) {
      // Most of BB's cache events concern queries no page owns.
      if (!page.queries.some((owned) => owned.query === event.query)) continue;
      page.queries = page.queries.filter((owned) => owned.query !== event.query
        || (event.type !== "observerAdded" && event.type !== "removed" && stillOwned(owned)));
      if (page.queries.length === 0) pages.delete(id);
    }
  });

  function hasData(id: string) {
    if (disposed) return true;
    const until = cooldowns.get(id);
    if (until !== undefined) {
      if (until > Date.now()) return true;
      cooldowns.delete(id);
    }
    if (dirty.has(id) || (generation !== 0 && validated.get(id) !== generation)) return false;
    return keys(id).every((key) => {
      const query = find(key);
      return isQuery(query) && query.state.status === "success" && query.state.data !== undefined
        && !query.state.isInvalidated;
    });
  }

  function invalidate(id?: string, drop = false) {
    if (disposed) return;
    if (id === undefined) cooldowns.clear();
    else cooldowns.delete(id);
    if (id === undefined) {
      generation++;
      validated.clear();
      dirty.clear();
    } else if (jobs.has(id) || keys(id).some((key) => find(key))) {
      dirty.add(id);
      // Unknown thread events allocate nothing; a large existing cache gets a
      // conservative global epoch instead of unbounded per-thread bookkeeping.
      if (dirty.size > BOOKKEEPING_LIMIT) {
        generation++;
        validated.clear();
        dirty.clear();
      }
    }
    for (const [jobId, job] of jobs) {
      if (id === undefined || id === jobId) {
        job.invalidated = true;
        job.controller.abort();
      }
    }
    if (drop) {
      if (id === undefined) for (const id of [...pages.keys()]) discard(id);
      else {
        discard(id);
      }
    }
  }

  async function warm(id: string, signal: AbortSignal): ReturnType<ThreadCache["warm"]> {
    // A rebuilt scheduler may arrive while its predecessor's aborted SDK reads
    // are still settling. Wait for those reads instead of losing the new work.
    while (!disposed && !signal.aborted) {
      const previous = jobs.get(id);
      if (!previous) break;
      await settled(previous, signal);
    }
    if (disposed || signal.aborted) return "superseded";
    if (hasData(id)) return "skipped";
    const snapshots = keys(id).map((key) => {
      const query = find(key);
      return { key, query, state: query?.state };
    });
    if (snapshots.some(({ query }) => !idle(query))) return "skipped";
    const startedGeneration = generation;
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const job: Job = { controller: new AbortController(), invalidated: false, done, finish };
    jobs.set(id, job);
    const abort = () => job.controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const superseded = () => disposed || signal.aborted || job.controller.signal.aborted
      || job.invalidated || startedGeneration !== generation;
    const requestSignal = job.controller.signal;
    const completed = <T,>(data: T) => ({ data, at: Date.now() });
    const staged: OwnedQuery[] = [];
    let stored = false;
    try {
      const [metadata, timeline, interactions] = await Promise.all([
        sdk.threads.get({ threadId: id, include: "environment,host", signal: requestSignal }).then(completed),
        // Ask the server for a small tail on every device. Keep its pagination
        // cursor intact so BB can load older history normally when opened.
        sdk.threads.timeline({ threadId: id, signal: requestSignal, segmentLimit: SEGMENT_LIMIT }).then(completed),
        sdk.threads.interactions.list({ threadId: id, signal: requestSignal }).then(completed),
      ]);
      if (superseded() || snapshots.some(({ key, query, state }) =>
        find(key) !== query || query?.state !== state || !idle(query))) return "superseded";

      const full: unknown = metadata.data;
      const latest: unknown = timeline.data;
      if (!object(full) || full.id !== id || typeof full.projectId !== "string"
        || !nullableNumber(full.lastReadAt) || !finite(full.latestAttentionAt)
        || !("environment" in full) || !("host" in full)
        || full.archivedAt !== null || full.deletedAt !== null || full.visibility !== "visible"
        || !object(latest) || !Array.isArray(latest.rows) || latest.delta !== undefined
        || !finite(latest.maxSeq) || latest.maxSeq < 0 || !object(latest.timelinePage)
        || latest.timelinePage.kind !== "latest" || !Array.isArray(interactions.data)) {
        remember(cooldowns, id, Date.now() + COOLDOWN_MS);
        return "skipped";
      }
      if (full.status !== "idle" && full.status !== "error") {
        remember(cooldowns, id, Date.now() + 1_000);
        return "skipped";
      }
      const serialized = JSON.stringify([full, latest, interactions.data]);
      const bytes = serialized.length > PAGE_LIMIT ? PAGE_LIMIT + 1 : new TextEncoder().encode(serialized).byteLength;
      if (bytes > PAGE_LIMIT) {
        remember(cooldowns, id, Infinity);
        return "skipped";
      }

      const { environment, host, ...thread } = full;
      const previous = pages.get(id);
      // BB's larger foreground window cannot use this short page as a delta
      // base. Without maxSeq, its first refresh requests a complete latest
      // page; otherwise a server-cached delta could skip the missing rows.
      const values = [thread, { ...latest, maxSeq: undefined }, interactions.data, full];
      const times = [metadata.at, timeline.at, interactions.at, metadata.at];
      const unchanged = () => !superseded() && snapshots.every(({ key, query, state }) =>
        find(key) === query && query?.state === state && idle(query));
      writing = true;
      try {
        // Bootstrap is last: its success suppresses BB's metadata gate, so the
        // matching full thread must already be available at the ordinary key.
        for (let index = 0; index < snapshots.length; index++) {
          if (!unchanged()) return "superseded";
          if (index === snapshots.length - 1) {
            // Shared metadata keeps BB's normal GC and is never evicted by our
            // thread budget. Existing records, including active ones, stay intact.
            for (const [name, data] of [["environment", environment], ["host", host]] as const) {
              if (!unchanged()) return "superseded";
              if (object(data) && typeof data.id === "string" && !find([name, data.id])) {
                client!.setQueryData([name, data.id], data, { updatedAt: metadata.at });
              }
            }
            if (!unchanged()) return "superseded";
          }
          const snapshot = snapshots[index];
          const { key, query } = snapshot;
          const owned = !query || previous?.queries.some((entry) => entry.query === query && stillOwned(entry));
          const count = query?.state.dataUpdateCount ?? 0;
          const data = client!.setQueryData(key, values[index], { updatedAt: times[index] });
          const written = find(key);
          if (!isQuery(written) || !idle(written) || (query && written !== query)
            || written.state.dataUpdateCount !== count + 1 || written.state.data !== data) return "superseded";
          if (owned && !claimed.has(written)) {
            staged.push({ key, query: written, dataUpdateCount: written.state.dataUpdateCount,
              updatedAt: written.state.dataUpdatedAt });
          }
          snapshot.query = written;
          snapshot.state = written.state;
        }
      } finally {
        writing = false;
      }
      if (!unchanged()) return "superseded";
      pages.delete(id);
      const priority = Math.max(finite(full.updatedAt) ? full.updatedAt : 0, full.latestAttentionAt);
      if (staged.length) pages.set(id, { bytes, priority, queries: staged });
      dirty.delete(id);
      remember(validated, id, generation);
      while (pages.size > LIMIT || [...pages.values()].reduce((sum, page) => sum + page.bytes, 0) > BYTE_LIMIT) {
        // The queue starts with the newest thread. Arrival order would evict
        // that useful page first, then download it again on every resume.
        const [oldest] = [...pages].sort(([, a], [, b]) => a.priority - b.priority)[0];
        remember(cooldowns, oldest, Infinity);
        discard(oldest);
      }
      stored = true;
      return "stored";
    } catch {
      if (superseded()) return "superseded";
      remember(cooldowns, id, Date.now() + COOLDOWN_MS);
      return "skipped";
    } finally {
      if (!stored) {
        for (const owned of staged) {
          if (stillOwned(owned)) client!.removeQueries({ queryKey: owned.key, exact: true });
        }
      }
      job.controller.abort();
      signal.removeEventListener("abort", abort);
      if (jobs.get(id) === job) jobs.delete(id);
      job.finish();
    }
  }

  return {
    hasData,
    isForegroundBusy: () => disposed || cache.findAll({ type: "active", fetchStatus: "fetching" }).length > 0,
    warm,
    invalidate,
    dispose() {
      if (disposed) return;
      invalidate(undefined, true);
      disposed = true;
      unsubscribe();
      cooldowns.clear();
      validated.clear();
    },
  };
}
