import { afterEach, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

/** Slack accepts only `goodToken`; prefs are always empty. */
function stubSlack(goodToken: string) {
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const token = new URLSearchParams(String(init.body)).get("token");
    if (token !== goodToken)
      return new Response(JSON.stringify({ ok: false, error: "invalid_auth" }));
    const reply = url.endsWith("client.counts")
      ? { ok: true, channel_badges: { dms: 2 } }
      : { ok: true, prefs: {} };
    return new Response(JSON.stringify(reply));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

async function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "slack" });
  await plugin(bb);
  return harness;
}

const published = (harness: Awaited<ReturnType<typeof setup>>) =>
  harness.inspection.realtimeSignals.map(({ payload }) => payload);

afterEach(() => {
  vi.unstubAllGlobals();
});

it("asks for a session and waits for one", async () => {
  const fetch = stubSlack("xoxc-1");
  const harness = await setup();
  expect(harness.inspection.needsConfigurationMessages).toHaveLength(1);
  const service = harness.behavior.runService("reader");
  await vi.waitFor(() =>
    expect(published(harness)).toEqual([{ kind: "signedOut" }]),
  );
  expect(fetch).not.toHaveBeenCalled();

  await harness.behavior.setSettings({ token: "xoxc-1", cookie: "d1" });
  await vi.waitFor(() =>
    expect(published(harness)).toEqual([
      { kind: "signedOut" },
      { kind: "counts", badge: 2, unread: false },
    ]),
  );
  expect(await harness.behavior.callRpc("slackState", null)).toEqual({
    kind: "counts",
    badge: 2,
    unread: false,
  });
  service.controller.abort();
  await service.done;
});

it("stops asking Slack after it rejects the session", async () => {
  const fetch = stubSlack("xoxc-2");
  const harness = await setup();
  await harness.behavior.setSettings({ token: "xoxc-1", cookie: "d1" });
  const service = harness.behavior.runService("reader");
  await vi.waitFor(() =>
    expect(published(harness)).toEqual([{ kind: "signedOut" }]),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(fetch).toHaveBeenCalledTimes(1);

  await harness.behavior.setSettings({ token: "xoxc-2" });
  await vi.waitFor(() =>
    expect(published(harness)).toContainEqual({
      kind: "counts",
      badge: 2,
      unread: false,
    }),
  );
  service.controller.abort();
  await service.done;
});
