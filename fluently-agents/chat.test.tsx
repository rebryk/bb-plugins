// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginBrowserBbSdk } from '@get-bb/plugin-sdk/app';
import { Chat, mergeRows, reconcileRows, removeSubmittedDraft, type ChatProps, type ChatRow } from './chat';
const voice = vi.hoisted(() => ({ state: 'idle' as import('./voice').VoiceState, level: 0, failedRecording: null as Blob | null, toggle: vi.fn(), cancel: vi.fn(), retry: vi.fn(), onTranscript: null as ((value: string) => void) | null, onError: null as ((value: string) => void) | null }));
vi.mock('./voice', () => ({ useVoiceTranscript: (options: { onTranscript(value: string): void; onError(value: string): void }) => { voice.onTranscript = options.onTranscript; voice.onError = options.onError; return voice; } }));
beforeEach(() => { const values = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }); });
beforeEach(() => {
  for (const method of ['showModal', 'close']) if (!(method in HTMLDialogElement.prototype)) Object.defineProperty(HTMLDialogElement.prototype, method, { configurable: true, writable: true, value() {} });
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function(this: HTMLDialogElement) {
    this.open = true;
  });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function(this: HTMLDialogElement) {
    this.open = false;
  });
});
afterEach(() => { cleanup(); voice.state = 'idle'; voice.failedRecording = null; voice.level = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const row = (id: string, seq: number, text: string, role: 'assistant' | 'user' = 'assistant') => ({ kind: 'conversation', role, id, sourceSeqStart: seq, sourceSeqEnd: seq, text, attachments: null }) as ChatRow;
type Upload = PluginBrowserBbSdk['projects']['attachments']['upload'];
type ReadAttachment = PluginBrowserBbSdk['projects']['attachments']['read'];
function mount(options: { upload?: Upload; readAttachment?: ReadAttachment; send?: () => Promise<unknown>; interactions?: unknown[]; status?: string; queued?: unknown[]; sendQueued?: () => Promise<unknown>; rows?: ChatRow[]; subscribe?: PluginBrowserBbSdk['subscribe'] } = {}, props: Partial<ChatProps> = {}) {
  return renderSlot({ component: Chat }, { threadId: 'thread-a', ...props }, { sdk: { projects: { attachments: { upload: options.upload ?? (async () => { throw new Error('Unexpected upload'); }), read: options.readAttachment ?? (async () => { throw new Error('Preview unavailable'); }) } } as PluginBrowserBbSdk['projects'], subscribe: options.subscribe ?? (() => () => {}), threads: {
    storageLocation: async () => ({ hostId: 'host-a', storageRootPath: '/storage/thread-a' }),
    timeline: async () => ({ rows: options.rows ?? [row('a', 1, 'Hello'), row('b', 2, 'My reply', 'user')], timelinePage: { olderCursor: null }, maxSeq: 2 }),
    get: async () => ({ id: 'thread-a', projectId: 'project-a', status: options.status || 'idle' }),
    interactions: { list: async () => options.interactions ?? [], resolve: async () => ({}) },
    queuedMessages: { list: async () => options.queued ?? [], send: options.sendQueued ?? (async () => ({})), delete: async () => ({}) },
    send: options.send ?? (async () => ({})),
    stop: async () => ({}),
  } as unknown as PluginBrowserBbSdk['threads'] } });
}
describe('Custom conversation', () => {
  it('shows an empty-recording error on the mic even when capture returns idle', async () => {
    const slot = mount(); await slot.findByText('Hello');
    await act(async () => { voice.onError?.('No audio was recorded'); });
    const retry = slot.getByRole('button', { name: 'Retry voice message: No audio was recorded' });
    expect(retry.querySelector('svg')).toBeTruthy(); expect(slot.queryByRole('alert')).toBeNull();
    fireEvent.click(retry);
    expect(slot.getByRole('button', { name: 'Record voice message' })).toBeTruthy();
  });
  it('keeps voice recording, processing and retry inside the microphone button', async () => {
    voice.state = 'recording'; voice.level = .7;
    const recording = mount(); await recording.findByText('Hello');
    expect(recording.queryByText('Cancel')).toBeNull();
    const finish = recording.getByRole('button', { name: 'Finish recording' });
    expect(finish.querySelector('.fa-voice-orb')).toBeTruthy();
    expect(finish.style.getPropertyValue('--voice-level')).toBe('0.7');
    voice.toggle.mockClear(); fireEvent.click(finish); expect(voice.toggle).toHaveBeenCalledTimes(1); recording.unmount();
    voice.state = 'transcribing';
    const processing = mount(); await processing.findByText('Hello');
    const spinner = processing.getByRole('button', { name: 'Transcribing voice message' });
    expect((spinner as HTMLButtonElement).disabled).toBe(true);
    expect(spinner.querySelector('.fa-voice-spinner')).toBeTruthy();
    expect(processing.queryByText('Transcribing…')).toBeNull(); processing.unmount();
    voice.state = 'error'; voice.failedRecording = new Blob(['audio']); voice.retry.mockClear();
    const failed = mount(); await failed.findByText('Hello');
    fireEvent.click(failed.getByRole('button', { name: 'Retry voice message' }));
    expect(voice.retry).toHaveBeenCalledTimes(1); expect(failed.queryByText('Retry voice')).toBeNull(); failed.unmount();
    voice.failedRecording = null; voice.toggle.mockClear();
    const unavailable = mount(); await unavailable.findByText('Hello');
    fireEvent.click(unavailable.getByRole('button', { name: 'Retry voice message' }));
    expect(voice.toggle).toHaveBeenCalledTimes(1);
  });

  it('attaches pasted screenshots once and keeps ordinary text paste untouched', async () => {
    const image = new File(['png'], 'Screenshot.png', { type: 'image/png' });
    const upload = vi.fn(async () => ({ type: 'localImage' as const, path: 'attachments/shot.png', name: image.name, sizeBytes: image.size }));
    const slot = mount({ upload }); await slot.findByText('Hello');
    const textbox = slot.getByRole('textbox');
    expect(fireEvent.paste(textbox, { clipboardData: { files: [], items: [{ kind: 'string' }], getData: () => 'plain text' } })).toBe(true);
    expect(upload).not.toHaveBeenCalled();
    expect(fireEvent.paste(textbox, { clipboardData: { files: [image], items: [{ kind: 'file', getAsFile: () => image }] } })).toBe(false);
    await slot.findByRole('button', { name: 'Remove Screenshot.png' }); expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith({ projectId: 'project-a', clientFile: image });
    fireEvent.click(slot.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(slot.inspection.sdkCalls.find(call => call.method === 'threads.send')).toMatchObject({ args: [{ input: [{ type: 'localImage', path: 'attachments/shot.png' }] }] }));
  });


  it('does not upload a paste already handled by a nested BB control', async () => {
    const upload = vi.fn<Upload>(); const slot = mount({ upload }); await slot.findByText('Hello');
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files: [new File(['x'], 'nested.txt')] } });
    event.preventDefault(); fireEvent(slot.getByRole('textbox'), event);
    expect(upload).not.toHaveBeenCalled();
  });
  it('waits for every concurrent drop and paste upload before sending', async () => {
    const finish = new Map<string, (attachment: Awaited<ReturnType<Upload>>) => void>();
    const upload = vi.fn<Upload>(({ clientFile }) => new Promise(resolve => { finish.set((clientFile as File).name, resolve); }));
    const slot = mount({ upload }); await slot.findByText('Hello');
    const first = new File(['a'], 'a.txt'), second = new File(['b'], 'b.txt');
    fireEvent.drop(slot.getByRole('log'), { dataTransfer: { files: [first], types: ['Files'] } });
    fireEvent.paste(slot.getByRole('textbox'), { clipboardData: { files: [], items: [{ kind: 'file', getAsFile: () => second }] } });
    expect(upload).toHaveBeenCalledTimes(2);
    await act(async () => finish.get('a.txt')!({ type: 'localFile', path: 'a.txt', name: 'a.txt', sizeBytes: 1 }));
    expect((slot.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(slot.getByRole('textbox'), { key: 'Enter' });
    expect(slot.inspection.sdkCalls.filter(call => call.method === 'threads.send')).toHaveLength(0);
    await act(async () => finish.get('b.txt')!({ type: 'localFile', path: 'b.txt', name: 'b.txt', sizeBytes: 1 }));
    fireEvent.click(slot.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(slot.inspection.sdkCalls.find(call => call.method === 'threads.send')).toMatchObject({ args: [{ input: [{ path: 'a.txt' }, { path: 'b.txt' }] }] }));
  });

  it('retains failed files for retry alongside successful attachments', async () => {
    const upload = vi.fn<Upload>().mockRejectedValueOnce(new Error('Upload failed')).mockResolvedValueOnce({ type: 'localFile', path: 'good.txt', name: 'good.txt', sizeBytes: 1 }).mockResolvedValueOnce({ type: 'localFile', path: 'retry.txt', name: 'retry.txt', sizeBytes: 1 });
    const slot = mount({ upload }); await slot.findByText('Hello');
    const failed = new File(['retry'], 'retry.txt');
    fireEvent.drop(slot.getByRole('log'), { dataTransfer: { files: [failed, new File(['good'], 'good.txt')], types: ['Files'] } });
    await slot.findByText('good.txt'); await slot.findByText('retry.txt: Upload failed');
    expect((slot.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(slot.getByRole('button', { name: 'Retry upload' }));
    await slot.findByText('retry.txt'); expect(slot.queryByRole('alert')).toBeNull();
    expect(upload).toHaveBeenLastCalledWith({ projectId: 'project-a', clientFile: failed });
    fireEvent.click(slot.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(slot.inspection.sdkCalls.find(call => call.method === 'threads.send')).toMatchObject({ args: [{ input: [{ path: 'good.txt' }, { path: 'retry.txt' }] }] }));
  });

  it('preserves a pending upload and failure across chat navigation', async () => {
    let fail!: (error: Error) => void;
    const upload = vi.fn<Upload>(() => new Promise((_resolve, reject) => { fail = reject; }));
    const first = mount({ upload }); await first.findByText('Hello');
    fireEvent.paste(first.getByRole('textbox'), { clipboardData: { files: [new File(['file'], 'pending.txt')] } });
    first.unmount(); const second = mount(); await second.findByText('Hello');
    expect(second.getByRole('status').textContent).toBe('Attaching files…');
    await act(async () => fail(new Error('Connection lost')));
    await second.findByText('pending.txt: Connection lost');
    fireEvent.click(second.getByRole('button', { name: 'Dismiss pending.txt' }));
    expect(second.queryByRole('alert')).toBeNull();
  });

  it('previews only safe raster images and releases Blob URLs', async () => {
    const create = vi.fn(() => 'blob:preview'), revoke = vi.fn();
    const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = create; URL.revokeObjectURL = revoke;
    try {
      const upload = vi.fn<Upload>(async ({ clientFile }) => ({ type: 'localImage', path: (clientFile as File).name, name: (clientFile as File).name, sizeBytes: 1 }));
      const readAttachment = vi.fn<ReadAttachment>(async ({ path }) => ({ bytes: new Uint8Array([1]), mimeType: path.endsWith('.svg') ? 'image/svg+xml' : 'image/png', sizeBytes: 1 }));
      const slot = mount({ upload, readAttachment }); await slot.findByText('Hello');
      fireEvent.drop(slot.getByRole('log'), { dataTransfer: { files: [new File(['png'], 'preview.png'), new File(['svg'], 'unsafe.svg')], types: ['Files'] } });
      await slot.findByRole('button', { name: 'Preview preview.png' });
      expect(slot.queryByRole('button', { name: 'Preview unsafe.svg' })).toBeNull();
      expect(create).toHaveBeenCalledTimes(1);
      expect(slot.queryByText('preview.png')).toBeNull();
      expect(slot.getByRole('img', { name: 'Preview unavailable: unsafe.svg' })).toBeTruthy();
      expect(slot.getByRole('button', { name: 'Remove unsafe.svg' })).toBeTruthy();
      const preview = slot.getByRole('button', { name: 'Preview preview.png' });
      fireEvent.click(preview);
      expect(slot.getAllByRole('img', { name: 'preview.png' })).toHaveLength(2);
      const modal = slot.getByRole('dialog', { name: 'Preview preview.png' });
      expect(modal.textContent).toBe('');
      const bubbled = vi.fn(); window.addEventListener('keydown', bubbled);
      expect(slot.queryByRole('button', { name: 'Close image preview' })).toBeNull();
      expect(document.activeElement).toBe(modal);
      fireEvent.keyDown(modal, { key: 'n' });
      expect(bubbled).not.toHaveBeenCalled(); window.removeEventListener('keydown', bubbled);
      fireEvent.click(modal, { clientX: -1, clientY: -1 });
      expect(slot.queryByRole('dialog')).toBeNull();
      expect(revoke).not.toHaveBeenCalled();
      preview.focus(); fireEvent.click(preview);
      fireEvent(slot.getByRole('dialog'), new Event('cancel', { cancelable: true }));
      expect(slot.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(preview);
      fireEvent.click(preview);
      fireEvent.error(preview.querySelector('img')!);
      expect(slot.getByRole('img', { name: 'Preview unavailable: preview.png' })).toBeTruthy();
      expect(slot.queryByRole('button', { name: 'Preview preview.png' })).toBeNull();
      fireEvent.click(slot.getByRole('button', { name: 'Remove preview.png' }));
      expect(revoke).toHaveBeenCalledWith('blob:preview');
    } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
  });



  it('keeps loading image previews accessible and removable before the read finishes', async () => {
    let finish!: (value: Awaited<ReturnType<ReadAttachment>>) => void;
    const upload = vi.fn<Upload>(async () => ({ type: 'localImage', path: 'loading.png', name: 'loading.png', sizeBytes: 1 }));
    const readAttachment = vi.fn<ReadAttachment>(() => new Promise(resolve => { finish = resolve; }));
    const slot = mount({ upload, readAttachment }); await slot.findByText('Hello');
    fireEvent.paste(slot.getByRole('textbox'), { clipboardData: { files: [new File(['png'], 'loading.png')] } });
    await slot.findByRole('img', { name: 'Loading preview: loading.png' });
    expect(slot.queryByText('loading.png')).toBeNull();
    fireEvent.click(slot.getByRole('button', { name: 'Remove loading.png' }));
    await act(async () => finish({ bytes: new Uint8Array([1]), mimeType: 'image/png', sizeBytes: 1 }));
    expect(slot.queryByRole('button', { name: 'Preview loading.png' })).toBeNull();
    expect(slot.queryByRole('img', { name: 'Loading preview: loading.png' })).toBeNull();
  });
  it('renders sent local images through BB attachment reads with a link fallback', async () => {
    const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:sent'); URL.revokeObjectURL = vi.fn();
    try {
      const sent = { ...row('image', 1, 'Attached screenshot', 'user'), attachments: { imageUrls: [], localFileDetails: [], localImagePaths: ['attachments/sent.png', 'attachments/missing.png'], localFilePaths: [], localFiles: 0, localImages: 2, webImages: 0 } } as ChatRow;
      const readAttachment = vi.fn<ReadAttachment>(async ({ path }) => { if (path.includes('missing')) throw new Error('Unavailable'); return { bytes: new Uint8Array([1]), mimeType: 'image/png', sizeBytes: 1 }; });
      const slot = mount({ rows: [sent], readAttachment });
      await slot.findByRole('button', { name: 'Preview sent.png' });
      expect(slot.queryByRole('button', { name: 'Preview missing.png' })).toBeNull();
      expect(slot.getByRole('button', { name: 'missing.png' })).toBeTruthy();
      expect(slot.queryByText('sent.png')).toBeNull();
      expect(slot.queryByRole('button', { name: 'Remove sent.png' })).toBeNull();
      expect(readAttachment).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-a', path: 'attachments/sent.png' }));
      slot.unmount();
    } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
  });
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
    const group = slot.getByText('Activity').closest('details')!;
    group.open = true; fireEvent(group, new Event('toggle'));
    await slot.findByText('Internal event 1');
    expect(slot.getByText('Result')).toBeTruthy();
    group.open = false; fireEvent(group, new Event('toggle'));
    await waitFor(() => expect(slot.queryByText('Internal event 1')).toBeNull());
  });

  it('uses actual pending activity presentation and renders one quiet runtime indicator', async () => {
    const pending = { kind: 'tool', id: 'pending', sourceSeqStart: 1, sourceSeqEnd: 1, status: 'pending', presentation: { title: 'Inspecting screenshots', label: { pending: 'Inspecting', completed: 'Inspected' }, icon: { glyph: 'Toolbox' } } } as unknown as ChatRow;
    const completed = { ...pending, id: 'completed', sourceSeqStart: 2, sourceSeqEnd: 2, status: 'completed', presentation: { title: 'Later completed step', label: { pending: 'Working', completed: 'Completed' }, icon: { glyph: 'Toolbox' } } } as unknown as ChatRow;
    const slot = mount({ status: 'active', rows: [pending, completed] });
    await slot.findByText('Inspecting screenshots');
    expect(slot.queryByText('Later completed step')).toBeNull();
    expect(slot.getAllByRole('status')).toHaveLength(1);
    expect(slot.getByRole('status').textContent).toBe('Working…');
    expect(slot.getByRole('status').closest('[role="log"]')).toBeTruthy();
  });

  it('does not label failed activity as completed or show processing behind an interaction', async () => {
    const failed = { kind: 'tool', id: 'failed', sourceSeqStart: 1, sourceSeqEnd: 1, status: 'error', presentation: { label: { pending: 'Checking', completed: 'Checks passed' }, icon: { glyph: 'Toolbox' } } } as unknown as ChatRow;
    const slot = mount({ status: 'active', rows: [failed], interactions: [{ id: 'i', payload: { kind: 'form', title: 'Question' } }] });
    await slot.findByText('Activity');
    expect(slot.queryByText('Checks passed')).toBeNull();
    expect(slot.queryByRole('status')).toBeNull();
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
  it('steers normal sends without Stop or queue mode controls', async () => {
    const slot = mount({ status: 'active' }); await slot.findByText('Hello'); expect(slot.queryByRole('button', { name: 'Stop work' })).toBeNull(); expect(slot.queryByRole('button', { name: 'Queue' })).toBeNull();
    fireEvent.change(slot.getByRole('textbox'), { target: { value: 'Change direction' } }); fireEvent.click(slot.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(slot.inspection.sdkCalls.find(call => call.method === 'threads.send')).toMatchObject({ args: [{ mode: 'steer-if-active' }] }));
  });
  it.each([['MacIntel', 'metaKey'], ['Win32', 'ctrlKey']])('queues modified Enter on %s', async (platform, modifier) => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform as string);
    const slot = mount({ status: 'active' }); await slot.findByText('Hello');
    fireEvent.change(slot.getByRole('textbox'), { target: { value: 'Follow up' } });
    fireEvent.keyDown(slot.getByRole('textbox'), { key: 'Enter', [modifier as string]: true });
    await waitFor(() => expect(slot.inspection.sdkCalls.find(call => call.method === 'threads.send')).toMatchObject({ args: [{ mode: 'queue-if-active' }] }));
  });
  it('steers Enter without reading the BB send preference', async () => {
    const slot = mount({ status: 'active' }); await slot.findByText('Hello');
    fireEvent.change(slot.getByRole('textbox'), { target: { value: 'After this' } });
    fireEvent.keyDown(slot.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(slot.inspection.sdkCalls.find(call => call.method === 'threads.send')).toMatchObject({ args: [{ mode: 'steer-if-active' }] }));
    expect(slot.inspection.sdkCalls.some(call => call.method === 'system.config')).toBe(false);
  });
  it('never sends unsupported modifiers, IME composition, key repeat or Shift+Enter', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const slot = mount({ status: 'active' }); await slot.findByText('Hello');
    fireEvent.change(slot.getByRole('textbox'), { target: { value: 'Keep editing' } });
    for (const keys of [{ ctrlKey: true }, { metaKey: true, ctrlKey: true }, { altKey: true }, { metaKey: true, altKey: true }, { shiftKey: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }]) fireEvent.keyDown(slot.getByRole('textbox'), { key: 'Enter', ...keys });
    expect(slot.inspection.sdkCalls.filter(call => call.method === 'threads.send')).toHaveLength(0);
    expect((slot.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep editing');
  });
  it.each([false, true])('queues while stopping with modifier=%s', async modified => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const slot = mount({ status: 'stopping' }); await slot.findByText('Hello');
    fireEvent.change(slot.getByRole('textbox'), { target: { value: 'After stopping' } });
    fireEvent.keyDown(slot.getByRole('textbox'), { key: 'Enter', metaKey: modified });
    await waitFor(() => expect(slot.inspection.sdkCalls.find(call => call.method === 'threads.send')).toMatchObject({ args: [{ mode: 'queue-if-active' }] }));
  });
  it('renders the queue and sends an existing item now without submitting the draft', async () => {
    const slot = mount({ status: 'active', queued: [{ id: 'queue-a', content: [{ type: 'text', text: 'Do this later' }] }] }); await slot.findByText('Do this later');
    expect(slot.getByText('Queued')).toBeTruthy();
    const queue = slot.getByRole('region', { name: 'Queued messages' });
    expect(queue.closest('[role=log]')).toBeNull();
    expect(queue.nextElementSibling).toBe(slot.getByRole('textbox').closest('form'));
    expect(slot.getByRole('status').closest('[role=log]')).toBeTruthy();
    fireEvent.change(slot.getByRole('textbox'), { target: { value: 'Unsent draft' } });
    fireEvent.click(slot.getByRole('button', { name: 'Send queued message now' }));
    await waitFor(() => expect(slot.inspection.sdkCalls.find(call => call.method === 'threads.queuedMessages.send')).toMatchObject({ args: [{ threadId: 'thread-a', queuedMessageId: 'queue-a', mode: 'steer' }] }));
    expect(slot.inspection.sdkCalls.filter(call => call.method === 'threads.send')).toHaveLength(0);
    expect((slot.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Unsent draft');
  });
  it('blocks queued dispatch behind an interaction and retains queued messages after failure', async () => {
    const queued = [{ id: 'queue-a', content: [{ type: 'text', text: 'Still queued' }] }];
    const blocked = mount({ queued, interactions: [{ id: 'i', payload: { kind: 'form', title: 'Question' } }] }); await blocked.findByText('Still queued');
    expect((blocked.getByRole('button', { name: 'Send queued message now' }) as HTMLButtonElement).disabled).toBe(true); blocked.unmount();
    const sendQueued = vi.fn(async () => { throw new Error('Dispatch failed'); });
    const slot = mount({ queued, sendQueued }); await slot.findByText('Still queued');
    fireEvent.click(slot.getByRole('button', { name: 'Send queued message now' }));
    await slot.findByRole('alert'); expect(slot.getByText('Still queued')).toBeTruthy(); expect(sendQueued).toHaveBeenCalledTimes(1);
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
