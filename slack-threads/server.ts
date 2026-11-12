import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliContext,
  type PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import type { Logger, Message, Thread } from "chat";
import { z } from "zod";
import { answerFromText, describeInteraction } from "./interactions";
import {
  DEFAULT_GUARDRAILS,
  DEFAULT_PROMPT,
  channelsOrEmpty,
  channelsSettingSchema,
  coordinatorInstructions,
  parseChannels,
  workerInstructions,
} from "./prompts";
import {
  channelName,
  chatThreadId,
  connectSlack,
  describeMessage,
  describeSlackError,
  extractBlocks,
  parseBlocks,
  CHART_FAILED,
  isAuthError,
  isHumanMessage,
  permalink,
  postMarkdown,
  react,
  resolveChannel,
  rootTs,
  threadHistory,
  authorName,
  type SlackConnection,
} from "./slack";
import { PROGRESS_CHARS, renderStatus } from "./status";
import { openStore, slackKey, type Binding, type Task } from "./store";
import { describeUsage, poolStatusSchema, type PoolStatus } from "./usage";

type ThreadResponse = PluginThreadEventPayloads["thread.idle"]["thread"];

const EYES = "eyes";
const DONE = "check";
const FAILED = "x";

const USAGE_TTL_MS = 60_000;
/** Coalesces a worker's progress calls into one Slack edit. */
const STATUS_EDIT_MS = 1_500;
/** A worker idle for longer than this after its task started is done. */
const SETTLED_MS = 30_000;
const SKILL = "slack-threads";
const TITLE_CHARS = 80;

/**
 * This plugin's metadata on a bb thread it started: a coordinator answers one
 * Slack thread, a worker does a task a coordinator handed it.
 */
const threadRoleSchema = z.union([
  z.looseObject({
    role: z.literal("coordinator"),
    slack: z.looseObject({ channelId: z.string() }),
  }),
  z.looseObject({
    role: z.literal("worker"),
    channelId: z.string(),
  }),
]);

const EFFORTS: Record<string, string> = {
  xhigh: "extra high",
  max: "max",
  high: "high",
  medium: "medium",
  low: "low",
  minimal: "minimal",
  none: "no reasoning",
};

