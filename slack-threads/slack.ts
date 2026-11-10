import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat, type Logger, type Message, type Thread } from "chat";

/** Slack's `markdown_text` holds 12,000 characters; leave room. */
const CHUNK_CHARS = 11_000;
const HISTORY_MESSAGES = 50;
const HISTORY_MESSAGE_CHARS = 2_000;

export interface SlackIdentity {
  teamId: string;
  teamName: string;
  teamUrl: string;
  botUserId: string;
  botName: string;
}

export interface SlackConnection {
  bot: Chat<{ slack: SlackAdapter }>;
  slack: SlackAdapter;
  identity: SlackIdentity;
}

export type InboundHandler = (
  connection: SlackConnection,
  thread: Thread,
  messages: Message[],
  kind: "mention" | "subscribed" | "direct",
) => Promise<void>;

const AUTH_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "not_allowed_token_type",
]);

/** True for a Slack API error that only a new token can fix. */
export function isAuthError(error: unknown): boolean {
  const code = (error as { data?: { error?: unknown } } | null)?.data?.error;
  return typeof code === "string" && AUTH_ERRORS.has(code);
}

/**
 * Opens the Socket Mode connection and routes messages to `onInbound`.
 * `subscriptions` lists the Chat thread IDs to follow without a mention.
 */
export async function connectSlack(options: {
  botToken: string;
  appToken: string;
  logger: Logger;
  subscriptions: (teamId: string) => string[];
  onInbound: InboundHandler;
}): Promise<SlackConnection> {
  const slack = createSlackAdapter({
    mode: "socket",
    botToken: options.botToken,
    appToken: options.appToken,
    logger: options.logger.child("slack"),
  });
  // Fails fast on a bad bot token before the socket opens.
  const auth = await slack.webClient.auth.test();
  const identity: SlackIdentity = {
    teamId: auth.team_id ?? "",
    teamName: auth.team ?? "",
    teamUrl: auth.url ?? "",
    botUserId: auth.user_id ?? "",
    botName: auth.user ?? "bb",
  };

  // Memory state, rebuilt from the plugin's own bindings on every connect.
  const state = createMemoryState();
  await state.connect();
  for (const threadId of options.subscriptions(identity.teamId)) {
    await state.subscribe(threadId);
  }
  const bot = new Chat({
    userName: identity.botName,
    adapters: { slack },
    state,
    concurrency: "queue",
    logger: options.logger,
  });
  const connection: SlackConnection = { bot, slack, identity };
  const batch = (message: Message, context?: { skipped: Message[] }) => [
    ...(context?.skipped ?? []),
    message,
  ];
  bot.onNewMention((thread, message, context) =>
    options.onInbound(connection, thread, batch(message, context), "mention"),
  );
  bot.onSubscribedMessage((thread, message, context) =>
    options.onInbound(
      connection,
      thread,
      batch(message, context),
      "subscribed",
    ),
  );
  bot.onDirectMessage((thread, message, _channel, context) =>
    options.onInbound(connection, thread, batch(message, context), "direct"),
  );
  try {
    await bot.initialize();
  } catch (error) {
    await bot.shutdown().catch(() => {});
    throw error;
  }
  return connection;
}

export const chatThreadId = (channelId: string, threadTs: string) =>
  `slack:${channelId}:${threadTs}`;

