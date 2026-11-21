import { NativeCensus, runningThreadIds } from './counts';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import type { BbPluginApi, PluginAgentToolContext } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { agentInputSchema, CHANGED, rpcContract, type Agent, type Task } from './shared';
import { chooseExecution, type AgentRole } from './routing';
import { roleInstructions } from './instructions';
import { readSidebarPhases, trackLegacyOutline, type SidebarPhase } from './status';

type Thread = Awaited<ReturnType<BbPluginApi['sdk']['threads']['get']>>;
type ListedThread = Awaited<ReturnType<BbPluginApi['sdk']['threads']['list']>>[number];
type Launch = { id: string; role: AgentRole; agentId: string; taskId?: string; threadId: string | null; requestKey: string; callerId: string; ordinary?: boolean; title?: string; ready?: boolean };
type StoredTask = Task & { declaredAsk: string | null; archivedProjection?: boolean; reopenedAt?: number };
const working = (t: Pick<Thread, 'status'>) => ['active', 'starting', 'pending', 'stopping'].includes(t.status);

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const taskInput = z.object({
  title: z.string().trim().min(1).max(180), prompt: z.string().trim().min(1).max(50000),
  projectId: z.string().optional(), environmentId: z.string().optional(),
  isolated: z.boolean().default(true), requestKey: z.string().min(1).max(120),
});

