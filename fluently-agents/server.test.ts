import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@get-bb/plugin-sdk', () => ({ defineRpcContract: (contract: unknown) => contract }));
vi.mock('./routing', () => ({ chooseExecution: vi.fn(async () => ({ providerId: 'provider', model: 'catalog-model', reasoningLevel: 'high', reason: 'Test catalog' })) }));
import plugin from './server';
import { chooseExecution } from './routing';

type Handler = (...args: any[]) => any;
type FakeThread = {
  id: string; title: string; projectId: string; environmentId: string;
  status: string; archivedAt: number | null; deletedAt: number | null;
  hasPendingInteraction: boolean; queuedWork: string;
  activity: { activeBackgroundAgentCount: number };
  visibility?: string; updatedAt?: number; parentThreadId?: string; pluginMetadata: Record<string, string>;
};
const cleanups: (() => void)[] = [];
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

async function harness(maxWorkers = 2, seed = new Map<string, unknown>(), threads = new Map<string, FakeThread>(), beforeStart?: (bb: any) => void) {
  const storage = seed;
  const queues = new Map<string, any[]>();
  const tools = new Map<string, { parameters: z.ZodType; execute: Handler }>();
  const events = new Map<string, Handler>();
  let rpc: Record<string, Handler> = {};
  let contract: Record<string, { input: z.ZodType }> = {};
  let configure: Handler = () => ({});
  let cli: Handler = () => ({});
  const project = { id: 'project', name: 'Project', kind: 'personal', gitRemoteUrl: 'git@example.test:repo.git' };
  const threadApi = {
    events: { list: vi.fn(async (_args: any): Promise<any[]> => []) },
    get: vi.fn(async ({ threadId }: { threadId: string }) => {
      const thread = threads.get(threadId); if (!thread) throw new Error('Thread not found'); return thread;
    }),
    spawn: vi.fn(async (options: any) => {
      const thread: FakeThread = {
        id: `thread-${threads.size + 1}`, title: options.title, projectId: options.projectId,
        environmentId: options.environment.environmentId ?? 'environment', status: 'active',
        archivedAt: null, deletedAt: null, hasPendingInteraction: false, queuedWork: 'none',
        activity: { activeBackgroundAgentCount: 0 }, parentThreadId: options.parentThreadId,
        pluginMetadata: options.pluginMetadata ?? {}, visibility: options.visibility,
      };
      threads.set(thread.id, thread);
      queues.set(thread.id, [{ id: `initial-${thread.id}`, sendAt: options.sendAt, state: 'scheduled' }]);
      return thread;
    }),
    list: vi.fn(async (options: any) => [...threads.values()].filter(thread =>
      (!options.threadIds || options.threadIds.includes(thread.id)) && Boolean(thread.archivedAt) === Boolean(options.archived)
    ).slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 100))),
    update: vi.fn(async ({ threadId, ...patch }: any) => Object.assign(threads.get(threadId)!, patch)),
    updatePluginMetadata: vi.fn(async ({ threadId, set }: any) => Object.assign(threads.get(threadId)!.pluginMetadata, set)),
    queuedMessages: {
      list: vi.fn(async ({ threadId }: any) => queues.get(threadId) ?? []),
      send: vi.fn(async ({ threadId, queuedMessageId }: any) => { queues.set(threadId, (queues.get(threadId) ?? []).filter(row => row.id !== queuedMessageId)); }),
    },
    listRunning: vi.fn(async () => [...threads.values()].filter(thread => thread.status === 'active')),
    experimental_listPluginMetadata: vi.fn(async ({ threadIds }: { threadIds: string[] }) => ({ threads: threadIds.map(threadId => ({ threadId, metadata: threads.get(threadId)!.pluginMetadata })) })),
    experimental_listDescendants: vi.fn(async ({ threadIds }: { threadIds: string[] }) => ({ threads: threadIds.map(threadId => {
      const descendants = new Set<string>();
      let growing = true;
      while (growing) {
        growing = false;
        for (const t of threads.values()) if (t.parentThreadId && (t.parentThreadId === threadId || descendants.has(t.parentThreadId)) && !descendants.has(t.id)) { descendants.add(t.id); growing = true; }
      }
      return { threadId, descendantIds: [...descendants] };
    }) })),
    archive: vi.fn(async ({ threadId }: { threadId: string }) => { threads.get(threadId)!.archivedAt = Date.now(); }),
    unarchive: vi.fn(async ({ threadId }: { threadId: string }) => { threads.get(threadId)!.archivedAt = null; }),
    send: vi.fn(async ({ threadId }: { threadId: string }) => { threads.get(threadId)!.status = 'active'; }),
    stop: vi.fn(), delete: vi.fn(),
  };
  const bb = {
    pluginId: 'fluently-agents',
    settings: { define: () => ({ get: async () => ({ maxWorkers }) }) },
    storage: { kv: {
      list: async (prefix: string) => [...storage.keys()].filter(key => key.startsWith(prefix)),
      get: async (key: string) => structuredClone(storage.get(key)),
      set: async (key: string, value: unknown) => { storage.set(key, structuredClone(value)); },
      delete: async (key: string) => { storage.delete(key); },
    } },
    realtime: { publish: vi.fn() }, log: { warn: vi.fn() },
    sdk: {
      plugins: { callRpc: vi.fn(async ({ method }: any): Promise<any> => method === 'track_outline' ? { tracked: true } : ({ phases: Object.fromEntries([...threads.values()].filter(thread => thread.pluginMetadata.launchId || thread.status === 'active').map(thread => [thread.id,
        thread.status === 'active' || thread.activity.activeBackgroundAgentCount > 0
          ? { kind: 'running', reason: 'Working', etaAt: 999999, since: 1 }
          : { kind: 'done', unread: false }])) })) },
      threads: threadApi,
      projects: { get: vi.fn(async ({ projectId }: { projectId: string }) => ({ ...project, id: projectId })), list: vi.fn(async () => [project]) },
      environments: { get: vi.fn(async ({ environmentId }: { environmentId: string }) => ({ id: environmentId, projectId: environmentId === 'wrong-project' ? 'other' : 'project' })) },
    },
    rpc: { register: (schema: typeof contract, handlers: typeof rpc) => { contract = schema; rpc = handlers; } },
    agents: { registerTool: (tool: any) => tools.set(tool.name, tool), configure: (callback: Handler) => { configure = callback; } },
    events: { on: (name: string, callback: Handler) => events.set(name, callback) },
    onDispose: (callback: () => void) => cleanups.push(callback), cli: { register: vi.fn((registration: { run: Handler }) => { cli = registration.run; }) },
  };
  beforeStart?.(bb);
  await plugin(bb as unknown as BbPluginApi);
  async function call(name: string, input: unknown = null) { return rpc[name]!(contract[name]!.input.parse(input)); }
  async function tool(name: string, threadId: string, input: unknown) {
    const registered = tools.get(name)!;
    const output = await registered.execute(registered.parameters.parse(input), { threadId, projectId: 'project' });
    return JSON.parse(output.content[0].text);
  }
  async function event(name: string, threadId: string) { await events.get(name)!({ thread: threads.get(threadId)! }); }
  function patch(threadId: string, input: Partial<FakeThread>) { Object.assign(threads.get(threadId)!, input); events.get('thread.created')?.({ thread: threads.get(threadId)! }); }
  function session(threadId: string) { const thread = threads.get(threadId)!; return configure({ thread, pluginMetadata: thread.pluginMetadata }); }
  async function setupTask(key = 'task-key') {
    const coordinator = await call('openAgent', { agentId: 'general' });
    const task = await tool('agents_create_task', coordinator.threadId, { title: 'Build feature', prompt: 'Build and verify feature.', requestKey: key });
    return { coordinatorId: coordinator.threadId as string, taskId: task.taskId as string, threadId: task.threadId as string };
  }
  const boardTask = async (id: string) => (await call('board')).tasks.find((task: any) => task.id === id);
  return { call, tool, event, patch, session, setupTask, boardTask, threads, threadApi, storage, bb, cli: (args: string[]) => cli(args) };
}
const workerInput = (requestKey: string) => ({ title: 'Worker', prompt: 'Independent scope.', requestKey });
const update = { state: 'running', ask: null, completed: 1, total: 2, etaMinutes: 5 };

