// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginBrowserBbSdk } from '@get-bb/plugin-sdk/app';
import { Chat, mergeRows, reconcileRows, removeSubmittedDraft, type ChatProps, type ChatRow } from './chat';
const voice = vi.hoisted(() => ({ state: 'idle' as const, level: 0, toggle: vi.fn(), cancel: vi.fn(), retry: vi.fn(), onTranscript: null as ((value: string) => void) | null }));
vi.mock('./voice', () => ({ useVoiceTranscript: (options: { onTranscript(value: string): void }) => { voice.onTranscript = options.onTranscript; return voice; } }));
beforeEach(() => { const values = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const row = (id: string, seq: number, text: string, role: 'assistant' | 'user' = 'assistant') => ({ kind: 'conversation', role, id, sourceSeqStart: seq, sourceSeqEnd: seq, text, attachments: null }) as ChatRow;
function mount(options: { send?: () => Promise<unknown>; interactions?: unknown[]; status?: string; rows?: ChatRow[]; subscribe?: PluginBrowserBbSdk['subscribe'] } = {}, props: Partial<ChatProps> = {}) {
  return renderSlot({ component: Chat }, { threadId: 'thread-a', ...props }, { sdk: { subscribe: options.subscribe ?? (() => () => {}), threads: {
    storageLocation: async () => ({ hostId: 'host-a', storageRootPath: '/storage/thread-a' }),
    timeline: async () => ({ rows: options.rows ?? [row('a', 1, 'Hello'), row('b', 2, 'My reply', 'user')], timelinePage: { olderCursor: null }, maxSeq: 2 }),
    get: async () => ({ id: 'thread-a', projectId: 'project-a', status: options.status || 'idle' }),
    interactions: { list: async () => options.interactions ?? [], resolve: async () => ({}) },
    queuedMessages: { list: async () => [] },
    send: options.send ?? (async () => ({})),
    stop: async () => ({}),
  } as unknown as PluginBrowserBbSdk['threads'] } });
}
describe('Custom conversation', () => {
  it('renders custom messages and sends through the original thread without permission overrides', async () => {
    const slot = mount(); await slot.findByText('Hello');
    expect(slot.container.querySelector('.fa-message-user')?.textContent).toBe('My reply');
    expect(slot.queryByTestId('bb-thread-chat')).toBeNull();
    fireEvent.change(slot.getByRole('textbox', { name: 'Message' }), { target: { value: 'New task' } });
    fireEvent.click(slot.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect((slot.getByRole('textbox') as HTMLTextAreaElement).value).toBe(''));
    expect(slot.inspection.sdkCalls.find(call => call.method === 'threads.send')).toMatchObject({ args: [{ threadId: 'thread-a', mode: 'queue-if-active', input: [{ type: 'text', text: 'New task', mentions: [] }] }] });
  });
  it('collapses internal activity while keeping conversation messages visible', async () => {
    const events = [1, 2].map(seq => ({ kind: 'system', id: `event-${seq}`, sourceSeqStart: seq, sourceSeqEnd: seq, title: `Internal event ${seq}`, status: 'completed', detail: 'Diagnostic output' }) as ChatRow);
    const slot = mount({ rows: [...events, row('answer', 3, 'Result')] });
    await slot.findByText('Result');
    expect(slot.queryByText('Internal event 1')).toBeNull();
    const group = slot.getByText('Activity · 2').closest('details')!;
    group.open = true; fireEvent(group, new Event('toggle'));
    await slot.findByText('Internal event 1');
    expect(slot.getByText('Result')).toBeTruthy();
    group.open = false; fireEvent(group, new Event('toggle'));
    await waitFor(() => expect(slot.queryByText('Internal event 1')).toBeNull());
  });
  it('keeps the draft on ambiguous send failure and never retries automatically', async () => {
    const send = vi.fn(async () => { throw new Error('Connection lost'); }); const slot = mount({ send }); await slot.findByText('Hello');
    fireEvent.change(slot.getByRole('textbox'), { target: { value: 'Keep this draft' } }); fireEvent.click(slot.getByRole('button', { name: 'Send message' }));
    await slot.findByRole('alert'); expect((slot.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep this draft'); expect(send).toHaveBeenCalledTimes(1);
  });
  it('blocks normal sends behind an interaction and keeps advanced controls explicit', async () => {
    const slot = mount({ interactions: [{ id: 'i', payload: { kind: 'form', title: 'Question' } }] }); await slot.findByText('Your input is needed');
    fireEvent.change(slot.getByRole('textbox'), { target: { value: 'Not an approval' } }); expect((slot.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(slot.getByRole('button', { name: 'Review request' })); expect(slot.getByRole('dialog').getAttribute('aria-label')).toBe('Review agent request'); expect(slot.getByTestId('bb-thread-chat').getAttribute('data-thread-id')).toBe('thread-a');
  });
  it('uses actual active status for stop and steer controls', async () => {
    const slot = mount({ status: 'active' }); await slot.findByRole('button', { name: 'Stop work' }); fireEvent.click(slot.getByRole('button', { name: 'Queue' }));
    fireEvent.change(slot.getByRole('textbox'), { target: { value: 'Change direction' } }); fireEvent.click(slot.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(slot.inspection.sdkCalls.find(call => call.method === 'threads.send')).toMatchObject({ args: [{ mode: 'steer-if-active' }] }));
  });
  it('merges streaming updates without losing paginated history', () => {
    expect(mergeRows([row('old', 1, 'Earlier'), row('live', 3, 'Hel')], [row('live', 3, 'Hello'), row('new', 4, 'Next')]).map(item => item.id)).toEqual(['old', 'live', 'new']);
    expect(mergeRows([row('live', 3, 'Hel')], [row('live', 3, 'Hello')])[0]).toMatchObject({ text: 'Hello' });
  });
  it('clears an accepted send from its originating saved draft after navigation', async () => {
    let finish!: () => void; const pending = new Promise<void>(resolve => { finish = resolve; });
    const slot = mount({ send: () => pending }); await slot.findByText('Hello');
    fireEvent.change(slot.getByRole('textbox'), { target: { value: 'Send once' } }); fireEvent.click(slot.getByRole('button', { name: 'Send message' }));
    slot.unmount(); await act(async () => { finish(); await pending; });
    expect(JSON.parse(localStorage.getItem('fluently-agents.draft.thread-a') || '{}').text).toBe('');
  });
  it('reconciles condensed turns without retaining duplicate source messages', () => {
    const turn = { kind: 'turn', id: 'turn', sourceSeqStart: 2, sourceSeqEnd: 7, children: [row('inside', 3, 'Hello')] } as ChatRow;
    expect(reconcileRows([row('old', 1, 'Previous'), row('inside', 3, 'Hello')], [turn]).map(item => item.id)).toEqual(['old', 'turn']);
  });
  it('preserves newer draft edits when removing an accepted submission', () => {
    expect(removeSubmittedDraft({ text: 'Original plus more', attachments: [] }, { text: 'Original', attachments: [] })).toEqual({ text: ' plus more', attachments: [] });
    expect(removeSubmittedDraft({ text: 'Edited', attachments: [] }, { text: 'Original', attachments: [] }).text).toBe('Edited');
  });
  it('acknowledges voice requests before recording so remounts do not replay them', async () => {
    voice.toggle.mockClear(); const handled = vi.fn();
    const slot = mount({}, { voiceRequest: 5, onVoiceRequestHandled: handled }); await slot.findByText('Hello');
    expect(handled).toHaveBeenCalledWith(5); expect(voice.toggle).toHaveBeenCalledTimes(1);
    slot.unmount(); const next = mount({}, { voiceRequest: 0, onVoiceRequestHandled: handled }); await next.findByText('Hello'); expect(voice.toggle).toHaveBeenCalledTimes(1);
  });

  it('auto-sends a completed voice message only when the original draft is empty', async () => {
    const slot = mount(); await slot.findByText('Hello');
    await act(async () => { voice.onTranscript?.('Voice request'); });
    expect(slot.inspection.sdkCalls.find(call => call.method === 'threads.send')).toMatchObject({ args: [{ threadId: 'thread-a', input: [{ type: 'text', text: 'Voice request' }] }] });
    fireEvent.change(slot.getByRole('textbox'), { target: { value: 'Existing draft' } });
    await act(async () => { voice.onTranscript?.('More context'); });
    expect((slot.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Existing draft\nMore context');
    expect(slot.inspection.sdkCalls.filter(call => call.method === 'threads.send')).toHaveLength(1);
  });
  it('keeps a voice transcript when delivery fails without invoking transcription again', async () => {
    const slot = mount({ send: async () => { throw new Error('Delivery uncertain'); } }); await slot.findByText('Hello');
    await act(async () => { voice.onTranscript?.('Save this voice request'); });
    expect((slot.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Save this voice request');
    expect(slot.getByRole('alert').textContent).toContain('Delivery uncertain');
  });

  it('keeps an in-flight send locked across navigation and updates a remounted draft on acceptance', async () => {
    let finish!: () => void; const pending = new Promise<void>(resolve => { finish = resolve; }); const send = vi.fn(() => pending);
    const first = mount({ send }); await first.findByText('Hello');
    fireEvent.change(first.getByRole('textbox'), { target: { value: 'Do not duplicate' } }); fireEvent.click(first.getByRole('button', { name: 'Send message' })); first.unmount();
    const second = mount({ send }); await second.findByText('Hello');
    expect((second.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(second.getByRole('textbox'), { key: 'Enter' }); expect(send).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await pending; });
    await waitFor(() => expect((second.getByRole('textbox') as HTMLTextAreaElement).value).toBe(''));
    expect(JSON.parse(localStorage.getItem('fluently-agents.draft.thread-a') || '{}').text).toBe('');
  });

  it('refreshes a changed idle conversation from public realtime events', async () => {
    let changed: (() => void) | undefined;
    const rows = [row('first', 1, 'Before update')];
    const subscribe: PluginBrowserBbSdk['subscribe'] = args => { if (args.event === 'thread:changed') changed = () => args.callback({} as never); return () => {}; };
    const slot = mount({ rows, subscribe }); await slot.findByText('Before update');
    rows.push(row('second', 2, 'Realtime reply')); act(() => changed?.());
    await slot.findByText('Realtime reply');
  });

  it('keeps voice shortcuts outside the text editor after opening and acknowledging recording', async () => {
    const handled = vi.fn();
    const slot = mount({}, { focusRequest: 0, voiceRequest: 1, onVoiceRequestHandled: handled }); await slot.findByText('Hello');
    expect(document.activeElement).not.toBe(slot.getByRole('textbox'));
    slot.rerender(<Chat threadId="thread-a" focusRequest={0} voiceRequest={0} onVoiceRequestHandled={handled} />);
    expect(document.activeElement).not.toBe(slot.getByRole('textbox'));
    slot.rerender(<Chat threadId="thread-a" focusRequest={1} voiceRequest={0} onVoiceRequestHandled={handled} />);
    expect(document.activeElement).toBe(slot.getByRole('textbox'));
    slot.rerender(<Chat threadId="thread-a" focusRequest={1} voiceRequest={2} onVoiceRequestHandled={handled} />);
    expect(document.activeElement).not.toBe(slot.getByRole('textbox'));
  });

  it.each(['/storage/thread-a/check.md:7', 'file:///storage/thread-a/check.md:7'])('opens storage artifact %s with a valid relative preview target', async href => {
    const slot = mount(); await slot.findByText('Hello');
    const link = document.createElement('a'); link.href = href; link.textContent = 'Artifact'; slot.getByRole('log').append(link);
    fireEvent.click(link);
    expect(slot.inspection.navigateCalls).toContainEqual({ method: 'experimental_openFilePreview', options: { target: { kind: 'thread-storage', threadId: 'thread-a', path: 'check.md' }, location: { kind: 'line', line: 7, column: null } } });
  });

});
