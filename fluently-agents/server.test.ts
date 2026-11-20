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
  parentThreadId?: string; pluginMetadata: Record<string, string>;
};
const cleanups: (() => void)[] = [];
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

async function harness(maxWorkers = 2, seed = new Map<string, unknown>(), threads = new Map<string, FakeThread>()) {
  const storage = seed;
  const tools = new Map<string, { parameters: z.ZodType; execute: Handler }>();
  const events = new Map<string, Handler>();
  let rpc: Record<string, Handler> = {};
  let contract: Record<string, { input: z.ZodType }> = {};
  let configure: Handler = () => ({});
  let cli: Handler = () => ({});
  const project = { id: 'project', name: 'Project', kind: 'personal', gitRemoteUrl: 'git@example.test:repo.git' };
  const threadApi = {
    get: vi.fn(async ({ threadId }: { threadId: string }) => {
      const thread = threads.get(threadId); if (!thread) throw new Error('Thread not found'); return thread;
    }),
    spawn: vi.fn(async (options: any) => {
      const thread: FakeThread = {
        id: `thread-${threads.size + 1}`, title: options.title, projectId: options.projectId,
        environmentId: options.environment.environmentId ?? 'environment', status: 'active',
        archivedAt: null, deletedAt: null, hasPendingInteraction: false, queuedWork: 'none',
        activity: { activeBackgroundAgentCount: 0 }, parentThreadId: options.parentThreadId,
        pluginMetadata: options.pluginMetadata,
      };
      threads.set(thread.id, thread); return thread;
    }),
    list: vi.fn(async (options: any) => [...threads.values()].filter(thread =>
      (!options.threadIds || options.threadIds.includes(thread.id)) && Boolean(thread.archivedAt) === Boolean(options.archived)
    ).slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 100))),
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
      threads: threadApi,
      projects: { get: vi.fn(async ({ projectId }: { projectId: string }) => ({ ...project, id: projectId })), list: vi.fn(async () => [project]) },
      environments: { get: vi.fn(async ({ environmentId }: { environmentId: string }) => ({ id: environmentId, projectId: environmentId === 'wrong-project' ? 'other' : 'project' })) },
    },
    rpc: { register: (schema: typeof contract, handlers: typeof rpc) => { contract = schema; rpc = handlers; } },
    agents: { registerTool: (tool: any) => tools.set(tool.name, tool), configure: (callback: Handler) => { configure = callback; } },
    events: { on: (name: string, callback: Handler) => events.set(name, callback) },
    onDispose: (callback: () => void) => cleanups.push(callback), cli: { register: vi.fn((registration: { run: Handler }) => { cli = registration.run; }) },
  };
  await plugin(bb as unknown as BbPluginApi);
  async function call(name: string, input: unknown = null) { return rpc[name]!(contract[name]!.input.parse(input)); }
  async function tool(name: string, threadId: string, input: unknown) {
    const registered = tools.get(name)!;
    const output = await registered.execute(registered.parameters.parse(input), { threadId, projectId: 'project' });
    return JSON.parse(output.content[0].text);
  }
  async function event(name: string, threadId: string) { await events.get(name)!({ thread: threads.get(threadId)! }); }
  function patch(threadId: string, input: Partial<FakeThread>) { Object.assign(threads.get(threadId)!, input); }
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
    expect(options.visibility).toBe('hidden');
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
    await expect(h.tool('agents_update_task', worker.threadId, update)).rejects.toThrow('Only the task leader');
    await expect(h.tool('agents_update_task', task.coordinatorId, update)).rejects.toThrow('Only the task leader');
    await expect(h.tool('agents_update_task', task.threadId, { ...update, completed: 3 })).rejects.toThrow('cannot exceed');
    await expect(h.tool('agents_update_task', task.threadId, { ...update, state: 'needs-you' })).rejects.toThrow('Say what');
    await h.tool('agents_update_task', task.threadId, update);
    expect(await h.boardTask(task.taskId)).toMatchObject({ completed: 1, total: 2, state: 'running' });
  });
});

describe('task state and durable conversations', () => {
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
  it('counts native background work and descendants once in both card and board total', async () => {
    const h = await harness(); const task = await h.setupTask();
    h.patch(task.coordinatorId, { status: 'idle' });
    h.patch(task.threadId, { status: 'idle', activity: { activeBackgroundAgentCount: 2 } });
    let board = await h.call('board');
    expect(board.runningAgents).toBe(2); expect(board.tasks[0].runningAgents).toBe(2);
    const worker = await h.tool('agents_spawn_worker', task.threadId, workerInput('first'));
    await h.tool('agents_spawn_worker', worker.threadId, workerInput('nested'));
    await h.call('snoozeTask', { taskId: task.taskId, until: null });
    h.patch(task.coordinatorId, { status: 'active' });
    board = await h.call('board');
    expect(board.runningAgents).toBe(5); expect(board.tasks[0].runningAgents).toBe(4);
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
    await h.tool('agents_update_task', task.threadId, { ...update, state: 'needs-you', ask: 'Pick direction' });
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
      await h.call('snoozeTask', { taskId: task.taskId, until: now + 1000 }); clock.mockReturnValue(now + 1001);
      expect(await h.boardTask(task.taskId)).toMatchObject({ state: 'running', snoozeUntil: null });
    } finally { clock.mockRestore(); }
    expect(h.threadApi.spawn).toHaveBeenCalledTimes(2);
  });
  it('blocks completion during native background work and pending approval', async () => {
    const h = await harness(); const task = await h.setupTask();
    h.patch(task.threadId, { status: 'idle', activity: { activeBackgroundAgentCount: 2 } });
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
    expect(h.session(task.threadId).tools).toContain('agents_update_task');
    expect(h.session(worker.threadId).tools).not.toContain('agents_update_task');
    for (const threadId of [task.coordinatorId, task.threadId, worker.threadId]) {
      const config = h.session(threadId);
      expect(config.instructions).toContain('global and relevant project memories');
      expect(config.instructions).toContain('Use our review checklist.');
      expect(config).not.toHaveProperty('permissionMode'); expect(config).not.toHaveProperty('model');
      expect(h.threadApi.spawn.mock.calls.find(([options]) => options.pluginMetadata.launchId === h.threads.get(threadId)!.pluginMetadata.launchId)![0]).not.toHaveProperty('permissionMode');
    }
  });
});
