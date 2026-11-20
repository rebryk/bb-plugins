import { randomUUID } from 'node:crypto';
import type { BbPluginApi, PluginAgentToolContext } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { agentInputSchema, CHANGED, rpcContract, type Agent, type Task } from './shared';
import { chooseExecution, type AgentRole } from './routing';
import { roleInstructions } from './instructions';

type Thread = Awaited<ReturnType<BbPluginApi['sdk']['threads']['get']>>;
type ListedThread = Awaited<ReturnType<BbPluginApi['sdk']['threads']['list']>>[number];
type Launch = { id: string; role: AgentRole; agentId: string; taskId?: string; threadId: string | null; requestKey: string; callerId: string };
type StoredTask = Task & { declaredAsk: string | null };
const working = (t: Pick<Thread, 'status'>) => ['active', 'starting', 'pending', 'stopping'].includes(t.status);
const active = (t: Pick<Thread, 'status'>) => t.status === 'active' || t.status === 'starting';
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const taskInput = z.object({
  title: z.string().trim().min(1).max(180), prompt: z.string().trim().min(1).max(50000),
  projectId: z.string().optional(), environmentId: z.string().optional(),
  isolated: z.boolean().default(true), requestKey: z.string().min(1).max(120),
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({ maxWorkers: { type: 'number', label: 'Concurrent workers per task', default: 8 } });
  const config = await settings.get();
  const maxWorkers = Math.max(1, Math.min(32, Math.trunc(config.maxWorkers)));
  const agents = new Map<string, Agent>();
  const tasks = new Map<string, StoredTask>();
  const launches = new Map<string, Launch>();
  const locks = new Map<string, Promise<unknown>>();
  let disposed = false;
  let reconciliation: Promise<void> | undefined;
  let recoverArchived = true;
  async function load<T extends { id: string }>(prefix: string, map: Map<string, T>) {
    for (const key of await bb.storage.kv.list(prefix)) {
      const item = await bb.storage.kv.get<T>(key);
      if (item) map.set(item.id, item);
    }
  }
  await Promise.all([load('agent:', agents), load('task:', tasks), load('launch:', launches)]);
  if (!agents.size) {
    const general: Agent = { id: 'general', name: 'General', avatar: '', instructions: '', projectId: null, threadId: null, execution: null };
    await bb.storage.kv.set('agent:general', general); agents.set(general.id, general);
  }
  const changed = () => { if (!disposed) bb.realtime.publish(CHANGED, null); };
  async function saveAgent(agent: Agent) {
    await bb.storage.kv.set(`agent:${agent.id}`, agent); agents.set(agent.id, agent); changed(); return agent;
  }
  async function saveTask(task: StoredTask) {
    await bb.storage.kv.set(`task:${task.id}`, task); tasks.set(task.id, task); changed(); return task;
  }
  async function saveLaunch(launch: Launch) {
    await bb.storage.kv.set(`launch:${launch.id}`, launch); launches.set(launch.id, launch); return launch;
  }
  async function locked<T>(key: string, run: () => Promise<T>): Promise<T> {
    const next = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
    locks.set(key, next);
    try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
  }
  function agentById(id: string) {
    const agent = agents.get(id); if (!agent) throw new Error('Agent not found.'); return agent;
  }
  function taskById(id: string) {
    const task = tasks.get(id); if (!task) throw new Error('Task not found.'); return task;
  }
  function caller(ctx: PluginAgentToolContext) {
    const launch = [...launches.values()].find(row => row.threadId === ctx.threadId);
    if (!launch) throw new Error('This thread is not managed by Fluently Agents.'); return launch;
  }
  async function project(id?: string | null) {
    if (id) return bb.sdk.projects.get({ projectId: id });
    const rows = await bb.sdk.projects.list({ includePersonal: true });
    const personal = rows.find(row => row.kind === 'personal');
    if (!personal) throw new Error('Choose a BB project for this agent first.'); return personal;
  }
  async function remember(thread: Thread, launch: Launch) {
    await saveLaunch({ ...launch, threadId: thread.id });
    if (launch.role === 'coordinator') await saveAgent({ ...agentById(launch.agentId), threadId: thread.id });
    else if (launch.role === 'task' && launch.taskId) await saveTask({ ...taskById(launch.taskId), threadId: thread.id });
  }
  // A lost response must not create duplicate work on retry.
  async function findLaunchThread(launch: Launch): Promise<string | null> {
    if (launch.threadId) return launch.threadId;
    for (const archived of [false, true]) for (let offset = 0; ; offset += 100) {
      const rows = await bb.sdk.threads.list({ originPluginId: bb.pluginId, includeHidden: true, archived, limit: 100, offset });
      if (!rows.length) break;
      const metadata = await bb.sdk.threads.experimental_listPluginMetadata({ pluginId: bb.pluginId, threadIds: rows.map(row => row.id) });
      const found = metadata.threads.find(row => row.metadata.launchId === launch.id);
      if (found) { await remember(await bb.sdk.threads.get({ threadId: found.threadId }), launch); return found.threadId; }
      if (rows.length < 100) break;
    }
    return null;
  }
  async function recoverLaunch(launch: Launch) {
    const threadId = await findLaunchThread(launch);
    if (threadId) return threadId;
    throw new Error(`No confirmed thread for launch ${launch.id}. To check and abandon this unresolved launch explicitly, run bb agents abandon-launch ${launch.id}. Work was not duplicated.`);
  }
  async function abandonLaunch(id: string) {
    const launch = launches.get(id);
    if (!launch) throw new Error('Launch not found.');
    const key = launch.role === 'coordinator' ? `agent:${launch.agentId}`
      : launch.role === 'worker' ? `task:${launch.taskId}` : `request:${launch.callerId}:${launch.requestKey}`;
    if (locks.has(key)) throw new Error('This launch is still in flight. Wait for it to settle before abandoning it.');
    return locked(key, async () => {
      const current = launches.get(id);
      if (!current || current.threadId) throw new Error('Only an unresolved launch without a confirmed conversation can be abandoned.');
      const found = await findLaunchThread(current);
      if (found) throw new Error(`The launch already created conversation ${found}. It was recovered; use the existing conversation instead.`);
      if (current.role === 'task' && current.taskId) {
        await saveTask({ ...taskById(current.taskId), state: 'done', ask: null, declaredAsk: null, needsSince: null, snoozeUntil: null, runningAgents: 0, pendingWorkers: [], updatedAt: Date.now() });
      }
      await bb.storage.kv.delete(`launch:${id}`); launches.delete(id); changed();
    });
  }
  async function spawn(launch: Launch, options: Parameters<BbPluginApi['sdk']['threads']['spawn']>[0]) {
    await saveLaunch(launch);
    try {
      const thread = await bb.sdk.threads.spawn({ ...options, visibility: 'hidden', pluginMetadata: { launchId: launch.id } });
      await remember(thread, launch); return thread;
    } catch (error) {
      if (launch.taskId && launch.role === 'task') await saveTask({ ...taskById(launch.taskId), state: 'needs-you', ask: 'Check failed launch', declaredAsk: 'Check failed launch', needsSince: Date.now() });
      throw new Error(`${error instanceof Error ? error.message : String(error)} Unresolved launch ${launch.id}: run bb agents abandon-launch ${launch.id} to check and abandon it explicitly if a retry is needed.`, { cause: error });
    }
  }
  async function openAgent(id: string) {
    return locked(`agent:${id}`, async () => {
      const agent = agentById(id);
      if (agent.threadId) {
        const thread = await bb.sdk.threads.get({ threadId: agent.threadId });
        if (thread.deletedAt) throw new Error('This conversation was deleted. Create a new agent to start again.');
        if (thread.archivedAt) await bb.sdk.threads.unarchive({ threadId: thread.id });
        return { threadId: thread.id };
      }
      const existing = [...launches.values()].find(row => row.agentId === id && row.role === 'coordinator');
      if (existing) return { threadId: await recoverLaunch(existing) };
      const target = await project(agent.projectId);
      const execution = await chooseExecution(bb, { role: 'coordinator', projectId: target.id, preferred: agent.execution ?? undefined });
      const thread = await spawn({ id: randomUUID(), role: 'coordinator', agentId: id, threadId: null, requestKey: 'coordinator', callerId: 'user' }, {
        projectId: target.id, environment: { type: 'project-default' }, title: agent.name,
        providerId: execution.providerId, model: execution.model, reasoningLevel: execution.reasoningLevel,
        input: [{ type: 'text', text: 'This conversation is ready for the user. Reply with one short greeting. Do not create tasks or start work until the user asks.', mentions: [], visibility: 'agent-only' }],
      });
      return { threadId: thread.id };
    });
  }
  async function createTask(input: z.infer<typeof taskInput>, ctx: PluginAgentToolContext) {
    const owner = caller(ctx);
    if (owner.role !== 'coordinator') throw new Error('Only a standing coordinator creates board tasks. Use agents_spawn_worker within a task.');
    return locked(`request:${ctx.threadId}:${input.requestKey}`, async () => {
      const previous = [...launches.values()].find(row => row.callerId === ctx.threadId && row.requestKey === input.requestKey);
      if (previous) return { taskId: previous.taskId, threadId: previous.threadId ?? await recoverLaunch(previous) };
      const agent = agentById(owner.agentId);
      const target = await project(input.projectId ?? agent.projectId ?? ctx.projectId);
      if (input.environmentId) {
        const environment = await bb.sdk.environments.get({ environmentId: input.environmentId });
        if (environment.projectId !== target.id) throw new Error('The workspace belongs to a different project.');
      }
      const execution = await chooseExecution(bb, { role: 'task', projectId: target.id, environmentId: input.environmentId });
      const task: StoredTask = {
        id: randomUUID(), agentId: agent.id, threadId: null, title: input.title, projectId: target.id, projectName: target.name,
        state: 'queued', ask: null, declaredAsk: null, needsSince: null, etaAt: null, completed: 0, total: 0,
        runningAgents: 0, snoozeUntil: null, updatedAt: Date.now(), pendingWorkers: [], artifacts: [],
        execution: { providerId: execution.providerId, model: execution.model, reasoningLevel: execution.reasoningLevel }, routingReason: execution.reason,
      };
      await saveTask(task);
      const environment = input.environmentId ? { type: 'reuse' as const, environmentId: input.environmentId }
        : input.isolated && target.gitRemoteUrl ? { type: 'host' as const, workspace: { type: 'managed-worktree' as const, baseBranch: { kind: 'default' as const } } }
        : { type: 'project-default' as const };
      const thread = await spawn({ id: randomUUID(), role: 'task', agentId: agent.id, taskId: task.id, threadId: null, requestKey: input.requestKey, callerId: ctx.threadId }, {
        projectId: target.id, environment, title: input.title, ...task.execution!, prompt: input.prompt, senderThreadId: ctx.threadId,
      });
      return { taskId: task.id, threadId: thread.id, execution };
    });
  }
  async function spawnWorker(input: z.infer<typeof taskInput>, ctx: PluginAgentToolContext) {
    const owner = caller(ctx);
    if (!owner.taskId) throw new Error('Create a board task before spawning workers.');
    return locked(`task:${owner.taskId}`, async () => {
      const previous = [...launches.values()].find(row => row.callerId === ctx.threadId && row.requestKey === input.requestKey);
      if (previous) return { threadId: previous.threadId ?? await recoverLaunch(previous) };
      const task = taskById(owner.taskId!);
      if (task.state === 'done') throw new Error('Reopen this task before starting workers.');
      const workers = [...launches.values()].filter(row => row.taskId === task.id && row.role === 'worker');
      const states = await Promise.all(workers.map(row => row.threadId ? bb.sdk.threads.get({ threadId: row.threadId }) : null));
      if (states.filter(t => !t || (!t.archivedAt && !t.deletedAt && working(t))).length >= maxWorkers) throw new Error(`This task has reached its ${maxWorkers}-worker budget. Wait for an existing worker; do useful independent work meanwhile.`);
      const parent = await bb.sdk.threads.get({ threadId: ctx.threadId });
      const environmentId = input.environmentId ?? parent.environmentId;
      if (!environmentId) throw new Error('Wait for the task workspace to become ready.');
      const target = await project(input.projectId ?? parent.projectId);
      const environment = await bb.sdk.environments.get({ environmentId });
      if (environment.projectId !== target.id) throw new Error('The worker workspace belongs to a different project.');
      const execution = await chooseExecution(bb, { role: 'worker', projectId: target.id, environmentId });
      const thread = await spawn({ id: randomUUID(), role: 'worker', agentId: owner.agentId, taskId: task.id, threadId: null, requestKey: input.requestKey, callerId: ctx.threadId }, {
        projectId: target.id, environment: { type: 'reuse', environmentId }, title: input.title, prompt: input.prompt,
        parentThreadId: ctx.threadId, parentNotifications: 'auto', providerId: execution.providerId, model: execution.model, reasoningLevel: execution.reasoningLevel,
      });
      return { threadId: thread.id, execution };
    });
  }
  async function relatedThreads(task: StoredTask) {
    if (!task.threadId) return [];
    const descendants = await bb.sdk.threads.experimental_listDescendants({ threadIds: [task.threadId], includeHidden: true, includeArchived: true });
    const ids = [...new Set([task.threadId, ...descendants.threads.flatMap(row => row.descendantIds), ...[...launches.values()].filter(row => row.taskId === task.id && row.threadId).map(row => row.threadId!)])];
    const rows: ListedThread[] = [];
    for (let start = 0; start < ids.length; start += 100) {
      for (const archived of [false, true]) rows.push(...await bb.sdk.threads.list({ threadIds: ids.slice(start, start + 100), includeHidden: true, archived, limit: 100 }));
    }
    return rows.filter(row => !row.deletedAt);
  }
  async function reconcileTask(id: string) {
    return locked(`task:${id}`, async () => {
      const old = taskById(id); if (!old.threadId) return;
      const rows = await relatedThreads(old);
      const lead = rows.find(row => row.id === old.threadId);
      if (!lead) {
        if (old.state !== 'done') {
          const next = { ...old, state: 'needs-you' as const, ask: 'Task conversation was deleted', needsSince: old.needsSince ?? Date.now(), runningAgents: 0, pendingWorkers: [] };
          if (JSON.stringify(next) !== JSON.stringify(old)) await saveTask(next);
        }
        return;
      }
      const live = rows.filter(row => !row.archivedAt);
      const pendingWorkers: Task['pendingWorkers'] = [];
      for (const row of live) {
        if (row.hasPendingInteraction) pendingWorkers.push({ threadId: row.id, title: row.title ?? old.title });
      }
      const count = live.reduce((sum, row) => sum + (active(row) ? 1 : 0) + row.activity.activeBackgroundAgentCount, 0);
      let state = old.state; let ask = old.ask; const now = Date.now();
      if (state === 'snoozed' && old.snoozeUntil !== null && old.snoozeUntil <= now) state = 'queued';
      if (state === 'done' && !lead.archivedAt) state = 'queued';
      if (state !== 'done' && state !== 'snoozed') {
        if (lead.archivedAt) { state = 'done'; ask = null; }
        else if (pendingWorkers.length) { state = 'needs-you'; ask = 'Answer a question'; }
        else if (old.declaredAsk) { state = 'needs-you'; ask = old.declaredAsk; }
        else if (count > 0) { state = 'running'; ask = null; }
        else if (live.some(row => working(row) || row.queuedWork !== 'none')) { state = 'queued'; ask = null; }
        else { state = 'needs-you'; ask = live.some(row => row.status === 'error') ? 'Check failed work' : 'Review result'; }
      }
      const next = { ...old, state, ask, snoozeUntil: state === 'snoozed' ? old.snoozeUntil : null, runningAgents: count, pendingWorkers, needsSince: state === 'needs-you' ? old.needsSince ?? now : null };
      if (JSON.stringify(next) !== JSON.stringify(old)) await saveTask(next);
    });
  }
  async function reconcile() {
    if (reconciliation) return reconciliation;
    reconciliation = (async () => {
      // Recover automation wakes missed while the plugin was stopped. Later
      // wakes arrive through thread events, without rescanning the archive.
      if (recoverArchived) {
        const archived = [...tasks.values()].filter(task => task.state === 'done' && task.threadId);
        for (let start = 0; start < archived.length; start += 100) {
          const batch = archived.slice(start, start + 100);
          const live = await bb.sdk.threads.list({ threadIds: batch.map(task => task.threadId!), archived: false, includeHidden: true, limit: 100 });
          for (const task of batch) if (live.some(thread => thread.id === task.threadId && !thread.deletedAt)) await reconcileTask(task.id);
        }
        recoverArchived = false;
      }
      for (const task of tasks.values()) if (task.state !== 'done') await reconcileTask(task.id);
    })().finally(() => { reconciliation = undefined; });
    return reconciliation;
  }
  async function completeTask(id: string) {
    return locked(`task:${id}`, async () => {
      const task = taskById(id); const rows = await relatedThreads(task);
      if (rows.some(row => !row.archivedAt && (working(row) || row.queuedWork !== 'none' || row.activity.activeBackgroundAgentCount > 0 || row.hasPendingInteraction))) throw new Error('Work is still running, queued, or awaiting a response. Resolve it in the chat before marking the task done.');
      for (const row of rows.filter(row => row.id !== task.threadId)) if (!row.archivedAt) await bb.sdk.threads.archive({ threadId: row.id });
      if (task.threadId) await bb.sdk.threads.archive({ threadId: task.threadId });
      await saveTask({ ...task, state: 'done', ask: null, declaredAsk: null, needsSince: null, snoozeUntil: null, runningAgents: 0, pendingWorkers: [], updatedAt: Date.now() }); return null;
    });
  }
  async function reopenTask(id: string, prompt?: string, senderThreadId?: string) {
    return locked(`task:${id}`, async () => {
      const task = taskById(id); if (!task.threadId) throw new Error('This task has no confirmed conversation to reopen.');
      const lead = await bb.sdk.threads.get({ threadId: task.threadId });
      if (lead.archivedAt) await bb.sdk.threads.unarchive({ threadId: lead.id });
      await saveTask({ ...task, state: 'needs-you', ask: 'Continue task', declaredAsk: null, needsSince: Date.now(), snoozeUntil: null, updatedAt: Date.now() });
      if (prompt) await bb.sdk.threads.send({ threadId: lead.id, mode: 'auto', input: [{ type: 'text', text: prompt, mentions: [] }], ...(senderThreadId ? { senderThreadId } : {}) }); return null;
    });
  }
  async function updateAgent(input: z.infer<typeof agentInputSchema>) {
    const previous = input.id ? agentById(input.id) : null;
    if (input.projectId) await project(input.projectId);
    if (previous?.threadId && (previous.projectId !== input.projectId || JSON.stringify(previous.execution) !== JSON.stringify(input.execution))) throw new Error('Use the existing chat model picker, or create a new agent for another project.');
    return saveAgent({ ...input, id: previous?.id ?? randomUUID(), threadId: previous?.threadId ?? null });
  }
  bb.rpc.register(rpcContract, {
    board: async () => {
      await reconcile();
      const coordinatorIds = [...agents.values()].flatMap(agent => agent.threadId ? [agent.threadId] : []);
      let runningAgents = [...tasks.values()].reduce((sum, task) => sum + task.runningAgents, 0);
      for (let start = 0; start < coordinatorIds.length; start += 100) {
        const coordinators = await bb.sdk.threads.list({ threadIds: coordinatorIds.slice(start, start + 100), archived: false, includeHidden: true, limit: 100 });
        for (const thread of coordinators) if (!thread.deletedAt) runningAgents += (active(thread) ? 1 : 0) + thread.activity.activeBackgroundAgentCount;
      }
      return { agents: [...agents.values()], tasks: [...tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt), runningAgents };
    },
    openAgent: ({ agentId }) => openAgent(agentId), saveAgent: updateAgent,
    completeTask: ({ taskId }) => completeTask(taskId), reopenTask: ({ taskId }) => reopenTask(taskId),
    snoozeTask: ({ taskId, until }) => locked(`task:${taskId}`, async () => {
      if (until !== null && until <= Date.now()) throw new Error('Choose a future snooze time.');
      const task = taskById(taskId); if (task.state === 'done') throw new Error('Reopen this task before snoozing it.');
      await saveTask({ ...task, state: 'snoozed', snoozeUntil: until, updatedAt: Date.now() }); return null;
    }),
  });
  bb.agents.registerTool({ name: 'agents_create_task', description: 'Create one standalone board task with a self-contained brief. Reuse requestKey on retries. Independent tasks may run in parallel. Code changes default to an isolated worktree.', parameters: taskInput, execute: async (input, ctx) => result(await createTask(input, ctx)) });
  bb.agents.registerTool({ name: 'agents_spawn_worker', description: 'Delegate a substantial independent part of this task. Workers share its workspace by default: give non-overlapping scopes. Recursive delegation shares one worker budget. Reuse requestKey on retries.', parameters: taskInput, execute: async (input, ctx) => result(await spawnWorker(input, ctx)) });
  bb.agents.registerTool({ name: 'agents_update_task', description: 'Task leader only: report aggregate progress and honest ETA. needs-you requires a concrete ask, including final review. Only the user marks done.', parameters: z.object({
    state: z.enum(['running', 'needs-you']), ask: z.string().trim().min(1).max(100).nullable(),
    completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(), etaMinutes: z.number().positive().max(10080).nullable(),
    artifacts: z.array(z.object({ title: z.string().max(180), url: z.string().url().refine(url => /^https?:\/\//.test(url), 'Use an HTTP or HTTPS result link.') })).max(40).optional(),
  }), execute: async (input, ctx) => {
    const owner = caller(ctx); if (owner.role !== 'task' || !owner.taskId) throw new Error('Only the task leader changes aggregate progress.');
    if (input.completed > input.total) throw new Error('Completed steps cannot exceed total steps.');
    if (input.state === 'needs-you' && !input.ask) throw new Error('Say what the user needs to do.');
    return locked(`task:${owner.taskId}`, async () => {
      const task = taskById(owner.taskId!); if (task.state === 'done') throw new Error('The task is already archived.');
      const now = Date.now();
      await saveTask({ ...task, state: task.state === 'snoozed' ? 'snoozed' : input.state,
        declaredAsk: input.state === 'needs-you' ? input.ask : null, ask: input.state === 'needs-you' ? input.ask : null,
        completed: input.completed, total: input.total, etaAt: input.etaMinutes ? now + input.etaMinutes * 60000 : null,
        artifacts: input.artifacts ?? task.artifacts, needsSince: input.state === 'needs-you' ? task.needsSince ?? now : null, updatedAt: now });
      return result({ updated: true });
    });
  } });
  bb.agents.registerTool({ name: 'agents_list_tasks', description: 'Read tracked work, including snoozed and archived tasks, and available agents. Task workers see only their own task.', parameters: z.object({}), execute: async (_, ctx) => {
    const owner = caller(ctx); await reconcile();
    return result({ agents: [...agents.values()].map(({ avatar: _avatar, ...agent }) => agent), tasks: [...tasks.values()].filter(row => owner.role === 'coordinator' || row.id === owner.taskId) });
  } });
  bb.agents.registerTool({ name: 'agents_manage_agent', description: 'Create or change an agent only when the user asks. Provide its name, avatar, instructions, project and optional fixed coordinator execution. Omit id to create.', parameters: agentInputSchema, execute: async (input, ctx) => {
    if (caller(ctx).role !== 'coordinator') throw new Error('Only standing coordinators manage agents.'); return result(await updateAgent(input));
  } });
  bb.agents.registerTool({ name: 'agents_reopen_task', description: 'Standing coordinator: wake an existing task and optionally send a self-contained follow-up directly to its conversation.', parameters: z.object({ taskId: z.string(), prompt: z.string().max(50000).optional() }), execute: async (input, ctx) => {
    if (caller(ctx).role !== 'coordinator') throw new Error('Only a standing coordinator routes follow-ups.');
    await reopenTask(input.taskId, input.prompt, ctx.threadId); return result({ reopened: true });
  } });
  bb.agents.configure(ctx => {
    const launch = typeof ctx.pluginMetadata.launchId === 'string' ? launches.get(ctx.pluginMetadata.launchId) : undefined;
    if (!launch || (launch.threadId && launch.threadId !== ctx.thread.id)) return { tools: [], skills: [] };
    // Session configuration can precede the spawn response.
    if (!launch.threadId) launch.threadId = ctx.thread.id;
    const agent = agents.get(launch.agentId); if (!agent) return { tools: [], skills: [] };
    const tools = launch.role === 'coordinator' ? ['agents_create_task', 'agents_list_tasks', 'agents_manage_agent', 'agents_reopen_task']
      : ['agents_spawn_worker', 'agents_list_tasks', ...(launch.role === 'task' ? ['agents_update_task'] : [])];
    return { tools, skills: [], instructions: roleInstructions({ role: launch.role, agentName: agent.name, agentId: agent.id, taskId: launch.taskId, instructions: agent.instructions, maxWorkers }) };
  });
  async function onChange(thread: Thread, clearAsk = false) {
    const launch = [...launches.values()].find(row => row.threadId === thread.id); if (!launch) return;
    if (launch.taskId) {
      if (clearAsk && launch.role === 'task') await locked(`task:${launch.taskId}`, async () => {
        await saveTask({ ...taskById(launch.taskId!), declaredAsk: null, ask: null, needsSince: null, updatedAt: Date.now() });
      });
      await reconcileTask(launch.taskId);
    } else changed();
  }
  bb.events.on('thread.active', ({ thread }) => onChange(thread, true));
  bb.events.on('thread.idle', ({ thread }) => onChange(thread));
  bb.events.on('thread.failed', ({ thread }) => onChange(thread));
  bb.events.on('thread.archived', ({ thread }) => onChange(thread));
  bb.events.on('thread.unarchived', ({ thread }) => onChange(thread));
  bb.events.on('thread.deleted', ({ thread }) => onChange(thread));
  bb.events.on('interaction.pending', ({ thread }) => onChange(thread));
  const timer = setInterval(() => { void reconcile().catch(error => bb.log.warn(String(error))); }, 15000);
  bb.onDispose(() => { disposed = true; clearInterval(timer); });
  bb.cli.register({ name: 'agents', summary: 'Inspect tasks and wake existing conversations', commands: [
    { name: 'list', summary: 'List agents, tasks and unresolved launches', usage: 'bb agents list' },
    { name: 'abandon-launch', summary: 'Explicitly release an unresolved launch after checking that no conversation exists', usage: 'bb agents abandon-launch <launch-id>' },
    { name: 'reopen', summary: 'Wake a task; optionally send a follow-up', usage: 'bb agents reopen <task-id> [message]' },
  ], async run(argv) {
    if (argv[0] === 'list') { await reconcile(); return { exitCode: 0, stdout: JSON.stringify({ agents: [...agents.values()], tasks: [...tasks.values()], unresolvedLaunches: [...launches.values()].filter(launch => !launch.threadId) }, null, 2) }; }
    if (argv[0] === 'abandon-launch' && argv[1]) { await abandonLaunch(argv[1]); return { exitCode: 0, stdout: 'Unresolved launch abandoned; no conversation was deleted.' }; }
    if (argv[0] === 'reopen' && argv[1]) { await reopenTask(argv[1], argv.slice(2).join(' ') || undefined); return { exitCode: 0, stdout: 'Task reopened.' }; }
    return { exitCode: 1, stderr: 'Usage: bb agents list | reopen <task-id> [message] | abandon-launch <launch-id>' };
  } });
}
