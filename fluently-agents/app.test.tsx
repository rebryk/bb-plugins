// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import { CHANGED, rpcContract, type Agent, type Task } from './shared';

vi.mock('./chat', () => ({ Chat: ({ threadId, focusRequest, voiceRequest, composerAgents, onVoiceContextMenu }: import('./chat').ChatProps) => <div data-testid="agents-chat" data-thread-id={threadId} data-focus-request={focusRequest} data-voice-request={voiceRequest}>{composerAgents}<button aria-label="Record voice message" onContextMenu={onVoiceContextMenu} /></div> }));

const general: Agent = { id: 'general', name: 'General', avatar: '', instructions: '', projectId: null, threadId: 'general-thread', execution: null };
const ads: Agent = { ...general, id: 'ads', name: 'Ads', threadId: 'ads-thread' };
const reviewTask: Task = {
  id: 'review', agentId: 'ads', threadId: 'task-thread', title: 'Review campaign',
  projectId: 'project', projectName: 'Marketing', state: 'needs-you', ask: 'Approve direction',
  needsSince: Date.now() - 60000, etaAt: null, completed: 1, total: 3, runningAgents: 0,
  snoozeUntil: null, updatedAt: Date.now(), execution: null, routingReason: null,
  pendingWorkers: [{ threadId: 'worker-thread', title: 'Permission needed' }], artifacts: [],
};
const runningTask: Task = { ...reviewTask, id: 'running', title: 'Prepare creatives', state: 'running', threadId: 'running-thread', ask: null, runningAgents: 3, pendingWorkers: [] };
const boardData = { agents: [general, ads], tasks: [reviewTask, runningTask], runningAgents: 3 };
let app: Awaited<ReturnType<typeof loadPluginApp>>;
beforeAll(async () => { app = await loadPluginApp(() => import('./app')); });
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), clear: () => values.clear() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount(overrides: {
  board?: () => typeof boardData | Promise<typeof boardData>;
  openAgent?: (input: { agentId: string }) => { threadId: string } | Promise<{ threadId: string }>;
  completeTask?: (input: { taskId: string }) => null | Promise<null>;
} = {}) {
  return renderSlot<{ subPath: string }, typeof rpcContract>(app.navPanels[0]!, { subPath: '' }, {
    pluginId: 'fluently-agents', experimental_rpcContract: rpcContract,
    rpc: {
      board: overrides.board ?? (() => structuredClone(boardData)),
      openAgent: overrides.openAgent ?? (input => ({ threadId: `${input.agentId}-thread` })),
      saveAgent: input => ({ ...general, ...input, id: input.id ?? 'new-agent' }),
      completeTask: overrides.completeTask ?? (() => null),
      snoozeTask: () => null,
      reopenTask: () => null,
    },
  });
}

async function selectReview(slot: ReturnType<typeof mount>) {
  await slot.findByRole('region', { name: 'Tasks' });
}

