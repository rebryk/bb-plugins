import { useEffect, useRef } from "react";
import {
  experimental_useSidebarThreads,
  useBbContext,
  useSdk,
  useSettings,
  type PluginAppBuilder,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { createThreadCache } from "./cache";
import { createPrefetchQueue } from "./queue";

type DataConnection = EventTarget & { saveData?: boolean };

// Include optimistic read-state changes, which can precede realtime events.
function revision(thread: PluginSidebarThread) {
  return JSON.stringify([
    thread.status, thread.latestAttentionAt,
    thread.lastReadAt, thread.isUnread, thread.isArchived, thread.isHidden,
    thread.environment?.id, thread.hasPendingInteraction, thread.title,
  ]);
}

function ThreadPrefetch() {
  const sdk = useSdk();
  const sidebar = experimental_useSidebarThreads();
  const { threadId } = useBbContext();
  const anchor = useRef<HTMLSpanElement>(null);
  const latest = useRef({ sidebar, threadId });
  latest.current = { sidebar, threadId };
  const update = useRef<() => void>(() => {});

  useEffect(() => {
    const lifetime = new AbortController();
    let stop = () => {};
    void (async () => {
      const version = await sdk.system.version({ signal: lifetime.signal });
      if (lifetime.signal.aborted || version.isDevelopment || !anchor.current) return;
      const cache = createThreadCache({
        document, anchor: anchor.current, version: version.currentVersion, sdk,
      });
      if (!cache) return;

      const connection = (navigator as Navigator & {
        connection?: DataConnection;
      }).connection;
      // The SDK replays its current connection state to new subscribers.
      // Wait for it, without treating an already-connected replay as a reset.
      let connected = false;
      let missedUpdates = false;
      let revisions = new Map<string, { metadata: string; updatedAt: number }>();
      const makeQueue = () => createPrefetchQueue({
        hasData: cache.hasData,
        isForegroundBusy: cache.isForegroundBusy,
        canRun: () => connected && navigator.onLine
          && document.visibilityState !== "hidden" && !connection?.saveData,
        async warm(id, signal) {
          const result = await cache.warm(id, signal);
          if (result === "superseded" && !signal.aborted) {
            queue.changed(id, ["events-appended"]);
          }
        },
      });
      let queue = makeQueue();
      const sync = () => {
        const { sidebar, threadId } = latest.current;
        if (sidebar.status !== "ready") return;
        const next = new Map(sidebar.threads.map((thread) => [thread.id, {
          metadata: revision(thread), updatedAt: thread.updatedAt,
        }]));
        let discarded = false;
        for (const [id, before] of revisions) {
          const after = next.get(id);
          if (after?.metadata !== before.metadata) {
            cache.invalidate(id, true);
            discarded = true;
          } else if (after.updatedAt !== before.updatedAt) cache.invalidate(id);
        }
        revisions = next;
        queue.updateThreads(sidebar.threads, threadId);
        if (discarded) queue.resume();
      };
      const reset = () => {
        queue.dispose();
        cache.invalidate(undefined, true);
        queue = makeQueue();
        sync();
      };
      const resume = () => queue.resume();
      const unsubscribes: (() => void)[] = [];
      stop = () => {
        update.current = () => {};
        unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
        document.removeEventListener("visibilitychange", resume);
        window.removeEventListener("online", resume);
        window.removeEventListener("offline", resume);
        connection?.removeEventListener("change", resume);
        queue.dispose();
        cache.dispose();
      };
      unsubscribes.push(sdk.subscribe({
        event: "thread:changed",
        callback(event) {
          if (!event.id) { reset(); return; }
          const discard = event.changes.some((change) => [
            "history-rewritten", "environment-changed", "thread-deleted",
            "archived-changed", "read-state-changed", "title-changed",
          ].includes(change))
            || event.metadata?.eventTypes?.includes("client/turn/requested");
          cache.invalidate(event.id, discard);
          queue.changed(event.id, event.changes);
          if (event.changes.some((change) =>
            change === "read-state-changed" || change === "title-changed")) resume();
        },
      }));
      unsubscribes.push(sdk.subscribe({ event: "system:config-changed", callback: reset }));
      unsubscribes.push(sdk.subscribe({
        event: "system:changed",
        callback(event) {
          if (event.changes.some((change) => [
            "plugins-changed", "provider-registrations-changed", "server-move-changed",
          ].includes(change))) reset();
        },
      }));
      unsubscribes.push(sdk.subscribe({
        event: "realtime:connection",
        callback(event) {
          connected = event.state === "connected";
          const reconnect = connected && (missedUpdates || event.reconnected);
          missedUpdates = !connected;
          if (reconnect) reset();
          else resume();
        },
      }));
      document.addEventListener("visibilitychange", resume);
      window.addEventListener("online", resume);
      window.addEventListener("offline", resume);
      connection?.addEventListener("change", resume);
      update.current = sync;
      sync();
    })().catch(() => {
      // Unsupported hosts or an unavailable version endpoint leave native
      // loading intact. A remount can try again; there is no retry loop.
      stop();
    });
    return () => { lifetime.abort(); stop(); };
  }, [sdk]);

  useEffect(() => { update.current(); }, [sidebar, threadId]);
  // The cache adapter walks this element's React ancestors once on mount.
  return <span ref={anchor} hidden aria-hidden="true" />;
}

function ThreadPrefetchSetting() {
  const { values, isLoading } = useSettings();
  return !isLoading && values?.threadPrefetch !== false ? <ThreadPrefetch /> : null;
}

export default function registerThreadPrefetch(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({
    id: "thread-prefetch", component: ThreadPrefetchSetting,
  });
}
