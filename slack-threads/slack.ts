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

/** Posts Markdown into a Slack thread; returns the first message's ts. */
export async function postMarkdown(
  connection: SlackConnection,
  channelId: string,
  threadTs: string,
  text: string,
): Promise<string | null> {
  let first: string | null = null;
  for (const chunk of chunkMarkdown(text)) {
    const sent = await connection.bot
      .thread(chatThreadId(channelId, threadTs))
      .post({ markdown: chunk });
    first ??= sent.id;
  }
  return first;
}

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

/** The latest messages of a Slack thread, oldest first; empty for a DM. */
export async function threadHistory(thread: Thread): Promise<Message[]> {
  if (thread.isDM) return [];
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
