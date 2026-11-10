import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliContext,
  type PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import type { Logger, Message, Thread } from "chat";
import { answerFromText, describeInteraction } from "./interactions";
import {
  channelName,
  chatThreadId,
  connectSlack,
  describeMessage,
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
import { openStore, slackKey, type Binding } from "./store";

type ThreadResponse = PluginThreadEventPayloads["thread.idle"]["thread"];

const EYES = "eyes";
const DONE = "check";
const FAILED = "x";

const INSTRUCTIONS =
  "You are answering inside this Slack thread; your final reply of each turn is posted back to the thread automatically, so do not post it yourself. Keep replies short and use Slack-friendly Markdown (no Markdown tables or HTML); for a chart or table, add a `slack-blocks` fence as the slack-threads skill describes. Use the shared bb memory: recall what is relevant before answering and save durable knowledge you learn.";

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
      description: "The bb project new threads from Slack start in",
    },
    provider: {
      type: "string",
      label: "Provider",
      description:
        "Provider ID for new threads; empty uses the project default",
      default: "",
    },
    model: {
      type: "string",
      label: "Model",
      description: "Model for new threads; empty uses the project default",
      default: "",
    },
    reasoningLevel: {
      type: "string",
      label: "Reasoning level",
      description: "Reasoning level for new threads; empty uses the default",
      default: "",
    },
    permissionMode: {
      type: "string",
      label: "Permission mode",
      description:
        "Permission mode for new threads: full, auto, or accept-edits; empty uses the default",
      default: "full",
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
      store.addPending(binding.bbThreadId, binding.slackKey, message.id);
    }
    store.touch(binding.slackKey);
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
      INSTRUCTIONS,
    ].join("\n\n");

    const botName = current.identity.botName.replace(
      /[.*+?^${}()|[\]\\]/gu,
      "\\$&",
    );
    const words = last.text
      .replace(/<@[A-Z0-9]+>/gu, "")
      .replace(new RegExp(`@${botName}\\b`, "giu"), "")
      .replace(/\s+/gu, " ")
      .trim();
    const title = `${thread.isDM ? `@${author}` : (name ?? channelId)} · ${clip(words || "Slack thread", 60)}`;

    const permissionMode = (["full", "auto", "accept-edits"] as const).find(
      (mode) => mode === values.permissionMode.trim(),
    );
    const spawned = await bb.sdk.threads.spawn({
      projectId: values.projectId,
      environment: { type: "project-default" },
      ...(values.provider ? { providerId: values.provider } : {}),
      ...(values.model ? { model: values.model } : {}),
      ...(values.reasoningLevel
        ? { reasoningLevel: values.reasoningLevel }
        : {}),
      ...(permissionMode ? { permissionMode } : {}),
      executionInputSources: {
        ...(values.provider ? { providerId: "explicit" as const } : {}),
        ...(values.model ? { model: "explicit" as const } : {}),
        ...(values.reasoningLevel
          ? { reasoningLevel: "explicit" as const }
          : {}),
        ...(permissionMode ? { permissionMode: "explicit" as const } : {}),
      },
      title,
      prompt,
      pluginMetadata: {
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.save(binding);
    await thread.subscribe();
    markPending(binding, messages);
    bb.log.info(`Started bb thread ${spawned.id} for ${binding.slackKey}`);
  };

  const continueThread = async (
    current: SlackConnection,
    thread: Thread,
    binding: Binding,
    messages: Message[],
  ) => {
    // An archived or deleted thread is handled where the send fails.
    const interactions = await bb.sdk.threads.interactions
      .list({ threadId: binding.bbThreadId })
      .catch(() => []);
    const waiting = interactions
      .filter((interaction) => interaction.status === "pending")
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (waiting) {
      const answer = answerFromText(
        waiting,
        messages.map((message) => message.text).join("\n"),
      );
      if (answer && "hint" in answer) {
        await postMarkdown(
          current,
          binding.channelId,
          binding.threadTs,
          answer.hint,
        );
        await unmark(current, binding.channelId, messages);
        return;
      }
      if (answer) {
        await bb.sdk.threads.interactions.resolve({
          threadId: binding.bbThreadId,
          interactionId: waiting.id,
          resolution: answer.resolution,
        });
        markPending(binding, messages);
        return;
      }
    }

    const text = messages
      .map((message) => `Slack reply from ${describeMessage(message)}`)
      .join("\n\n");
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
          messages,
          `This Slack thread used to continue bb thread ${binding.bbThreadId}, which is no longer available; you take it over.`,
        );
        return;
      }
    }
    markPending(binding, messages);
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
      if (
        !binding &&
        !watched &&
        kind === "subscribed" &&
        !messages.some((m) => m.isMention)
      ) {
        await thread.unsubscribe();
        continue;
      }
      try {
        for (const message of messages) {
          await react(current, channelId, message.id, EYES);
        }
        if (binding) {
          await continueThread(current, target, binding, messages);
        } else {
          const source = watched?.sourceBbThreadId;
          await startThread(
            current,
            target,
            messages,
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
        for (const message of messages) {
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
  const modelFooter = async (thread: ThreadResponse) => {
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

  /**
   * Posts to the Slack threads a bb thread answers: those with messages
   * waiting for a reply, else the one that started it. A thread bound by
   * `post` stays quiet until someone writes in it. With `reaction`, the
   * waiting messages swap 👀 for it and stop waiting.
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
      store.touch(binding.slackKey);
    }
    if (!reaction) return;
    for (const message of pending) {
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

  bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
    await deliver(thread.id, lastAssistantText?.trim() || null, DONE, thread);
  });

  bb.events.on("thread.failed", async ({ thread, error }) => {
    await deliver(
      thread.id,
      `⚠️ The bb thread stopped with an error${error ? `: ${clip(error, 500)}` : "."}`,
      FAILED,
    );
  });

  bb.events.on("interaction.pending", async ({ thread, interaction }) => {
    await deliver(thread.id, describeInteraction(interaction), null);
  });

  bb.events.on("thread.deleted", async ({ thread }) => {
    const removed = store.removeBbThread(thread.id);
    const state = connection?.bot.getState();
    for (const binding of removed) {
      await state?.unsubscribe(
        chatThreadId(binding.channelId, binding.threadTs),
      );
    }
  });

  // ---------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------

  let wake: (() => void) | null = null;
  settings.onChange((next, prev) => {
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
                      ? `Replies there continue bb thread ${bbThreadId}.`
                      : "The first reply there starts a new bb thread."
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
