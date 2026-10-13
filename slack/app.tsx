import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSdk,
  type ExperimentalPluginBrowserToolbarActionProps,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import "./app.css";
import type { rpcContract } from "./contract";
import {
  STATE_CHANNEL,
  isSlackUrl,
  sameState,
  stateSchema,
  type SlackState,
} from "./shared";

const SLACK_URL = "https://app.slack.com/client";
// Slack's universal and app link: iOS and Android hand it to the Slack app
// when it is installed, and a browser shows Slack's own page otherwise. BB's
// phone apps open only http(s) links, so a slack:// link never leaves them.
const SLACK_APP_URL = "https://slack.com/app/open";

// The last state the server sent, kept in localStorage: a window draws it
// at once, before its connection is up, and every window of this browser
// shares it. StateFeed fills it, every header button reads it.
const STORAGE_KEY = "bb-plugin-slack:state";

function readStored(): SlackState {
  try {
    const parsed = stateSchema.safeParse(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

let state: SlackState = readStored();
const listeners = new Set<() => void>();

function setState(next: SlackState) {
  if (sameState(state, next)) return;
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Without storage, the next window waits for the server.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const useSlackState = () => useSyncExternalStore(subscribe, () => state);

/** Renders nothing; keeps the store in step with the server. */
function StateFeed() {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const pushes = useRef(0);
  useRealtime(STATE_CHANNEL, (payload) => {
    const parsed = stateSchema.safeParse(payload);
    if (!parsed.success) return;
    pushes.current++;
    setState(parsed.data);
  });
  // Realtime events sent while disconnected are lost; ask on each connect.
  // A push that lands before the reply is newer, so the reply then yields.
  useEffect(() => {
    if (connection !== "connected") return;
    const before = pushes.current;
    rpc.call("slackState").then(
      (next) => {
        if (pushes.current === before) setState(next);
      },
      () => {},
    );
  }, [connection, rpc]);
  // Another window of this browser got a newer state first.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setState(readStored());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return null;
}

/**
 * Slack's mark as an outline, after icons8's "Slack New" on its 50-unit
 * grid, with thinner parts and wider gaps so they stay apart at 16px. The
 * margin in the viewBox makes its ink as large as BB's own 16px icons, and
 * app.css sets its line as wide on screen as theirs.
 */
function SlackIcon() {
  return (
    <svg
      viewBox="-4.25 -4.25 58.5 58.5"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      className="slack-logo"
      aria-hidden
    >
      <rect x="1.25" y="14.75" width="20.5" height="7" rx="3.5" />
      <path d="M21.75 8.25H18.25A3.5 3.5 0 1 1 21.75 4.75Z" />
      <rect x="28.25" y="1.25" width="7" height="20.5" rx="3.5" />
      <path d="M41.75 21.75V18.25A3.5 3.5 0 1 1 45.25 21.75Z" />
      <rect x="28.25" y="28.25" width="20.5" height="7" rx="3.5" />
      <path d="M28.25 41.75H31.75A3.5 3.5 0 1 1 28.25 45.25Z" />
      <rect x="14.75" y="28.25" width="7" height="20.5" rx="3.5" />
      <path d="M8.25 28.25V31.75A3.5 3.5 0 1 1 4.75 28.25Z" />
    </svg>
  );
}

function describe(current: SlackState) {
  if (current?.kind === "signedOut") return "Slack: set a session in settings";
  if (current?.kind !== "counts") return "Slack";
  if (current.badge === 1) return "Slack, 1 mention or direct message";
  if (current.badge > 1)
    return `Slack, ${current.badge} mentions and direct messages`;
  return current.unread ? "Slack, unread messages" : "Slack, nothing unread";
}

// Slack tabs this window has shown, by thread. Only this window's Browser
// tabs mount its toolbar, so another machine's tab never lands here.
const shownTabs = new Map<string, string>();

/** Renders nothing; notes which Slack tab each thread shows. */
function SlackTabWatcher({
  threadId,
  tabId,
  url,
}: ExperimentalPluginBrowserToolbarActionProps) {
  const slack = isSlackUrl(url);
  useEffect(() => {
    if (slack) shownTabs.set(threadId, tabId);
    else if (shownTabs.get(threadId) === tabId) shownTabs.delete(threadId);
  }, [threadId, tabId, slack]);
  return null;
}

/**
 * Selects the thread's Slack tab in this window, so a second click never
 * opens a copy. False when this window has shown none or it closed.
 */
function useRevealSlackTab() {
  const sdk = useSdk();
  return async (threadId: string) => {
    const tabId = shownTabs.get(threadId);
    if (!tabId) return false;
    const browsers = sdk.experimental_desktopBrowsers;
    const fulfilled = <T,>(results: PromiseSettledResult<T>[]) =>
      results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
    const hosts = await sdk.hosts.list();
    const scopes = fulfilled(
      await Promise.allSettled(
        hosts.map((host) => browsers.listInstances({ hostId: host.id })),
      ),
    ).flatMap(({ instances }) =>
      instances.map(({ hostId, instanceId, generation }) => ({
        hostId,
        instanceId,
        generation,
        threadId,
      })),
    );
    const owners = fulfilled(
      await Promise.allSettled(
        scopes.map(async (scope) => {
          const { tabs } = await browsers.listTabs(scope);
          return tabs.some((tab) => tab.tabId === tabId) ? scope : null;
        }),
      ),
    );
    const scope = owners.find((owner) => owner !== null);
    if (!scope) {
      shownTabs.delete(threadId);
      return false;
    }
    await browsers.revealTab({ ...scope, tabId });
    return true;
  };
}

/**
 * A Slack button in each thread's header, with the count of mentions and
 * direct messages. A click shows Slack in the thread's right panel, or opens
 * the Slack app on a phone.
 */
function SlackHeaderButton({ threadId }: PluginThreadHeaderActionProps) {
  const current = useSlackState();
  const navigate = useBbNavigate();
  const reveal = useRevealSlackTab();
  const opening = useRef(false);
  const counts = current?.kind === "counts" ? current : null;
  const label =
    counts && counts.badge > 0
      ? counts.badge > 99
        ? "99+"
        : String(counts.badge)
      : null;
  const openUrl = (url = SLACK_URL) => {
    if (!navigate.openUrl(url)) window.open(url, "_blank");
  };
  const open = async () => {
    // A phone or tablet opens the Slack app.
    if (matchMedia("(pointer: coarse)").matches) return openUrl(SLACK_APP_URL);
    // Without the BB app there is no Browser tab to find, and a browser
    // opens a new window only while the click is still current.
    if (!("bbDesktop" in window)) return openUrl();
    // A second click while the first looks for the tab would open a copy.
    if (opening.current) return;
    opening.current = true;
    try {
      if (!(await reveal(threadId).catch(() => false))) openUrl();
    } finally {
      opening.current = false;
    }
  };
  return (
    <button
      type="button"
      className="slack-button"
      data-signed-out={current?.kind === "signedOut" || undefined}
      aria-label={describe(current)}
      title={describe(current)}
      onClick={() => void open()}
    >
      <SlackIcon />
      {label ? (
        <span className="slack-badge">{label}</span>
      ) : (
        counts?.unread && <span className="slack-dot" />
      )}
    </button>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "stateFeed", component: StateFeed });
  app.slots.experimental_browserToolbarAction({
    id: "slackTab",
    title: "Slack tab",
    component: SlackTabWatcher,
  });
  app.slots.experimental_threadHeaderAction({
    id: "openSlack",
    title: "Slack",
    component: SlackHeaderButton,
  });
});