describe('task orchestration', () => {
  it('creates one standalone task on concurrent retries and preserves project isolation', async () => {
    const h = await harness();
    const agent = await h.call('openAgent', { agentId: 'general' });
    const input = { title: 'Build', prompt: 'Acceptance criteria.', requestKey: 'stable' };
    const [a, b] = await Promise.all([h.tool('agents_create_task', agent.threadId, input), h.tool('agents_create_task', agent.threadId, input)]);
    expect(a.taskId).toBe(b.taskId); expect(a.threadId).toBe(b.threadId);
    expect(h.threadApi.spawn).toHaveBeenCalledTimes(2);
    expect(h.threadApi.spawn.mock.calls[0]![0]).not.toHaveProperty('prompt');
    expect(h.threadApi.spawn.mock.calls[0]![0].input[0].visibility).toBe('agent-only');
    const options = h.threadApi.spawn.mock.calls[1]![0];
    expect(options).not.toHaveProperty('parentThreadId');
    expect(options.senderThreadId).toBe(agent.threadId);
    expect(options.environment.workspace.type).toBe('managed-worktree');
    expect(options.visibility).toBe('visible');
    expect(options.origin).toBe('sdk');
    expect(options).not.toHaveProperty('pluginMetadata');
    expect(h.threads.get(a.threadId)?.title).toBe('Build');
    expect(h.threadApi.queuedMessages.send).toHaveBeenCalledTimes(2);
    expect((await h.call('board')).tasks).toHaveLength(1);
  });
  it('recovers a lost spawn response by durable metadata without repeating work', async () => {
    const h = await harness();
    const agent = await h.call('openAgent', { agentId: 'general' });
    const spawn = h.threadApi.spawn.getMockImplementation()!;
    h.threadApi.spawn.mockImplementationOnce(async options => { await spawn(options); throw new Error('Response lost'); });
    const input = { title: 'Build', prompt: 'Acceptance criteria.', requestKey: 'stable' };
    await expect(h.tool('agents_create_task', agent.threadId, input)).rejects.toThrow('Response lost');
    const recovered = await h.tool('agents_create_task', agent.threadId, input);
    expect(recovered.threadId).toBe('thread-2');
    expect(h.threadApi.spawn).toHaveBeenCalledTimes(2);
    expect((await h.call('board')).tasks).toHaveLength(1);
  });
  it('holds the first prompt until the durable role mapping exists', async () => {
    const h = await harness();
    const original = h.threadApi.queuedMessages.send.getMockImplementation()!;
    h.threadApi.queuedMessages.send.mockImplementation(async args => {
      const launch = [...h.storage.values()].find((row: any) => row?.threadId === args.threadId && row?.role) as any;
      expect(launch).toBeDefined();
      expect(h.session(args.threadId).instructions).toContain('shared memory');
      return original(args);
    });
    await h.setupTask();
  });
  it('recovers a lost initial dispatch response without sending the prompt twice', async () => {
    const h = await harness();
    const coordinator = await h.call('openAgent', { agentId: 'general' });
    const send = h.threadApi.queuedMessages.send.getMockImplementation()!;
    h.threadApi.queuedMessages.send.mockImplementationOnce(async args => { await send(args); throw new Error('Send response lost'); });
    const input = { title: 'Build', prompt: 'Acceptance criteria.', requestKey: 'stable' };
    await expect(h.tool('agents_create_task', coordinator.threadId, input)).rejects.toThrow('Send response lost');
    const task = await h.tool('agents_create_task', coordinator.threadId, input);
    expect(task.threadId).toBe('thread-2');
    expect(h.threadApi.spawn).toHaveBeenCalledTimes(2);
    expect(h.threadApi.queuedMessages.send).toHaveBeenCalledTimes(2);
  });
  it('retries metadata setup before releasing the initial prompt', async () => {
    const h = await harness();
    const coordinator = await h.call('openAgent', { agentId: 'general' });
    h.threadApi.updatePluginMetadata.mockRejectedValueOnce(new Error('Metadata unavailable'));
    const input = { title: 'Build', prompt: 'Acceptance criteria.', requestKey: 'stable' };
    await expect(h.tool('agents_create_task', coordinator.threadId, input)).rejects.toThrow('Metadata unavailable');
    expect(h.threadApi.queuedMessages.send).toHaveBeenCalledTimes(1);
    await h.tool('agents_create_task', coordinator.threadId, input);
    expect(h.threadApi.spawn).toHaveBeenCalledTimes(2);
    expect(h.threadApi.queuedMessages.send).toHaveBeenCalledTimes(2);
  });
  it('explicitly abandons a confirmed absent worker launch to free its budget', async () => {
    const h = await harness(1); const task = await h.setupTask();
    h.threadApi.spawn.mockRejectedValueOnce(new Error('Launch refused'));
    await expect(h.tool('agents_spawn_worker', task.threadId, workerInput('failed'))).rejects.toThrow('bb agents abandon-launch');
    const unresolved = JSON.parse((await h.cli(['list'])).stdout).unresolvedLaunches[0];
    await expect(h.tool('agents_spawn_worker', task.threadId, workerInput('other'))).rejects.toThrow('1-worker budget');
    await expect(h.tool('agents_spawn_worker', task.threadId, workerInput('failed'))).rejects.toThrow(`bb agents abandon-launch ${unresolved.id}`);
    expect((await h.cli(['abandon-launch', unresolved.id])).exitCode).toBe(0);
    expect(h.storage.has(`launch:${unresolved.id}`)).toBe(false);
    await expect(h.tool('agents_spawn_worker', task.threadId, workerInput('failed'))).resolves.toHaveProperty('threadId');
    expect(h.threadApi.delete).not.toHaveBeenCalled();
  });
  it('recovers an existing conversation instead of abandoning a lost-response launch', async () => {
    const h = await harness(1); const task = await h.setupTask();
    const spawn = h.threadApi.spawn.getMockImplementation()!;
    h.threadApi.spawn.mockImplementationOnce(async options => { await spawn(options); throw new Error('Response lost'); });
    await expect(h.tool('agents_spawn_worker', task.threadId, workerInput('lost'))).rejects.toThrow('Response lost');
    const unresolved = JSON.parse((await h.cli(['list'])).stdout).unresolvedLaunches[0];
    await expect(h.cli(['abandon-launch', unresolved.id])).rejects.toThrow('already created conversation');
    expect((await h.tool('agents_spawn_worker', task.threadId, workerInput('lost'))).threadId).toBe('thread-3');
    await expect(h.cli(['abandon-launch', unresolved.id])).rejects.toThrow('Only an unresolved launch');
    expect(h.threadApi.spawn).toHaveBeenCalledTimes(3); expect(h.threadApi.delete).not.toHaveBeenCalled();
  });
  it('refuses to abandon a launch that is still in flight', async () => {
    const h = await harness(); const task = await h.setupTask();
    let resume!: () => void; let started!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const spawn = h.threadApi.spawn.getMockImplementation()!;
    h.threadApi.spawn.mockImplementationOnce(async options => { started(); await gate; return spawn(options); });
    const spawning = h.tool('agents_spawn_worker', task.threadId, workerInput('in-flight'));
    await entered;
    const unresolved = [...h.storage.values()].find((value: any) => value.role === 'worker') as { id: string };
    await expect(h.cli(['abandon-launch', unresolved.id])).rejects.toThrow('still in flight');
    resume(); await spawning;
    expect(h.threadApi.spawn).toHaveBeenCalledTimes(3);
  });
  it('retains the failed task record when explicitly abandoning a launch', async () => {
    const h = await harness(); const coordinator = await h.call('openAgent', { agentId: 'general' });
    h.threadApi.spawn.mockRejectedValueOnce(new Error('Launch refused'));
    await expect(h.tool('agents_create_task', coordinator.threadId, workerInput('failed-task'))).rejects.toThrow('Launch refused');
    const unresolved = JSON.parse((await h.cli(['list'])).stdout).unresolvedLaunches[0];
    await h.cli(['abandon-launch', unresolved.id]);
    expect(await h.boardTask(unresolved.taskId)).toMatchObject({ state: 'done', threadId: null });
    expect(h.threadApi.archive).not.toHaveBeenCalled(); expect(h.threadApi.delete).not.toHaveBeenCalled();
    await expect(h.tool('agents_create_task', coordinator.threadId, workerInput('failed-task'))).resolves.toHaveProperty('threadId');
  });
  it('shares one recursive worker budget and reuses request keys at the limit', async () => {
    const h = await harness(2); const task = await h.setupTask();
    const first = await h.tool('agents_spawn_worker', task.threadId, workerInput('first'));
    const second = await h.tool('agents_spawn_worker', first.threadId, workerInput('recursive'));
    expect(h.threadApi.spawn.mock.calls[3]![0].parentThreadId).toBe(first.threadId);
    await expect(h.tool('agents_spawn_worker', second.threadId, workerInput('overflow'))).rejects.toThrow('2-worker budget');
    expect((await h.tool('agents_spawn_worker', first.threadId, workerInput('recursive'))).threadId).toBe(second.threadId);
    h.patch(first.threadId, { status: 'idle' });
    await expect(h.tool('agents_spawn_worker', task.threadId, workerInput('replacement'))).resolves.toHaveProperty('threadId');
  });
  it('rejects unmanaged callers, worker task creation, and mismatched environments', async () => {
    const h = await harness(); const task = await h.setupTask();
    await expect(h.tool('agents_create_task', 'unmanaged', workerInput('bad'))).rejects.toThrow('not managed');
    await expect(h.tool('agents_create_task', task.threadId, workerInput('bad'))).rejects.toThrow('standing coordinator');
    await expect(h.tool('agents_spawn_worker', task.threadId, { ...workerInput('bad'), environmentId: 'wrong-project' })).rejects.toThrow('different project');
    expect(h.threadApi.spawn).toHaveBeenCalledTimes(2);
  });
  it('serializes completion against an in-flight worker launch', async () => {
    const h = await harness(); const task = await h.setupTask();
    h.patch(task.threadId, { status: 'idle' });
    let resume!: () => void; let started!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(chooseExecution).mockImplementationOnce(async () => {
      started(); await gate;
      return { providerId: 'provider', model: 'catalog-model', reason: 'Test catalog' };
    });
    const spawning = h.tool('agents_spawn_worker', task.threadId, workerInput('race'));
    await entered;
    const completion = expect(h.call('completeTask', { taskId: task.taskId })).rejects.toThrow('still running');
    resume(); await spawning; await completion;
    expect(h.threadApi.archive).not.toHaveBeenCalled();
  });
  it('only lets the task leader update aggregate progress', async () => {
    const h = await harness(); const task = await h.setupTask();
    const worker = await h.tool('agents_spawn_worker', task.threadId, workerInput('first'));
    await expect(h.tool('agents_update_task_details', worker.threadId, update)).rejects.toThrow('Only the task leader');
    await expect(h.tool('agents_update_task_details', task.coordinatorId, update)).rejects.toThrow('Only the task leader');
    await expect(h.tool('agents_update_task_details', task.threadId, { ...update, completed: 3 })).rejects.toThrow('cannot exceed');
    await h.tool('agents_update_task_details', task.threadId, update);
    expect(await h.boardTask(task.taskId)).toMatchObject({ completed: 1, total: 2, state: 'running' });
  });
});

