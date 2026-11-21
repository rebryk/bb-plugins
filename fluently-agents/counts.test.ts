import { expect, it } from 'vitest';
import { runningThreadIds } from './counts';
const row = { id: 'root', status: 'active', archivedAt: null, deletedAt: null, hasPendingInteraction: false };
it('deduplicates overlapping roots and excludes every non-running lifecycle', () => {
  const rows = [row, row, { ...row, id: 'worker' },
    ...['idle', 'starting', 'pending', 'stopping', 'error'].map(status => ({ ...row, id: status, status })),
    { ...row, id: 'archived', archivedAt: 1 }, { ...row, id: 'deleted', deletedAt: 1 },
    { ...row, id: 'approval', hasPendingInteraction: true }];
  expect([...runningThreadIds(rows)]).toEqual(['bb:root', 'bb:worker']);
});
it('does not mistake unresolved native background tasks for running executions', () => {
  expect(runningThreadIds([{ ...row, status: 'idle', activity: { activeBackgroundAgentCount: 7 } } as typeof row]).size).toBe(0);
});

import { NativeCensus, lifecycleTypes } from './counts';
import { vi } from 'vitest';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
type Events = BbPluginApi['sdk']['threads']['events'];
type Event = Awaited<ReturnType<Events['list']>>[number];
const delegation = (id = 'call1', childRef = 'native1', status = 'pending') => ({ type: 'delegation', id, childRef, status, background: false, label: 'Worker' });
const background = (taskStatus = 'running', id = 'task:t1', familyId = 't1') => ({ type: 'backgroundTask', id, familyId, parentToolCallId: 'call1', taskType: 'local_agent', taskStatus, status: ['running', 'paused', 'pending'].includes(taskStatus) ? 'pending' : 'completed', foreground: false, skipTranscript: false, description: 'Worker' });
function event(seq: number, item: object, type = 'item/started', session = 'session'): Event {
  return { id: `event${seq}`, scope: { kind: 'thread' }, seq, createdAt: seq, threadId: 'owner', type, data: { item, providerThreadId: session } } as Event;
}
it('reduces Codex start, finish, interrupt, follow-up and late previous completion', () => {
  const c = new NativeCensus();
  c.reduce(event(1, delegation())); expect(c.identities('owner').size).toBe(1);
  c.reduce(event(1, delegation())); expect(c.identities('owner').size).toBe(1);
  c.reduce(event(2, delegation('call1', 'native1', 'completed'), 'item/delegation/completed'));
  expect(c.identities('owner').size).toBe(0);
  c.reduce(event(3, delegation('followup')));
  c.reduce(event(4, delegation('call1', 'native1', 'completed'), 'item/delegation/completed'));
  expect(c.identities('owner').size).toBe(1);
  c.reduce(event(5, delegation('followup', 'native1', 'interrupted'), 'item/delegation/completed'));
  expect(c.identities('owner').size).toBe(0);
  c.reduce(event(6, delegation('followup'))); expect(c.identities('owner').size).toBe(1);
});
it('aliases Claude delegation/background lifetimes and respects explicit states', () => {
  const c = new NativeCensus(); c.reduce(event(1, delegation()));
  let seq = 2;
  for (const [status, count] of [['running', 1], ['paused', 0], ['pending', 0], ['running', 1], ['stopped', 0]] as const) {
    c.reduce(event(seq++, background(status), 'item/backgroundTask/progress'));
    expect(c.identities('owner').size).toBe(count);
  }
  c.reduce(event(seq++, background('running', 'task:t1#2')));
  c.reduce(event(seq++, background('completed'), 'item/backgroundTask/completed'));
  expect(c.identities('owner').size).toBe(1);
  c.reduce(event(seq++, delegation('call1', 'native1', 'completed'), 'item/delegation/completed'));
  expect(c.identities('owner').size).toBe(1);
});
it('counts nested workers and namespaces owner/session identities; ignores workflow rows', () => {
  const c = new NativeCensus(); c.reduce(event(1, delegation()));
  c.reduce(event(2, { ...delegation('nested', 'native2'), parentToolCallId: 'call1' }));
  c.reduce(event(3, delegation(), 'item/started', 'another-session'));
  c.reduce(event(4, { ...background(), taskType: 'workflow' }));
  expect(c.identities('owner').size).toBe(3);
  expect(new Set([...c.identities('owner'), ...c.identities('owner')]).size).toBe(3);
  expect(new Set([...c.identities('owner'), ...c.identities('another-owner')]).size).toBe(6);
});
it('bootstraps in bounded pages, reports unknown, then reads only after cursor and recovers failures/restarts', async () => {
  const history = Array.from({ length: 1000 }, (_, i) => event(i + 1, delegation(`call${i}`, `worker${i}`)));
  history.push(event(1001, delegation('call0', 'worker0', 'completed'), 'item/delegation/completed'));
  const list = vi.fn(async ({ afterSeq, limit }: any) => history.filter(e => e.seq > Number(afterSeq)).slice(0, Number(limit)));
  const api = { list } as unknown as Events; const c = new NativeCensus();
  await c.refresh(api, 'owner'); expect(list).toHaveBeenCalledTimes(4); expect(c.cursor).toBe(400); expect(c.complete).toBe(false);
  await c.refresh(api, 'owner'); await c.refresh(api, 'owner'); expect(c.complete).toBe(true); expect(c.identities('owner').size).toBe(999);
  await c.refresh(api, 'owner'); expect(list).toHaveBeenLastCalledWith({ threadId: 'owner', types: lifecycleTypes, afterSeq: '1001', order: 'asc', limit: '100' });
  list.mockRejectedValueOnce(new Error('offline')); await c.refresh(api, 'owner'); expect(c.complete).toBe(false);
  await c.refresh(api, 'owner'); expect(c.complete).toBe(true);
  const restarted = new NativeCensus(); await restarted.refresh(api, 'owner'); await restarted.refresh(api, 'owner'); await restarted.refresh(api, 'owner');
  expect(restarted.identities('owner')).toEqual(c.identities('owner'));
});