/** Splits long Markdown at paragraph breaks into Slack-sized posts. */
export function chunkMarkdown(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of text.split(/\n{2,}/u)) {
    let rest = paragraph;
    while (rest.length > CHUNK_CHARS) {
      if (current) chunks.push(current);
      current = "";
      chunks.push(rest.slice(0, CHUNK_CHARS));
      rest = rest.slice(CHUNK_CHARS);
    }
    const next = current ? `${current}\n\n${rest}` : rest;
    if (next.length > CHUNK_CHARS) {
      chunks.push(current);
      current = rest;
    } else {
      current = next;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

/** True when the text has nothing Slack would show. */
const isBlank = (text: string) =>
  !text.replace(/[\s\u200b-\u200d\u2060\ufeff]/gu, "");

type PostArgs = Parameters<SlackAdapter["webClient"]["chat"]["postMessage"]>[0];
type Block = NonNullable<
  Extract<PostArgs, { blocks?: unknown }>["blocks"]
>[number];

export const CHART_FAILED = "_(chart could not be rendered)_";

const BLOCKS_FENCE = /```slack-blocks[^\n]*\n([\s\S]*?)```/gu;

/** Parses a JSON array of Block Kit blocks, or one block; throws if invalid. */
export function parseBlocks(json: string): Block[] {
  const parsed: unknown = JSON.parse(json);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  for (const block of list) {
    if (typeof (block as { type?: unknown } | null)?.type !== "string") {
      throw new Error("every block needs a string `type`");
    }
  }
  return list as Block[];
}

/**
 * Takes the ```slack-blocks fences (a JSON array of Block Kit blocks, or one
 * block) out of Markdown. A fence that is not valid JSON blocks is dropped,
 * noted in the text, and reported in `errors`.
 */
export function extractBlocks(markdown: string): {
  text: string;
  blocks: Block[];
  errors: string[];
} {
  const blocks: Block[] = [];
  const errors: string[] = [];
  const text = markdown
    .replace(BLOCKS_FENCE, (_fence, json: string) => {
      try {
        blocks.push(...parseBlocks(json));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
      return "";
    })
    .trim();
  return {
    text: errors.length > 0 ? `${text}\n\n${CHART_FAILED}`.trim() : text,
    blocks,
    errors,
  };
}

/** Slack's own account of a rejected call, safe to log. */
export function describeSlackError(error: unknown): string | null {
  const data = (error as { data?: Record<string, unknown> } | null)?.data;
  if (typeof data?.error !== "string") return null;
  const metadata = data.response_metadata as { messages?: unknown } | undefined;
  return JSON.stringify({
    error: data.error,
    ...(data.errors ? { errors: data.errors } : {}),
    ...(metadata?.messages ? { messages: metadata.messages } : {}),
  });
}

/**
 * Posts Markdown into a Slack thread through the Web API, one message per
 * chunk. The last message also carries `blocks` (charts, tables) and a muted
 * `footer`; when Slack rejects the blocks, it is posted again without them,
 * with a note, and `onBlocksError` gets Slack's error. An empty `threadTs`
 * posts at the top level and threads the rest under the first message.
 * Returns the first message's ts, or null when nothing was posted.
 */
export async function postMarkdown(
  connection: SlackConnection,
  channelId: string,
  threadTs: string,
  text: string,
  options: {
    footer?: string | null;
    blocks?: Block[];
    onBlocksError?: (detail: string) => void;
  } = {},
): Promise<string | null> {
  const extra = options.blocks ?? [];
  const chunks = chunkMarkdown(text).filter((chunk) => !isBlank(chunk));
  if (chunks.length === 0 && extra.length === 0) return null;
  const footer: Block[] = options.footer
    ? [
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: options.footer }],
        },
      ]
    : [];
  const send = (parent: string | null, chunk: string, blocks: Block[]) =>
    connection.slack.webClient.chat.postMessage({
      channel: channelId,
      ...(parent ? { thread_ts: parent } : {}),
      text: chunk || fallbackText(extra),
      blocks: [
        ...(chunk ? [{ type: "markdown" as const, text: chunk }] : []),
        ...blocks,
      ],
      unfurl_links: false,
      unfurl_media: false,
    });

  let first: string | null = null;
  const count = Math.max(chunks.length, 1);
  for (let index = 0; index < count; index += 1) {
    const chunk = chunks[index] ?? "";
    const last = index === count - 1;
    const parent = threadTs || first;
    let result;
    try {
      result = await send(parent, chunk, last ? [...extra, ...footer] : []);
    } catch (error) {
      const detail = describeSlackError(error);
      if (!last || extra.length === 0 || !detail) throw error;
      options.onBlocksError?.(detail);
      result = await send(parent, `${chunk}\n\n${CHART_FAILED}`.trim(), footer);
    }
    first ??= result.ts ?? null;
  }
  return first;
}