describe('task state and durable conversations', () => {
  it('does not opt deleted legacy leads into Sidebar or block the board', async () => {
    const h = await harness(); const task = await h.setupTask();
    for (const [key, value] of h.storage) if (key.startsWith('launch:') && (value as any).role === 'task') {
      h.storage.set(key, { ...(value as any), ordinary: undefined });
    }
    h.patch(task.threadId, { deletedAt: Date.now() });
    const restarted = await harness(2, h.storage, h.threads);
    expect(await restarted.boardTask(task.taskId)).toMatchObject({ state: 'needs-you', ask: 'Task conversation was deleted' });
    expect(restarted.bb.sdk.plugins.callRpc.mock.calls.some(([args]) => args.method === 'track_outline')).toBe(false);
  });
  it('opts a legacy lead in once, preserving its thread and history', async () => {
    const h = await harness(); const task = await h.setupTask();
    for (const [key, value] of h.storage) if (key.startsWith('launch:') && (value as any).role === 'task') {
      h.storage.set(key, { ...(value as any), ordinary: undefined });
    }
    const restarted = await harness(2, h.storage, h.threads);
    await restarted.boardTask(task.taskId); restarted.patch(task.threadId, {}); await restarted.boardTask(task.taskId);
    expect(restarted.bb.sdk.plugins.callRpc.mock.calls.filter(([args]) => args.method === 'track_outline')).toHaveLength(1);
    expect(restarted.threadApi.spawn).not.toHaveBeenCalled();
  });

  it('keeps a task running until its last worker finishes, then requests review', async () => {
    const h = await harness(); const task = await h.setupTask();
    const worker = await h.tool('agents_spawn_worker', task.threadId, workerInput('first'));
    h.patch(task.threadId, { status: 'idle' }); await h.event('thread.idle', task.threadId);
    expect(await h.boardTask(task.taskId)).toMatchObject({ state: 'running', runningAgents: 1 });
    h.patch(worker.threadId, { status: 'idle' }); await h.event('thread.idle', worker.threadId);
    expect(await h.boardTask(task.taskId)).toMatchObject({ state: 'needs-you', ask: 'Review result', runningAgents: 0 });
    h.patch(task.threadId, { status: 'active' }); await h.event('thread.active', task.threadId);
    expect(await h.boardTask(task.taskId)).toMatchObject({ state: 'running', ask: null });
  });
  it('excludes explicitly paused native workers and counts active BB descendants once', async () => {
    const h = await harness(); const task = await h.setupTask();
    h.patch(task.coordinatorId, { status: 'idle' });
    h.patch(task.threadId, { status: 'idle', activity: { activeBackgroundAgentCount: 2 } });
    h.threadApi.events.list.mockImplementation(async ({ threadId, afterSeq }: any) => threadId === task.threadId ? [1, 2].filter(seq => seq > Number(afterSeq)).map(seq => ({ seq, type: 'item/backgroundTask/progress', data: { providerThreadId: 'session', item: { type: 'backgroundTask', id: `paused-${seq}`, familyId: `family-${seq}`, taskType: 'local_agent', taskStatus: 'paused', status: 'pending', foreground: false, skipTranscript: false } } })) : []);
    let board = await h.call('board');
    expect(board.runningAgents).toBe(0); expect(board.tasks[0].runningAgents).toBe(0);
    const worker = await h.tool('agents_spawn_worker', task.threadId, workerInput('first'));
    await h.tool('agents_spawn_worker', worker.threadId, workerInput('nested'));
    await h.call('snoozeTask', { taskId: task.taskId, until: null });
    h.patch(task.coordinatorId, { status: 'active' });
    board = await h.call('board');
    expect(board.runningAgents).toBe(3); expect(board.tasks[0].runningAgents).toBe(2);
  });
  it('deduplicates overlapping task roots and coordinator membership', async () => {
    const h = await harness(); const task = await h.setupTask();
    const worker = await h.tool('agents_spawn_worker', task.threadId, workerInput('first'));
    const stored = h.storage.get(`task:${task.taskId}`) as any;
    h.storage.set('task:overlap', { ...stored, id: 'overlap', threadId: worker.threadId });
    const agent = h.storage.get('agent:general') as any;
    h.storage.set('agent:general', { ...agent, threadId: worker.threadId });
    h.patch(task.coordinatorId, { status: 'idle' }); // The previous coordinator is still a real BB owner.
    const restarted = await harness(2, h.storage, h.threads);
    const board = await restarted.call('board');
    expect(board.runningAgents).toBe(2);
  });
  it('surfaces a worker approval while other work remains active', async () => {
    const h = await harness(); const task = await h.setupTask();
    const worker = await h.tool('agents_spawn_worker', task.threadId, workerInput('first'));
    h.patch(worker.threadId, { hasPendingInteraction: true }); await h.event('interaction.pending', worker.threadId);
    expect(await h.boardTask(task.taskId)).toMatchObject({ state: 'needs-you', ask: 'Answer a question', pendingWorkers: [{ threadId: worker.threadId, title: 'Worker' }] });
    h.patch(worker.threadId, { hasPendingInteraction: false });
    expect(await h.boardTask(task.taskId)).toMatchObject({ state: 'running', pendingWorkers: [] });
  });
  it('clears an explicit review request when the user resumes the leader', async () => {
    const h = await harness(); const task = await h.setupTask();
    h.bb.sdk.plugins.callRpc.mockResolvedValueOnce({ phases: { [task.threadId]: { kind: 'needs-you', reason: 'Pick direction' } } });
    expect(await h.boardTask(task.taskId)).toMatchObject({ state: 'needs-you', ask: 'Pick direction' });
    await h.event('thread.active', task.threadId);
    expect(await h.boardTask(task.taskId)).toMatchObject({ state: 'running', ask: null });
  });
  it('snoozes without stopping, expires automatically, and reopens the same thread', async () => {
    const h = await harness(); const task = await h.setupTask();
    await h.call('snoozeTask', { taskId: task.taskId, until: null });
    expect(await h.boardTask(task.taskId)).toMatchObject({ state: 'snoozed', snoozeUntil: null });
    expect(h.threadApi.stop).not.toHaveBeenCalled(); expect(h.threadApi.archive).not.toHaveBeenCalled();
    await h.call('reopenTask', { taskId: task.taskId });
    expect(await h.boardTask(task.taskId)).toMatchObject({ state: 'running', threadId: task.threadId });
    const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      await h.call('snoozeTask', { taskId: task.taskId, until: now + 1000 }); clock.mockReturnValue(now + 1001); h.patch(task.threadId, {});
      expect(await h.boardTask(task.taskId)).toMatchObject({ state: 'running', snoozeUntil: null });
    } finally { clock.mockRestore(); }
    expect(h.threadApi.spawn).toHaveBeenCalledTimes(2);
  });
  it('blocks completion during native background work and pending approval', async () => {
    const h = await harness(); const task = await h.setupTask();
    h.patch(task.threadId, { status: 'idle', activity: { activeBackgroundAgentCount: 2 } });
    h.threadApi.events.list.mockImplementation(async ({ threadId, afterSeq }: any) => threadId === task.threadId ? [1, 2].filter(seq => seq > Number(afterSeq)).map(seq => ({ seq, type: 'item/backgroundTask/progress', data: { providerThreadId: 'session', item: { type: 'backgroundTask', id: `paused-${seq}`, familyId: `family-${seq}`, taskType: 'local_agent', taskStatus: 'paused', status: 'pending', foreground: false, skipTranscript: false } } })) : []);
    await expect(h.call('completeTask', { taskId: task.taskId })).rejects.toThrow();
    h.patch(task.threadId, { activity: { activeBackgroundAgentCount: 0 }, hasPendingInteraction: true });
    await expect(h.call('completeTask', { taskId: task.taskId })).rejects.toThrow();
    expect(h.threadApi.archive).not.toHaveBeenCalled();
  });
  it('does not republish unchanged deleted-lead state on every board refresh', async () => {
    const h = await harness(); const task = await h.setupTask();
    h.patch(task.threadId, { deletedAt: Date.now() });
    expect(await h.boardTask(task.taskId)).toMatchObject({ state: 'needs-you', ask: 'Task conversation was deleted' });
    const publishes = h.bb.realtime.publish.mock.calls.length;
    await h.call('board'); await h.call('board');
    expect(h.bb.realtime.publish).toHaveBeenCalledTimes(publishes);
  });
  it('finds automation-reactivated completed tasks after plugin restart without an event', async () => {
    const h = await harness(); const task = await h.setupTask();
    h.patch(task.threadId, { status: 'idle' });
    await h.call('completeTask', { taskId: task.taskId });
    h.patch(task.threadId, { archivedAt: null, status: 'active' });
    const restarted = await harness(2, h.storage, h.threads);
    expect(await restarted.boardTask(task.taskId)).toMatchObject({ state: 'running', threadId: task.threadId });
    expect(restarted.threadApi.spawn).not.toHaveBeenCalled();
  });
  it('archives completed conversations and restores them without deleting runtime history', async () => {
    const h = await harness(); const task = await h.setupTask();
    const worker = await h.tool('agents_spawn_worker', task.threadId, workerInput('first'));
    await expect(h.call('completeTask', { taskId: task.taskId })).rejects.toThrow('still running');
    h.patch(task.threadId, { status: 'idle' }); h.patch(worker.threadId, { status: 'idle' });
    await h.call('completeTask', { taskId: task.taskId });
    expect(await h.boardTask(task.taskId)).toMatchObject({ state: 'done' });
    expect(h.threadApi.archive).toHaveBeenCalledTimes(2);
    await h.tool('agents_reopen_task', task.coordinatorId, { taskId: task.taskId, prompt: 'Another pass' });
    expect(h.threadApi.send).toHaveBeenCalledWith(expect.objectContaining({ threadId: task.threadId, senderThreadId: task.coordinatorId }));
    expect(await h.boardTask(task.taskId)).toMatchObject({ state: 'running', threadId: task.threadId });
    expect(h.threadApi.stop).not.toHaveBeenCalled(); expect(h.threadApi.delete).not.toHaveBeenCalled();
    expect(h.threadApi.spawn).toHaveBeenCalledTimes(3);
  });
});

