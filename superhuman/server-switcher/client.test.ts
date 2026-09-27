import { describe, expect, it, vi } from "vitest";
import { appKind, connectHandle, nextServer, openDeviceSettings, parseServers, switchServer, SwitchError } from "./client";

const payload = {
  servers: [
    { handle: "gamma", name: "Desktop", live: true },
    { handle: "alpha", name: "Laptop", live: true },
    { handle: "beta", name: "Offline machine", live: false },
  ],
};

describe("server order", () => {
  it("cycles in a stable order, skips offline servers, and wraps around", () => {
    const servers = parseServers(payload);
    expect(servers.map((server) => server.handle)).toEqual(["alpha", "beta", "gamma"]);
    expect(nextServer(servers, "alpha")?.handle).toBe("gamma");
    expect(nextServer(servers, "gamma")?.handle).toBe("alpha");
    expect(nextServer(servers, "missing")?.handle).toBe("alpha");
    expect(nextServer(servers.slice(0, 2), "alpha")).toBeNull();
    expect(nextServer([], "alpha")).toBeNull();
  });

  it("deduplicates handles and keeps no supplied URL", () => {
    const servers = parseServers({ servers: [
      { handle: "alpha", live: true, url: "https://outside.example" },
      { handle: "alpha", live: false },
    ] });
    expect(servers).toEqual([{ handle: "alpha", live: true }]);
  });

  it.each(["../evil", "alpha.evil", "x/getbb", "a@b", "-alpha", "alpha-"])("rejects malformed handle %s", (handle) => {
    expect(() => parseServers({ servers: [{ handle, live: true }] })).toThrow();
  });

  it.each([null, {}, { servers: "bad" }, { servers: [{ handle: "alpha", live: "yes" }] }])("rejects invalid responses", (value) => {
    expect(() => parseServers(value)).toThrow();
  });

  it("recognizes only the main HTTPS bb connect server origin", () => {
    expect(connectHandle("https://alpha.getbb.app/threads/t1")).toBe("alpha");
    for (const url of ["http://alpha.getbb.app", "https://alpha.getbb.app.evil", "https://alpha--38886.share.getbb.app", "https://getbb.app", "https://alpha.getbb.app:444", "http://localhost:38886"]) {
      expect(connectHandle(url)).toBeNull();
    }
  });
});

describe("switching", () => {
  function windowFixture(servers: unknown = payload) {
    return {
      location: { href: "https://alpha.getbb.app/threads/t1", assign: vi.fn() },
      fetch: vi.fn(async () => new Response(JSON.stringify(servers))),
    };
  }

  it("uses the current browser session and opens the next online server's root", async () => {
    const win = windowFixture();
    const signal = new AbortController().signal;
    await switchServer(win, signal);
    expect(win.fetch).toHaveBeenCalledExactlyOnceWith("/api/connect/servers", {
      method: "GET", credentials: "same-origin", redirect: "error", headers: { Accept: "application/json" }, signal,
    });
    expect(win.location.assign).toHaveBeenCalledExactlyOnceWith("https://gamma.getbb.app/");
  });

  it("explains an expired session, a lone online server, and a direct URL", async () => {
    const signal = new AbortController().signal;
    const expired = windowFixture();
    expired.fetch.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(switchServer(expired, signal)).rejects.toThrow(new SwitchError("Sign in to bb connect to switch servers."));

    const alone = windowFixture({ servers: [{ handle: "alpha", live: true }, { handle: "beta", live: false }] });
    await expect(switchServer(alone, signal)).rejects.toThrow(new SwitchError("No other server is online."));
    expect(alone.location.assign).not.toHaveBeenCalled();

    const direct = windowFixture();
    direct.location.href = "http://localhost:38886";
    await expect(switchServer(direct, signal)).rejects.toThrow(new SwitchError("Open BB through bb connect to switch servers."));
    expect(direct.fetch).not.toHaveBeenCalled();
  });

  it("leaves server failures and malformed lists to the generic message", async () => {
    const failed = windowFixture();
    failed.fetch.mockResolvedValue(new Response(null, { status: 502 }));
    const error = await switchServer(failed, new AbortController().signal).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SwitchError);
    await expect(switchServer(windowFixture({ servers: "bad" }), new AbortController().signal))
      .rejects.not.toBeInstanceOf(SwitchError);
  });

  it("tells the browser, the mobile shell, and BB Desktop apart", () => {
    expect(appKind(windowFixture())).toBe("browser");
    expect(appKind({ ...windowFixture(), bb: { native: { platform: "android" } } })).toBe("mobile");
    expect(appKind({ ...windowFixture(), ReactNativeWebView: {} })).toBe("mobile");
    expect(appKind({ ...windowFixture(), bbDesktop: {} })).toBe("desktop");
  });

  it("opens This device through the mobile bridge without touching server URLs", () => {
    const post = vi.fn();
    const win = { ...windowFixture(), bb: { native: { platform: "ios", capabilities: ["open-native"], post } } };
    openDeviceSettings(win);
    expect(post).toHaveBeenCalledExactlyOnceWith({ type: "open-native", screen: "device-settings" });
    expect(win.fetch).not.toHaveBeenCalled();
    expect(win.location.assign).not.toHaveBeenCalled();
    expect(() => openDeviceSettings({ ...windowFixture(), ReactNativeWebView: {} }))
      .toThrow(new SwitchError("Open Settings → This device → Servers in the BB app."));
  });
});
