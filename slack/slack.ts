// Reads unread counts from Slack's web client API with a browser session.
import { z } from "zod";

const API = "https://slack.com/api/";
/** A hung connection would otherwise stall the reader for minutes. */
const TIMEOUT_MS = 10_000;
/** Muted conversations change rarely. */
const MUTED_TTL_MS = 5 * 60_000;
const AUTH_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
]);

const conversation = z.object({ id: z.string(), has_unreads: z.boolean() });

/** The parts of Slack's `client.counts` reply that the counts use. */
const clientCountsSchema = z.object({
  channel_badges: z.record(z.string(), z.unknown()).optional(),
  channels: z.array(conversation).optional(),
  mpims: z.array(conversation).optional(),
  ims: z.array(conversation).optional(),
  threads: z.object({ has_unreads: z.boolean() }).partial().optional(),
});

type ClientCounts = z.infer<typeof clientCountsSchema>;

const BADGE_KEYS = ["dms", "app_dms", "channels", "thread_mentions"];

/**
 * Muted conversation ids from `users.prefs.get`: the legacy comma-separated
 * `muted_channels` and the per-channel `all_notifications_prefs`.
 */
export function mutedIds(prefs: unknown): Set<string> {
  const ids = new Set<string>();
  const { muted_channels: legacy, all_notifications_prefs: all } =
    (prefs ?? {}) as Record<string, unknown>;
  if (typeof legacy === "string") {
    for (const id of legacy.split(",")) if (id) ids.add(id);
  }
  try {
    const parsed = typeof all === "string" ? JSON.parse(all) : all;
    for (const [id, pref] of Object.entries(parsed?.channels ?? {})) {
      if ((pref as { muted?: unknown })?.muted === true) ids.add(id);
    }
  } catch {
    // Without these prefs, every unread conversation counts.
  }
  return ids;
}

/** Sums the workspaces' counts the way Slack's own badge does. */
export function summarize(
  workspaces: readonly { counts: ClientCounts; muted: Set<string> }[],
): { badge: number; unread: boolean } {
  let badge = 0;
  let unread = false;
  for (const { counts, muted } of workspaces) {
    for (const key of BADGE_KEYS) {
      const value = counts.channel_badges?.[key];
      if (typeof value === "number" && value > 0) badge += value;
    }
    unread ||=
      counts.threads?.has_unreads === true ||
      [counts.channels, counts.mpims, counts.ims].some((list) =>
        list?.some((c) => c.has_unreads && !muted.has(c.id)),
      );
  }
  return { badge, unread };
}

/** Slack rejected the session; reading again will not help. */
export class SignedOutError extends Error {
  override name = "SignedOutError";
}

interface Session {
  /** One `xoxc-` token per workspace. */
  tokens: string[];
  /** The value of Slack's `d` cookie, shared by all workspaces. */
  cookie: string;
}

/** Splits the settings into a session; null when either part is missing. */
export function parseSession(
  token: unknown,
  cookie: unknown,
): Session | null {
  const tokens =
    typeof token === "string"
      ? [...new Set(token.split(/[\s,]+/).filter(Boolean))]
      : [];
  const value = typeof cookie === "string" ? cookie.trim() : "";
  return tokens.length > 0 && value ? { tokens, cookie: value } : null;
}

async function call(
  method: string,
  token: string,
  cookie: string,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetch(API + method, {
    method: "POST",
    headers: { Cookie: `d=${cookie}` },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
  });
  if (!response.ok) throw new Error(`Slack ${method}: HTTP ${response.status}`);
  const reply = (await response.json()) as Record<string, unknown>;
  if (reply.ok === true) return reply;
  const error = String(reply.error ?? "unknown_error");
  if (AUTH_ERRORS.has(error)) throw new SignedOutError(`Slack ${method}: ${error}`);
  throw new Error(`Slack ${method}: ${error}`);
}

/** Counts across workspaces; `rejected` workspaces' sessions are signed out. */
interface Reading {
  badge: number;
  unread: boolean;
  rejected: number;
}

export function createReader() {
  const muted = new Map<string, { at: number; ids: Set<string> }>();

  /** Muting changes rarely: on failure, keep the last list or count all. */
  async function mutedFor(token: string, cookie: string, signal: AbortSignal) {
    const cached = muted.get(token);
    if (cached && Date.now() - cached.at < MUTED_TTL_MS) return cached.ids;
    try {
      const { prefs } = await call("users.prefs.get", token, cookie, signal);
      const ids = mutedIds(prefs);
      muted.set(token, { at: Date.now(), ids });
      return ids;
    } catch {
      return cached?.ids ?? new Set<string>();
    }
  }

  async function workspace(token: string, cookie: string, signal: AbortSignal) {
    const counts = clientCountsSchema.parse(
      await call("client.counts", token, cookie, signal),
    );
    return { counts, muted: await mutedFor(token, cookie, signal) };
  }

  /**
   * A workspace whose session Slack rejects drops out of the counts. Any
   * other failure throws, so the server keeps the last reading rather than
   * publish counts that miss a workspace for a moment.
   */
  return async (session: Session, signal: AbortSignal): Promise<Reading> => {
    const results = await Promise.allSettled(
      session.tokens.map((token) => workspace(token, session.cookie, signal)),
    );
    const read = [];
    let rejected = 0;
    for (const result of results) {
      if (result.status === "fulfilled") read.push(result.value);
      else if (result.reason instanceof SignedOutError) rejected++;
      else throw result.reason;
    }
    if (read.length === 0) throw new SignedOutError("Slack rejected every session");
    return { ...summarize(read), rejected };
  };
}