describe('agent session configuration', () => {
  it('adds role-specific instructions without overriding BB permissions or memory', async () => {
    const h = await harness();
    await h.call('saveAgent', { id: 'general', name: 'General', instructions: 'Use our review checklist.' });
    const task = await h.setupTask();
    const worker = await h.tool('agents_spawn_worker', task.threadId, workerInput('first'));
    const coordinator = h.session(task.coordinatorId);
    expect(coordinator.tools).toEqual(['agents_create_task', 'agents_list_tasks', 'agents_manage_agent', 'agents_reopen_task']);
    expect(h.session(task.threadId).tools).toContain('agents_update_task_details');
    expect(h.session(worker.threadId).tools).not.toContain('agents_update_task_details');
    for (const threadId of [task.coordinatorId, task.threadId, worker.threadId]) {
      const config = h.session(threadId);
      expect(config.instructions).toContain('global and relevant project memories');
      expect(config.instructions).toContain('Use our review checklist.');
      expect(config).not.toHaveProperty('permissionMode'); expect(config).not.toHaveProperty('model');
      expect(h.threadApi.spawn.mock.calls.find(([options]) => options.title === `Agents launch ${h.threads.get(threadId)!.pluginMetadata.launchId}`)![0]).not.toHaveProperty('permissionMode');
    }
  });
});

