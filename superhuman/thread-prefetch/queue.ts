export type PrefetchThread = {
  id: string;
  status: string;
  isArchived: boolean;
  isHidden: boolean;
  updatedAt: number;
  latestAttentionAt: number;
  isUnread: boolean;
};

export type PrefetchOptions = {
  hasData(id: string): boolean;
  // The adapter must check the signal before committing data to the cache.
  warm(id: string, signal: AbortSignal): Promise<void>;
  isForegroundBusy(): boolean;
  canRun(): boolean;
};

const INITIAL_LIMIT = 6;
const QUEUE_LIMIT = 8;
const FOREGROUND_RETRY_MS = 250;
const busy = (status: string) => status === "starting" || status === "active" || status === "stopping";
const CONTENT_CHANGES = new Set(["events-appended", "history-rewritten", "interactions-changed", "environment-changed"]);

/** A small background queue; foreground navigation and completed turns take priority. */
export function createPrefetchQueue(options: PrefetchOptions) {
  let threads = new Map<string, PrefetchThread>();
  let currentId: string | null = null;
  let initialized = false;
  let disposed = false;
  let scheduled = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  // True entries refresh existing data; false entries only fill missing data.
  const pending = new Map<string, boolean>();
  const dirty = new Set<string>();
  const failed = new Set<string>();
  const awaitingSnapshot = new Set<string>();
  let active: { id: string; refresh: boolean; controller: AbortController } | null = null;

  function eligible(id: string) {
    const thread = threads.get(id);
    return !!thread && id !== currentId && !thread.isArchived && !thread.isHidden
      && !busy(thread.status) && !awaitingSnapshot.has(id);
  }

  function enqueue(id: string, refresh: boolean, changed = false) {
    if (!eligible(id) || failed.has(id)) return;
    if (!changed && active?.id === id && !active.controller.signal.aborted) return;
    if (!refresh && options.hasData(id)) return;
    pending.set(id, refresh || pending.get(id) === true);
    if (pending.size > QUEUE_LIMIT) {
      // Initial candidates arrive newest first. Drop their oldest entry before
      // dropping an older completion notification when every entry is urgent.
      const initial = [...pending].filter(([, refresh]) => !refresh).at(-1)?.[0];
      pending.delete(initial ?? pending.keys().next().value!);
    }
  }

  function invalidate(id: string) {
    if (!threads.has(id) || id === currentId) return;
    dirty.add(id);
    failed.delete(id);
    enqueue(id, true, true);
    if (active?.id === id) cancel(false);
  }

  function cancel(keep: boolean) {
    if (!active || active.controller.signal.aborted) return;
    const request = active;
    request.controller.abort();
    if (keep) enqueue(request.id, request.refresh);
  }

  function clearRetry() {
    if (retry !== null) clearTimeout(retry);
    retry = null;
  }

  function wake() {
    if (disposed) return;
    clearRetry();
    const allowed = options.canRun();
    if (active && (!eligible(active.id) || !allowed || options.isForegroundBusy())) cancel(true);
    if (!allowed || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!disposed) pump();
    });
  }

  function pump() {
    clearRetry();
    for (const [id, refresh] of pending) {
      if (!eligible(id) || failed.has(id) || (!refresh && options.hasData(id))) pending.delete(id);
    }
    // Idle wakes are frequent; the foreground check scans BB's whole cache.
    if (!active && !pending.size) return;
    const allowed = options.canRun();
    const foreground = allowed && options.isForegroundBusy();
    if (active && (!eligible(active.id) || !allowed || foreground
      || pending.get(active.id) === true
      || (!active.refresh && [...pending.values()].some(Boolean)))) cancel(true);
    if (!allowed) return;
    if (foreground) {
      if (pending.size) retry = setTimeout(wake, FOREGROUND_RETRY_MS);
      return;
    }
    // Wait for cancellation to settle, so even an adapter that settles late
    // cannot create overlapping background requests.
    if (active || !pending.size) return;
    const [id, refresh] = [...pending].find(([, refresh]) => refresh) ?? pending.entries().next().value!;
    pending.delete(id);
    const request = { id, refresh, controller: new AbortController() };
    active = request;
    void (async () => {
      try {
        await options.warm(id, request.controller.signal);
        if (!request.controller.signal.aborted) dirty.delete(id);
      } catch {
        // A failed request waits for an explicit resume or new content. There
        // is no automatic failure loop competing with the user's navigation.
        if (!request.controller.signal.aborted) failed.add(id);
      } finally {
        if (active === request) active = null;
        wake();
      }
    })();
  }

  function reconcileMissing() {
    for (const [id, refresh] of pending) if (!refresh) pending.delete(id);
    const recent = [...threads.values()].filter((thread) => eligible(thread.id))
      .sort((a, b) => Math.max(b.updatedAt, b.latestAttentionAt) - Math.max(a.updatedAt, a.latestAttentionAt)
        || Number(b.isUnread) - Number(a.isUnread));
    // Keep a fixed recent window. Filtering cached entries before this limit
    // would march through old threads and continually evict the useful ones.
    for (const thread of recent.slice(0, INITIAL_LIMIT)) enqueue(thread.id, false);
  }

  return {
    updateThreads(next: readonly PrefetchThread[], selectedId: string | null = null) {
      if (disposed) return;
      const previous = threads;
      const navigated = currentId !== selectedId;
      threads = new Map(next.map((thread) => [thread.id, { ...thread }]));
      currentId = selectedId;
      awaitingSnapshot.clear();
      dirty.delete(currentId ?? "");
      let available = !initialized || navigated;
      initialized = true;
      for (const id of [...dirty, ...failed]) {
        if (!threads.has(id)) { dirty.delete(id); failed.delete(id); }
      }
      for (const thread of threads.values()) {
        const before = previous.get(thread.id);
        available ||= !before || ((before.isArchived || before.isHidden) && eligible(thread.id));
        if (before && !busy(thread.status) && (before.status !== thread.status
          || thread.latestAttentionAt > before.latestAttentionAt)) invalidate(thread.id);
        else if (dirty.has(thread.id)) enqueue(thread.id, true);
      }
      if (navigated) cancel(true);
      if (available) reconcileMissing();
      wake();
    },

    changed(id: string, changes: readonly string[]) {
      if (disposed) return;
      if (changes.includes("thread-deleted")) {
        threads.delete(id);
        dirty.delete(id);
        failed.delete(id);
        pending.delete(id);
        if (active?.id === id) cancel(false);
      } else if (changes.includes("archived-changed")) {
        // The event does not say whether this is archive or unarchive. Wait for
        // the next list snapshot instead of using the previous visibility.
        awaitingSnapshot.add(id);
        pending.delete(id);
        if (active?.id === id) cancel(false);
      } else if (changes.some((change) => CONTENT_CHANGES.has(change))) invalidate(id);
      // status-changed is resolved by updateThreads, after its new status is
      // known. Title/read/order changes alone never invalidate cached history.
      wake();
    },

    resume() {
      if (disposed) return;
      failed.clear();
      for (const id of dirty) enqueue(id, true);
      reconcileMissing();
      wake();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      clearRetry();
      cancel(false);
      pending.clear();
      dirty.clear();
      failed.clear();
      awaitingSnapshot.clear();
      threads.clear();
    },
  };
}
