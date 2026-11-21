import { z } from 'zod';
import type { BbPluginApi } from '@get-bb/plugin-sdk';

type Events = BbPluginApi['sdk']['threads']['events'];
type Event = Awaited<ReturnType<Events['list']>>[number];
export const lifecycleTypes = ['item/started', 'item/completed',
  'item/delegation/progress', 'item/delegation/completed',
  'item/backgroundTask/progress', 'item/backgroundTask/completed'] as const;

export function runningThreadIds(rows: readonly {
  id: string; status: string; archivedAt: number | null;
  deletedAt: number | null; hasPendingInteraction: boolean;
}[]): Set<string> {
  return new Set(rows.filter(row => row.status === 'active' &&
    !row.archivedAt && !row.deletedAt && !row.hasPendingInteraction)
    .map(row => `bb:${row.id}`));
}

// Only ordering and lifecycle fields survive reduction; never retain payloads.
const recordSchema = z.object({
  key: z.string(), family: z.string(), opened: z.number(), pending: z.boolean(),
  active: z.boolean(), alias: z.string().nullable(),
});
const checkpointSchema = z.object({ version: z.literal(1), cursor: z.number().int().nonnegative(),
  complete: z.boolean(), unavailable: z.string().nullable(), size: z.number().int().min(1).max(100), records: z.array(recordSchema) });
type Record = z.infer<typeof recordSchema>;
export class NativeCensus {
  cursor = 0;
  complete = false;
  unavailable: string | null = null;
  retryLater = false;
  private size = 100;
  get pageSize() { return this.size; }
  private items = new Map<string, Record>();
  private latest = new Map<string, Record>();
  private aliases = new Set<string>();
  private active = new Set<string>();
  private pending = new Set<string>();
  get watching() { return this.pending.size > 0; }
  private update(family: string) {
    const value = this.latest.get(family)!;
    this.active.delete(family); this.pending.delete(family);
    if (!this.aliases.has(value.key)) {
      if (value.active) this.active.add(family);
      if (value.pending) this.pending.add(family);
    }
  }
  private put(value: Record) {
    this.items.set(value.key, value);
    if (value.alias) {
      this.aliases.add(value.alias);
      const linked = this.items.get(value.alias);
      if (linked && this.latest.has(linked.family)) this.update(linked.family);
    }
    if ((this.latest.get(value.family)?.opened ?? -1) <= value.opened) {
      this.latest.set(value.family, value); this.update(value.family);
    }
  }
  reduce(event: Event) {
    if (event.seq <= this.cursor) return;
    this.cursor = event.seq;
    if (!('item' in event.data) || !('providerThreadId' in event.data)) return;
    const item = event.data.item;
    if (item.type !== 'delegation' && item.type !== 'backgroundTask') return;
    if (item.type === 'backgroundTask' && !['local_agent', 'local_subagent'].includes(item.taskType)) return;
    const session = event.data.providerThreadId;
    const key = JSON.stringify([session, item.id]);
    const previous = this.items.get(key);
    const reopened = event.type === 'item/started' && !previous?.pending;
    this.put({ key,
      family: JSON.stringify([session, item.type, item.type === 'delegation' ? item.childRef : item.familyId ?? item.id]),
      opened: !previous || reopened ? event.seq : previous.opened,
      pending: item.status === 'pending',
      active: item.status === 'pending' && (item.type === 'delegation' || (!item.skipTranscript && item.taskStatus === 'running')),
      alias: item.type === 'backgroundTask' && item.parentToolCallId ? JSON.stringify([session, item.parentToolCallId]) : null,
    });
  }
  identities(owner: string) {
    return new Set([...this.active].map(key => JSON.stringify(['native', owner, key])));
  }
  snapshot() {
    return { version: 1 as const, cursor: this.cursor, complete: this.complete, unavailable: this.unavailable, size: this.size, records: [...this.items.values()] };
  }
  static restore(input: unknown) {
    const state = checkpointSchema.safeParse(input);
    const census = new NativeCensus();
    if (!state.success) return census;
    const data = state.data;
    census.cursor = data.cursor; census.complete = data.complete; census.size = data.size; census.unavailable = data.unavailable;
    for (const record of data.records) census.put(record);
    // Aliases can precede their delegation in a checkpoint.
    for (const family of census.latest.keys()) census.update(family);
    return census;
  }
  async refresh(events: Events, threadId: string, pages = 4, signal?: AbortSignal) {
    if (this.unavailable) return;
    this.complete = false; this.retryLater = false;
    for (let page = 0; page < pages; page++) {
      try {
        const rows = await events.list({ threadId, types: lifecycleTypes, afterSeq: String(this.cursor), order: 'asc', limit: String(this.size), ...(signal ? { signal } : {}) });
        for (const row of rows) this.reduce(row);
        if (rows.length < this.size) { this.complete = true; break; }
      } catch (error) {
        const message = String(error);
        const oversized = /event_data_too_large|413|8 MiB|response.*too large/i.test(message) ||
          (typeof error === 'object' && error !== null && ('status' in error && error.status === 413 || 'code' in error && error.code === 'event_data_too_large'));
        if (!oversized) { this.retryLater = true; break; }
        if (this.size === 1) {
          this.unavailable = `Cannot read lifecycle event after sequence ${this.cursor} in ${threadId}: a single event exceeds the server response limit. Repair/export that event or increase the upstream response limit.`;
          break;
        }
        this.size = Math.max(1, Math.floor(this.size / 2));
      }
    }
  }
}
export const countDescription = 'Active worker lifecycles, including BB turns, native Codex and Claude agents, and tool waits. Each worker counts once. Counts are withheld while lifecycle history is incomplete or unavailable.';