describe('existing BB conversations', () => {
  function existing(h: Awaited<ReturnType<typeof harness>>, id: string, patch: Partial<FakeThread> = {}) {
    h.threads.set(id, { id, title: `Existing ${id}`, projectId: 'project', environmentId: 'environment', status: 'idle', archivedAt: null, deletedAt: null, hasPendingInteraction: false, queuedWork: 'none', activity: { activeBackgroundAgentCount: 0 }, pluginMetadata: {}, visibility: 'visible', updatedAt: 100, ...patch });
    h.patch(id, {});
  }
  it('shows every open root across pages without changing its thread or injecting instructions', async () => {
    const h = await harness();
    for (let i = 0; i < 103; i++) existing(h, `existing-${i}`);
    existing(h, 'archived', { archivedAt: 1 }); existing(h, 'hidden', { visibility: 'hidden' });
    const board = await h.call('board');
    expect(board.tasks).toHaveLength(103);
    expect(board.tasks[0]).toMatchObject({ source: 'existing', execution: null, state: 'queued' });
    expect(h.session('existing-0')).toEqual({ tools: [], skills: [] });
    expect(h.threadApi.spawn).not.toHaveBeenCalled(); expect(h.threadApi.send).not.toHaveBeenCalled(); expect(h.threadApi.archive).not.toHaveBeenCalled();
    const publishes = h.bb.realtime.publish.mock.calls.length;
    await h.call('board'); expect(h.bb.realtime.publish).toHaveBeenCalledTimes(publishes);
  });
  it('groups descendants, excludes standing coordinators, and promotes visible orphan roots', async () => {
    const h = await harness(); const managed = await h.setupTask();
    existing(h, 'root', { status: 'active' });
    existing(h, 'child', { parentThreadId: 'root', status: 'active', visibility: 'hidden' });
    existing(h, 'grandchild', { parentThreadId: 'child', hasPendingInteraction: true });
    existing(h, 'orphan', { parentThreadId: 'missing' });
    existing(h, 'hidden-parent', { visibility: 'hidden' }); existing(h, 'visible-child', { parentThreadId: 'hidden-parent' });
    const board = await h.call('board');
    expect(board.tasks.map((t: any) => t.threadId).sort()).toEqual([managed.threadId, 'root', 'orphan', 'visible-child'].sort());
    expect(board.tasks.find((t: any) => t.threadId === 'root')).toMatchObject({ runningAgents: 2, state: 'needs-you', pendingWorkers: [{ threadId: 'grandchild', title: 'Existing grandchild' }] });
  });
  it('uses fresh public progress cards and real errors, never guessing attention from idle', async () => {
    const h = await harness();
    for (const id of ['review', 'waiting', 'running', 'done', 'idle', 'stale', 'error']) existing(h, id);
    h.patch('error', { status: 'error' });
    h.bb.sdk.plugins.callRpc.mockResolvedValue({ phases: {
      review: { kind: 'needs-you', reason: 'pick design' },
      waiting: { kind: 'needs-you', reason: 'add key' },
      running: { kind: 'running', reason: 'CI', etaAt: 999999, since: 1 },
      done: { kind: 'done', unread: true },
      error: { kind: 'failed', reason: 'Check failed work' },
    } });
    const byId = Object.fromEntries((await h.call('board')).tasks.map((t: any) => [t.threadId, t]));
    expect(byId.review).toMatchObject({ state: 'needs-you', ask: 'pick design' });
    expect(byId.waiting).toMatchObject({ state: 'needs-you', ask: 'add key' });
    expect(byId.running).toMatchObject({ state: 'running', etaAt: 999999 });
    expect(byId.done.state).toBe('done'); expect(byId.idle.state).toBe('queued'); expect(byId.stale.state).toBe('queued');
    expect(byId.error).toMatchObject({ state: 'needs-you', ask: 'Check failed work' });
    h.bb.sdk.plugins.callRpc.mockRejectedValue(new Error('Plugin unavailable')); h.patch('review', {});
    await expect(h.boardTask('existing:review')).rejects.toThrow('Plugin unavailable');
  });
  it('snoozes, completes, and reopens the original conversation, preserving its identity', async () => {
    const h = await harness(); existing(h, 'original'); await h.call('board');
    await h.call('snoozeTask', { taskId: 'existing:original', until: null });
    expect(await h.boardTask('existing:original')).toMatchObject({ state: 'snoozed' });
    await h.call('reopenTask', { taskId: 'existing:original' });
    await h.call('completeTask', { taskId: 'existing:original' });
    expect(h.threadApi.archive).toHaveBeenCalledWith({ threadId: 'original' });
    expect(await h.boardTask('existing:original')).toMatchObject({ state: 'done' });
    await h.call('reopenTask', { taskId: 'existing:original' });
    expect(await h.boardTask('existing:original')).toMatchObject({ threadId: 'original', state: 'needs-you' });
    expect(h.threadApi.spawn).not.toHaveBeenCalled(); expect(h.threadApi.delete).not.toHaveBeenCalled();
  });
  it('keeps a fresh user ask visible while descendants and background agents continue', async () => {
    const h = await harness(); existing(h, 'root', { activity: { activeBackgroundAgentCount: 2 } });
    existing(h, 'child', { parentThreadId: 'root', status: 'active' });
    h.bb.sdk.plugins.callRpc.mockResolvedValue({ phases: { root: { kind: 'needs-you', reason: 'pick direction' } } });
    expect(await h.boardTask('existing:root')).toMatchObject({ state: 'needs-you', ask: 'pick direction', runningAgents: 1 });
    h.bb.sdk.plugins.callRpc.mockResolvedValue({ phases: { root: { kind: 'running', reason: 'Working', etaAt: 999999, since: 1 } } });
    h.patch('root', { status: 'active' });
    expect(await h.boardTask('existing:root')).toMatchObject({ state: 'running', ask: null });
  });
  it('serializes a projection rename against a concurrent user snooze', async () => {
    const h = await harness(); existing(h, 'root'); await h.call('board');
    const save = h.bb.storage.kv.set;
    let started!: () => void; let resume!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    let once = true;
    h.bb.storage.kv.set = async (key, value: any) => {
      if (key === 'task:existing:root' && value.title === 'Renamed' && once) { once = false; started(); await gate; }
      await save(key, value);
    };
    h.patch('root', { title: 'Renamed' });
    const refresh = h.call('board'); await entered;
    const snooze = h.call('snoozeTask', { taskId: 'existing:root', until: null });
    resume(); await Promise.all([refresh, snooze]);
    expect(await h.boardTask('existing:root')).toMatchObject({ state: 'snoozed', title: 'Renamed' });
  });
  it('does not resurrect a task from a snapshot taken before user completion', async () => {
    const h = await harness(); existing(h, 'root'); await h.call('board');
    const list = h.threadApi.list.getMockImplementation()!;
    h.threadApi.list.mockImplementation(async args => structuredClone(await list(args)));
    let entered!: () => void; let resume!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    h.bb.sdk.plugins.callRpc.mockImplementationOnce(async () => { entered(); await gate; return { phases: {} }; });
    h.patch('root', { title: 'Renamed' });
    const refresh = h.call('board'); await started;
    await h.call('completeTask', { taskId: 'existing:root' });
    resume(); const board = await refresh;
    expect(board.tasks.find((t: any) => t.threadId === 'root').state).toBe('done');
    expect(await h.boardTask('existing:root')).toMatchObject({ state: 'done' });
  });
  it('coalesces refreshes and does not rescan known archived projections', async () => {
    const h = await harness(); existing(h, 'root'); existing(h, 'open');
    const before = h.bb.realtime.publish.mock.calls.length;
    await h.call('board'); expect(h.bb.realtime.publish.mock.calls.length - before).toBe(1);
    const scans = () => h.threadApi.list.mock.calls.filter(([args]) => !args.threadIds && !args.archived).length;
    const first = scans(); await h.call('board'); await h.call('board'); expect(scans()).toBe(first);
    await h.call('completeTask', { taskId: 'existing:root' }); await h.call('board');
    h.threadApi.list.mockClear(); h.patch('open', {}); await h.call('board');
    expect(h.threadApi.list.mock.calls.some(([args]) => args.archived && args.threadIds?.includes('root'))).toBe(false);
    h.patch('root', { archivedAt: null, status: 'active' });
    expect(await h.boardTask('existing:root')).toMatchObject({ state: 'running', threadId: 'root' });
  });
  it('keeps an explicitly reopened completed conversation visible after restart', async () => {
    const h = await harness(); existing(h, 'root');
    h.bb.sdk.plugins.callRpc.mockResolvedValue({ phases: { root: { kind: 'done', unread: false } } });
    expect(await h.boardTask('existing:root')).toMatchObject({ state: 'done' });
    await h.call('reopenTask', { taskId: 'existing:root' });
    expect(await h.boardTask('existing:root')).toMatchObject({ state: 'needs-you', ask: 'Continue task' });
    const restarted = await harness(2, h.storage, h.threads);
    expect(await restarted.boardTask('existing:root')).toMatchObject({ state: 'needs-you', ask: 'Continue task' });
    expect(h.threadApi.spawn).not.toHaveBeenCalled();
  });
  it('updates titles and grouping after external reparenting and removes deleted projections only', async () => {
    const h = await harness(); existing(h, 'a'); existing(h, 'b'); await h.call('board');
    h.patch('b', { parentThreadId: 'a' }); h.patch('a', { title: 'Renamed', updatedAt: 200 });
    let board = await h.call('board'); expect(board.tasks).toHaveLength(1); expect(board.tasks[0].title).toBe('Renamed');
    h.patch('a', { deletedAt: 200 });
    board = await h.call('board'); expect(board.tasks.map((t: any) => t.threadId)).toEqual(['b']);
    expect(h.threadApi.delete).not.toHaveBeenCalled();
  });
});