/** `claude-opus-5-5` → `Opus 5.5`; other ids stay as they are. */
const modelName = (id: string) => {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:$|-)/u.exec(id);
  if (!match) return id;
  const [, family = "", major, minor] = match;
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ""}`;
};

const needsConfiguration = (message: string) =>
  Object.assign(new Error(message), { name: "NeedsConfigurationError" });

const list = (value: string) =>
  value
    .split(/[\s,]+/u)
    .map((item) => item.trim())
    .filter(Boolean);

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const httpStatus = (error: unknown) =>
  (error as { status?: unknown } | null)?.status;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** `slack:<channel>:<threadTs>` → its parts; threadTs is empty for a DM. */
const splitChatThreadId = (id: string) => {
  const [, channelId = "", threadTs = ""] = id.split(":");
  return { channelId, threadTs };
};

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const settings = bb.settings.define({
    botToken: {
      type: "string",
      label: "Bot token",
      description: "Bot User OAuth Token (xoxb-…)",
      secret: true,
    },
    appToken: {
      type: "string",
      label: "App token",
      description:
        "App-level token with connections:write (xapp-…), for Socket Mode",
      secret: true,
    },
    projectId: {
      type: "project",
      label: "Project",
      description:
        "The bb project coordinators and workers start in, unless a channel sets its own",
    },
    provider: {
      type: "string",
      label: "Provider",
      description:
        "Provider ID for coordinators and workers; empty uses the project default",
      default: "",
    },
    coordinatorModel: {
      type: "string",
      label: "Coordinator model",
      description:
        "Model of the bb thread that answers each Slack thread and hands work to workers; empty uses the worker model",
      default: "",
    },
    coordinatorReasoningLevel: {
      type: "string",
      label: "Coordinator reasoning level",
      description: "Reasoning level of coordinators; empty uses the default",
      default: "low",
    },
    model: {
      type: "string",
      label: "Worker model",
      description:
        "Model of the worker threads coordinators start; empty uses the project default",
      default: "",
    },
    reasoningLevel: {
      type: "string",
      label: "Worker reasoning level",
      description: "Reasoning level of workers; empty uses the default",
      default: "",
    },
    permissionMode: {
      type: "string",
      label: "Permission mode",
      description:
        "Permission mode of coordinators and workers: full, auto, or accept-edits; empty uses the default",
      default: "full",
    },
    prompt: {
      type: "string",
      label: "Prompt",
      description:
        "Who the agent is, what it knows, and how it answers, for coordinators and workers in every channel; a channel can add to it or replace it",
      experimental_multiline: true,
      default: DEFAULT_PROMPT,
    },
    guardrails: {
      type: "string",
      label: "Guardrails",
      description:
        "Rules coordinators and workers always follow; a channel can add rules but never remove these",
      experimental_multiline: true,
      default: DEFAULT_GUARDRAILS,
    },
    channels: {
      type: "string",
      label: "Channels",
      description:
        'Per-channel settings as JSON keyed by channel ID: {"C0123ABCD": {"name": "#growth", "prompt": "…", "promptMode": "append" or "replace", "guardrails": "…", "projectId": "proj_…"}}. Admins can also change them from Slack by asking the bot',
      experimental_multiline: true,
      experimental_schema: channelsSettingSchema,
      default: "{}",
    },
    adminUserIds: {
      type: "string",
      label: "Admins",
      description:
        "Comma-separated Slack user IDs (U…) who can change channel settings from Slack",
      default: "",
    },
    allowedChannelIds: {
      type: "string",
      label: "Allowed channels",
      description:
        "Comma-separated channel IDs the bot answers in; empty means every channel it is in. Direct messages are not affected",
      default: "",
    },
    allowedUserIds: {
      type: "string",
      label: "Allowed users",
      description:
        "Comma-separated Slack user IDs (U…) who can talk to the agent; empty means everyone in the workspace",
      default: "",
    },
  });

  type Values = Awaited<ReturnType<typeof settings.get>>;
  /** The latest settings, for the synchronous agent configuration. */
  let latest: Values = await settings.get();

  /** Provider, model, reasoning, and permission mode of a new thread. */
  const executionFor = (
    values: Values,
    model: string,
    reasoningLevel: string,
  ) => {
    const permissionMode = (["full", "auto", "accept-edits"] as const).find(
      (mode) => mode === values.permissionMode.trim(),
    );
    return {
      ...(values.provider ? { providerId: values.provider } : {}),
      ...(model ? { model } : {}),
      ...(reasoningLevel ? { reasoningLevel } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      executionInputSources: {
        ...(values.provider ? { providerId: "explicit" as const } : {}),
        ...(model ? { model: "explicit" as const } : {}),
        ...(reasoningLevel ? { reasoningLevel: "explicit" as const } : {}),
        ...(permissionMode ? { permissionMode: "explicit" as const } : {}),
      },
    };
  };

  const missingSettings = async () => {
    const values = await settings.get();
    return (["botToken", "appToken", "projectId"] as const).filter(
      (key) => !values[key],
    );
  };
  const setupMessage = (missing: readonly string[]) =>
    `Set ${missing.join(", ")} in Settings → Plugins → Slack Threads, or with \`bb plugin config slack-threads set <key> <value>\`.`;

  const initiallyMissing = await missingSettings();
  if (initiallyMissing.length > 0) {
    bb.status.needsConfiguration(setupMessage(initiallyMissing));
  }

  const store = openStore(bb);
  let connection: SlackConnection | null = null;
  let connectedAt: number | null = null;
  let lastError: string | null = null;

  // Shallow on purpose: Slack HTTP errors carry request headers with tokens.
  const summarize = (value: unknown): string => {
    if (value instanceof Error) return value.message;
    if (value === null || typeof value !== "object") return String(value);
    return Object.entries(value)
      .map(([key, field]) => {
        if (field instanceof Error) return `${key}=${field.message}`;
        if (field === null || typeof field !== "object")
          return `${key}=${String(field)}`;
        return `${key}=[object]`;
      })
      .join(" ");
  };
  const format = (args: unknown[]) =>
    clip(
      args
        .map(summarize)
        .join(" ")
        .replace(/\b(xox[a-z]|xapp)-[A-Za-z0-9-]+/gu, "$1-…"),
      2000,
    );
  const makeLogger = (prefix: string): Logger => ({
    child: (name) => makeLogger(`${prefix}:${name}`),
    debug: () => {},
    info: () => {},
    warn: (message, ...args) =>
      bb.log.warn(`[${prefix}] ${message} ${format(args)}`),
    error: (message, ...args) =>
      bb.log.error(`[${prefix}] ${message} ${format(args)}`),
  });

  // ---------------------------------------------------------------------
  // Slack → bb
  // ---------------------------------------------------------------------

  const isAllowed = async (thread: Thread, message: Message) => {
    const values = await settings.get();
    const users = list(values.allowedUserIds);
    if (users.length > 0 && !users.includes(message.author.userId))
      return false;
    const channels = list(values.allowedChannelIds);
    const { channelId } = splitChatThreadId(thread.id);
    return thread.isDM || channels.length === 0 || channels.includes(channelId);
  };

  /** Records Slack messages (already marked 👀) as waiting for a reply. */
  const markPending = (binding: Binding, messages: Message[]) => {
    for (const message of messages) {
      store.addPending(
        binding.bbThreadId,
        binding.slackKey,
        message.id,
        message.author.userId,
      );
    }
    store.touch(binding.slackKey);
  };

  /** The text without the bot's own mention. */
  const withoutMentions = (current: SlackConnection, text: string) => {
    const name = current.identity.botName.replace(
      /[.*+?^${}()|[\]\\]/gu,
      "\\$&",
    );
    return text
      .replace(
        new RegExp(`<@${current.identity.botUserId}>|@${name}\\b`, "giu"),
        "",
      )
      .trim();
  };

  const unmark = async (
    current: SlackConnection,
    channelId: string,
    messages: Message[],
  ) => {
    for (const message of messages) {
      await react(current, channelId, message.id, null, EYES);
    }
  };

  const startThread = async (
    current: SlackConnection,
    thread: Thread,
    messages: Message[],
    note: string | null = null,
  ) => {
    const values = await settings.get();
    const { channelId, threadTs } = splitChatThreadId(thread.id);
    const last = messages[messages.length - 1];
    if (!last) return;
    if (!values.projectId) {
      await postMarkdown(
        current,
        channelId,
        threadTs,
        "bb is not set up yet: pick a project for Slack Threads.",
      );
      await unmark(current, channelId, messages);
      return;
    }

    const [name, link, history] = await Promise.all([
      thread.isDM ? Promise.resolve(null) : channelName(thread),
      permalink(current, channelId, threadTs || last.id),
      threadHistory(thread).catch((error: unknown) => {
        bb.log.warn(
          `Could not read Slack thread history: ${errorMessage(error)}`,
        );
        return [];
      }),
    ]);
    const fresh = new Set(messages.map((message) => message.id));
    const earlier = history.filter((message) => !fresh.has(message.id));
    const where = thread.isDM ? "a direct message" : (name ?? channelId);
    const author = authorName(last);
    const prompt = [
      `Slack message from ${author} in ${where}${link ? ` (${link})` : ""}:`,
      messages.map(describeMessage).join("\n\n"),
      ...(earlier.length > 0
        ? [
            `Earlier messages in this Slack thread, oldest first:\n${earlier.map(describeMessage).join("\n")}`,
          ]
        : []),
      ...(note ? [note] : []),
    ].join("\n\n");

    const words = withoutMentions(current, last.text)
      .replace(/<@[A-Z0-9]+>/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
    const title = `${thread.isDM ? `@${author}` : (name ?? channelId)} · ${clip(words || "Slack thread", 60)}`;

    const channel = channelsOrEmpty(values.channels)[channelId];
    const spawned = await bb.sdk.threads.spawn({
      projectId: channel?.projectId || values.projectId,
      environment: { type: "project-default" },
      ...executionFor(
        values,
        values.coordinatorModel || values.model,
        values.coordinatorReasoningLevel,
      ),
      title,
      prompt,
      pluginMetadata: {
        role: "coordinator",
        slack: {
          teamId: current.identity.teamId,
          channelId,
          channelName: name,
          threadTs,
          permalink: link,
        },
      },
    });
    const binding: Binding = {
      slackKey: slackKey(current.identity.teamId, channelId, threadTs),
      bbThreadId: spawned.id,
      teamId: current.identity.teamId,
      channelId,
      threadTs,
      channelName: name,
      permalink: link,
      origin: "slack",
      cursor: last.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.save(binding);
    store.setCursor(binding.slackKey, last.id);
    await thread.subscribe();
    markPending(binding, messages);
    bb.log.info(`Started bb thread ${spawned.id} for ${binding.slackKey}`);
  };

  /**
   * Answers the oldest pending question or approval of the bb thread or of
   * its workers still at work from a Slack reply. A reply that does not parse
   * gets a hint, unless `quiet`.
   */
  const answerInteraction = async (
    current: SlackConnection,
    binding: Binding,
    text: string,
    quiet: boolean,
  ): Promise<"answered" | "hint" | "none"> => {
    const tasks = store.activeTasksOf(binding.slackKey);
    const threadIds = [
      binding.bbThreadId,
      ...new Set(tasks.map((task) => task.workerThreadId)),
    ];
    // An archived or deleted thread is handled where the send fails.
    const lists = await Promise.all(
      threadIds.map((threadId) =>
        bb.sdk.threads.interactions
          .list({ threadId })
          .then((interactions) =>
            interactions.map((interaction) => ({ threadId, interaction })),
          )
          .catch(() => []),
      ),
    );
    const pending = lists
      .flat()
      .filter(({ interaction }) => interaction.status === "pending")
      .sort((a, b) => a.interaction.createdAt - b.interaction.createdAt)[0];
    const waiting = pending?.interaction;
    const answer = waiting ? answerFromText(waiting, text) : null;
    if (!pending || !waiting || !answer) return "none";
    if ("hint" in answer) {
      if (quiet) return "none";
      await postMarkdown(
        current,
        binding.channelId,
        binding.threadTs,
        answer.hint,
      );
      return "hint";
    }
    await bb.sdk.threads.interactions.resolve({
      threadId: pending.threadId,
      interactionId: waiting.id,
      resolution: answer.resolution,
    });
    for (const task of tasks) {
      if (task.workerThreadId !== pending.threadId) continue;
      if (task.state !== "waiting") continue;
      store.setTaskState(task.id, "running");
      refreshStatus(task);
    }
    return "answered";
  };

  /** Human messages after the binding's cursor and before `until`. */
  const messagesSince = async (
    thread: Thread,
    binding: Binding,
    until: Message,
  ) => {
    const history = await threadHistory(thread).catch(() => []);
    // Bindings older than the cursor start after the bot's last reply.
    const after =
      binding.cursor ??
      history
        .filter((message) => message.author.isMe)
        .map((message) => message.id)
        .sort()
        .pop() ??
      "";
    return history.filter(
      (message) =>
        message.id > after && message.id < until.id && isHumanMessage(message),
    );
  };

  /**
   * Hands Slack messages to a bound bb thread. In a DM every message is for
   * the bot; in a channel `answerTo` is the mention, and the messages posted
   * since the last turn come with it as context.
   */
  const continueThread = async (
    current: SlackConnection,
    thread: Thread,
    binding: Binding,
    messages: Message[],
    answerTo: Message,
  ) => {
    const direct = thread.isDM;
    const forwarded = direct ? messages : [answerTo];
    const reply = direct
      ? messages.map((message) => message.text).join("\n")
      : withoutMentions(current, answerTo.text);
    const answered = await answerInteraction(current, binding, reply, false);
    if (answered === "hint") {
      await unmark(current, binding.channelId, forwarded);
      return;
    }
    if (answered === "answered") {
      markPending(binding, forwarded);
      store.setCursor(binding.slackKey, answerTo.id);
      return;
    }

    const since = direct ? [] : await messagesSince(thread, binding, answerTo);
    const text = direct
      ? messages
          .map((message) => `Slack reply from ${describeMessage(message)}`)
          .join("\n\n")
      : [
          ...(since.length > 0
            ? [
                `Slack messages since your last turn, oldest first:\n${since.map(describeMessage).join("\n")}`,
              ]
            : []),
          `Answer this Slack message:\n${describeMessage(answerTo)}`,
        ].join("\n\n");
    const send = () =>
      bb.sdk.threads.send({
        threadId: binding.bbThreadId,
        mode: "auto",
        input: [{ type: "text", text, mentions: [] }],
      });
    try {
      await send();
    } catch (error) {
      if (!(await reviveAndSend(binding.bbThreadId, error, send))) {
        // The bb thread is gone for good: a fresh one takes the Slack thread.
        store.remove(binding.slackKey);
        await startThread(
          current,
          thread,
          forwarded,
          `This Slack thread used to continue bb thread ${binding.bbThreadId}, which is no longer available; you take it over.`,
        );
        return;
      }
    }
    markPending(binding, forwarded);
    store.setCursor(binding.slackKey, answerTo.id);
  };

  /**
   * After a failed send: unarchives an archived thread and sends once more.
   * Returns false when the thread is deleted, missing, or cannot come back;
   * rethrows any other failure.
   */
  const reviveAndSend = async (
    bbThreadId: string,
    error: unknown,
    send: () => Promise<unknown>,
  ) => {
    const status = httpStatus(error);
    if (status === 404 || status === 410) return false;
    if (status !== 409) throw error;
    const thread = await bb.sdk.threads
      .get({ threadId: bbThreadId })
      .catch(() => null);
    if (!thread || thread.deletedAt !== null) return false;
    if (thread.archivedAt === null) throw error;
    try {
      await bb.sdk.threads.unarchive({ threadId: bbThreadId });
      await send();
      bb.log.info(`Unarchived bb thread ${bbThreadId} for a Slack reply`);
      return true;
    } catch (retryError) {
      bb.log.warn(
        `Could not bring back bb thread ${bbThreadId}: ${errorMessage(retryError)}`,
      );
      return false;
    }
  };

  /**
   * In a one-to-one DM every message is for the bot. In channels and group
   * DMs only a mention starts or continues a turn; other messages there only
   * answer a pending question or approval.
   */
  const onInbound = async (
    current: SlackConnection,
    thread: Thread,
    batch: Message[],
    kind: "mention" | "subscribed" | "direct",
  ) => {
    // One Slack thread is one bb thread: split a batch of top-level DMs.
    const groups = new Map<string, Message[]>();
    for (const message of batch) {
      if (!isHumanMessage(message) || !(await isAllowed(thread, message))) {
        continue;
      }
      const ts = rootTs(thread, message);
      groups.set(ts, [...(groups.get(ts) ?? []), message]);
    }
    const { channelId, threadTs } = splitChatThreadId(thread.id);
    for (const [ts, messages] of groups) {
      const target =
        ts === threadTs
          ? thread
          : current.bot.thread(chatThreadId(channelId, ts));
      const key = slackKey(current.identity.teamId, channelId, ts);
      const binding = store.get(key);
      const watched = binding ? null : store.getWatched(key);
      const last = messages[messages.length - 1];
      const answerTo = target.isDM
        ? last
        : [...messages].reverse().find((message) => message.isMention);
      let marked: Message[] = [];
      try {
        if (!answerTo) {
          // Unaddressed chatter: it may still answer a pending question.
          if (
            binding &&
            last &&
            (await answerInteraction(current, binding, last.text, true)) ===
              "answered"
          ) {
            marked = [last];
            await react(current, channelId, last.id, EYES);
            markPending(binding, marked);
            store.setCursor(key, last.id);
          } else if (!binding && !watched && kind === "subscribed") {
            await thread.unsubscribe();
          }
          continue;
        }
        marked = target.isDM ? messages : [answerTo];
        for (const message of marked) {
          await react(current, channelId, message.id, EYES);
        }
        if (binding) {
          await continueThread(current, target, binding, messages, answerTo);
        } else {
          const source = watched?.sourceBbThreadId;
          await startThread(
            current,
            target,
            marked,
            source
              ? `This post came from bb thread ${source}; read it with \`bb thread messages ${source}\` if you need its context.`
              : null,
          );
          // From now on the Slack thread is bound to the new bb thread.
          if (watched && store.get(key)) store.unwatch(key);
        }
      } catch (error) {
        bb.log.error(
          `Could not hand a Slack message to bb: ${errorMessage(error)}`,
        );
        for (const message of marked) {
          await react(current, channelId, message.id, FAILED, EYES);
        }
      }
    }
  };

  // ---------------------------------------------------------------------
  // bb → Slack
  // ---------------------------------------------------------------------

  const labels = new Map<string, string>();
  /** "Opus 5.5 · extra high" for the model and reasoning the thread runs. */
  const modelLabel = async (thread: ThreadResponse) => {
    try {
      const options = await bb.sdk.threads.defaultExecutionOptions({
        threadId: thread.id,
      });
      if (!options?.model) return null;
      const key = `${thread.providerId}:${options.model}:${options.reasoningLevel}`;
      const cached = labels.get(key);
      if (cached) return cached;
      const catalog = await bb.sdk.providers
        .models({
          providerId: thread.providerId,
          projectId: thread.projectId,
          preferCached: true,
        })
        .catch(() => null);
      const model = catalog?.models.find(
        (entry) => entry.model === options.model || entry.id === options.model,
      );
      const effort = model?.supportedReasoningEfforts.find(
        (entry) => entry.reasoningEffort === options.reasoningLevel,
      );
      const label = [
        model?.displayName || modelName(options.model),
        options.reasoningLevel &&
          (effort?.label?.toLowerCase() ||
            EFFORTS[options.reasoningLevel] ||
            options.reasoningLevel),
      ]
        .filter(Boolean)
        .join(" · ");
      labels.set(key, label);
      return label;
    } catch (error) {
      bb.log.warn(
        `Could not read the model of ${thread.id}: ${errorMessage(error)}`,
      );
      return null;
    }
  };

  let pool: { status: PoolStatus | null; readAt: number } | null = null;
  /** The Account Pooler's status, at most a minute old; null without it. */
  const poolStatus = async () => {
    if (pool && Date.now() - pool.readAt < USAGE_TTL_MS) return pool.status;
    const status = await bb.sdk.plugins
      .callRpc({
        pluginId: "account-pool",
        method: "status.get",
        input: null,
        outputSchema: poolStatusSchema,
      })
      .catch(() => null);
    pool = { status, readAt: Date.now() };
    return status;
  };

  /** The model line, then the serving account's usage when the pool has it. */
  const modelFooter = async (thread: ThreadResponse) => {
    const [model, status] = await Promise.all([
      modelLabel(thread),
      poolStatus(),
    ]);
    const usage = status ? describeUsage(status, thread.providerId) : null;
    return [model, usage].filter(Boolean).join(" · ") || null;
  };

  // ---------------------------------------------------------------------
  // Live status of workers
  // ---------------------------------------------------------------------

  const statusTimers = new Map<string, ReturnType<typeof setTimeout>>();
  bb.onDispose(() => {
    for (const timer of statusTimers.values()) clearTimeout(timer);
    statusTimers.clear();
  });

  const editStatus = async (key: string, ts: string) => {
    const current = connection;
    const binding = store.get(key);
    if (!current || !binding) return;
    const { text, blocks } = renderStatus(store.tasksOfMessage(key, ts));
    try {
      await current.slack.webClient.chat.update({
        channel: binding.channelId,
        ts,
        text,
        blocks,
      });
    } catch (error) {
      bb.log.warn(
        `Could not update the status in ${key}: ${describeSlackError(error) ?? errorMessage(error)}`,
      );
    }
  };

  /**
   * Edits the Slack message that shows a task, at most once per
   * STATUS_EDIT_MS. A task not in Slack yet shows up when its coordinator's
   * turn ends.
   */
  const refreshStatus = (task: Pick<Task, "slackKey" | "messageTs">) => {
    const ts = task.messageTs;
    if (!ts) return;
    const id = `${task.slackKey}/${ts}`;
    if (statusTimers.has(id)) return;
    statusTimers.set(
      id,
      setTimeout(() => {
        statusTimers.delete(id);
        void editStatus(task.slackKey, ts);
      }, STATUS_EDIT_MS),
    );
  };

  /** Posts the status of a coordinator turn's new tasks under its reply. */
  const postStatus = async (
    current: SlackConnection,
    binding: Binding,
    tasks: Task[],
  ) => {
    const message = renderStatus(tasks);
    try {
      const result = await current.slack.webClient.chat.postMessage({
        channel: binding.channelId,
        thread_ts: binding.threadTs,
        text: message.text,
        blocks: message.blocks,
        unfurl_links: false,
        unfurl_media: false,
      });
      if (!result.ts) return;
      store.attachTasks(
        result.ts,
        tasks.map((task) => task.id),
      );
      // Progress or a finish that came while the post was on its way.
      const now = renderStatus(store.tasksOfMessage(binding.slackKey, result.ts));
      if (JSON.stringify(now) !== JSON.stringify(message)) {
        refreshStatus({ slackKey: binding.slackKey, messageTs: result.ts });
      }
    } catch (error) {
      bb.log.warn(
        `Could not post the status in ${binding.slackKey}: ${describeSlackError(error) ?? errorMessage(error)}`,
      );
    }
  };

  /**
   * Finishes a worker's tasks when its turn ends. With a follow-up queued,
   * only the oldest finishes: the follow-up is a task that has not run yet.
   */
  const finishTasks = (
    workerId: string,
    state: "done" | "failed",
    followUpQueued = false,
  ) => {
    const active = store.activeTasks(workerId);
    for (const task of followUpQueued ? active.slice(0, 1) : active) {
      store.setTaskState(task.id, state);
      refreshStatus(task);
    }
  };

  /**
   * Finishes tasks whose worker can no longer report: deleted, archived,
   * handed to another parent, or idle while the plugin was not listening.
   */
  const reconcileTasks = async (tasks: Task[]) => {
    for (const task of tasks) {
      const worker = await bb.sdk.threads
        .get({ threadId: task.workerThreadId })
        .catch((error: unknown) =>
          [404, 410].includes(Number(httpStatus(error))) ? null : undefined,
        );
      if (worker === undefined) continue;
      const coordinator = store.get(task.slackKey)?.bbThreadId;
      if (
        !worker ||
        worker.deletedAt !== null ||
        worker.archivedAt !== null ||
        worker.parentThreadId !== coordinator
      ) {
        finishTasks(task.workerThreadId, "failed");
      } else if (worker.status === "error") {
        finishTasks(task.workerThreadId, "failed");
      } else if (
        worker.status === "idle" &&
        worker.queuedMessageCount === 0 &&
        Date.now() - task.startedAt > SETTLED_MS
      ) {
        finishTasks(task.workerThreadId, "done");
      }
    }
  };

  /**
   * Swaps 👀 for `reaction` on the messages a bb thread answered, except in
   * Slack threads whose workers still work.
   */
  const settlePending = async (
    current: SlackConnection,
    bbThreadId: string,
    reaction: string,
  ) => {
    const bindings = store.forBbThread(bbThreadId);
    for (const message of store.pending(bbThreadId)) {
      if (store.activeTaskCount(message.slackKey) > 0) continue;
      store.removePending(message.slackKey, message.messageTs);
      const binding = bindings.find((b) => b.slackKey === message.slackKey);
      if (binding) {
        await react(
          current,
          binding.channelId,
          message.messageTs,
          reaction,
          EYES,
        );
      }
    }
  };

  /**
   * Posts to the Slack threads a bb thread answers: those with messages
   * waiting for a reply, else the one that started it. A thread bound by
   * `post` stays quiet until someone writes in it. Tasks a coordinator handed
   * to workers this turn get a live status message under the reply. With
   * `reaction`, the waiting messages swap 👀 for it and stop waiting, unless
   * workers still work on their Slack thread.
   */
  const deliver = async (
    bbThreadId: string,
    text: string | null,
    reaction: string | null,
    /** The thread whose final reply this is: adds charts and the model. */
    agentReply: ThreadResponse | null = null,
  ) => {
    const bindings = store.forBbThread(bbThreadId);
    if (bindings.length === 0) return;
    const pending = store.pending(bbThreadId);
    const waiting = new Set(pending.map((message) => message.slackKey));
    const targets = bindings.filter((binding) =>
      waiting.size > 0
        ? waiting.has(binding.slackKey)
        : binding.origin === "slack",
    );
    if (targets.length === 0) return;
    const current = connection;
    if (!current) {
      bb.log.warn(`Slack is not connected; dropped a reply for ${bbThreadId}`);
      return;
    }
    const reply =
      agentReply && text
        ? extractBlocks(text)
        : { text: text ?? "", blocks: [], errors: [] };
    if (reply.errors.length > 0) {
      bb.log.warn(
        `Could not parse slack-blocks from ${bbThreadId}: ${reply.errors.join("; ")}`,
      );
    }
    const footer = agentReply && text ? await modelFooter(agentReply) : null;
    for (const binding of targets) {
      if (text) {
        await postMarkdown(
          current,
          binding.channelId,
          binding.threadTs,
          reply.text,
          {
            footer,
            blocks: reply.blocks,
            onFixes: (fixes) =>
              bb.log.info(
                `Fixed the blocks of a reply from ${bbThreadId}: ${fixes.join("; ")}`,
              ),
            onBlocksError: (detail) =>
              bb.log.warn(
                `Slack rejected the blocks of a reply from ${bbThreadId}: ${detail}`,
              ),
          },
        );
      }
      if (agentReply) {
        const tasks = store.unpostedTasks(binding.slackKey);
        if (tasks.length > 0) await postStatus(current, binding, tasks);
        await reconcileTasks(store.activeTasksOf(binding.slackKey));
      }
      store.touch(binding.slackKey);
    }
    if (reaction) await settlePending(current, bbThreadId, reaction);
  };

  bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
    finishTasks(thread.id, "done", thread.queuedMessageCount > 0);
    await deliver(thread.id, lastAssistantText?.trim() || null, DONE, thread);
  });

  bb.events.on("thread.failed", async ({ thread, error }) => {
    finishTasks(thread.id, "failed", thread.queuedMessageCount > 0);
    await deliver(
      thread.id,
      `⚠️ The bb thread stopped with an error${error ? `: ${clip(error, 500)}` : "."}`,
      FAILED,
    );
  });

  bb.events.on("interaction.pending", async ({ thread, interaction }) => {
    // A worker's question goes to its coordinator's Slack thread, and the
    // next Slack reply there answers it.
    const [task] = store.activeTasks(thread.id);
    if (task) {
      store.setTaskState(task.id, "waiting");
      refreshStatus(task);
    }
    const coordinator = task ? store.get(task.slackKey)?.bbThreadId : null;
    await deliver(
      coordinator ?? thread.id,
      describeInteraction(interaction),
      null,
    );
  });

  bb.events.on("thread.deleted", async ({ thread }) => {
    const [task] = store.activeTasks(thread.id);
    finishTasks(thread.id, "failed");
    const coordinator = task ? store.get(task.slackKey)?.bbThreadId : null;
    if (coordinator && connection) {
      await settlePending(connection, coordinator, FAILED);
    }
    const removed = store.removeBbThread(thread.id);
    const state = connection?.bot.getState();
    for (const binding of removed) {
      await state?.unsubscribe(
        chatThreadId(binding.channelId, binding.threadTs),
      );
    }
  });

  // Tasks whose worker finished while the plugin was not running.
  const startupCheck = setTimeout(() => {
    void reconcileTasks(store.allActiveTasks()).catch((error: unknown) =>
      bb.log.warn(`Could not check workers: ${errorMessage(error)}`),
    );
  }, SETTLED_MS);
  bb.onDispose(() => clearTimeout(startupCheck));

  // ---------------------------------------------------------------------
  // Coordinators and workers
  // ---------------------------------------------------------------------

  const toolError = (text: string) => ({
    content: [{ type: "text" as const, text }],
    isError: true,
  });

  bb.agents.configure((context) => {
    const parsed = threadRoleSchema.safeParse(context.pluginMetadata);
    if (!parsed.success) return { tools: [], skills: [SKILL] };
    const thread = parsed.data;
    const channels = channelsOrEmpty(latest.channels);
    if (thread.role === "worker") {
      return {
        tools: ["slack_progress"],
        skills: [SKILL],
        instructions: workerInstructions(latest, channels[thread.channelId]),
      };
    }
    const { channelId, channelName } = thread.slack;
    const directMessage = channelId.startsWith("D");
    return {
      tools: ["slack_delegate", "slack_channel_settings"],
      skills: [SKILL],
      instructions: coordinatorInstructions(latest, channels[channelId], {
        channelLabel: directMessage
          ? "a direct message"
          : typeof channelName === "string"
            ? channelName
            : channelId,
        directMessage,
      }),
    };
  });

  bb.agents.registerTool({
    name: "slack_delegate",
    description:
      "Hand a task to a worker bb thread, or send a follow-up or an answer to a worker you started. The worker's live status appears in the Slack thread under your reply, and its result comes back to you as a message when its turn ends.",
    parameters: z
      .object({
        task: z
          .string()
          .min(1)
          .describe(
            "Everything the worker needs: the request, the context from the conversation, and the result expected. Not a step-by-step plan.",
          ),
        title: z
          .string()
          .min(1)
          .describe(
            "A few words for the status line in Slack, in the people's language",
          ),
        workerThreadId: z
          .string()
          .optional()
          .describe("A worker you started earlier, to continue it"),
        projectId: z
          .string()
          .optional()
          .describe(
            "bb project of a new worker, only when the task belongs to another project (`bb project list`)",
          ),
        model: z
          .string()
          .optional()
          .describe("Model of a new worker, only when people ask for one"),
      })
      .strict(),
    presentation: {
      label: { pending: "Handing off to a worker", completed: "Handed off" },
    },
    async execute(params, { threadId }) {
      const [binding] = store.forBbThread(threadId);
      if (!binding) return toolError("This thread answers no Slack thread.");
      const title = clip(params.title.trim(), TITLE_CHARS);
      const input = [{ type: "text" as const, text: params.task, mentions: [] }];

      if (params.workerThreadId) {
        const workerId = params.workerThreadId;
        const worker = await bb.sdk.threads
          .get({ threadId: workerId })
          .catch(() => null);
        if (!worker || worker.parentThreadId !== threadId) {
          return toolError(
            `${workerId} is not a worker of this thread. Leave workerThreadId out to start a new one.`,
          );
        }
        // Recorded first, so the worker's next idle finds it.
        const taskId = store.addTask({
          workerThreadId: workerId,
          slackKey: binding.slackKey,
          title,
        });
        const send = () =>
          bb.sdk.threads.send({ threadId: workerId, mode: "auto", input });
        try {
          await send();
        } catch (error) {
          const sent = await reviveAndSend(workerId, error, send).catch(
            () => false,
          );
          if (!sent) {
            store.removeTask(taskId);
            return toolError(
              `Could not reach worker ${workerId}. Leave workerThreadId out to start a new one.`,
            );
          }
        }
        return `Sent to worker ${workerId}. Its status appears in Slack under your reply, and its result comes back here. End your turn now with one short line.`;
      }

      const values = await settings.get();
      const channel = channelsOrEmpty(values.channels)[binding.channelId];
      const projectId =
        params.projectId || channel?.projectId || values.projectId;
      if (!projectId) return toolError("Slack Threads has no project set.");
      const worker = await bb.sdk.threads.spawn({
        projectId,
        environment: { type: "project-default" },
        ...executionFor(
          values,
          params.model || values.model,
          values.reasoningLevel,
        ),
        parentThreadId: threadId,
        title,
        input,
        pluginMetadata: { role: "worker", channelId: binding.channelId },
      });
      store.addTask({
        workerThreadId: worker.id,
        slackKey: binding.slackKey,
        title,
      });
      bb.log.info(`Coordinator ${threadId} started worker ${worker.id}`);
      return `Started worker ${worker.id}. Its live status appears in Slack under your reply, and its result comes back here when it finishes. End your turn now with one short line saying what you started.`;
    },
  });

  bb.agents.registerTool({
    name: "slack_progress",
    description:
      "Show your plan and progress to the people in Slack as a live status. Pass the whole checklist every time: 2–5 short steps, one per line, each starting with ✅ (done), ⏳ (in progress), or ▫️ (next).",
    parameters: z.object({ status: z.string().min(1) }).strict(),
    presentation: {
      label: { pending: "Updating the status", completed: "Status updated" },
    },
    execute({ status }, { threadId }) {
      const [task] = store.activeTasks(threadId);
      if (!task) return "No Slack task is running in this thread; nothing shown.";
      store.setTaskProgress(task.id, clip(status.trim(), PROGRESS_CHARS));
      refreshStatus(task);
      return "Shown in Slack.";
    },
  });

  bb.agents.registerTool({
    name: "slack_channel_settings",
    description:
      "Read or change how coordinators work in this Slack channel: a prompt added to the global one or used instead of it, and guardrails added to the global ones. Changes apply to new Slack threads. Only admins can change them.",
    parameters: z
      .object({
        action: z.enum(["get", "set"]),
        prompt: z
          .string()
          .nullable()
          .optional()
          .describe("The channel's prompt; null removes it"),
        promptMode: z
          .enum(["append", "replace"])
          .optional()
          .describe(
            "append (the default) adds the prompt to the global one; replace uses it alone",
          ),
        guardrails: z
          .string()
          .nullable()
          .optional()
          .describe(
            "The channel's extra guardrails; null removes them. The global guardrails always apply",
          ),
      })
      .strict(),
    async execute(params, { threadId }) {
      const [binding] = store.forBbThread(threadId);
      if (!binding) return toolError("This thread answers no Slack thread.");
      const values = await settings.get();
      let channels;
      try {
        channels = parseChannels(values.channels);
      } catch (error) {
        return toolError(
          `The channels setting is invalid (${errorMessage(error)}); fix it in Settings → Plugins → Slack Threads.`,
        );
      }
      const channel = channels[binding.channelId] ?? {};
      if (params.action === "get") {
        return JSON.stringify(
          {
            channelId: binding.channelId,
            channel,
            globalPrompt: values.prompt,
            globalGuardrails: values.guardrails,
          },
          null,
          2,
        );
      }
      // Every message this thread still answers must come from an admin, so
      // a request from someone else cannot ride on an admin's later message.
      const admins = list(values.adminUserIds);
      const authors = store.pendingAuthors(threadId);
      if (
        authors.length === 0 ||
        !authors.every((author) => author && admins.includes(author))
      ) {
        return toolError(
          admins.length > 0
            ? `Only admins can change channel settings, and only when they asked for it: ${admins.map((id) => `<@${id}>`).join(", ")}.`
            : "No one can change channel settings from Slack yet: add admins in Settings → Plugins → Slack Threads.",
        );
      }
      const next = {
        ...channel,
        ...(binding.channelName ? { name: binding.channelName } : {}),
        ...(params.promptMode ? { promptMode: params.promptMode } : {}),
      };
      for (const key of ["prompt", "guardrails"] as const) {
        const value = params[key];
        if (value === null) delete next[key];
        else if (value !== undefined) next[key] = value;
      }
      await settings.experimental_set({
        channels: JSON.stringify(
          { ...channels, [binding.channelId]: next },
          null,
          2,
        ),
      });
      bb.log.info(
        `${authors.join(", ")} changed the settings of ${binding.channelId}`,
      );
      return `Saved; new Slack threads in this channel use it:\n${JSON.stringify(next, null, 2)}`;
    },
  });

  // ---------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------

  let wake: (() => void) | null = null;
  settings.onChange((next, prev) => {
    latest = next;
    if (next.botToken !== prev.botToken || next.appToken !== prev.appToken) {
      wake?.();
    }
  });
  const untilChangeOrAbort = (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const done = () => {
        signal.removeEventListener("abort", done);
        wake = null;
        resolve();
      };
      wake = done;
      if (signal.aborted) done();
      else signal.addEventListener("abort", done, { once: true });
    });

  bb.background.service("socket", {
    async start(signal) {
      while (!signal.aborted) {
        const missing = await missingSettings();
        if (missing.length > 0) throw needsConfiguration(setupMessage(missing));
        const { botToken, appToken } = await settings.get();
        const changed = untilChangeOrAbort(signal);
        let current: SlackConnection | null = null;
        try {
          current = await connectSlack({
            botToken: String(botToken),
            appToken: String(appToken),
            logger: makeLogger("chat"),
            subscriptions: (teamId) =>
              [...store.all(), ...store.allWatched()]
                .filter((entry) => entry.teamId === teamId)
                .map((entry) => chatThreadId(entry.channelId, entry.threadTs)),
            onInbound,
          });
          connection = current;
          connectedAt = Date.now();
          lastError = null;
          bb.log.info(
            `Connected to Slack workspace ${current.identity.teamName} as @${current.identity.botName}`,
          );
          await changed;
        } catch (error) {
          lastError = errorMessage(error);
          wake = null;
          if (isAuthError(error)) {
            throw needsConfiguration(
              `Slack rejected the bot or app token (${lastError}). ${setupMessage(["botToken", "appToken"])}`,
            );
          }
          throw error;
        } finally {
          connection = null;
          connectedAt = null;
          await current?.bot.shutdown().catch((error: unknown) => {
            bb.log.warn(`Slack shutdown failed: ${errorMessage(error)}`);
          });
        }
      }
    },
  });

  // ---------------------------------------------------------------------
  // CLI
  // ---------------------------------------------------------------------

  /** Reads a file on the machine that ran the command, not the server's. */
  const readInvokerFile = async (path: string, ctx: PluginCliContext) => {
    const absolute = path.startsWith("/")
      ? path
      : ctx.cwd
        ? `${ctx.cwd.replace(/\/$/u, "")}/${path}`
        : null;
    if (!absolute) {
      throw new PluginCliError(`Pass an absolute path for ${path}.`, {
        code: "invalid_value",
      });
    }
    try {
      const thread = ctx.threadId
        ? await bb.sdk.threads.get({ threadId: ctx.threadId })
        : null;
      const environment = thread?.environmentId
        ? await bb.sdk.environments.get({ environmentId: thread.environmentId })
        : null;
      const file = await bb.sdk.files.read({
        path: absolute,
        ...(environment?.hostId ? { hostId: environment.hostId } : {}),
      });
      return file.contentEncoding === "base64"
        ? Buffer.from(file.content, "base64").toString("utf8")
        : file.content;
    } catch (error) {
      throw new PluginCliError(
        `Could not read ${absolute}: ${errorMessage(error)}`,
        {
          code: "file_not_found",
        },
      );
    }
  };

  const requireConnection = () => {
    if (!connection) {
      throw new PluginCliError("Slack is not connected.", {
        code: "not_connected",
        hint: "Run `bb slack-threads status` and `bb plugin logs slack-threads`.",
      });
    }
    return connection;
  };

  const describeBinding = (binding: Binding) =>
    [
      new Date(binding.updatedAt).toISOString(),
      binding.origin.padEnd(5),
      binding.channelName ?? binding.channelId,
      binding.threadTs || "(DM)",
      "→",
      binding.bbThreadId,
      binding.permalink ?? "",
    ].join("  ");

  bb.cli.register(
    defineCli({
      name: "slack-threads",
      summary:
        "Post to Slack and see which Slack threads continue which bb threads",
      commands: {
        post: cliCommand({
          summary:
            "Post a new Slack message; the first reply under it starts a new bb thread",
          options: {
            channel: {
              type: "string",
              required: true,
              description: "Channel ID (C…) or #name; the bot must be a member",
            },
            text: {
              type: "string",
              stdin: true,
              description:
                "Markdown message; --text-stdin reads one line from stdin, so pass multi-line text as the argument",
            },
            "blocks-file": {
              type: "string",
              description:
                "JSON file with an array of Block Kit blocks (charts, tables) to post under the text",
            },
            thread: {
              type: "string",
              description:
                "bb thread the post comes from (defaults to the calling thread)",
            },
            bind: {
              type: "boolean",
              description:
                "Bind the Slack thread to that bb thread instead, so replies continue it",
            },
            json: { type: "boolean", description: "Print JSON" },
          },
          constraints: [
            { kind: "at-least-one", options: ["text", "blocks-file"] },
          ],
          async run(input, ctx) {
            const current = requireConnection();
            const bbThreadId = input.options.thread ?? ctx.threadId ?? null;
            if (input.options.bind && !bbThreadId) {
              throw new PluginCliError("No bb thread to bind.", {
                code: "missing_thread",
                hint: "Pass --thread <bbThreadId>.",
              });
            }
            if (bbThreadId) {
              await bb.sdk.threads.get({ threadId: bbThreadId }).catch(() => {
                throw new PluginCliError(
                  `bb thread ${bbThreadId} was not found.`,
                  { code: "thread_not_found" },
                );
              });
            }
            const channelId = await resolveChannel(
              current,
              input.options.channel,
            );
            if (!channelId) {
              throw new PluginCliError(
                `Slack channel ${input.options.channel} was not found.`,
                {
                  code: "channel_not_found",
                  hint: "Use the channel ID (C…) and invite the bot to the channel.",
                },
              );
            }
            const message = extractBlocks(input.options.text ?? "");
            const problems = [...message.errors];
            const file = input.options["blocks-file"];
            if (file) {
              const json = await readInvokerFile(file, ctx);
              try {
                message.blocks.push(...parseBlocks(json));
              } catch (error) {
                problems.push(`${file}: ${errorMessage(error)}`);
                if (message.errors.length === 0) {
                  message.text = `${message.text}\n\n${CHART_FAILED}`.trim();
                }
              }
            }
            const threadTs = await postMarkdown(
              current,
              channelId,
              "",
              message.text,
              {
                blocks: message.blocks,
                onFixes: (fixes) =>
                  bb.log.info(
                    `Fixed the blocks of a post: ${fixes.join("; ")}`,
                  ),
                onBlocksError: (detail) => {
                  problems.push(`Slack rejected the blocks: ${detail}`);
                  bb.log.warn(`Slack rejected the blocks of a post: ${detail}`);
                },
              },
            );
            if (!threadTs) {
              throw new PluginCliError("The text is empty.", {
                code: "empty_text",
              });
            }
            const link = await permalink(current, channelId, threadTs);
            const teamId = current.identity.teamId;
            const key = slackKey(teamId, channelId, threadTs);
            if (input.options.bind && bbThreadId) {
              store.save({
                slackKey: key,
                bbThreadId,
                teamId,
                channelId,
                threadTs,
                channelName: input.options.channel.startsWith("#")
                  ? input.options.channel
                  : null,
                permalink: link,
                origin: "cli",
              });
            } else {
              store.watch({
                slackKey: key,
                teamId,
                channelId,
                threadTs,
                sourceBbThreadId: bbThreadId,
              });
            }
            await current.bot
              .getState()
              .subscribe(chatThreadId(channelId, threadTs));
            const bound = Boolean(input.options.bind);
            const result = {
              channelId,
              threadTs,
              permalink: link,
              bbThreadId,
              bound,
              problems,
            };
            return {
              exitCode: 0,
              stdout: input.options.json
                ? `${JSON.stringify(result)}\n`
                : `Posted ${link ?? `${channelId}/${threadTs}`}\n${
                    bound
                      ? `Replies there that mention the bot continue bb thread ${bbThreadId}.`
                      : "The first reply there that mentions the bot starts a new bb thread."
                  }\n${problems.map((problem) => `Warning: blocks not rendered: ${problem}\n`).join("")}`,
            };
          },
        }),
        status: cliCommand({
          summary:
            "Show the Slack connection, workspace, bot user and binding count",
          options: { json: { type: "boolean", description: "Print JSON" } },
          async run(input) {
            const missing = await missingSettings();
            const identity = connection?.identity ?? null;
            const status = {
              connected: connection !== null,
              connectedAt: connectedAt
                ? new Date(connectedAt).toISOString()
                : null,
              workspace: identity
                ? {
                    id: identity.teamId,
                    name: identity.teamName,
                    url: identity.teamUrl,
                  }
                : null,
              bot: identity
                ? { id: identity.botUserId, name: identity.botName }
                : null,
              bindings: store.count(),
              watched: store.watchedCount(),
              missingSettings: missing,
              lastError,
            };
            if (input.options.json) {
              return { exitCode: 0, stdout: `${JSON.stringify(status)}\n` };
            }
            const lines = [
              `Connected: ${status.connected ? `yes, since ${status.connectedAt}` : "no"}`,
              `Workspace: ${identity ? `${identity.teamName} (${identity.teamId}) ${identity.teamUrl}` : "-"}`,
              `Bot user: ${identity ? `@${identity.botName} (${identity.botUserId})` : "-"}`,
              `Bound Slack threads: ${status.bindings}`,
              `Posts waiting for a first reply: ${status.watched}`,
              ...(missing.length > 0
                ? [`Missing settings: ${missing.join(", ")}`]
                : []),
              ...(lastError ? [`Last error: ${lastError}`] : []),
            ];
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          },
        }),
        list: cliCommand({
          summary: "List recently active Slack threads and their bb threads",
          options: {
            limit: {
              type: "integer",
              min: 1,
              max: 200,
              default: 20,
              description: "How many to list (1–200)",
            },
            json: { type: "boolean", description: "Print JSON" },
          },
          async run(input) {
            const bindings = store.recent(input.options.limit);
            if (input.options.json) {
              return { exitCode: 0, stdout: `${JSON.stringify(bindings)}\n` };
            }
            return {
              exitCode: 0,
              stdout:
                bindings.length === 0
                  ? "No Slack threads are bound yet.\n"
                  : `${bindings.map(describeBinding).join("\n")}\n`,
            };
          },
        }),
        configure: cliCommand({
          summary: "Save the Slack tokens from stdin, or the project",
          options: {
            "bot-token": {
              type: "string",
              stdin: true,
              description:
                "Bot User OAuth Token (xoxb-…); prefer --bot-token-stdin",
            },
            "app-token": {
              type: "string",
              stdin: true,
              description: "App-level token (xapp-…); prefer --app-token-stdin",
            },
            project: { type: "string", description: "bb project ID (proj_…)" },
          },
          constraints: [
            {
              kind: "at-least-one",
              options: ["bot-token", "app-token", "project"],
            },
          ],
          async run(input) {
            const botToken = input.options["bot-token"]?.trim();
            const appToken = input.options["app-token"]?.trim();
            if (botToken && !botToken.startsWith("xoxb-")) {
              throw new PluginCliError("The bot token must start with xoxb-.", {
                code: "invalid_value",
              });
            }
            if (appToken && !appToken.startsWith("xapp-")) {
              throw new PluginCliError("The app token must start with xapp-.", {
                code: "invalid_value",
              });
            }
            await settings.experimental_set({
              ...(botToken ? { botToken } : {}),
              ...(appToken ? { appToken } : {}),
              ...(input.options.project
                ? { projectId: input.options.project }
                : {}),
            });
            const saved = [
              botToken && "botToken",
              appToken && "appToken",
              input.options.project && "projectId",
            ].filter(Boolean);
            return { exitCode: 0, stdout: `Saved ${saved.join(", ")}.\n` };
          },
        }),
      },
    }),
  );
}
