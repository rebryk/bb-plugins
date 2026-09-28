// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginBrowserBbSdk, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { asPluginApp } from "../testing";
import { createThreadCache } from "./cache";

vi.mock("./cache", () => ({ createThreadCache: vi.fn() }));

const cached = new Set<string>();
const cache = {
  hasData: (id: string) => cached.has(id),
  isForegroundBusy: () => false,
  warm: vi.fn(async (id: string, _signal: AbortSignal) => {
    cached.add(id);
    return "stored" as "stored" | "superseded" | "skipped";
  }),
  invalidate: vi.fn((id?: string) => { if (id) cached.delete(id); else cached.clear(); }),
  dispose: vi.fn(),
};
type Subscription = Parameters<PluginBrowserBbSdk["subscribe"]>[0];
const listeners = new Map<string, Subscription["callback"]>();
const version = vi.fn(async () => ({
  currentVersion: "0.44.0", isDevelopment: false, latestVersion: null,
  source: "npm" as const, updateAvailable: false, upgradeCommand: "",
}));

function thread(id: string): PluginSidebarThread {
  // Only the public sidebar fields consumed by this feature matter here.
  return {
    id, status: "idle", title: id, updatedAt: 1, latestAttentionAt: 1,
    lastReadAt: null, isUnread: true, isArchived: false, isHidden: false,
    environment: null, hasPendingInteraction: false,
  } as PluginSidebarThread;
}

async function mount(enabled = true, connection = { state: "connected", reconnected: false }) {
  const app = await loadPluginApp(asPluginApp(() => import("./app")));
  return renderSlot(app.appOverlays[0]!, {}, {
    settings: { threadPrefetch: enabled },
    context: { threadId: "open" },
    sidebarThreads: { status: "ready", threads: [thread("open"), thread("other")] },
    sdk: {
      system: { version },
      subscribe: ((args: Subscription) => {
        listeners.set(args.event, args.callback);
        if (args.event === "realtime:connection") queueMicrotask(() => {
          if (listeners.get(args.event) === args.callback) emit(args.event, connection);
        });
        return () => { listeners.delete(args.event); };
      }) as PluginBrowserBbSdk["subscribe"],
    },
  });
}

function emit(event: string, payload: unknown) {
  (listeners.get(event) as ((payload: unknown) => void) | undefined)?.(payload);
}

