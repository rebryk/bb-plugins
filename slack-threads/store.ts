import type { BbPluginApi } from "@get-bb/plugin-sdk";

/** A Slack thread bound to a bb thread. */
export interface Binding {
  slackKey: string;
  bbThreadId: string;
  teamId: string;
  channelId: string;
  /** Empty for a direct-message conversation, which is one bb thread. */
  threadTs: string;
  channelName: string | null;
  permalink: string | null;
  /** `slack` when a Slack message started it, `cli` for `bb slack-threads post`. */
  origin: "slack" | "cli";
  createdAt: number;
  updatedAt: number;
}

/**
 * A Slack thread opened by `bb slack-threads post` that no bb thread owns yet:
 * its first human reply starts one.
 */
export interface Watched {
  slackKey: string;
  teamId: string;
  channelId: string;
  threadTs: string;
  /** The bb thread that posted it, for context. */
  sourceBbThreadId: string | null;
}

/** A Slack message forwarded to bb whose reply has not been posted yet. */
export interface PendingMessage {
  slackKey: string;
  messageTs: string;
}

interface BindingRow {
  slack_key: string;
  bb_thread_id: string;
  team_id: string;
  channel_id: string;
  thread_ts: string;
  channel_name: string | null;
  permalink: string | null;
  origin: "slack" | "cli";
  created_at: number;
  updated_at: number;
}

export const slackKey = (teamId: string, channelId: string, threadTs: string) =>
  `${teamId}:${channelId}:${threadTs}`;