/** Notification text for a message that is only blocks. */
const fallbackText = (blocks: Block[]) =>
  blocks
    .map((block) => {
      const { title, caption } = block as {
        title?: unknown;
        caption?: unknown;
      };
      return typeof title === "string" ? title : caption;
    })
    .filter((label): label is string => typeof label === "string")
    .join(", ") || "Chart";

export const authorName = (message: Message) =>
  message.author.isMe
    ? "you (bb)"
    : message.author.userName ||
      message.author.fullName ||
      message.author.userId;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** One message as the agent reads it. */
export function describeMessage(message: Message): string {
  const files = message.attachments.length
    ? ` [${message.attachments.length} attachment(s) not forwarded]`
    : "";
  return `${authorName(message)}: ${clip(message.text.trim(), HISTORY_MESSAGE_CHARS)}${files}`;
}

/** The latest messages of a Slack thread, oldest first. */
export async function threadHistory(thread: Thread): Promise<Message[]> {
  if (!thread.id.split(":")[2]) return [];
  const result = await thread.adapter.fetchMessages(thread.id, {
    limit: HISTORY_MESSAGES,
  });
  return result.messages;
}

export async function channelName(thread: Thread): Promise<string | null> {
  try {
    const info = await thread.channel.fetchMetadata();
    return info.name ?? null;
  } catch {
    return null;
  }
}

export async function permalink(
  connection: SlackConnection,
  channelId: string,
  messageTs: string,
): Promise<string | null> {
  try {
    const result = await connection.slack.webClient.chat.getPermalink({
      channel: channelId,
      message_ts: messageTs,
    });
    return result.permalink ?? null;
  } catch {
    return null;
  }
}

/** Resolves `C123`, `#name`, or `name` to a channel ID. */
export async function resolveChannel(
  connection: SlackConnection,
  channel: string,
): Promise<string | null> {
  const name = channel.trim().replace(/^#/u, "");
  if (/^[CDG][A-Z0-9]{6,}$/u.test(name)) return name;
  let cursor: string | undefined;
  do {
    const page = await connection.slack.webClient.conversations.list({
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    const match = page.channels?.find((candidate) => candidate.name === name);
    if (match?.id) return match.id;
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return null;
}

/** Swaps a reaction without failing when Slack already has (or lacks) it. */
export async function react(
  connection: SlackConnection,
  channelId: string,
  messageTs: string,
  add: string | null,
  remove: string | null = null,
): Promise<void> {
  const threadId = chatThreadId(channelId, messageTs);
  if (remove) {
    await connection.slack
      .removeReaction(threadId, messageTs, remove)
      .catch(() => {});
  }
  if (add) {
    await connection.slack
      .addReaction(threadId, messageTs, add)
      .catch(() => {});
  }
}

/** Subtypes people post; joins, bot posts and Slack's own messages are not. */
const HUMAN_SUBTYPES = new Set([
  "file_share",
  "thread_broadcast",
  "me_message",
]);

/** True for a message a person wrote that has something to forward. */
export function isHumanMessage(message: Message): boolean {
  const raw = message.raw as { subtype?: string; bot_id?: string } | null;
  if (message.author.isMe || message.author.isBot === true) return false;
  if (message.author.isSystem || raw?.bot_id) return false;
  if (raw?.subtype && !HUMAN_SUBTYPES.has(raw.subtype)) return false;
  return !isBlank(message.text) || message.attachments.length > 0;
}

/**
 * The ts of the Slack thread a message belongs to. A top-level direct
 * message starts its own thread, like a top-level channel message.
 */
export function rootTs(thread: Thread, message: Message): string {
  const threadTs = thread.id.split(":")[2] ?? "";
  const raw = message.raw as { thread_ts?: string } | null;
  return threadTs || raw?.thread_ts || message.id;
}
