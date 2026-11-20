// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import { CHANGED, rpcContract, type Agent, type Task } from './shared';

vi.mock('./chat', () => ({ Chat: ({ threadId, focusRequest, voiceRequest }: { threadId: string; focusRequest?: number; voiceRequest?: number }) => <div data-testid="agents-chat" data-thread-id={threadId} data-focus-request={focusRequest} data-voice-request={voiceRequest} /> }));

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

describe('Agents board interactions', () => {
  it('routes agent, task, and blocked worker conversations independently', async () => {
    const slot = mount();
    await slot.findByRole('button', { name: 'Chat with Ads' });
    fireEvent.click(slot.getByRole('button', { name: 'Chat with Ads' }));
    await waitFor(() => expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('ads-thread'));
    fireEvent.click(slot.getByRole('button', { name: /Review campaign.*Marketing/ }));
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('task-thread');
    expect(slot.queryByRole('button', { name: 'Chat with Ads' })).toBeNull();
    fireEvent.click(slot.getByRole('button', { name: 'Permission needed' }));
    const approval = slot.getByRole('dialog', { name: 'Worker approval' });
    expect(within(approval).getByTestId('bb-thread-chat').getAttribute('data-thread-id')).toBe('worker-thread');
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('task-thread');
    fireEvent.click(slot.getByRole('button', { name: 'Back to task' }));
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('task-thread');
    fireEvent.click(slot.getByRole('button', { name: 'Board' }));
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('ads-thread');
    expect(slot.inspection.rpcCalls.filter(call => call.method === 'openAgent')).toHaveLength(1);
  });

  it('shares one resizable column and keeps the root control mounted through inbox and task navigation', async () => {
    const slot = mount();
    await slot.findByRole('button', { name: 'Chat with General' });
    fireEvent.click(slot.getByRole('button', { name: 'Open chat' }));
    await slot.findByTestId('agents-chat');
    const rootControl = slot.getByRole('button', { name: 'Board' });
    const canvas = slot.container.querySelector('.fa-canvas');
    const footer = slot.container.querySelector('.fa-footer');
    fireEvent.click(slot.getByRole('button', { name: 'Show inbox' }));
    expect(slot.getByRole('button', { name: 'Inbox' })).toBe(rootControl);
    const column = slot.getByRole('complementary', { name: 'Conversations' });
    expect(column.querySelector('.fa-inbox')).not.toBeNull();
    expect(column.querySelector('.fa-chat')).not.toBeNull();
    const handles = within(column).getAllByRole('separator');
    expect(handles).toHaveLength(2);
    fireEvent.keyDown(handles[0]!, { key: 'ArrowRight' });
    expect(handles.map(handle => handle.getAttribute('aria-valuenow'))).toEqual(['380', '380']);
    expect(localStorage.getItem('fluently-agents.communication-width')).toBe('380');
    fireEvent.click(within(slot.getByRole('region', { name: 'Needs you' })).getByRole('button', { name: /Review campaign/ }));
    expect(slot.getByRole('button', { name: 'Inbox' })).toBe(rootControl);
    expect(slot.container.querySelector('.fa-canvas')).toBe(canvas);
    expect(slot.container.querySelector('.fa-footer')).toBe(footer);
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('task-thread');
  });

  it('ignores an earlier openAgent response after another agent was selected', async () => {
    let finishGeneral!: (result: { threadId: string }) => void;
    const deferred = new Promise<{ threadId: string }>(resolve => { finishGeneral = resolve; });
    const slot = mount({ openAgent: input => input.agentId === 'general' ? deferred : { threadId: 'ads-thread' } });
    await slot.findByRole('button', { name: 'Chat with General' });
    fireEvent.click(slot.getByRole('button', { name: 'Chat with General' }));
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
    fireEvent.click(await slot.findByRole('button', { name: /Review campaign.*Marketing/ }));
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
    await waitFor(() => expect(slot.queryByRole('button', { name: /Review campaign.*Marketing/ })).toBeNull());
    expect(slot.getByText('Nothing needs your attention.')).not.toBeNull();
  });

  it('advances to the next inbox task after completion', async () => {
    const nextTask = { ...reviewTask, id: 'next', title: 'Review landing', threadId: 'next-thread', pendingWorkers: [] };
    let current = { ...boardData, tasks: [reviewTask, nextTask] };
    const slot = mount({ board: () => current, completeTask: () => { current = { ...current, tasks: [nextTask] }; return null; } });
    await slot.findByRole('button', { name: 'Show inbox' });
    await slot.findByRole('button', { name: /Review campaign.*Marketing/ });
    fireEvent.click(slot.getByRole('button', { name: 'Show inbox' }));
    fireEvent.click(within(slot.getByRole('region', { name: 'Needs you' })).getByRole('button', { name: /Review campaign/ }));
    fireEvent.click(slot.getByRole('button', { name: 'Mark task done' }));
    await waitFor(() => expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('next-thread'));
    expect(slot.getByRole('button', { name: 'Inbox' })).not.toBeNull();
  });

  it('does not override newer task navigation when a prior completion resolves', async () => {
    let finish!: () => void;
    const completed = new Promise<null>(resolve => { finish = () => resolve(null); });
    const slot = mount({ completeTask: () => completed });
    fireEvent.click(await slot.findByRole('button', { name: /Review campaign.*Marketing/ }));
    fireEvent.click(slot.getByRole('button', { name: 'Mark task done' }));
    fireEvent.click(slot.getByRole('button', { name: 'Board' }));
    fireEvent.click(slot.getByRole('button', { name: /Prepare creatives/ }));
    await act(async () => { finish(); await completed; });
    expect(slot.getByTestId('agents-chat').getAttribute('data-thread-id')).toBe('running-thread');
  });

});