describe('private avatar pool', () => {
  const pool = ['data:image/webp;base64,YQ==', 'data:image/png;base64,Yg=='];
  it('assigns unused portraits concurrently, balances reuse, and persists through reload', async () => {
    const h = await harness(2, new Map([['avatar-pool', pool]]));
    const [a, b] = await Promise.all(['One', 'Two'].map(name => h.call('saveAgent', { name })));
    expect([a.avatar, b.avatar]).toEqual(pool);
    const restarted = await harness(2, h.storage, h.threads);
    expect((await restarted.call('saveAgent', { name: 'Three', avatar: '' })).avatar).toBe(pool[0]);
    expect((await restarted.call('board')).agents.find((agent: any) => agent.id === a.id).avatar).toBe(a.avatar);
  });
  it('preserves custom and existing avatars, including omitted avatars on edits and explicit clearing', async () => {
    const h = await harness(2, new Map([['avatar-pool', pool]]));
    const custom = await h.call('saveAgent', { name: 'Custom', avatar: '🐱' });
    expect(custom.avatar).toBe('🐱');
    expect((await h.call('saveAgent', { id: custom.id, name: 'Renamed' })).avatar).toBe('🐱');
    expect((await h.call('saveAgent', { id: custom.id, name: 'Cleared', avatar: '' })).avatar).toBe('');
    expect((await h.call('saveAgent', { id: 'general', name: 'General' })).avatar).toBe('');
  });
  it('keeps initials when the pool is absent or malformed', async () => {
    for (const value of [undefined, ['https://example.test/avatar.png'], Array(17).fill(pool[0]), ['data:image/webp;base64,' + 'A'.repeat(150001)]]) {
      const h = await harness(2, new Map([['avatar-pool', value]]));
      expect((await h.call('saveAgent', { name: 'Fallback' })).avatar).toBe('');
    }
  });
});

describe('coordinator avatar persistence', () => {
  it('keeps an avatar edit while the coordinator conversation is being remembered', async () => {
    const h = await harness();
    const agent = await h.call('saveAgent', { name: 'Review', avatar: 'old' });
    const originalSet = h.bb.storage.kv.set;
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    h.bb.storage.kv.set = async (key, value: any) => {
      if (key === `agent:${agent.id}` && value.threadId) { entered(); await blocked; }
      return originalSet(key, value);
    };
    const opening = h.call('openAgent', { agentId: agent.id });
    await waiting;
    const editing = h.call('saveAgent', { id: agent.id, name: 'Review', avatar: 'new' });
    await new Promise(resolve => setImmediate(resolve));
    release();
    await Promise.all([opening, editing]);
    expect((h.storage.get(`agent:${agent.id}`) as any).avatar).toBe('new');
  });
});

it('refreshes archived managed descendants through idle, restart, deletion and plugin restart', async () => {
  const h = await harness(); const task = await h.setupTask();
  const worker = await h.tool('agents_spawn_worker', task.threadId, workerInput('review-worker'));
  h.patch(task.coordinatorId, { status: 'idle' });
  h.patch(task.threadId, { status: 'idle', archivedAt: 1 });
  expect((await h.call('board')).runningAgents).toBe(1);
  h.patch(worker.threadId, { status: 'idle' }); await h.event('thread.idle', worker.threadId);
  expect((await h.call('board')).runningAgents).toBe(0);
  h.patch(worker.threadId, { status: 'active' }); await h.event('thread.active', worker.threadId);
  expect((await h.call('board')).runningAgents).toBe(1);
  const restarted = await harness(2, h.storage, h.threads);
  expect((await restarted.call('board')).runningAgents).toBe(1);
  restarted.patch(task.threadId, { deletedAt: 2 }); await restarted.event('thread.deleted', task.threadId);
  expect((await restarted.call('board')).runningAgents).toBe(1);
  restarted.patch(worker.threadId, { deletedAt: 3 }); await restarted.event('thread.deleted', worker.threadId);
  expect((await restarted.call('board')).runningAgents).toBe(0);
  expect((await restarted.boardTask(task.taskId)).runningAgents).toBe(0);
});
it('counts native work while its BB owner is idle, retains Sidebar phase/ETA and exposes read failures', async () => {
  const h = await harness(); const task = await h.setupTask();
  h.patch(task.coordinatorId, { status: 'idle' }); h.patch(task.threadId, { status: 'idle' });
  const nativeEvent = { seq: 1, type: 'item/started', data: { providerThreadId: 'session', item: { type: 'delegation', id: 'call', childRef: 'child', status: 'pending' } } };
  h.threadApi.events.list.mockImplementation(async ({ threadId, afterSeq }: any) => threadId === task.threadId && Number(afterSeq) < 1 ? [nativeEvent] : []);
  expect((await h.call('board')).runningAgents).toBe(1);
  const row = await h.boardTask(task.taskId); expect(row.state).toBe('needs-you'); expect(row.etaAt).toBeNull();
  h.threadApi.events.list.mockRejectedValueOnce(new Error('offline')); await h.event('thread.idle', task.threadId);
  expect((await h.call('board')).runningAgents).toBeNull();
  await h.event('thread.idle', task.threadId); expect((await h.call('board')).runningAgents).toBe(1);
});
it('REVIEW settled managed history is queried on every refresh',async()=>{
 const h=await harness(); const made=[];
 for(let i=0;i<20;i++) { const task=await h.setupTask(`old-${i}`);made.push(task);h.patch(task.threadId,{status:'idle',archivedAt:1});h.patch(task.coordinatorId,{status:'idle'}); }
 for (let i = 0; i < 4; i++) { await h.event('thread.idle',made[0].coordinatorId); await h.call('board'); }
 h.threadApi.events.list.mockClear();h.threadApi.experimental_listDescendants.mockClear();h.threadApi.list.mockClear();
 await h.event('thread.idle',made[0].coordinatorId);
 const board=await h.call('board');
 const counts={global:board.runningAgents,eventCalls:h.threadApi.events.list.mock.calls.length,descendantCalls:h.threadApi.experimental_listDescendants.mock.calls.length,listCalls:h.threadApi.list.mock.calls.length};
 console.log('Settled managed census polling',JSON.stringify(counts));
 expect(counts.eventCalls).toBe(1);expect(counts.descendantCalls).toBe(0);expect(counts.listCalls).toBe(2);
});
it('REVIEW archived ordinary root keeps a hidden active descendant counted',async()=>{
 const h=await harness();
 const base:any={title:'Existing',projectId:'project',environmentId:'environment',status:'idle',archivedAt:null,deletedAt:null,hasPendingInteraction:false,queuedWork:'none',activity:{activeBackgroundAgentCount:0},pluginMetadata:{},visibility:'visible',updatedAt:100};
 h.threads.set('root',{...base,id:'root'});
 h.threads.set('hidden',{...base,id:'hidden',parentThreadId:'root',visibility:'hidden',status:'active'});
 expect((await h.call('board')).runningAgents).toBe(1);
 h.patch('root',{archivedAt:1});await h.event('thread.archived','root');
 expect((await h.call('board')).runningAgents).toBe(1);
});

it('retains ordinary hidden ownership after root deletion, restart and latent worker resume', async () => {
 const h = await harness();
 const base: any = { title: 'Existing', projectId: 'project', environmentId: 'environment', status: 'idle', archivedAt: null, deletedAt: null, hasPendingInteraction: false, queuedWork: 'none', activity: { activeBackgroundAgentCount: 0 }, pluginMetadata: {}, visibility: 'visible', updatedAt: 100 };
 h.threads.set('root', { ...base, id: 'root' });
 h.threads.set('hidden', { ...base, id: 'hidden', parentThreadId: 'root', visibility: 'hidden', status: 'active' });
 expect((await h.call('board')).runningAgents).toBe(1);
 h.patch('root', { deletedAt: 1 });
 expect((await h.call('board')).runningAgents).toBe(1);
 h.patch('hidden', { status: 'idle' }); expect((await h.call('board')).runningAgents).toBe(0);
 const restarted = await harness(2, h.storage, h.threads);
 restarted.patch('hidden', { status: 'active' });
 expect((await restarted.call('board')).runningAgents).toBe(1);
 expect(restarted.threadApi.experimental_listDescendants).not.toHaveBeenCalled();
});
it('continues fairly without board calls, bounds each slice and restores warm cursors', async () => {
 vi.useFakeTimers();
 try {
  const h = await harness();
  const base: any = { title: 'Existing', projectId: 'project', environmentId: 'environment', status: 'idle', archivedAt: null, deletedAt: null, hasPendingInteraction: false, queuedWork: 'none', activity: { activeBackgroundAgentCount: 0 }, pluginMetadata: {}, visibility: 'visible', updatedAt: 100 };
  for (let i = 0; i < 20; i++) h.threads.set(`root${i}`, { ...base, id: `root${i}` });
  h.threadApi.events.list.mockImplementation(async ({ afterSeq, limit }: any) => Array.from({ length: Math.min(Number(limit), 300 - Number(afterSeq)) }, (_, i) => ({ seq: Number(afterSeq) + i + 1, type: 'item/started', data: { item: { type: 'tool' }, providerThreadId: 's' } })));
  expect((await h.call('board')).runningAgents).toBeNull();
  expect(h.threadApi.events.list.mock.calls.length).toBeLessThanOrEqual(8);
  const tickReads: number[] = [];
  for (let i = 0; i < 20; i++) {
    const before = h.threadApi.events.list.mock.calls.length + h.threadApi.list.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    tickReads.push(h.threadApi.events.list.mock.calls.length + h.threadApi.list.mock.calls.length - before);
  }
  expect(Math.max(...tickReads)).toBeLessThanOrEqual(16);
  console.log('Fair census tick SDK reads', JSON.stringify(tickReads));
  const calls = h.threadApi.events.list.mock.calls;
  expect(new Set(calls.map(([args]) => args.threadId)).size).toBe(20);
  expect((await h.call('board')).runningAgents).toBe(0);
  const restarted = await harness(2, h.storage, h.threads);
  await restarted.call('board');
  expect(restarted.threadApi.events.list.mock.calls.every(([args]) => args.afterSeq === '300')).toBe(true);
 } finally { vi.useRealTimers(); }
});