const toBinding = (row: BindingRow): Binding => ({
  slackKey: row.slack_key,
  bbThreadId: row.bb_thread_id,
  teamId: row.team_id,
  channelId: row.channel_id,
  threadTs: row.thread_ts,
  channelName: row.channel_name,
  permalink: row.permalink,
  origin: row.origin,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export type Store = ReturnType<typeof openStore>;

export function openStore(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS bindings (
      slack_key TEXT PRIMARY KEY,
      bb_thread_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      channel_name TEXT,
      permalink TEXT,
      origin TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS bindings_bb_thread ON bindings (bb_thread_id)`,
    `CREATE TABLE IF NOT EXISTS pending (
      slack_key TEXT NOT NULL,
      message_ts TEXT NOT NULL,
      bb_thread_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (slack_key, message_ts)
    )`,
    `CREATE INDEX IF NOT EXISTS pending_bb_thread ON pending (bb_thread_id)`,
    // A DM conversation was once one binding with an empty thread ts; every
    // Slack thread, DMs included, is its own bb thread now.
    `DELETE FROM pending WHERE slack_key IN
      (SELECT slack_key FROM bindings WHERE thread_ts = '')`,
    `DELETE FROM bindings WHERE thread_ts = ''`,
    `CREATE TABLE IF NOT EXISTS watched (
      slack_key TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      source_bb_thread_id TEXT,
      created_at INTEGER NOT NULL
    )`,
  ]);

  const toWatched = (row: {
    slack_key: string;
    team_id: string;
    channel_id: string;
    thread_ts: string;
    source_bb_thread_id: string | null;
  }): Watched => ({
    slackKey: row.slack_key,
    teamId: row.team_id,
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    sourceBbThreadId: row.source_bb_thread_id,
  });

  return {
    get(key: string): Binding | null {
      const row = db
        .prepare(`SELECT * FROM bindings WHERE slack_key = ?`)
        .get(key) as BindingRow | undefined;
      return row ? toBinding(row) : null;
    },

    /** Bindings of one bb thread, most recently active first. */
    forBbThread(bbThreadId: string): Binding[] {
      return (
        db
          .prepare(
            `SELECT * FROM bindings WHERE bb_thread_id = ? ORDER BY updated_at DESC`,
          )
          .all(bbThreadId) as BindingRow[]
      ).map(toBinding);
    },

    recent(limit: number): Binding[] {
      return (
        db
          .prepare(`SELECT * FROM bindings ORDER BY updated_at DESC LIMIT ?`)
          .all(limit) as BindingRow[]
      ).map(toBinding);
    },

    all(): Binding[] {
      return (db.prepare(`SELECT * FROM bindings`).all() as BindingRow[]).map(
        toBinding,
      );
    },

    count(): number {
      return (
        db.prepare(`SELECT COUNT(*) AS n FROM bindings`).get() as { n: number }
      ).n;
    },

    save(binding: Omit<Binding, "createdAt" | "updatedAt">): void {
      const now = Date.now();
      db.prepare(
        `INSERT INTO bindings (slack_key, bb_thread_id, team_id, channel_id,
           thread_ts, channel_name, permalink, origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (slack_key) DO UPDATE SET
           bb_thread_id = excluded.bb_thread_id,
           channel_name = excluded.channel_name,
           permalink = excluded.permalink,
           origin = excluded.origin,
           updated_at = excluded.updated_at`,
      ).run(
        binding.slackKey,
        binding.bbThreadId,
        binding.teamId,
        binding.channelId,
        binding.threadTs,
        binding.channelName,
        binding.permalink,
        binding.origin,
        now,
        now,
      );
    },

    touch(key: string): void {
      db.prepare(`UPDATE bindings SET updated_at = ? WHERE slack_key = ?`).run(
        Date.now(),
        key,
      );
    },

    remove(key: string): void {
      db.prepare(`DELETE FROM bindings WHERE slack_key = ?`).run(key);
      db.prepare(`DELETE FROM pending WHERE slack_key = ?`).run(key);
    },

    removeBbThread(bbThreadId: string): Binding[] {
      const removed = this.forBbThread(bbThreadId);
      db.prepare(`DELETE FROM bindings WHERE bb_thread_id = ?`).run(bbThreadId);
      db.prepare(`DELETE FROM pending WHERE bb_thread_id = ?`).run(bbThreadId);
      return removed;
    },

    watch(watched: Watched): void {
      db.prepare(
        `INSERT OR REPLACE INTO watched (slack_key, team_id, channel_id,
           thread_ts, source_bb_thread_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        watched.slackKey,
        watched.teamId,
        watched.channelId,
        watched.threadTs,
        watched.sourceBbThreadId,
        Date.now(),
      );
    },

    getWatched(key: string): Watched | null {
      const row = db
        .prepare(`SELECT * FROM watched WHERE slack_key = ?`)
        .get(key) as Parameters<typeof toWatched>[0] | undefined;
      return row ? toWatched(row) : null;
    },

    allWatched(): Watched[] {
      return (
        db.prepare(`SELECT * FROM watched`).all() as Parameters<
          typeof toWatched
        >[0][]
      ).map(toWatched);
    },

    unwatch(key: string): void {
      db.prepare(`DELETE FROM watched WHERE slack_key = ?`).run(key);
    },

    watchedCount(): number {
      return (
        db.prepare(`SELECT COUNT(*) AS n FROM watched`).get() as { n: number }
      ).n;
    },

    addPending(bbThreadId: string, key: string, messageTs: string): void {
      db.prepare(
        `INSERT OR IGNORE INTO pending (slack_key, message_ts, bb_thread_id, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(key, messageTs, bbThreadId, Date.now());
    },

    pending(bbThreadId: string): PendingMessage[] {
      return (
        db
          .prepare(
            `SELECT slack_key, message_ts FROM pending WHERE bb_thread_id = ?
             ORDER BY created_at`,
          )
          .all(bbThreadId) as Array<{ slack_key: string; message_ts: string }>
      ).map((row) => ({ slackKey: row.slack_key, messageTs: row.message_ts }));
    },

    removePending(key: string, messageTs: string): void {
      db.prepare(
        `DELETE FROM pending WHERE slack_key = ? AND message_ts = ?`,
      ).run(key, messageTs);
    },
  };
}
