import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SignedOutError,
  createReader,
  mutedIds,
  parseSession,
  summarize,
} from "./slack";

const signal = new AbortController().signal;
const counts = (dms: number) => ({ ok: true, channel_badges: { dms } });

/** Answers each method per token, read from the request body. */
function stubSlack(replies: Record<string, Record<string, object>>) {
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const method = url.split("/").pop()!;
    const token = new URLSearchParams(String(init.body)).get("token")!;
    return new Response(JSON.stringify(replies[token]?.[method]));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseSession", () => {
  it("needs both a token and a cookie, and reads each token once", () => {
    expect(parseSession("xoxc-1, xoxc-2 xoxc-1", " d1 ")).toEqual({
      tokens: ["xoxc-1", "xoxc-2"],
      cookie: "d1",
    });
    expect(parseSession("xoxc-1", "")).toBeNull();
    expect(parseSession(undefined, "d1")).toBeNull();
  });
});

describe("createReader", () => {
  it("sends the session and reads muted prefs once", async () => {
    const fetch = stubSlack({
      "xoxc-1": {
        "client.counts": {
          ...counts(1),
          channels: [{ id: "C1", has_unreads: true }],
        },
        "users.prefs.get": { ok: true, prefs: { muted_channels: "C1" } },
      },
    });
    const read = createReader();
    const session = { tokens: ["xoxc-1"], cookie: "d1" };
    expect(await read(session, signal)).toEqual({
      badge: 1,
      unread: false,
      rejected: 0,
    });
    await read(session, signal);
    expect(fetch).toHaveBeenCalledTimes(3);
    const [, init] = fetch.mock.calls[0]!;
    expect(init.headers).toEqual({ Cookie: "d=d1" });
  });

  it("counts every unread when muted prefs fail", async () => {
    stubSlack({
      "xoxc-1": {
        "client.counts": {
          ...counts(0),
          channels: [{ id: "C1", has_unreads: true }],
        },
        "users.prefs.get": { ok: false, error: "ratelimited" },
      },
    });
    expect(
      await createReader()({ tokens: ["xoxc-1"], cookie: "d1" }, signal),
    ).toEqual({ badge: 0, unread: true, rejected: 0 });
  });

  it("drops a workspace whose session Slack rejects", async () => {
    stubSlack({
      "xoxc-1": { "client.counts": counts(2), "users.prefs.get": { ok: true } },
      "xoxc-2": { "client.counts": { ok: false, error: "token_revoked" } },
    });
    expect(
      await createReader()({ tokens: ["xoxc-1", "xoxc-2"], cookie: "d" }, signal),
    ).toEqual({ badge: 2, unread: false, rejected: 1 });
  });

  it("is signed out when Slack rejects every session", async () => {
    stubSlack({ "xoxc-1": { "client.counts": { ok: false, error: "invalid_auth" } } });
    await expect(
      createReader()({ tokens: ["xoxc-1"], cookie: "d1" }, signal),
    ).rejects.toBeInstanceOf(SignedOutError);
  });

  it("fails the whole reading on any other error", async () => {
    stubSlack({
      "xoxc-1": { "client.counts": counts(2), "users.prefs.get": { ok: true } },
      "xoxc-2": { "client.counts": { ok: false, error: "ratelimited" } },
    });
    const failure = createReader()(
      { tokens: ["xoxc-1", "xoxc-2"], cookie: "d" },
      signal,
    );
    await expect(failure).rejects.toThrow("ratelimited");
    await expect(failure).rejects.not.toBeInstanceOf(SignedOutError);
  });
});

const none = new Set<string>();

describe("summarize", () => {
  it("adds mentions and direct messages across workspaces", () => {
    expect(
      summarize([
        { counts: { channel_badges: { dms: 2, app_dms: 1, channels: 1 } }, muted: none },
        { counts: { channel_badges: { thread_mentions: 3, thread_unreads: 9 } }, muted: none },
      ]),
    ).toEqual({ badge: 7, unread: false });
  });

  it("marks unread only for unmuted conversations and threads", () => {
    const counts = { channels: [{ id: "C1", has_unreads: true }] };
    expect(summarize([{ counts, muted: new Set(["C1"]) }])).toEqual({
      badge: 0,
      unread: false,
    });
    expect(summarize([{ counts, muted: none }])).toEqual({ badge: 0, unread: true });
    expect(
      summarize([{ counts: { threads: { has_unreads: true } }, muted: none }]),
    ).toEqual({ badge: 0, unread: true });
  });
});

it("reads muted conversations from both kinds of prefs", () => {
  const prefs = {
    muted_channels: "C1,C2",
    all_notifications_prefs: JSON.stringify({
      channels: { C3: { muted: true }, C4: { muted: false } },
    }),
  };
  expect([...mutedIds(prefs)].sort()).toEqual(["C1", "C2", "C3"]);
  expect(mutedIds(undefined).size).toBe(0);
  expect(mutedIds({ all_notifications_prefs: "{" }).size).toBe(0);
});
