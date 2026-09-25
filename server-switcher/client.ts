export interface Server {
  handle: string;
  live: boolean;
}

interface NativeBridge {
  platform?: unknown;
  capabilities?: unknown;
  post?: (message: unknown) => void;
}

interface ClientWindow {
  location: { href: string; assign(url: string): void };
  bb?: { native?: NativeBridge };
  ReactNativeWebView?: unknown;
  bbDesktop?: unknown;
  fetch: typeof fetch;
}

// An error whose message is written for the user. Anything else is reported as
// a generic failure.
export class SwitchError extends Error {}

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function connectHandle(href: string): string | null {
  try {
    const url = new URL(href);
    const suffix = ".getbb.app";
    if (url.protocol !== "https:" || url.port || !url.hostname.endsWith(suffix)) return null;
    const handle = url.hostname.slice(0, -suffix.length);
    return HANDLE.test(handle) ? handle : null;
  } catch {
    return null;
  }
}

export function parseServers(value: unknown): Server[] {
  if (typeof value !== "object" || value === null || !("servers" in value) ||
      !Array.isArray(value.servers) || value.servers.length > 500) {
    throw new Error("Unexpected server list");
  }
  const servers = new Map<string, Server>();
  for (const entry of value.servers) {
    if (typeof entry !== "object" || entry === null ||
        typeof entry.handle !== "string" || !HANDLE.test(entry.handle) ||
        typeof entry.live !== "boolean") {
      throw new Error("Unexpected server list");
    }
    if (!servers.has(entry.handle)) servers.set(entry.handle, { handle: entry.handle, live: entry.live });
  }
  return [...servers.values()].sort((a, b) => a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0);
}

export function nextServer(servers: readonly Server[], current: string): Server | null {
  const currentIndex = servers.findIndex((server) => server.handle === current);
  for (let offset = 1; offset <= servers.length; offset += 1) {
    const server = servers[(currentIndex + offset) % servers.length];
    if (server?.live && server.handle !== current) return server;
  }
  return null;
}

// Matches BB's own detection. Both native shells expose their bridge before any
// page script runs.
export function appKind(win: ClientWindow): "browser" | "mobile" | "desktop" {
  if (win.bbDesktop !== undefined) return "desktop";
  const platform = win.bb?.native?.platform;
  return platform === "ios" || platform === "android" || win.ReactNativeWebView !== undefined
    ? "mobile" : "browser";
}

// The mobile bridge can open This device but has no message that switches servers.
export function openDeviceSettings(win: ClientWindow): void {
  const native = win.bb?.native;
  if (typeof native?.post !== "function" ||
      !Array.isArray(native.capabilities) || !native.capabilities.includes("open-native")) {
    throw new SwitchError("Open Settings → This device → Servers in the BB app.");
  }
  native.post({ type: "open-native", screen: "device-settings" });
}

// Opens the next online server on the page's bb connect account, in alphabetical
// handle order.
export async function switchServer(win: ClientWindow, signal: AbortSignal): Promise<void> {
  const current = connectHandle(win.location.href);
  if (current === null) throw new SwitchError("Open BB through bb connect to switch servers.");
  const response = await win.fetch("/api/connect/servers", {
    method: "GET",
    credentials: "same-origin",
    redirect: "error",
    headers: { Accept: "application/json" },
    signal,
  });
  if (response.status === 401 || response.status === 403) {
    throw new SwitchError("Sign in to bb connect to switch servers.");
  }
  if (!response.ok) throw new Error(`Server list failed with ${response.status}`);
  const next = nextServer(parseServers(await response.json()), current);
  if (next === null) throw new SwitchError("No other server is online.");
  // Only account handles become destinations; never a URL from the response.
  win.location.assign(`https://${next.handle}.getbb.app/`);
}
