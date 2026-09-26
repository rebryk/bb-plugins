import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CHANGED_CHANNEL } from "./shared";
import type { Choice } from "./time";

/** The wake timer sleeps at most this long, so it catches up soon after the computer sleeps. */
const MAX_SLEEP = 60_000;

const threadIdSchema = z.string().min(1).max(200);

const choiceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("preset"),
      id: z.enum(["later", "tomorrow", "nextweek"]),
    })
    .strict(),
  z
    .object({ kind: z.literal("text"), text: z.string().min(1).max(200) })
    .strict(),
]);

const snoozeSchema = z.object({
  threadId: z.string(),
  title: z.string(),
  until: z.number(),
});

export type Snooze = z.infer<typeof snoozeSchema>;

export const rpcContract = defineRpcContract({
  list: {
    input: z.null(),
    output: z.object({
      /** Soonest wake first. */
      snoozes: z.array(snoozeSchema),
      last: choiceSchema.nullable(),
    }),
  },
  snooze: {
    input: z
      .object({
        threadId: threadIdSchema,
        until: z.number().int().positive(),
        /** Stored as Last used; null keeps the stored one. */
        choice: choiceSchema.nullable(),
      })
      .strict(),
    output: z.object({
      /** The thread's title, for the toast. */
      title: z.string(),
      /** When the thread was already snoozed, its previous wake time. */
      previous: z.number().nullable(),
      /** Every thread the snooze hides: the thread and its descendants. */
      hidden: z.array(z.string()),
    }),
  },
  unsnooze: {
    input: z.object({ threadId: threadIdSchema }).strict(),
    output: z.null(),
  },
});

interface StoredSnooze {
  title: string;
  until: number;
  /** The threads the snooze hid, parents first. */
  hidden: string[];
}

type Snoozes = Record<string, StoredSnooze>;

export default async function plugin(bb: BbPluginApi) {
  const { threads } = bb.sdk;
  const { kv } = bb.storage;

  // Every change to the snoozes runs in this queue, one at a time.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  }

  const load = async () => (await kv.get<Snoozes>("snoozes")) ?? {};
  const save = (snoozes: Snoozes) => kv.set("snoozes", snoozes);
  const publishChange = () => bb.realtime.publish(CHANGED_CHANNEL, null);
  const warn = (message: string, error: unknown) =>
    bb.log.warn(`${message}: ${String(error)}`);

  async function setVisibility(
    threadId: string,
    visibility: "hidden" | "visible",
  ) {
    try {
      await threads.update({ threadId, visibility });
    } catch (error) {
      warn(`Could not make thread ${threadId} ${visibility}`, error);
    }
  }

  /** The thread and its descendants that the sidebar shows, parents first. */
  async function visibleTree(thread: { id: string; visibility: string }) {
    const visible = thread.visibility === "visible" ? [thread.id] : [];
    const all = [thread.id];
    for (const parentThreadId of all) {
      const children = await threads.list({
        parentThreadId,
        includeHidden: true,
      });
      for (const child of children) {
        all.push(child.id);
        if (child.visibility === "visible") visible.push(child.id);
      }
    }
    return visible;
  }

  async function snooze(
    threadId: string,
    until: number,
    choice: Choice | null,
  ) {
    const thread = await threads.get({ threadId });
    const tree = await visibleTree(thread);
    const snoozes = await load();
    const previous = snoozes[threadId];
    const hidden = [...new Set([...(previous?.hidden ?? []), ...tree])];
    const title = thread.title ?? thread.titleFallback ?? "Untitled thread";
    snoozes[threadId] = { title, until, hidden };
    await save(snoozes);
    if (choice !== null) await kv.set("last", choice);
    // Deepest first: BB lifts a visible child of a hidden thread to the top.
    for (const id of [...tree].reverse()) await setVisibility(id, "hidden");
    publishChange();
    return { title, previous: previous?.until ?? null, hidden };
  }

  async function wake(threadId: string, markUnread: boolean) {
    const snoozes = await load();
    const snooze = snoozes[threadId];
    if (snooze === undefined) return;
    for (const id of snooze.hidden) await setVisibility(id, "visible");
    delete snoozes[threadId];
    await save(snoozes);
    if (markUnread) {
      await threads
        .markUnread({ threadId })
        .catch((error: unknown) =>
          warn(`Could not mark thread ${threadId} unread`, error),
        );
    }
    publishChange();
  }

  /** Wake the snooze of `threadId`, or with `orHidden` also the one hiding it. */
  function wakeOn(threadId: string, orHidden: boolean) {
    return serial(async () => {
      for (const [id, snooze] of Object.entries(await load())) {
        if (id === threadId || (orHidden && snooze.hidden.includes(threadId))) {
          await wake(id, false);
        }
      }
    }).catch((error: unknown) =>
      warn(`Could not wake thread ${threadId}`, error),
    );
  }

  bb.rpc.register(rpcContract, {
    async list() {
      const snoozes = Object.entries(await load())
        .map(([threadId, { title, until }]) => ({ threadId, title, until }))
        .sort((a, b) => a.until - b.until);
      return { snoozes, last: (await kv.get<Choice>("last")) ?? null };
    },
    async snooze({ threadId, until, choice }) {
      const result = await serial(() => snooze(threadId, until, choice));
      wakeTimer();
      return result;
    },
    async unsnooze({ threadId }) {
      await serial(() => wake(threadId, false));
      return null;
    },
  });

  // A turn that ends or fails, or an agent that needs an answer, wakes the
  // thread at once. Archiving or deleting it drops the snooze.
  bb.events.on("thread.idle", ({ thread }) => wakeOn(thread.id, false));
  bb.events.on("thread.failed", ({ thread }) => wakeOn(thread.id, false));
  bb.events.on("thread.archived", ({ thread }) => wakeOn(thread.id, false));
  bb.events.on("thread.deleted", ({ thread }) => wakeOn(thread.id, false));
  bb.events.on("interaction.pending", ({ thread }) => wakeOn(thread.id, true));

  let wakeTimer = () => {};

  /** Wakes the due snoozes, marked unread, and returns the next wake time. */
  async function wakeDue() {
    const now = Date.now();
    let next = Infinity;
    for (const [threadId, { until }] of Object.entries(await load())) {
      if (until <= now) await wake(threadId, true);
      else next = Math.min(next, until);
    }
    return next;
  }

  // Starts with the wakes missed while BB was not running.
  bb.background.service("wake", {
    async start(signal) {
      while (!signal.aborted) {
        const next = await serial(wakeDue);
        if (signal.aborted) break;
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            wakeTimer = () => {};
            resolve();
          };
          const timer = setTimeout(
            done,
            Math.min(next - Date.now(), MAX_SLEEP),
          );
          signal.addEventListener("abort", done);
          wakeTimer = done;
        });
      }
    },
  });
}