it('does not retry or log singleton overflow repeatedly, including after checkpoint reload', async () => {
 vi.useFakeTimers();
 try {
  const h = await harness(); const task = await h.setupTask();
  h.threadApi.events.list.mockRejectedValue(Object.assign(new Error('oversized'), { code: 'event_data_too_large' }));
  await h.call('board'); await vi.advanceTimersByTimeAsync(1000);
  const calls = h.threadApi.events.list.mock.calls.length;
  const warnings = h.bb.log.warn.mock.calls.length;
  expect(warnings).toBe(2); expect(calls).toBe(14);
  await vi.advanceTimersByTimeAsync(30000); await h.call('board');
  expect(h.threadApi.events.list.mock.calls.length).toBe(calls);
  expect(h.bb.log.warn.mock.calls.length).toBe(warnings);
  const restarted = await harness(2, h.storage, h.threads);
  expect((await restarted.call('board')).runningAgents).toBeNull();
  expect(restarted.threadApi.events.list).not.toHaveBeenCalled();
  expect((await restarted.boardTask(task.taskId)).runningAgents).toBeNull();
 } finally { vi.useRealTimers(); }
});

it('excludes an unrelated archived singleton error but preserves known archived native ownership', async () => {
 const h = await harness();
 const base: any = { title: 'Existing', projectId: 'project', environmentId: 'environment', status: 'idle', archivedAt: null, deletedAt: null, hasPendingInteraction: false, queuedWork: 'none', activity: { activeBackgroundAgentCount: 0 }, pluginMetadata: {}, visibility: 'visible', updatedAt: 100 };
 h.threads.set('known', { ...base, id: 'known' });
 h.threads.set('unrelated', { ...base, id: 'unrelated', archivedAt: 1 });
 const list = async ({threadId, afterSeq}: any) => {
   if (threadId === 'unrelated') throw Object.assign(new Error('oversized'), {code:'event_data_too_large'});
   return Number(afterSeq) ? [] : [{ seq: 1, type: 'item/started', data: { providerThreadId: 's', item: { type: 'delegation', id: 'call', childRef: 'native', status: 'pending' } } }];
 };
 h.threadApi.events.list.mockImplementation(list);
 expect((await h.call('board')).runningAgents).toBe(1);
 h.patch('known', { archivedAt: 1 }); expect((await h.call('board')).runningAgents).toBe(1);
 const warm = await harness(2,h.storage,h.threads); warm.threadApi.events.list.mockImplementation(list);
 expect((await warm.call('board')).runningAgents).toBe(1);
 expect(warm.threadApi.events.list.mock.calls.some(([args])=>args.threadId==='unrelated')).toBe(false);
});
it('keeps the previous atomic checkpoint if publishing the replacement fails', async () => {
 const h = await harness(); const task = await h.setupTask();
 await h.call('board');
 const before = structuredClone([...h.storage]);
 const set = h.bb.storage.kv.set;
 h.bb.storage.kv.set = async (key, value) => {
   if (key === `census:${task.threadId}`) throw new Error('simulated interrupted manifest commit');
   await set(key, value);
 };
 h.threadApi.events.list.mockImplementation(async ({threadId}: any) => threadId === task.threadId ? [{ seq: 5, type: 'item/started', data: { providerThreadId: 's', item: { type: 'delegation', id: 'call', childRef: 'native', status: 'pending' } } }] : []);
 await h.event('thread.idle', task.threadId);
 await expect(h.call('board')).rejects.toThrow('interrupted manifest');
 expect(h.storage.get(`census:${task.threadId}`)).toEqual(new Map(before).get(`census:${task.threadId}`));
 const restarted = await harness(2, h.storage, h.threads);
 await restarted.call('board');
 expect(restarted.threadApi.events.list.mock.calls.find(([args]) => args.threadId === task.threadId)?.[0].afterSeq).toBe('0');
});
it('stops admitting census reads at the global time budget', async () => {
 vi.useFakeTimers();
 try {
  const h = await harness(); const task = await h.setupTask();
  const started = Date.now();
  h.threadApi.events.list.mockImplementation(async ({afterSeq}: any) => {
    vi.setSystemTime(Date.now() + 90);
    return Array.from({length:100}, (_, i) => ({seq:Number(afterSeq)+i+1,type:'item/started',data:{item:{type:'tool'},providerThreadId:'s'}}));
  });
  const board = await h.call('board');
  expect(board.runningAgents).toBeNull();
  expect(h.threadApi.events.list.mock.calls).toHaveLength(3);
  expect(Date.now()-started).toBe(270); // No fourth read admitted after 250ms.
  expect(h.threadApi.events.list.mock.calls.every(([args]) => args.signal instanceof AbortSignal)).toBe(true);
  expect(h.threadApi.events.list.mock.calls.some(([args]) => args.threadId === task.threadId)).toBe(true);
 } finally { vi.useRealTimers(); }
});
it('INDEPENDENT inventory must not discard an invalidation received during its scan',async()=>{
 const h=await harness();
 const list=h.threadApi.list.getMockImplementation()!;
 h.threadApi.list.mockImplementation(async(args:any)=>{
   if(args.archived && !h.threads.has('new-worker')) {
     h.threads.set('new-worker',{id:'new-worker',title:'New',projectId:'project',environmentId:'environment',status:'active',archivedAt:null,deletedAt:null,hasPendingInteraction:false,queuedWork:'none',activity:{activeBackgroundAgentCount:0},pluginMetadata:{},visibility:'visible'});
     await h.event('thread.created','new-worker');
   }
   return list(args);
 });
 const board=await h.call('board');
 expect(board.runningAgents).not.toBe(0); // Either unknown, or fresh and counted.
});
it('INDEPENDENT disposal must stop continuation after an in-flight event read',async()=>{
 const h=await harness();await h.setupTask();
 let release!:()=>void;let entered!:()=>void;
 const ready=new Promise<void>(r=>entered=r);const wait=new Promise<void>(r=>release=r);
 h.threadApi.events.list.mockImplementationOnce(async()=>{entered();await wait;return [];});
 const board=h.call('board');await ready;
 for(const dispose of cleanups.splice(0))dispose();
 const writes=vi.spyOn(h.bb.storage.kv,'set');release();await board;
 expect(writes).not.toHaveBeenCalled();
});
it('INDEPENDENT deleted incomplete census must not keep the 100ms pump hot',async()=>{
 vi.useFakeTimers();try{
 const h=await harness();const task=await h.setupTask();
 h.threadApi.events.list.mockImplementation(async({threadId}:any)=>{if(threadId===task.threadId)throw new Error('offline');return [];});
 await h.call('board');h.patch(task.threadId,{deletedAt:1});await h.event('thread.deleted',task.threadId);await h.call('board');
 h.bb.realtime.publish.mockClear();
 await vi.advanceTimersByTimeAsync(1000);
 console.log('Deleted incomplete owner publishes in 1 second',h.bb.realtime.publish.mock.calls.length);
 expect(h.bb.realtime.publish.mock.calls.length).toBeLessThan(3);
 }finally{vi.useRealTimers();}
});
it('INDEPENDENT failed checkpoint publications must not leak generations',async()=>{
 const h=await harness();const task=await h.setupTask();await h.call('board');
 const set=h.bb.storage.kv.set;let seq=0;
 h.bb.storage.kv.set=async(key,value)=>{if(key===`census:${task.threadId}`)throw new Error('manifest fail');await set(key,value);};
 h.threadApi.events.list.mockImplementation(async({threadId}:any)=>threadId===task.threadId?[{seq:++seq,type:'item/started',data:{providerThreadId:'s',item:{type:'delegation',id:`call${seq}`,childRef:`child${seq}`,status:'completed'}}}]:[]);
 for(let i=0;i<3;i++){await h.event('thread.idle',task.threadId);await expect(h.call('board')).rejects.toThrow('manifest fail');}
 const chunkKeys=[...h.storage.keys()].filter(key=>key.startsWith(`census-chunk:${task.threadId}:`));
 console.log('Retained chunk generations after three manifest failures',chunkKeys.length);
 expect(chunkKeys.length).toBe(1);
});
it('INDEPENDENT warm restart must verify every checkpoint tail before asserting global count',async()=>{
 const h=await harness();
 const base:any={title:'Existing',projectId:'project',environmentId:'environment',status:'idle',archivedAt:null,deletedAt:null,hasPendingInteraction:false,queuedWork:'none',activity:{activeBackgroundAgentCount:0},pluginMetadata:{},visibility:'visible',updatedAt:100};
 for(let i=0;i<20;i++)h.threads.set(`root${i}`,{...base,id:`root${i}`});
 for(let i=0;i<4;i++){await h.event('thread.idle','root0');await h.call('board');}
 const warm=await harness(2,h.storage,h.threads);
 warm.threadApi.events.list.mockImplementation(async({threadId}:any)=>threadId==='root19'?[{seq:1,type:'item/started',data:{providerThreadId:'s',item:{type:'delegation',id:'call',childRef:'child',status:'pending'}}}]:[]);
 const board=await warm.call('board');
 expect(warm.threadApi.events.list.mock.calls.some(([args])=>args.threadId==='root19')).toBe(false);
 expect(board.runningAgents).not.toBe(0);
});
it('FINAL independent coalescing must deliver the final caught-up change within one second',async()=>{
 vi.useFakeTimers();try{
 const h=await harness();const task=await h.setupTask();
 h.threadApi.events.list.mockImplementation(async({threadId,afterSeq,limit}:any)=>threadId===task.threadId?Array.from({length:Math.min(Number(limit),2400-Number(afterSeq))},(_,i)=>({seq:Number(afterSeq)+i+1,type:'item/started',data:{providerThreadId:'s',item:{type:'tool'}}})):[]);
 await h.call('board');h.bb.realtime.publish.mockClear();
 await vi.advanceTimersByTimeAsync(1100);
 // The first notice occurred during catch-up; a second must expose completion.
 expect(h.bb.realtime.publish.mock.calls.length).toBe(2);
 expect((await h.call('board')).runningAgents).not.toBeNull();
 }finally{vi.useRealTimers();}
});
it('FINAL independent invalidation during projection must withhold stale global certainty',async()=>{
 const h=await harness();
 h.bb.sdk.projects.list.mockImplementationOnce(async()=>{
 h.threads.set('new',{id:'new',title:'New',projectId:'project',environmentId:'environment',status:'active',archivedAt:null,deletedAt:null,hasPendingInteraction:false,queuedWork:'none',activity:{activeBackgroundAgentCount:0},pluginMetadata:{},visibility:'visible'});
 await h.event('thread.created','new');return [];
 });
 expect((await h.call('board')).runningAgents).not.toBe(0);
});
it('STARTUP independent disposal during checkpoint enumeration must stop initialization',async()=>{
 vi.useFakeTimers();try{
 let release!:()=>void;let entered!:()=>void;let bb:any;
 const ready=new Promise<void>(r=>entered=r);const wait=new Promise<void>(r=>release=r);
 const storage=new Map<string,unknown>([['census-chunk:deleted:orphan:0','unused']]);
 const starting=harness(2,storage,new Map(),value=>{
 bb=value;const list=bb.storage.kv.list;let blocked=false;
 bb.storage.kv.list=async(prefix:string)=>{if(prefix==='census:'&&!blocked){blocked=true;entered();await wait;}return list(prefix);};
 vi.spyOn(bb.storage.kv,'set');vi.spyOn(bb.storage.kv,'delete');vi.spyOn(bb.rpc,'register');
 });
 await ready;for(const dispose of cleanups)dispose();release();await starting;
 console.log('STARTUP',JSON.stringify({writes:bb.storage.kv.set.mock.calls.map((c:any)=>c[0]),deletes:bb.storage.kv.delete.mock.calls.map((c:any)=>c[0]),rpcRegistrations:bb.rpc.register.mock.calls.length,timers:vi.getTimerCount()}));
 expect(bb.storage.kv.set).not.toHaveBeenCalled();expect(bb.storage.kv.delete).not.toHaveBeenCalled();expect(bb.rpc.register).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 }finally{for(const dispose of cleanups.splice(0))dispose();vi.useRealTimers();}
});

