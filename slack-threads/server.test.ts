import { readFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { Message, Thread } from "chat";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import plugin from "./server";
import { connectSlack, type InboundHandler, type SlackConnection } from "./slack";
import { openStore } from "./store";
import type { Interaction } from "./interactions";

vi.mock("./slack", async (original) => ({
  ...await original<typeof import("./slack")>(),
  connectSlack: vi.fn(),
  react: vi.fn(),
  channelName: vi.fn(async () => "test-channel"),
  permalink: vi.fn(async () => null),
}));

const message = (id: string, name: string, isMention = true): Message => ({
  id, text: "here", isMention,
  author: { userName: "ann", userId: "U1", isMe: false },
  attachments: [{ type: "image", name, fetchData: async () => Buffer.from(name) }],
}) as Message;

let host: ReturnType<typeof createFakePluginHost>;
let inbound: InboundHandler;
let connection: SlackConnection;
let history: Message[];
let thread: Thread;
let filesDir: string;
const spawn = vi.fn(async (_input: unknown) => makeThreadResponse({ id: "thr_test" }));
const send = vi.fn(async (_input: unknown) => ({}));
const resolve = vi.fn(async (_input: unknown) => ({}));
let pending: Interaction[];

beforeEach(async () => {
  vi.clearAllMocks();
  pending = [];
  history = [];
  host = createFakePluginHost({
    pluginId: "slack-threads", agentSkillIds: ["slack-threads"],
    settings: { botToken: "test", appToken: "test", projectId: "proj_test" },
    sdk: { threads: { spawn, send, interactions: {
      list: async () => pending,
      resolve,
    } } },
  });
  filesDir = join(dirname(host.bb.storage.database().name), "slack-files/T1_C1_1731.1");
  thread = {
    id: "slack:C1:1731.1", isDM: false,
    subscribe: vi.fn(), unsubscribe: vi.fn(),
    adapter: { fetchMessages: async () => ({ messages: history }) },
  } as unknown as Thread;
  connection = {
    identity: { teamId: "T1", teamName: "test", botUserId: "B1", botName: "test" },
    bot: { shutdown: async () => {}, getState: () => ({ unsubscribe: vi.fn() }) },
  } as unknown as SlackConnection;
  vi.mocked(connectSlack).mockImplementation(async (options) => {
    inbound = options.onInbound;
    return connection;
  });
  await plugin(host.bb);
  host.harness.behavior.runService("socket");
  await vi.waitFor(() => expect(connectSlack).toHaveBeenCalled());
});

afterEach(async () => { await host.harness.lifecycle.dispose(); });

it("forwards history, mentions and DM attachments, then cleans up on deletion", async () => {
  history = [message("1731.0", "old.png", false)];
  await inbound(connection, thread, [message("1731.1", "first.png")], "mention");
  const prompt = spawn.mock.calls[0]?.[0];
  expect(prompt).toMatchObject({ prompt: expect.stringContaining("1-first.png") });
  expect(prompt).toMatchObject({ prompt: expect.stringContaining("1-old.png") });
  expect(await readFile(join(filesDir, "1731.0/1-old.png"), "utf8")).toBe("old.png");

  history = [message("1731.2", "context.png", false)];
  await inbound(connection, thread, [message("1731.3", "next.png")], "mention");
  expect(send.mock.calls[0]?.[0]).toMatchObject({ input: [{
    text: expect.stringContaining("1-context.png"), type: "text", mentions: [],
  }] });
  expect(send.mock.calls[0]?.[0]).toMatchObject({ input: [{
    text: expect.stringContaining("1-next.png"), type: "text", mentions: [],
  }] });

  Object.assign(thread, { isDM: true });
  await inbound(connection, thread, [message("1731.4", "dm.png", false)], "direct");
  expect(send.mock.calls[1]?.[0]).toMatchObject({ input: [{
    text: expect.stringContaining("1-dm.png"), type: "text", mentions: [],
  }] });
  expect(await readFile(join(filesDir, "1731.4/1-dm.png"), "utf8")).toBe("dm.png");
  await host.harness.behavior.emitThreadEvent("thread.deleted", {
    thread: makeThreadResponse({ id: "thr_test" }),
  });
  await expect(access(filesDir)).rejects.toThrow();
});

it.each([true, false])("keeps attachment paths in free-text answers (mention: %s)", async (mention) => {
  await inbound(connection, thread, [message("1731.1", "first.png")], "mention");
  pending = [{
    id: "interaction_test", status: "pending", createdAt: 1,
    payload: { kind: "user_question", questions: [
      { id: "screen", prompt: "Show the screen", allowFreeText: true },
    ] },
  }] as Interaction[];
  await inbound(connection, thread, [message("1731.2", "answer.png", mention)], "subscribed");
  expect(resolve.mock.calls[0]?.[0]).toMatchObject({
    threadId: "thr_test", interactionId: "interaction_test",
    resolution: { kind: "user_answer", answers: { screen: {
      selected: [], freeText: expect.stringContaining("1-answer.png"),
    } } },
  });
  expect(await readFile(join(filesDir, "1731.2/1-answer.png"), "utf8")).toBe("answer.png");
  expect(send).not.toHaveBeenCalled();
});

it("forwards approval attachments to the worker after resolving approval", async () => {
  await inbound(connection, thread, [message("1731.1", "first.png")], "mention");
  openStore(host.bb).addTask({
    workerThreadId: "thr_worker", slackKey: "T1:C1:1731.1", title: "test",
  });
  host.harness.inspection.sdk.stub("threads.interactions.list", async ({ threadId }) =>
    threadId === "thr_worker" ? pending : []);
  pending = [{
    id: "interaction_test", status: "pending", createdAt: 1,
    payload: { kind: "approval", availableDecisions: ["allow_once", "deny"] },
  }] as Interaction[];
  const answer = message("1731.2", "approved.png", false);
  Object.assign(answer, { text: "approve" });
  await inbound(connection, thread, [answer], "subscribed");
  expect(send.mock.calls[0]?.[0]).toMatchObject({
    threadId: "thr_worker", mode: "auto", input: [{
      type: "text", text: expect.stringContaining("1-approved.png"), mentions: [],
    }],
  });
  expect(resolve.mock.calls[0]?.[0]).toMatchObject({
    threadId: "thr_worker", resolution: { decision: "allow_once" },
  });
  expect(send.mock.invocationCallOrder[0]).toBeGreaterThan(resolve.mock.invocationCallOrder[0]!);
});