export default async function plugin(bb: BbPluginApi) {
  let disposed = false;
  const lifetime = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  let censusNotification: ReturnType<typeof setTimeout> | undefined;
  bb.onDispose(() => { disposed = true; lifetime.abort(); if (timer) clearInterval(timer); if (censusNotification) clearTimeout(censusNotification); });
  const signalUntil = (deadline: number) => AbortSignal.any([lifetime.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]);
  let inventoryRevision = 0;
  let scanRevision = 0;
  const ownerRevisions = new Map<string, number>();

  const settings = bb.settings.define({ maxWorkers: { type: 'number', label: 'Concurrent workers per task', default: 8 } });
  const config = await settings.get();
  if (disposed) return;
  const maxWorkers = Math.max(1, Math.min(32, Math.trunc(config.maxWorkers)));
  // Private, locally provisioned images; never ship licensed packs in the bundle.
  const pool = z.array(z.string().max(150000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)).max(16)
    .refine(value => JSON.stringify(value).length <= 240000)
    .safeParse(await bb.storage.kv.get('avatar-pool') ?? []);
  if (disposed) return;
  const avatarPool = pool.success ? [...new Set(pool.data)] : [];
  const agents = new Map<string, Agent>();
  const tasks = new Map<string, StoredTask>();
  const launches = new Map<string, Launch>();
  const locks = new Map<string, Promise<unknown>>();
  let reconciliation: Promise<void> | undefined;
  let dirty = true;
  let lastReconciled = 0;
  let pendingPublish = false;
  const transitions = new Map<string, number>();
  const native = new Map<string, NativeCensus>();
  // KV manifests atomically select immutable chunks (each below 256 KiB).
  const checkpointManifest = z.object({ version: z.literal(1), generation: z.string(), chunks: z.number().int().min(0).max(10000), parent: z.string().nullable().optional() });
  const manifests = new Map<string, z.infer<typeof checkpointManifest>>();
  let eligible = new Map<string, ListedThread>();
  const retainedParents = new Map<string, string | null>();
  const fingerprints = new Map<string, string>();
  const requested = new Set<string>();
  let inventory = new Map<string, ListedThread>();
  let scanRows = new Map<string, ListedThread>();
  let scanArchived = false;
  let scanOffset = 0;
  let inventoryComplete = false;
  let scanPending = false;
  const serviced = new Map<string, number>();
  let serviceSequence = 0;
  let inventoryDirty = true;
  let inventoryAt = 0;
  async function persist(id: string, state: NativeCensus) {
    const key = `census:${id}`;
    const previous = checkpointManifest.safeParse(await bb.storage.kv.get(key));
    if (disposed) return;
    const generation = randomUUID();
    const encoded = gzipSync(JSON.stringify({ state: state.snapshot(), parent: retainedParents.get(id) ?? null, fingerprint: fingerprints.get(id) })).toString('base64');
    const chunks = Math.ceil(encoded.length / 180000);
    try {
    for (let i = 0; i < chunks; i++) {
      if (disposed) return;
      await bb.storage.kv.set(`census-chunk:${id}:${generation}:${i}`, encoded.slice(i * 180000, (i + 1) * 180000));
    }
    if (disposed) return;
    const manifest = { version: 1 as const, generation, chunks, parent: retainedParents.get(id) ?? null };
    await bb.storage.kv.set(key, manifest); manifests.set(id, manifest);
    } catch (error) {
      if (!disposed) {
        const committed = checkpointManifest.safeParse(await bb.storage.kv.get(key));
        if (!committed.success || committed.data.generation !== generation) {
          for (let i = 0; i < chunks && !disposed; i++) await bb.storage.kv.delete(`census-chunk:${id}:${generation}:${i}`);
        }
      }
      throw error;
    }
    if (previous.success) for (let i = 0; i < previous.data.chunks && !disposed; i++) await bb.storage.kv.delete(`census-chunk:${id}:${previous.data.generation}:${i}`);
  }
  for (const key of await bb.storage.kv.list('census:')) {
    if (disposed) return;
    const manifest = checkpointManifest.safeParse(await bb.storage.kv.get(key));
    if (disposed) return;
    if (!manifest.success) continue;
    const id = key.slice(7); manifests.set(id, manifest.data);
    if (manifest.data.parent !== undefined) retainedParents.set(id, manifest.data.parent);
  }
  if (disposed) return;
  const committedChunks = new Set<string>();
  for (const [id, manifest] of manifests) for (let i = 0; i < manifest.chunks; i++) committedChunks.add(`census-chunk:${id}:${manifest.generation}:${i}`);
  for (const key of await bb.storage.kv.list('census-chunk:')) {
    if (disposed) return;
    if (!committedChunks.has(key)) await bb.storage.kv.delete(key);
  }
  if (disposed) return;
  async function restoreOwner(id: string, ancestryOnly = false) {
    const manifest = manifests.get(id);
    if (!manifest?.chunks) return new NativeCensus();
    try {
      let encoded = '';
      for (let i = 0; i < manifest.chunks; i++) {
        if (disposed) return new NativeCensus();
        const chunk = await bb.storage.kv.get(`census-chunk:${id}:${manifest.generation}:${i}`);
        if (disposed) return new NativeCensus();
        if (typeof chunk !== 'string') throw new Error('Missing census checkpoint chunk');
        encoded += chunk;
      }
      const value = JSON.parse(gunzipSync(Buffer.from(encoded, 'base64')).toString());
      if (value.parent === null || typeof value.parent === 'string') retainedParents.set(id, value.parent);
      if (ancestryOnly) return new NativeCensus();
      const state = NativeCensus.restore(value.state); state.complete = false; return state;
    } catch (error) { if (!disposed) bb.log.warn(`Census checkpoint ${id}: ${String(error)}`); return new NativeCensus(); }
  }
  async function selectOwners() {
    // Old checkpoints kept ancestry inside their payload. Read those only for
    // missing links actually reached from surviving rows; new manifests carry it.
    for (const row of inventory.values()) {
      let parent = row.parentThreadId; const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        if (!inventory.has(parent) && !retainedParents.has(parent) && manifests.get(parent)?.chunks) await restoreOwner(parent, true);
        if (disposed) return;
        parent = retainedParents.get(parent) ?? null;
      }
    }
    const roots = new Set([...tasks.values()].flatMap(task => task.threadId ? [task.threadId] : []));
    for (const agent of agents.values()) if (agent.threadId) roots.add(agent.threadId);
    const managed = new Set([...launches.values()].flatMap(row => row.threadId ? [row.threadId] : []));
    for (const row of inventory.values()) if (!row.archivedAt) {
      let current: ListedThread | undefined = row; let root: string | undefined;
      const seen = new Set<string>();
      while (current && !seen.has(current.id)) {
        if (managed.has(current.id)) { root = undefined; break; }
        seen.add(current.id);
        if (current.visibility !== 'hidden') root = current.id;
        current = current.parentThreadId ? inventory.get(current.parentThreadId) : undefined;
      }
      if (root) roots.add(root);
    }
    eligible = new Map([...roots].flatMap(root => tree(root)).map(row => [row.id, row]));
    for (const id of native.keys()) if (!eligible.has(id)) { native.delete(id); fingerprints.delete(id); serviced.delete(id); }
  }
  async function retireCheckpoints(deadline: number) {
    // Preserve only ancestry for unrelated/deleted owners. Never evict ordering
    // metadata from an eligible lifecycle, including settled archived tasks.
    let retired = 0;
    for (const [id, manifest] of manifests) {
      if (disposed || Date.now() >= deadline || retired >= 4) break;
      if (eligible.has(id) || !manifest.chunks) continue;
      const parent = retainedParents.get(id) ?? manifest.parent ?? null;
      const ancestry = { version: 1 as const, generation: '', chunks: 0, parent };
      await bb.storage.kv.set(`census:${id}`, ancestry);
      if (disposed) return;
      manifests.set(id, ancestry);
      for (let i = 0; i < manifest.chunks && !disposed; i++) await bb.storage.kv.delete(`census-chunk:${id}:${manifest.generation}:${i}`);
      retired++;
    }
  }
  async function scanInventory(deadline: number) {
    if (!scanPending) scanRevision = inventoryRevision;
    scanPending = true;
    for (let calls = 0; calls < 8 && Date.now() < deadline && !disposed; calls++) {
      const page = await bb.sdk.threads.list({ archived: scanArchived, includeHidden: true, limit: 100, offset: scanOffset, signal: signalUntil(deadline) });
      if (disposed) return;
      for (const row of page) if (!row.deletedAt) {
        scanRows.set(row.id, row); retainedParents.set(row.id, row.parentThreadId ?? null);
      }
      if (page.length === 100) { scanOffset += 100; continue; }
      if (!scanArchived) { scanArchived = true; scanOffset = 0; continue; }
      if (scanRevision !== inventoryRevision) {
        scanRows = new Map(); scanArchived = false; scanOffset = 0; scanRevision = inventoryRevision; return;
      }
      inventory = scanRows; scanRows = new Map(); scanArchived = false; scanOffset = 0;
      inventoryComplete = true; scanPending = false; inventoryDirty = false; inventoryAt = Date.now(); return;
    }
  }
  function tree(root: string) {
    return [...inventory.values()].filter(row => {
      let id: string | null = row.id; const seen = new Set<string>();
      while (id && !seen.has(id)) {
        if (id === root) return true;
        seen.add(id); id = retainedParents.get(id) ?? null;
      }
      return false;
    });
  }

  function census(rows: ListedThread[]) {
    const ids = runningThreadIds(rows);
    let complete = true;
    for (const row of rows) {
      if (row.deletedAt) continue;
      const state = native.get(row.id);
      if (!state?.complete) complete = false;
      for (const id of state?.identities(row.id) ?? []) ids.add(id);
    }
    return { ids, complete };
  }
  let phases: Record<string, SidebarPhase> = {};
  const trackedLegacy = new Set<string>();
  async function load<T extends { id: string }>(prefix: string, map: Map<string, T>) {
    if (disposed) return;
    for (const key of await bb.storage.kv.list(prefix)) {
      if (disposed) return;
      const item = await bb.storage.kv.get<T>(key);
      if (disposed) return;
      if (item) map.set(item.id, item);
    }
  }
  await Promise.all([load('agent:', agents), load('task:', tasks), load('launch:', launches)]);
  if (disposed) return;
  if (!agents.size) {
    const general: Agent = { id: 'general', name: 'General', avatar: '', instructions: '', projectId: null, threadId: null, execution: null };
    await bb.storage.kv.set('agent:general', general); if (disposed) return; agents.set(general.id, general);
  }
  const changed = () => {
    if (disposed) return;
    if (reconciliation) pendingPublish = true;
    else bb.realtime.publish(CHANGED, null);
  };
  const invalidate = (threadId?: string) => { dirty = true; inventoryDirty = true; inventoryRevision++; if (threadId) ownerRevisions.set(threadId, (ownerRevisions.get(threadId) ?? 0) + 1); if (threadId) { requested.add(threadId); const state = native.get(threadId); if (state) state.complete = false; } };
  async function saveAgent(agent: Agent) {
    await bb.storage.kv.set(`agent:${agent.id}`, agent); agents.set(agent.id, agent); changed(); return agent;
  }
  async function saveTask(task: StoredTask) {
    if (disposed) return task;
    if (!reconciliation) invalidate();
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
    if (launch.role === 'coordinator') await locked('agent-save', () => saveAgent({ ...agentById(launch.agentId), threadId: thread.id }));
    else if (launch.role === 'task' && launch.taskId) await saveTask({ ...taskById(launch.taskId), threadId: thread.id });
  }
  // A lost response must not create duplicate work on retry.
  async function findLaunchThread(launch: Launch): Promise<string | null> {
    if (launch.threadId) return launch.threadId;
    for (const archived of [false, true]) for (let offset = 0; ; offset += 100) {
      const rows = await bb.sdk.threads.list({ ...(launch.ordinary ? {} : { originPluginId: bb.pluginId }), includeHidden: true, archived, limit: 100, offset });
      if (!rows.length) break;
      const metadata = await bb.sdk.threads.experimental_listPluginMetadata({ pluginId: bb.pluginId, threadIds: rows.map(row => row.id) });
      const found = metadata.threads.find(row => row.metadata.launchId === launch.id)
        ?? (launch.ordinary ? rows.filter(row => row.title === `Agents launch ${launch.id}`).map(row => ({ threadId: row.id }))[0] : undefined);
      if (found) { await remember(await bb.sdk.threads.get({ threadId: found.threadId }), launch); return found.threadId; }
      if (rows.length < 100) break;
    }
    return null;
  }
  async function recoverLaunch(launch: Launch) {
    const threadId = await findLaunchThread(launch);
    if (threadId) { await finishLaunch(launches.get(launch.id)!); return threadId; }
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
  // Public SDK creation allows ordinary attribution. Metadata must be attached
  // afterwards: passing it to spawn would force plugin ownership. Hold the
  // first message until role configuration and the durable mapping exist.
  const heldUntil = Date.UTC(9999, 0, 1);
  async function finishLaunch(launch: Launch) {
    if (!launch.ordinary || launch.ready || !launch.threadId) return;
    await bb.sdk.threads.updatePluginMetadata({ threadId: launch.threadId, set: { launchId: launch.id } });
    await bb.sdk.threads.update({ threadId: launch.threadId, title: launch.title });
    const queue = await bb.sdk.threads.queuedMessages.list({ threadId: launch.threadId });
    const initial = queue.find(row => row.sendAt === heldUntil);
    if (initial?.state === 'scheduled') await bb.sdk.threads.queuedMessages.send({ threadId: launch.threadId, queuedMessageId: initial.id, mode: 'auto' });
    // If the send response was lost, its queue row is already gone. Never
    // recreate or resend the prompt during recovery.
    await saveLaunch({ ...launch, ready: true });
  }
  async function spawn(launch: Launch, options: Parameters<BbPluginApi['sdk']['threads']['spawn']>[0]) {
    launch = { ...launch, ordinary: true, title: options.title, ready: false };
    await saveLaunch(launch);
    try {
      const thread = await bb.sdk.threads.spawn({ ...options, origin: 'sdk', visibility: 'visible', title: `Agents launch ${launch.id}`, sendAt: heldUntil });
      await remember(thread, launch);
      await finishLaunch(launches.get(launch.id)!);
      invalidate(thread.id); return thread;
    } catch (error) {
      if (launch.taskId && launch.role === 'task') await saveTask({ ...taskById(launch.taskId), state: 'needs-you', ask: 'Check failed launch', declaredAsk: 'Check failed launch', needsSince: Date.now() });
      throw new Error(`${error instanceof Error ? error.message : String(error)} Unresolved launch ${launch.id}: retry the same request key to recover its conversation. To abandon an unconfirmed launch explicitly, run bb agents abandon-launch ${launch.id}.`, { cause: error });
    }
  }
  async function openAgent(id: string) {
    return locked(`agent:${id}`, async () => {
      const agent = agentById(id);
      if (agent.threadId) {
        const pending = [...launches.values()].find(row => row.threadId === agent.threadId);
        if (pending) await finishLaunch(pending);
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
      if (previous) return { taskId: previous.taskId, threadId: await recoverLaunch(previous) };
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
      if (previous) return { threadId: await recoverLaunch(previous) };
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
  // Existing conversations stay ordinary BB threads. Only the board projection
  // is stored here: no launch metadata, prompts, model or history is changed.
  async function discoverExisting() {
    const rows = [...inventory.values()].filter(row => !row.archivedAt);
    const byId = new Map(rows.map(row => [row.id, row]));
    const managed = new Set([...launches.values()].flatMap(launch => launch.threadId ? [launch.threadId] : []));
    // Creation events may arrive before spawn returns its ID.
    for (const launch of launches.values()) if (launch.ordinary && !launch.threadId) {
      const pending = rows.find(row => row.title === `Agents launch ${launch.id}`);
      if (pending) managed.add(pending.id);
    }
    const rootFor = (row: ListedThread): string | null => {
      let root = row.visibility !== 'hidden' ? row.id : null;
      let current: ListedThread | undefined = row;
      const visited = new Set<string>();
      while (current && !visited.has(current.id)) {
        if (managed.has(current.id)) return null;
        visited.add(current.id);
        if (current.visibility !== 'hidden') root = current.id;
        current = current.parentThreadId ? inventory.get(current.parentThreadId) : undefined;
      }
      if (!root && row.parentThreadId) {
        let parent: string | null = row.parentThreadId; const seen = new Set<string>();
        while (parent && !seen.has(parent)) {
          if (managed.has(parent)) return null;
          if (tasks.has(`existing:${parent}`)) root = parent;
          seen.add(parent); parent = retainedParents.get(parent) ?? null;
        }
      }
      return root;
    };
    const groups = new Map<string, ListedThread[]>();
    for (const row of rows) {
      const root = rootFor(row); if (!root) continue;
      const group = groups.get(root) ?? []; group.push(row); groups.set(root, group);
    }
    const projects = new Map((await bb.sdk.projects.list({ includePersonal: true })).map(project => [project.id, project.name]));
    for (const [threadId] of groups) {
      if (disposed) return groups;
      const row = inventory.get(threadId); if (!row) continue; const id = `existing:${threadId}`;
      await locked(`task:${id}`, async () => {
      const previous = tasks.get(id);
      const task: StoredTask = previous ? { ...previous, title: row.title ?? row.titleFallback ?? 'Untitled task', projectId: row.projectId, projectName: projects.get(row.projectId) ?? row.projectId, updatedAt: row.updatedAt ?? previous.updatedAt }
        : { id, source: 'existing', agentId: 'general', threadId, title: row.title ?? row.titleFallback ?? 'Untitled task', projectId: row.projectId, projectName: projects.get(row.projectId) ?? row.projectId, state: 'queued', ask: null, declaredAsk: null, needsSince: null, etaAt: null, completed: 0, total: 0, runningAgents: 0, snoozeUntil: null, updatedAt: row.updatedAt ?? Date.now(), pendingWorkers: [], artifacts: [], execution: null, routingReason: null };
      if (JSON.stringify(task) !== JSON.stringify(previous)) await saveTask(task);
      });
    }
    const missing = [...tasks.values()].filter(task => task.source === 'existing' && task.threadId && !groups.has(task.threadId));
    for (const task of missing) {
      if (disposed) return groups;
      if (byId.has(task.threadId!)) {
        // Reparented conversations now belong to their visible root card.
        await locked(`task:${task.id}`, async () => { await bb.storage.kv.delete(`task:${task.id}`); tasks.delete(task.id); changed(); });
      }
    }
    const claimed = new Set([...groups.values()].flatMap(rows => rows.map(row => row.id)));
    for (const [root] of groups) groups.set(root, tree(root));
    for (const task of missing) if (!byId.has(task.threadId!)) groups.set(task.threadId!, tree(task.threadId!).filter(row => !claimed.has(row.id)));
    return groups;
  }
  async function reconcileTask(id: string, snapshot?: ListedThread[], transition?: number) {
    return locked(`task:${id}`, async () => {
      if (transition !== undefined && transition !== (transitions.get(id) ?? 0)) { dirty = true; inventoryDirty = true; return; }
      if (disposed) return;
      const old = taskById(id); if (!old.threadId) return;
      const rows = snapshot ?? await relatedThreads(old);
      const current = census(rows);
      const count = current.complete ? current.ids.size : null;
      const lead = rows.find(row => row.id === old.threadId);
      if (!lead && old.source === 'existing' && !rows.length) {
        await bb.storage.kv.delete(`task:${old.id}`); tasks.delete(old.id); changed(); return;
      }
      if (!lead) {
        const next = { ...old, runningAgents: count, pendingWorkers: [], ...(old.state === 'done' ? {} : { state: 'needs-you' as const, ask: 'Task conversation was deleted', needsSince: old.needsSince ?? Date.now() }) };
        if (JSON.stringify(next) !== JSON.stringify(old)) await saveTask(next);
        return;
      }
      const live = rows.filter(row => !row.archivedAt);
      const pendingWorkers: Task['pendingWorkers'] = [];
      for (const row of live) {
        if (row.hasPendingInteraction) pendingWorkers.push({ threadId: row.id, title: row.title ?? old.title });
      }
      let state = old.state; let ask = old.ask; const now = Date.now();
      const leadPhase = phases[lead.id];
      const runningPhases = rows.flatMap(row => {
        const phase = phases[row.id];
        return !row.archivedAt && phase?.kind === 'running' ? [phase] : [];
      });
      const phase = leadPhase?.kind === 'needs-you' || leadPhase?.kind === 'failed' ? leadPhase
        : runningPhases.sort((a, b) => b.etaAt - a.etaAt).find(() => true) ?? leadPhase;
      if (state === 'snoozed' && old.snoozeUntil !== null && old.snoozeUntil <= now) state = 'queued';
      if (lead.archivedAt) { state = 'done'; ask = null; }
      else if (state !== 'snoozed') {
        // Sidebar resolves execution, cards, reviews, CI and ETA. This layer
        // only adds board lifecycle and actionable worker questions.
        if (pendingWorkers.length) { state = 'needs-you'; ask = 'Answer a question'; }
        else if (phase?.kind === 'needs-you' || phase?.kind === 'failed') { state = 'needs-you'; ask = phase.reason; }
        else if (phase?.kind === 'running') { state = 'running'; ask = null; }
        else if (phase?.kind === 'done') {
          state = old.source === 'existing' && !old.reopenedAt ? 'done' : 'needs-you';
          ask = old.reopenedAt ? 'Continue task' : old.source === 'existing' ? null : 'Review result';
        }
        else { state = old.reopenedAt ? 'needs-you' : 'queued'; ask = old.reopenedAt ? 'Continue task' : null; }
      }
      const next = { ...old, state, ask, declaredAsk: null,
        archivedProjection: Boolean(lead.archivedAt), reopenedAt: phase && phase.kind !== 'done' ? undefined : old.reopenedAt, etaAt: state === 'running' && phase?.kind === 'running' ? phase.etaAt : null,
        snoozeUntil: state === 'snoozed' ? old.snoozeUntil : null, runningAgents: count, pendingWorkers,
        needsSince: state === 'needs-you' ? old.needsSince ?? now : null };
      if (JSON.stringify(next) !== JSON.stringify(old)) await saveTask(next);
    });
  }
  let censusRun: Promise<void> | undefined;
  let lastCensus = 0;
  async function refreshCensus() {
    if (disposed) return;
    if (censusRun) return censusRun;
    censusRun = (async () => {
      const deadline = Date.now() + 250;
      if (inventoryDirty || scanPending || Date.now() - inventoryAt >= 15000) await scanInventory(deadline);
      if (disposed || scanPending) return;
      await selectOwners();
      if (disposed) return;
      const owners = eligible;
      const coordinatorIds = [...agents.values()].flatMap(agent => agent.threadId ? [agent.threadId] : []);
      for (const id of coordinatorIds) { const row = inventory.get(id); if (row) owners.set(id, row); }
      for (const id of requested) if (!owners.has(id) || native.get(id)?.unavailable) requested.delete(id);

      const candidates = [...owners.values()].sort((a, b) => (serviced.get(a.id) ?? 0) - (serviced.get(b.id) ?? 0) || Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) || Number(b.status === 'active') - Number(a.status === 'active')).filter(row => {
        const state = native.get(row.id);
        const fingerprint = JSON.stringify([row.updatedAt, row.status, row.archivedAt, row.hasPendingInteraction, row.parentThreadId]);
        return !state?.unavailable && (!state?.complete || state.watching || requested.has(row.id) || fingerprints.get(row.id) !== fingerprint);
      });
      // Serve least-recently serviced owners first, then use spare budget
      // on unfinished pages. This pump runs independently of board projection.
      const count = candidates.length ? 8 : 0;
      const visited = new Set<string>();
      const checkpoints = new Map<string, NativeCensus>();
      const current = candidates.filter(row => !row.archivedAt);
      const historical = candidates.filter(row => row.archivedAt);
      const take = (queue: ListedThread[]) => {
        for (let attempts = 0; attempts < queue.length; attempts++) {
          const row = queue.shift()!; queue.push(row);
          const state = native.get(row.id);
          if (!state?.unavailable && (!visited.has(row.id) || !state?.complete && !state?.retryLater)) return row;
        }
      };
      for (let i = 0; i < count && Date.now() < deadline && !disposed; i++) {
        const useHistory = historical.length > 0 && (current.length === 0 || i % 4 === 3);
        const row = useHistory ? take(historical) ?? take(current) : take(current) ?? take(historical);
        if (!row) break;
        visited.add(row.id);
        serviced.set(row.id, ++serviceSequence);
        const state = native.get(row.id) ?? await restoreOwner(row.id);
        if (disposed) return;
        native.set(row.id, state);
        if (state.unavailable) { requested.delete(row.id); continue; }
        const revision = ownerRevisions.get(row.id) ?? 0;
        const previousFingerprint = fingerprints.get(row.id);
        const cursor = state.cursor; const complete = state.complete; const size = state.pageSize; const unavailable = state.unavailable;
        await state.refresh(bb.sdk.threads.events, row.id, 1, signalUntil(deadline));
        if (disposed) return;
        if (revision !== (ownerRevisions.get(row.id) ?? 0)) state.complete = false;
        if (state.unavailable) { requested.delete(row.id); bb.log.warn(`event_data_too_large: ${state.unavailable}`); }
        if (state.complete) {
          fingerprints.set(row.id, JSON.stringify([row.updatedAt, row.status, row.archivedAt, row.hasPendingInteraction, row.parentThreadId]));
          requested.delete(row.id);
        }
        if (cursor !== state.cursor || complete !== state.complete || size !== state.pageSize || unavailable !== state.unavailable || previousFingerprint !== fingerprints.get(row.id)) {
          checkpoints.set(row.id, state);
        }
      }
      // One atomic checkpoint per changed owner per bounded slice. Generic
      // pages can advance the cursor without rewriting the same state eight times.
      for (const [id, state] of checkpoints) { if (disposed) return; await persist(id, state); }
      await retireCheckpoints(deadline);
      lastCensus = Date.now();
    })().finally(() => { censusRun = undefined; if (!reconciliation) dirty = true; });
    return censusRun;
  }
  async function reconcile() {
    if (reconciliation) return reconciliation;
    if (!dirty && Date.now() - lastReconciled < 1000) return;
    dirty = false;
    reconciliation = (async () => {
      const before = new Map(transitions);
      await refreshCensus();
      if (disposed || scanPending) { dirty = true; return; }
      const existing = await discoverExisting();
      if (disposed) return;
      const snapshots = new Map<string, ListedThread[]>();
      for (const task of tasks.values()) {
        if (task.source !== 'existing' && task.threadId) snapshots.set(task.id, tree(task.threadId));
      }
      for (const launch of launches.values()) {
        if (disposed) return;
        if (launch.role !== 'task' || launch.ordinary || !launch.threadId || trackedLegacy.has(launch.threadId)) continue;
        const lead = snapshots.get(launch.taskId!)?.find(row => row.id === launch.threadId && !row.archivedAt && !row.deletedAt);
        if (!lead) continue;
        await trackLegacyOutline(bb, launch.threadId);
        trackedLegacy.add(launch.threadId);
      }
      const phaseIds = [...new Set([...existing.values(), ...snapshots.values()].flatMap(rows => rows.map(row => row.id)))];
      const nextPhases: Record<string, SidebarPhase> = {};
      for (let start = 0; start < phaseIds.length; start += 200) {
        if (disposed) return;
        Object.assign(nextPhases, await readSidebarPhases(bb, phaseIds.slice(start, start + 200)));
      }
      if (disposed) return;
      phases = nextPhases;
      for (const task of [...tasks.values()]) if (task.source === 'existing' && existing.has(task.threadId!)) await reconcileTask(task.id, existing.get(task.threadId!)!, before.get(task.id) ?? 0);
      for (const task of tasks.values()) if (task.source !== 'existing') await reconcileTask(task.id, snapshots.get(task.id), before.get(task.id) ?? 0);
      lastReconciled = Date.now();
    })().catch(error => { dirty = true; throw error; }).finally(() => {
      reconciliation = undefined;
      if (pendingPublish) { pendingPublish = false; changed(); }
    });
    return reconciliation;
  }
  async function completeTask(id: string) {
    return locked(`task:${id}`, async () => {
      const task = taskById(id); const rows = await relatedThreads(task);
      if (rows.some(row => !row.archivedAt && (working(row) || row.queuedWork !== 'none' || row.activity.activeBackgroundAgentCount > 0 || row.hasPendingInteraction))) throw new Error('Work is still running, queued, or awaiting a response. Resolve it in the chat before marking the task done.');
      for (const row of rows.filter(row => row.id !== task.threadId)) if (!row.archivedAt) await bb.sdk.threads.archive({ threadId: row.id });
      if (task.threadId) await bb.sdk.threads.archive({ threadId: task.threadId });
      transitions.set(id, (transitions.get(id) ?? 0) + 1); dirty = true; inventoryDirty = true; inventoryRevision++;
      await saveTask({ ...task, state: 'done', ask: null, declaredAsk: null, needsSince: null, snoozeUntil: null, runningAgents: 0, pendingWorkers: [], updatedAt: Date.now() }); return null;
    });
  }
  async function reopenTask(id: string, prompt?: string, senderThreadId?: string) {
    return locked(`task:${id}`, async () => {
      const task = taskById(id); if (!task.threadId) throw new Error('This task has no confirmed conversation to reopen.');
      const lead = await bb.sdk.threads.get({ threadId: task.threadId });
      if (lead.archivedAt) await bb.sdk.threads.unarchive({ threadId: lead.id });
      transitions.set(id, (transitions.get(id) ?? 0) + 1); dirty = true; inventoryDirty = true; inventoryRevision++;
      await saveTask({ ...task, ...(task.source === 'existing' ? { reopenedAt: Date.now() } : {}), state: 'needs-you', ask: 'Continue task', declaredAsk: null, needsSince: Date.now(), snoozeUntil: null, updatedAt: Date.now() });
      if (prompt) await bb.sdk.threads.send({ threadId: lead.id, mode: 'auto', input: [{ type: 'text', text: prompt, mentions: [] }], ...(senderThreadId ? { senderThreadId } : {}) }); return null;
    });
  }
  async function updateAgent(input: z.infer<typeof agentInputSchema>) {
    return locked('agent-save', async () => {
      const previous = input.id ? agentById(input.id) : null;
      if (input.projectId) await project(input.projectId);
      if (previous?.threadId && (previous.projectId !== input.projectId || JSON.stringify(previous.execution) !== JSON.stringify(input.execution))) throw new Error('Use the existing chat model picker, or create a new agent for another project.');
      const usage = new Map(avatarPool.map(avatar => [avatar, 0]));
      for (const agent of agents.values()) if (usage.has(agent.avatar)) usage.set(agent.avatar, usage.get(agent.avatar)! + 1);
      const fallback = avatarPool.reduce((best, avatar) => !best || usage.get(avatar)! < usage.get(best)! ? avatar : best, '');
      const avatar = previous ? input.avatar ?? previous.avatar : input.avatar || fallback;
      return saveAgent({ ...input, avatar, id: previous?.id ?? randomUUID(), threadId: previous?.threadId ?? null });
    });
  }
  if (disposed) return;
  bb.rpc.register(rpcContract, {
    board: async () => {
      await reconcile();
      const current = census([...eligible.values()]);
      const complete = inventoryComplete && !inventoryDirty && !scanPending && current.complete;
      const executions = current.ids;
      return { agents: [...agents.values()], tasks: [...tasks.values()].map(task => scanPending || inventoryDirty ? { ...task, runningAgents: null } : task).sort((a, b) => b.updatedAt - a.updatedAt), runningAgents: complete ? executions.size : null };
    },
    openAgent: ({ agentId }) => openAgent(agentId), saveAgent: updateAgent,
    completeTask: ({ taskId }) => completeTask(taskId), reopenTask: ({ taskId }) => reopenTask(taskId),
    snoozeTask: ({ taskId, until }) => locked(`task:${taskId}`, async () => {
      if (until !== null && until <= Date.now()) throw new Error('Choose a future snooze time.');
      const task = taskById(taskId); if (task.state === 'done') throw new Error('Reopen this task before snoozing it.');
      transitions.set(taskId, (transitions.get(taskId) ?? 0) + 1); dirty = true;
      await saveTask({ ...task, state: 'snoozed', snoozeUntil: until, updatedAt: Date.now() }); return null;
    }),
  });
  bb.agents.registerTool({ name: 'agents_create_task', description: 'Create one standalone board task with a self-contained brief. Reuse requestKey on retries. Independent tasks may run in parallel. Code changes default to an isolated worktree.', parameters: taskInput, execute: async (input, ctx) => result(await createTask(input, ctx)) });
  bb.agents.registerTool({ name: 'agents_spawn_worker', description: 'Delegate a substantial independent part of this task. Workers share its workspace by default: give non-overlapping scopes. Recursive delegation shares one worker budget. Reuse requestKey on retries.', parameters: taskInput, execute: async (input, ctx) => result(await spawnWorker(input, ctx)) });
  bb.agents.registerTool({ name: 'agents_update_task_details', description: 'Optional task-leader result links and measured step counts. Use the standard progress_card_update tool for status, user requests and ETA.', parameters: z.object({
    completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(),
    artifacts: z.array(z.object({ title: z.string().max(180), url: z.string().url().refine(url => /^https?:\/\//.test(url), 'Use an HTTP or HTTPS result link.') })).max(40).optional(),
  }), execute: async (input, ctx) => {
    const owner = caller(ctx); if (owner.role !== 'task' || !owner.taskId) throw new Error('Only the task leader changes task details.');
    if (input.completed > input.total) throw new Error('Completed steps cannot exceed total steps.');
    return locked(`task:${owner.taskId}`, async () => {
      const task = taskById(owner.taskId!); if (task.state === 'done') throw new Error('The task is already archived.');
      await saveTask({ ...task, completed: input.completed, total: input.total, artifacts: input.artifacts ?? task.artifacts, updatedAt: Date.now() });
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
    const launch = [...launches.values()].find(row => row.threadId === ctx.thread.id)
      ?? (typeof ctx.pluginMetadata.launchId === 'string' ? launches.get(ctx.pluginMetadata.launchId) : undefined);
    if (!launch || (launch.threadId && launch.threadId !== ctx.thread.id)) return { tools: [], skills: [] };
    // Session configuration can precede the spawn response.
    if (!launch.threadId) launch.threadId = ctx.thread.id;
    const agent = agents.get(launch.agentId); if (!agent) return { tools: [], skills: [] };
    const tools = launch.role === 'coordinator' ? ['agents_create_task', 'agents_list_tasks', 'agents_manage_agent', 'agents_reopen_task']
      : ['agents_spawn_worker', 'agents_list_tasks', ...(launch.role === 'task' ? ['agents_update_task_details'] : [])];
    return { tools, skills: [], instructions: roleInstructions({ role: launch.role, agentName: agent.name, agentId: agent.id, taskId: launch.taskId, instructions: agent.instructions, maxWorkers }) };
  });
  async function onChange(thread: Thread, clearAsk = false) {
    invalidate(thread.id);
    const launch = [...launches.values()].find(row => row.threadId === thread.id); if (!launch) { changed(); return; }
    if (launch.taskId) {
      if (launch.role === 'task' && !thread.archivedAt && taskById(launch.taskId).state === 'done') await locked(`task:${launch.taskId}`, async () => {
        const task = taskById(launch.taskId!);
        await saveTask({ ...task, state: 'queued', ask: null, declaredAsk: null, needsSince: null });
      });
      if (clearAsk && launch.role === 'task') await locked(`task:${launch.taskId}`, async () => {
        await saveTask({ ...taskById(launch.taskId!), declaredAsk: null, ask: null, needsSince: null, updatedAt: Date.now() });
      });
      changed();
    } else changed();
  }
  bb.events.on('thread.created', ({ thread }) => { invalidate(thread.id); changed(); });
  bb.events.on('thread.active', ({ thread }) => onChange(thread, true));
  bb.events.on('thread.idle', ({ thread }) => onChange(thread));
  bb.events.on('thread.failed', ({ thread }) => onChange(thread));
  bb.events.on('thread.archived', ({ thread }) => onChange(thread));
  bb.events.on('thread.unarchived', ({ thread }) => onChange(thread));
  bb.events.on('thread.deleted', ({ thread }) => onChange(thread));
  bb.events.on('interaction.pending', ({ thread }) => onChange(thread));
  let censusPublishedAt = 0;
  function publishCensus() {
    if (disposed) return;
    const delay = 1000 - (Date.now() - censusPublishedAt);
    if (delay <= 0) {
      if (censusNotification) clearTimeout(censusNotification);
      censusNotification = undefined; censusPublishedAt = Date.now(); changed();
    } else if (!censusNotification) censusNotification = setTimeout(() => {
      censusNotification = undefined; publishCensus();
    }, delay);
  }
  if (disposed) return;
  timer = setInterval(() => {
    const catchingUp = scanPending || [...eligible.keys()].some(id => { const state = native.get(id); return !state || !state.complete && !state.unavailable; }) || requested.size > 0 || [...manifests].some(([id, value]) => value.chunks > 0 && !eligible.has(id));
    if (!inventoryComplete || inventoryDirty || catchingUp || Date.now() - lastCensus >= 15000) {
      void refreshCensus().then(publishCensus).catch(error => { if (!disposed) bb.log.warn(String(error)); });
    }
  }, 100);
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