it('does not hydrate unrelated native checkpoint payloads and retires them to ancestry only', async () => {
 const h = await harness(); const task = await h.setupTask(); await h.call('board');
 const agent = h.storage.get('agent:general') as any;
 h.storage.set('agent:general', {...agent,threadId:null});
 h.storage.delete(`task:${task.taskId}`);
 for (const row of h.threads.values()) row.archivedAt=1;
 let get: any;
 const warm = await harness(2,h.storage,h.threads,bb=>{get=vi.spyOn(bb.storage.kv,'get');});
 expect(get.mock.calls.some(([key]:string[])=>key.startsWith('census-chunk:'))).toBe(false);
 expect((await warm.call('board')).runningAgents).toBe(0);
 expect(warm.threadApi.events.list).not.toHaveBeenCalled();
 expect(get.mock.calls.some(([key]:string[])=>key.startsWith('census-chunk:'))).toBe(false);
 expect([...h.storage.keys()].filter(key=>key.startsWith('census-chunk:'))).toHaveLength(0);
 expect((h.storage.get(`census:${task.threadId}`) as any).chunks).toBe(0);
});
it.each(['settings', 'avatar-pool'])('stops startup when disposed during the first %s read', async stage => {
 vi.useFakeTimers();
 try {
  let release!: () => void; let entered!: () => void; let bb: any;
  const ready = new Promise<void>(resolve => entered = resolve);
  const wait = new Promise<void>(resolve => release = resolve);
  const starting = harness(2, new Map(), new Map(), value => {
    bb = value;
    if (stage === 'settings') bb.settings.define = () => ({get: async () => {entered(); await wait; return {maxWorkers:2};}});
    else { const get = bb.storage.kv.get; bb.storage.kv.get = async (key: string) => {if(key==='avatar-pool'){entered(); await wait;} return get(key);}; }
    vi.spyOn(bb.storage.kv, 'set'); vi.spyOn(bb.rpc, 'register');
  });
  await ready; for (const dispose of cleanups) dispose(); release(); await starting;
  expect(bb.storage.kv.set).not.toHaveBeenCalled(); expect(bb.rpc.register).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
 } finally { for (const dispose of cleanups.splice(0)) dispose(); vi.useRealTimers(); }
});
it('FINAL independent unavailable owner invalidation must not keep pump hot forever',async()=>{
 vi.useFakeTimers();try{
 const h=await harness();const task=await h.setupTask();
 h.threadApi.events.list.mockImplementation(async({threadId}:any)=>{if(threadId===task.threadId)throw Object.assign(new Error('event_data_too_large'),{status:413});return [];});
 for(let i=0;i<8;i++)await h.call('board');
 await vi.advanceTimersByTimeAsync(2000);
 await h.event('thread.idle',task.threadId);await h.call('board');
 await vi.advanceTimersByTimeAsync(2000);h.bb.realtime.publish.mockClear();
 await vi.advanceTimersByTimeAsync(4000);
 expect(h.bb.realtime.publish.mock.calls.length).toBeLessThan(2);
 }finally{vi.useRealTimers();}
});