describe('Agents board interactions', () => {
  it('does not activate composer shortcuts behind an open image dialog', async () => {
    const slot = mount(); await slot.findByRole('button', { name: 'Chat with General' });
    const chat = slot.getByTestId('agents-chat');
    const initial = chat.getAttribute('data-focus-request');
    const dialog = document.createElement('dialog'); dialog.open = true; chat.append(dialog);
    fireEvent.keyDown(document, { key: 'n' });
    expect(chat.getAttribute('data-focus-request')).toBe(initial);
    dialog.remove(); fireEvent.keyDown(document, { key: 'n' });
    expect(chat.getAttribute('data-focus-request')).not.toBe(initial);
  });

  it('routes agent, task, and blocked worker conversations independently', async () => {
    const slot = mount();
    await slot.findByRole('button', { name: 'Chat with Ads' });
    fireEvent.click(slot.getByRole('button', { name: 'Chat with Ads' }));
    await waitFor(() => expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('ads-thread'));
    await selectReview(slot);
    fireEvent.click(slot.getByRole('button', { name: /Approve direction.*Review campaign/ }));
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('task-thread');
    expect(slot.getByRole('button', { name: 'Chat with Ads' })).not.toBeNull();
    fireEvent.click(slot.getByRole('button', { name: 'Permission needed' }));
    const approval = slot.getByRole('dialog', { name: 'Worker approval' });
    expect(within(approval).getByTestId('bb-thread-chat').getAttribute('data-thread-id')).toBe('worker-thread');
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('task-thread');
    fireEvent.click(slot.getByRole('button', { name: 'Back to task' }));
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('task-thread');
    fireEvent.click(slot.getByRole('button', { name: 'Back to board' }));
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('ads-thread');
    expect(slot.inspection.rpcCalls.filter(call => call.method === 'openAgent')).toHaveLength(1);
  });


  it('ignores an earlier openAgent response after another agent was selected', async () => {
    let finishGeneral!: (result: { threadId: string }) => void;
    const deferred = new Promise<{ threadId: string }>(resolve => { finishGeneral = resolve; });
    const slot = mount({ board: () => ({ ...boardData, agents: [{ ...general, threadId: null }, ads] }), openAgent: input => input.agentId === 'general' ? deferred : { threadId: 'ads-thread' } });
    await slot.findByRole('button', { name: 'Chat with General' });
    fireEvent.click(slot.getByRole('button', { name: 'Chat with Ads' }));
    await waitFor(() => expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('ads-thread'));
    await act(async () => { finishGeneral({ threadId: 'general-thread' }); await deferred; });
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('ads-thread');
    expect(slot.getByRole('button', { name: 'Chat with Ads' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('anchors agent menus above their avatars, saves a rename, and closes on outside click', async () => {
    const slot = mount();
    const avatar = await slot.findByRole('button', { name: 'Chat with Ads' });
    const root = slot.container.querySelector('.fa-app')!;
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 0, right: 900, bottom: 700, width: 800, height: 700, x: 100, y: 0, toJSON: () => ({}) });
    vi.spyOn(avatar, 'getBoundingClientRect').mockReturnValue({ left: 170, top: 652, right: 198, bottom: 680, width: 28, height: 28, x: 170, y: 652, toJSON: () => ({}) });
    fireEvent.contextMenu(avatar);
    expect(slot.getByRole('menu').style.left).toBe('70px');
    expect(slot.getByRole('menu').style.bottom).toBe('56px');
    fireEvent.click(slot.getByRole('menuitem', { name: 'Rename' }));
    fireEvent.change(slot.getByRole('textbox', { name: 'Agent name' }), { target: { value: 'Growth' } });
    fireEvent.click(slot.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(slot.queryByRole('dialog')).toBeNull());
    expect(slot.inspection.rpcCalls).toContainEqual({ method: 'saveAgent', input: { id: 'ads', name: 'Growth', avatar: '', instructions: '', projectId: null, execution: null } });
    fireEvent.contextMenu(avatar);
    fireEvent.pointerDown(root);
    expect(slot.queryByRole('menu')).toBeNull();
  });

  it('shows failed task actions without navigating away or pretending completion', async () => {
    const slot = mount({ completeTask: () => { throw new Error('Could not archive this thread'); } });
    await selectReview(slot);
    fireEvent.click(await slot.findByRole('button', { name: /Approve direction.*Review campaign/ }));
    fireEvent.click(slot.getByRole('button', { name: 'Mark task done' }));
    expect((await slot.findByRole('alert')).textContent).toContain('Could not archive this thread');
    expect(slot.getByRole('button', { name: 'Mark task done' })).not.toBeNull();
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('task-thread');
  });

  it('reconciles realtime board changes and focuses N only outside text inputs', async () => {
    let current = structuredClone(boardData);
    const slot = mount({ board: () => current });
    await slot.findByRole('button', { name: 'Chat with General' });
    fireEvent.keyDown(window, { key: 'n' });
    const chat = await slot.findByTestId('agents-chat');
    const initialFocus = Number(chat.getAttribute('data-focus-request'));
    fireEvent.keyDown(window, { key: 'n' });
    expect(Number(chat.getAttribute('data-focus-request'))).toBe(initialFocus + 1);
    fireEvent.contextMenu(slot.getByRole('button', { name: 'Chat with General' }));
    fireEvent.click(slot.getByRole('menuitem', { name: 'Rename' }));
    fireEvent.keyDown(slot.getByRole('textbox', { name: 'Agent name' }), { key: 'n' });
    expect(Number(chat.getAttribute('data-focus-request'))).toBe(initialFocus + 1);
    fireEvent.keyDown(window, { key: 'Escape' });
    current = { ...current, tasks: [] };
    await slot.behavior.emitRealtime(CHANGED, null);
    await waitFor(() => expect(slot.queryByRole('button', { name: /Approve direction.*Review campaign/ })).toBeNull());
    expect(slot.getAllByText('All caught up.')[0]).not.toBeNull();
  });

  it('advances to the next inbox task after completion', async () => {
    const nextTask = { ...reviewTask, id: 'next', title: 'Review landing', threadId: 'next-thread', pendingWorkers: [] };
    let current = { ...boardData, tasks: [reviewTask, nextTask] };
    const slot = mount({ board: () => current, completeTask: () => { current = { ...current, tasks: [nextTask] }; return null; } });
    await selectReview(slot);
    await slot.findByRole('button', { name: /Approve direction.*Review campaign/ });
    fireEvent.click(within(slot.getByRole('region', { name: 'Tasks' })).getByRole('button', { name: /Review campaign/ }));
    fireEvent.click(slot.getByRole('button', { name: 'Mark task done' }));
    await waitFor(() => expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('next-thread'));
    expect(slot.getByRole('button', { name: 'Back to board' })).not.toBeNull();
  });

  it('does not override newer task navigation when a prior completion resolves', async () => {
    let finish!: () => void;
    const completed = new Promise<null>(resolve => { finish = () => resolve(null); });
    const slot = mount({ completeTask: () => completed });
    await selectReview(slot);
    fireEvent.click(await slot.findByRole('button', { name: /Approve direction.*Review campaign/ }));
    fireEvent.click(slot.getByRole('button', { name: 'Mark task done' }));
    fireEvent.click(slot.getByRole('button', { name: 'Back to board' }));
    fireEvent.click(slot.getByRole('button', { name: /Running/ }));
    fireEvent.click(within(slot.getByRole('region', { name: 'Tasks' })).getByRole('button', { name: /Prepare creatives/ }));
    await act(async () => { finish(); await completed; });
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('running-thread');
  });

  it('does not send worker voice to a coordinator before the task thread exists', async () => {
    const slot = mount({ board: () => ({ ...boardData, tasks: [{ ...reviewTask, threadId: null }] }) });
    await slot.findByTestId('agents-chat');
    fireEvent.contextMenu(slot.getByRole('button', { name: 'Record voice message' }));
    fireEvent.click(slot.getByRole('menuitem', { name: 'Voice input' }));
    fireEvent.click(slot.getByRole('button', { name: /Approve direction.*Review campaign/ }));
    fireEvent.keyDown(window, { key: 'n' });
    expect(slot.getByRole('button', { name: 'Chat with task worker' }).getAttribute('aria-pressed')).toBe('true');
    expect(slot.inspection.rpcCalls.filter(call => call.method === 'openAgent')).toHaveLength(0);
  });

  it('preserves a coordinator chosen while task completion is pending', async () => {
    let finish!: () => void;
    const pending = new Promise<null>(resolve => { finish = () => resolve(null); });
    const slot = mount({ completeTask: () => pending });
    await selectReview(slot);
    fireEvent.click(slot.getByRole('button', { name: /Approve direction.*Review campaign/ }));
    fireEvent.click(slot.getByRole('button', { name: 'Mark task done' }));
    fireEvent.click(slot.getByRole('button', { name: 'Chat with Ads' }));
    await waitFor(() => expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('ads-thread'));
    await act(async () => { finish(); await pending; });
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('ads-thread');
    expect(slot.getByText('Task')).not.toBeNull();
  });

  it('shows the saved coordinator by default and never closes it from its controls', async () => {
    const slot = mount(); const chat = await slot.findByTestId('agents-chat');
    expect(chat.getAttribute('data-thread-id')).toBe('general-thread');
    expect(slot.inspection.rpcCalls.filter(call => call.method === 'openAgent')).toHaveLength(0);
    fireEvent.click(slot.getByRole('button', { name: 'Chat with General' }));
    fireEvent.keyDown(window, { key: 'n' });
    expect(slot.getByTestId('agents-chat')).toBe(chat);
    expect(slot.inspection.rpcCalls.filter(call => call.method === 'openAgent')).toHaveLength(1);
  });

  it('opens a missing default conversation once and does not retry failures on board updates', async () => {
    const openAgent = vi.fn(async () => { throw new Error('Cannot open coordinator'); });
    const slot = mount({ board: () => ({ ...boardData, agents: [{ ...general, threadId: null }] }), openAgent });
    await slot.findByRole('alert'); await slot.behavior.emitRealtime(CHANGED, null);
    expect(openAgent).toHaveBeenCalledTimes(1);
    fireEvent.click(slot.getByRole('button', { name: 'Open General conversation' }));
    await waitFor(() => expect(openAgent).toHaveBeenCalledTimes(2));
  });


  it('keeps a task selected when automatic coordinator creation finishes late', async () => {
    let finish!: (value: { threadId: string }) => void;
    const pending = new Promise<{ threadId: string }>(resolve => { finish = resolve; });
    const slot = mount({ board: () => ({ ...boardData, agents: [{ ...general, threadId: null }] }), openAgent: () => pending });
    fireEvent.click(await slot.findByRole('button', { name: 'Chat with General' }));
    fireEvent.click(slot.getByRole('button', { name: 'Chat with General' }));
    await selectReview(slot);
    fireEvent.click(slot.getByRole('button', { name: /Approve direction.*Review campaign/ }));
    await act(async () => { finish({ threadId: 'created-thread' }); await pending; });
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('task-thread');
    fireEvent.click(slot.getByRole('button', { name: 'Back to board' }));
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('created-thread');
    expect(slot.inspection.rpcCalls.filter(call => call.method === 'openAgent')).toHaveLength(1);
  });

  it('validates and unarchives an existing coordinator on explicit clicks without hiding its chat', async () => {
    let finish!: (value: { threadId: string }) => void;
    const pending = new Promise<{ threadId: string }>(resolve => { finish = resolve; });
    const openAgent = vi.fn(() => pending); const slot = mount({ openAgent });
    const chat = await slot.findByTestId('agents-chat'); expect(openAgent).not.toHaveBeenCalled();
    fireEvent.click(slot.getByRole('button', { name: 'Chat with General' }));
    fireEvent.click(slot.getByRole('button', { name: 'Chat with General' }));
    await waitFor(() => expect(openAgent).toHaveBeenCalledTimes(1)); expect(openAgent).toHaveBeenCalledWith({ agentId: 'general' });
    expect(slot.getByTestId('agents-chat')).toBe(chat);
    expect(Number(chat.getAttribute('data-focus-request'))).toBe(2);
    await selectReview(slot);
    fireEvent.click(slot.getByRole('button', { name: /Approve direction.*Review campaign/ }));
    await act(async () => { finish({ threadId: 'general-thread' }); await pending; });
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('task-thread');
  });




  it('places coordinator avatars in the composer slot and exposes input mode from voice context menu', async () => {
    const slot = mount(); const chat = await slot.findByTestId('agents-chat');
    expect(chat.contains(slot.getByRole('button', { name: 'Chat with Ads' }))).toBe(true);
    expect(slot.container.querySelector('.fa-footer')).toBeNull();
    fireEvent.contextMenu(slot.getByRole('button', { name: 'Record voice message' }));
    fireEvent.click(slot.getByRole('menuitem', { name: 'Voice input' }));
    fireEvent.keyDown(window, { key: 'n' });
    expect(Number(chat.getAttribute('data-voice-request'))).toBeGreaterThan(0);
    await selectReview(slot);
    fireEvent.click(slot.getByRole('button', { name: /Approve direction.*Review campaign/ }));
    expect(slot.getByRole('button', { name: 'Chat with Ads' })).not.toBeNull();
    expect(slot.getByRole('button', { name: 'Record voice message' })).not.toBeNull();
  });

  it('keeps the task panel and selected task while switching conversation targets', async () => {
    const slot = mount(); await slot.findByTestId('agents-chat');
    const lists = () => Array.from(slot.container.querySelectorAll('.fa-communications > section')).map(el => el.getAttribute('aria-label'));
    expect(lists()).toEqual(['Tasks', 'Chat']);
    fireEvent.click(slot.getByRole('button', { name: /Running/ }));
    fireEvent.click(within(slot.getByRole('region', { name: 'Tasks' })).getByRole('button', { name: /Prepare creatives/ }));
    expect(lists()).toEqual(['Tasks', 'Chat']);
    fireEvent.click(slot.getByRole('button', { name: 'Chat with Ads' }));
    await waitFor(() => expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('ads-thread'));
    expect(slot.getByText('Task')).not.toBeNull();
    fireEvent.click(slot.getByRole('button', { name: 'Chat with task worker' }));
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('running-thread');
    fireEvent.click(slot.getByRole('button', { name: 'Board' }));
    expect(slot.queryByText('Task')).toBeNull();
    expect(slot.container.querySelectorAll('.fa-board-card')).toHaveLength(2);
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('ads-thread');
  });
  it('defaults to Inbox and switches lists without remounting chat or changing selection', async () => {
    const slot = mount(); await slot.findByTestId('agents-chat');
    const tasks = slot.getByRole('region', { name: 'Tasks' });
    expect(slot.getByRole('button', { name: /Inbox 1/ }).getAttribute('aria-pressed')).toBe('true');
    expect(within(tasks).queryByRole('button', { name: /Prepare creatives/ })).toBeNull();
    fireEvent.click(within(tasks).getByRole('button', { name: /Approve direction/ }));
    const chat = slot.getByTestId('agents-chat');
    const draft = document.createElement('textarea'); draft.value = 'Unsent draft'; chat.append(draft);
    fireEvent.click(slot.getByRole('button', { name: /Running 1/ }));
    expect(within(tasks).getByRole('button', { name: /Prepare creatives/ })).not.toBeNull();
    expect(slot.getByTestId('agents-chat')).toBe(chat);
    expect(chat.getAttribute('data-thread-id')).toBe('task-thread');
    expect(draft.value).toBe('Unsent draft');
    expect(slot.getByText('Task')).not.toBeNull();
    fireEvent.click(slot.getByRole('button', { name: 'Collapse tasks' }));
    fireEvent.click(slot.getByRole('button', { name: /Inbox 1/ }));
    expect(slot.getByRole('button', { name: 'Expand tasks' }).getAttribute('aria-expanded')).toBe('false');
    expect(slot.getByTestId('agents-chat')).toBe(chat);
    fireEvent.click(slot.getByRole('button', { name: 'Expand tasks' }));
    expect(within(tasks).getByRole('button', { name: /Approve direction/ }).className).toContain('fa-active');
  });
  it('persists a bounded keyboard-resizable sidebar', async () => {
    const slot = mount(); await slot.findByTestId('agents-chat');
    const handle = slot.getByRole('separator', { name: 'Sidebar width' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle.getAttribute('aria-valuenow')).toBe('456');
    expect(localStorage.getItem('fluently-agents.sidebar-width')).toBe('456');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(handle.getAttribute('aria-valuenow')).toBe('280');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(Number(handle.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(window.innerWidth - 300);
  });
});