// Sanitized normalized Claude events captured read-only from an existing BB
// conversation. Keep the real item linkage and lifecycle ordering.
it('replays captured Claude handoff without counting its delegation twice', () => {
  const rows = [
  {
    "seq": 495,
    "type": "item/started",
    "data": {
      "item": {
        "type": "delegation",
        "status": "pending",
        "background": true,
        "id": "captured-1",
        "childRef": "captured-1",
        "label": "Captured worker"
      },
      "providerThreadId": "captured-1"
    }
  },
  {
    "seq": 496,
    "type": "item/started",
    "data": {
      "item": {
        "type": "backgroundTask",
        "taskType": "local_agent",
        "status": "pending",
        "taskStatus": "running",
        "skipTranscript": false,
        "foreground": false,
        "id": "captured-2",
        "parentToolCallId": "captured-1",
        "familyId": "captured-2",
        "description": "Captured worker"
      },
      "providerThreadId": "captured-1"
    }
  },
  {
    "seq": 497,
    "type": "item/delegation/completed",
    "data": {
      "item": {
        "type": "delegation",
        "status": "completed",
        "background": true,
        "id": "captured-1",
        "childRef": "captured-1",
        "label": "Captured worker"
      },
      "providerThreadId": "captured-1"
    }
  },
  {
    "seq": 1077,
    "type": "item/backgroundTask/completed",
    "data": {
      "item": {
        "type": "backgroundTask",
        "taskType": "local_agent",
        "status": "completed",
        "taskStatus": "completed",
        "skipTranscript": false,
        "foreground": false,
        "id": "captured-2",
        "parentToolCallId": "captured-1",
        "familyId": "captured-2",
        "description": "Captured worker"
      },
      "providerThreadId": "captured-1"
    }
  }
];
  const c = new NativeCensus();
  const sizes: number[] = [];
  for (const row of rows) { c.reduce(row as Event); sizes.push(c.identities('owner').size); }
  expect(sizes).toEqual([1, 1, 1, 0]);
});
it('keeps superseded Claude delegation aliases suppressed and ignores unrelated tools', () => {
  const c = new NativeCensus(); c.reduce(event(1, delegation()));
  c.reduce(event(2, background()));
  c.reduce(event(3, delegation('call2', 'tool-use2')));
  c.reduce(event(4, { ...background('running', 'generation2'), parentToolCallId: 'call2' }));
  c.reduce(event(5, { type: 'tool', id: 'tool', status: 'pending' }));
  expect(c.identities('owner').size).toBe(1);
  c.reduce(event(6, { ...background('stopped', 'generation2'), parentToolCallId: 'call2' }, 'item/backgroundTask/completed'));
  expect(c.identities('owner').size).toBe(0);
});

it('adapts oversized pages and stops retrying an impossible singleton', async () => {
  const c = new NativeCensus();
  const list = vi.fn(async ({ limit }: any) => {
    if (Number(limit) > 50) throw Object.assign(new Error('oversized'), { status: 413 });
    return [];
  });
  await c.refresh({ list } as unknown as Events, 'owner');
  expect(c.complete).toBe(true);
  expect(list.mock.calls.map(([args]) => args.limit)).toEqual(['100', '50']);
  const impossible = vi.fn(async () => { throw Object.assign(new Error('oversized'), { code: 'event_data_too_large' }); });
  const blocked = new NativeCensus();
  for (let i = 0; i < 4; i++) await blocked.refresh({ list: impossible } as unknown as Events, 'owner');
  expect(impossible).toHaveBeenCalledTimes(7);
  expect(blocked.complete).toBe(false);
  expect(blocked.unavailable).toContain('single event');
});
it('does not revisit terminal payloads and checkpoints compact ordering with its cursor', () => {
  const c = new NativeCensus(); let reads = 0;
  for (let i = 1; i <= 10000; i++) {
    const item = { ...delegation(`call${i}`, `child${i}`, 'completed'), summary: 'x'.repeat(1000) };
    c.reduce(event(i, item));
    Object.defineProperty(item, 'childRef', { get() { reads++; return `child${i}`; } });
  }
  expect(c.identities('owner').size).toBe(0); expect(c.identities('owner').size).toBe(0);
  expect(reads).toBe(0);
  expect(JSON.stringify(c.snapshot())).not.toContain('summary');
  c.reduce(event(10001, delegation('followup', 'child1')));
  const restored = NativeCensus.restore(JSON.parse(JSON.stringify(c.snapshot())));
  restored.reduce(event(10002, delegation('call1', 'child1', 'completed'), 'item/completed'));
  expect(restored.identities('owner')).toEqual(c.identities('owner'));
  expect(restored.cursor).toBe(10002);
  expect(NativeCensus.restore({ version: 0, cursor: 10002 }).cursor).toBe(0);
});
it('preserves latent Claude aliases across a checkpoint and restart', () => {
  const c = new NativeCensus(); c.reduce(event(1, delegation())); c.reduce(event(2, background('paused')));
  const restored = NativeCensus.restore(c.snapshot());
  expect(restored.watching).toBe(true); expect(restored.identities('owner').size).toBe(0);
  restored.reduce(event(3, background('running'), 'item/backgroundTask/progress'));
  expect(restored.identities('owner').size).toBe(1);
});