beforeEach(() => {
  cached.clear();
  listeners.clear();
  vi.mocked(createThreadCache).mockReturnValue(cache);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("warms an unopened thread, refreshes it on content events, and never navigates", async () => {
  const slot = await mount();
  await vi.waitFor(() => expect(cache.warm).toHaveBeenCalledTimes(1));
  expect(cache.warm.mock.calls[0][0]).toBe("other");
  expect(cache.warm.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  emit("thread:changed", {
    id: "other", changes: ["events-appended"],
    metadata: { eventTypes: ["turn/completed"] },
  });
  await vi.waitFor(() => expect(cache.warm).toHaveBeenCalledTimes(2));
  expect(cache.invalidate).toHaveBeenCalledWith("other", false);
  expect(slot.inspection.navigateCalls).toEqual([]);
  expect(slot.inspection.sdkCalls.map((call) => call.method))
    .not.toContain("threads.open");
  slot.lifecycle.unmount();
  expect(listeners.size).toBe(0);
  expect(cache.dispose).toHaveBeenCalledOnce();
});

it("discards obsolete owned seeds on metadata edits and rechecks after reconnect", async () => {
  await mount();
  await vi.waitFor(() => expect(cache.warm).toHaveBeenCalledTimes(1));
  emit("thread:changed", { id: "other", changes: ["read-state-changed"] });
  expect(cache.invalidate).toHaveBeenCalledWith("other", true);
  emit("realtime:connection", { state: "disconnected" });
  await Promise.resolve();
  expect(cache.warm).toHaveBeenCalledTimes(1);
  emit("realtime:connection", { state: "connected", reconnected: true });
  await vi.waitFor(() => expect(cache.warm).toHaveBeenCalledTimes(2));
  emit("system:config-changed", { changes: ["config-changed"] });
  await vi.waitFor(() => expect(cache.warm).toHaveBeenCalledTimes(3));
  expect(cache.invalidate).toHaveBeenCalledWith(undefined, true);
});

it("preserves cached history when the SDK replays an already-connected state", async () => {
  cached.add("other");
  await mount();
  await vi.waitFor(() => expect(listeners.has("realtime:connection")).toBe(true));
  await Promise.resolve();
  expect(cache.invalidate).not.toHaveBeenCalled();
  expect(cache.warm).not.toHaveBeenCalled();
  fireEvent(document, new Event("visibilitychange"));
  await Promise.resolve();
  expect(cache.warm).not.toHaveBeenCalled();
});

it.each(["connecting", "disconnected"])("waits through an initial %s state, then checks for missed updates", async (state) => {
  cached.add("other");
  await mount(true, { state, reconnected: false });
  await vi.waitFor(() => expect(listeners.has("realtime:connection")).toBe(true));
  await Promise.resolve();
  expect(cache.warm).not.toHaveBeenCalled();
  expect(cache.invalidate).not.toHaveBeenCalled();
  emit("realtime:connection", { state: "connected", reconnected: false });
  await vi.waitFor(() => expect(cache.warm).toHaveBeenCalledOnce());
  expect(cache.invalidate).toHaveBeenCalledExactlyOnceWith(undefined, true);
});

it("checks for missed updates when the initial replay reports a reconnect", async () => {
  cached.add("other");
  await mount(true, { state: "connected", reconnected: true });
  await vi.waitFor(() => expect(cache.warm).toHaveBeenCalledOnce());
  expect(cache.invalidate).toHaveBeenCalledExactlyOnceWith(undefined, true);
});

it("stops an outstanding request when hidden and resumes on return", async () => {
  cache.warm.mockImplementationOnce((_id, signal) => new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve("superseded"), { once: true });
  }));
  await mount();
  await vi.waitFor(() => expect(cache.warm).toHaveBeenCalledTimes(1));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  await vi.waitFor(() => expect(cache.warm.mock.calls[0][1].aborted).toBe(true));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  fireEvent(document, new Event("visibilitychange"));
  await vi.waitFor(() => expect(cache.warm).toHaveBeenCalledTimes(2));
});

it("retries a response superseded by newer state, but not a skipped page", async () => {
  cache.warm.mockResolvedValueOnce("superseded").mockResolvedValueOnce("skipped");
  await mount();
  await vi.waitFor(() => expect(cache.warm).toHaveBeenCalledTimes(2));
  await Promise.resolve();
  expect(cache.warm).toHaveBeenCalledTimes(2);
});

it("does no work when disabled or when the host cache is unsupported", async () => {
  const disabled = await mount(false);
  expect(version).not.toHaveBeenCalled();
  disabled.lifecycle.unmount();
  vi.mocked(createThreadCache).mockReturnValueOnce(null);
  await mount();
  await vi.waitFor(() => expect(createThreadCache).toHaveBeenCalledOnce());
  expect(cache.warm).not.toHaveBeenCalled();
  expect(listeners.size).toBe(0);
});

it("aborts version detection on unmount, without attaching late listeners", async () => {
  let finish!: (value: Awaited<ReturnType<typeof version>>) => void;
  version.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const slot = await mount();
  slot.lifecycle.unmount();
  finish({ currentVersion: "0.44.0", isDevelopment: false, latestVersion: null,
    source: "npm", updateAvailable: false, upgradeCommand: "" });
  await Promise.resolve();
  expect(createThreadCache).not.toHaveBeenCalled();
  expect(listeners.size).toBe(0);
});
