import { useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties, type MouseEvent } from 'react';
import { ThreadChat, experimental_Icon as Icon, useSdk } from '@get-bb/plugin-sdk/app';
import { useVoiceTranscript, type VoiceState } from './voice';
import './chat.css';
type Sdk = ReturnType<typeof useSdk>;
type Attachment = Awaited<ReturnType<Sdk['projects']['attachments']['upload']>>;
type Thread = Awaited<ReturnType<Sdk['threads']['get']>>;
type Interactions = Awaited<ReturnType<Sdk['threads']['interactions']['list']>>;
type Queue = Awaited<ReturnType<Sdk['threads']['queuedMessages']['list']>>;
export interface ChatProps { threadId: string; focusRequest?: number; voiceRequest?: number; onVoiceRequestHandled?(nonce: number): void; onVoiceState?(value: { state: VoiceState; level: number }): void; composerAgents?: ReactNode; onVoiceContextMenu?(event: MouseEvent<HTMLButtonElement>): void; className?: string; }
function RetryIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2 8M3 3v7h7" /></svg>; }
type Draft = { text: string; attachments: Attachment[] };
export function removeSubmittedDraft(current: Draft, submitted: Draft): Draft {
  const paths = new Set(submitted.attachments.map(file => file.path));
  return { text: current.text.startsWith(submitted.text) ? current.text.slice(submitted.text.length) : current.text, attachments: current.attachments.filter(file => !paths.has(file.path)) };
}
const activeRequests = new Set<string>();
const pendingUploads = new Map<string, number>();
type FailedUpload = { file: File; error: string };
const failedUploads = new Map<string, FailedUpload[]>();
const requestListeners = new Map<string, Set<(draftChanged: boolean) => void>>();
function notifyRequest(threadId: string, draftChanged = false) { requestListeners.get(threadId)?.forEach(listener => listener(draftChanged)); }
function ImagePreview({ src, name, onClose }: { src: string; name: string; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal(); element.focus();
    return () => { if (element.open) element.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={dialog} className="fa-image-dialog" tabIndex={-1} aria-label={`Preview ${name}`} onClose={onClose} onCancel={onClose} onKeyDown={event => event.stopPropagation()} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}><img src={src} alt={name} /></dialog>;
}
function AttachmentPreview({ file, projectId, onRemove, fallback }: { file: Pick<Attachment, "type" | "path" | "name">; projectId?: string; onRemove?(): void; fallback?: ReactNode }) {
  const sdk = useSdk(); const [src, setSrc] = useState<string>(); const [open, setOpen] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    setSrc(undefined); setFailed(false);
    if (!projectId) return;
    const controller = new AbortController(); let url: string | undefined;
    void sdk.projects.attachments.read({ projectId, path: file.path, signal: controller.signal }).then(image => {
      if (controller.signal.aborted) return;
      if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(image.mimeType)) { setFailed(true); return; }
      url = URL.createObjectURL(new Blob([new Uint8Array(image.bytes)], { type: image.mimeType })); setSrc(url);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [sdk, file.path, projectId]);
  return <div className="fa-image-attachment">
    {src && !failed ? <><button type="button" className="fa-attachment-preview" aria-label={`Preview ${file.name}`} onClick={() => setOpen(true)}><img src={src} alt={file.name} onError={() => { setFailed(true); setOpen(false); }} /></button>{open && <ImagePreview src={src} name={file.name} onClose={() => setOpen(false)} />}</> : <div className="fa-image-fallback"><span role="img" aria-label={`${failed ? 'Preview unavailable' : 'Loading preview'}: ${file.name}`}><Icon name="Image" /><small>{failed ? 'Preview unavailable' : 'Loading…'}</small></span>{failed && fallback}</div>}
    {onRemove && <button type="button" className="fa-remove-attachment" aria-label={`Remove ${file.name}`} title={`Remove ${file.name}`} onClick={onRemove}><Icon name="X" /></button>}
  </div>;
}
function draftFor(id: string): { text: string; attachments: Attachment[] } {
  try { const item = JSON.parse(localStorage.getItem(`fluently-agents.draft.${id}`) || '{}'); return { text: typeof item.text === 'string' ? item.text : '', attachments: Array.isArray(item.attachments) ? item.attachments.filter((file: Attachment) => file && typeof file.path === 'string' && (file.type === 'localFile' || file.type === 'localImage')) : [] }; } catch { return { text: '', attachments: [] }; }
}
export function Chat(props: ChatProps) { return <ChatSession key={props.threadId} {...props} />; }
function ChatSession({ threadId, focusRequest, voiceRequest, onVoiceState, onVoiceRequestHandled, composerAgents, onVoiceContextMenu, className = '' }: ChatProps) {
  const sdk = useSdk();
  const [draft, setDraft] = useState(() => draftFor(threadId));
  const [thread, setThread] = useState<Thread | null>(null);
  const [interactions, setInteractions] = useState<Interactions>([]);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(() => activeRequests.has(threadId)), [uploading, setUploading] = useState(() => !!pendingUploads.get(threadId));
  const [failedFiles, setFailedFiles] = useState<FailedUpload[]>(() => failedUploads.get(threadId) ?? []);
  const uploadingFiles = useRef(new WeakSet<File>());
  const [error, setError] = useState<string | null>(null), [advanced, setAdvanced] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null), files = useRef<HTMLInputElement>(null);
  const transcript = useRef<HTMLDivElement>(null), transcriptContent = useRef<HTMLDivElement>(null), followTranscript = useRef(true), assignedScrollTop = useRef<number | null>(null);
  const scrollToLatest = useCallback(() => {
    const viewport = transcript.current;
    if (viewport && viewport.clientHeight > 0 && followTranscript.current) {
      viewport.scrollTop = viewport.scrollHeight;
      assignedScrollTop.current = viewport.scrollTop;
    }
  }, []);
  useEffect(() => {
    scrollToLatest();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(scrollToLatest);
    if (transcript.current) observer.observe(transcript.current);
    if (transcriptContent.current) observer.observe(transcriptContent.current);
    return () => observer.disconnect();
  }, [scrollToLatest]);
  const alive = useRef(true), sending = useRef(false);
  const abort = useRef(new AbortController());
  const refreshSequence = useRef(0), active = useRef(false);
  useEffect(() => {
    const listener = (draftChanged: boolean) => { setBusy(activeRequests.has(threadId)); setUploading(!!pendingUploads.get(threadId)); setFailedFiles(failedUploads.get(threadId) ?? []); if (draftChanged) setDraft(draftFor(threadId)); };
    const listeners = requestListeners.get(threadId) ?? new Set(); listeners.add(listener); requestListeners.set(threadId, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) requestListeners.delete(threadId); };
  }, [threadId]);
  const report = useCallback((cause: unknown) => { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }, []);
  const deliverVoice = useRef<(value: string) => void>(() => {});
  const [voiceError, setVoiceError] = useState<string>();
  const voice = useVoiceTranscript({ threadId, onTranscript: value => deliverVoice.current(value), onError: setVoiceError });
  const notifyVoice = useRef(onVoiceState); notifyVoice.current = onVoiceState;
  useEffect(() => { onVoiceState?.({ state: voice.state, level: voice.level }); }, [voice.state, voice.level, onVoiceState]);
  useEffect(() => () => { notifyVoice.current?.({ state: 'idle', level: 0 }); }, []);
  const lastVoice = useRef(0);
  useEffect(() => { if (voiceRequest && voiceRequest !== lastVoice.current) { lastVoice.current = voiceRequest; input.current?.blur(); onVoiceRequestHandled?.(voiceRequest); setVoiceError(undefined); void voice.toggle(); } }, [voiceRequest, voice.toggle, onVoiceRequestHandled]);
  const lastFocus = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (focusRequest === lastFocus.current) return;
    lastFocus.current = focusRequest;
    if (focusRequest && !voiceRequest) input.current?.focus();
  }, [focusRequest, voiceRequest]);
  useEffect(() => { try { localStorage.setItem(`fluently-agents.draft.${threadId}`, JSON.stringify(draft)); } catch { /* The draft remains available in memory. */ } }, [draft, threadId]);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const [current, pending, queued] = await Promise.all([sdk.threads.get({ threadId, signal: abort.current.signal }), sdk.threads.interactions.list({ threadId, signal: abort.current.signal }), sdk.threads.queuedMessages.list({ threadId, signal: abort.current.signal })]);
    if (!alive.current || sequence !== refreshSequence.current) return;
    active.current = ['active', 'starting', 'pending', 'stopping'].includes(current.status);
    setThread(current); setInteractions(pending); setQueue(queued); setLoaded(true);
  }, [sdk, threadId]);
  useEffect(() => {
    let timer: number, invalidationTimer: number | undefined; alive.current = true;
    const control = new AbortController(); abort.current = control;
    const update = async () => { try { if (!document.hidden) await refresh(); } catch (cause) { if (!control.signal.aborted) report(cause); } };
    const poll = async () => { await update(); if (alive.current) timer = window.setTimeout(poll, active.current ? 5000 : 60000); };
    const invalidate = () => { if (invalidationTimer === undefined) invalidationTimer = window.setTimeout(() => { invalidationTimer = undefined; void update(); }, 500); };
    const unsubscribe = sdk.subscribe({ event: 'thread:changed', threadId, callback: invalidate });
    const reconnect = sdk.subscribe({ event: 'realtime:connection', callback: event => { if (event.state === 'connected') invalidate(); } });
    document.addEventListener('visibilitychange', invalidate);
    void poll(); return () => { alive.current = false; control.abort(); window.clearTimeout(timer); window.clearTimeout(invalidationTimer); unsubscribe(); reconnect(); document.removeEventListener('visibilitychange', invalidate); };
  }, [sdk, threadId, refresh, report]);
  useEffect(() => {
    const textarea = input.current; if (!textarea) return;
    textarea.style.height = '28px'; textarea.style.height = `${Math.min(92, Math.max(28, textarea.scrollHeight))}px`;
  }, [draft.text]);
  const mutate = async (operation: () => Promise<unknown>) => { if (sending.current || activeRequests.has(threadId)) return; sending.current = true; activeRequests.add(threadId); notifyRequest(threadId); setBusy(true); setError(null); try { await operation(); await refresh(); } catch (cause) { report(cause); } finally { sending.current = false; activeRequests.delete(threadId); notifyRequest(threadId); if (alive.current) setBusy(false); } };
  const voiceBusy = ['starting', 'recording', 'transcribing'].includes(voice.state);
  const voiceLabel = voice.state === 'recording' ? 'Finish recording' : voice.state === 'starting' ? 'Starting microphone' : voice.state === 'transcribing' ? 'Transcribing voice message' : (voice.state === 'error' || voiceError) ? `Retry voice message${voiceError ? `: ${voiceError}` : ''}` : 'Record voice message';
  const canSteer = !!thread && ['active', 'provisioning', 'starting', 'waiting-for-host'].includes(thread.runtime?.displayStatus ?? thread.status);
  const send = (submitted = draft, fromVoice = false, alternate = false) => {
    if ((!submitted.text.trim() && !submitted.attachments.length) || pendingUploads.get(threadId) || failedUploads.get(threadId)?.length || uploading || !loaded || interactions.length || (voiceBusy && !fromVoice)) return;
    void mutate(async () => {
      await sdk.threads.send({ threadId, mode: canSteer && !alternate ? 'steer-if-active' : 'queue-if-active', input: [...(submitted.text.trim() ? [{ type: 'text' as const, text: submitted.text, mentions: [] }] : []), ...submitted.attachments] });
      if (alive.current) { followTranscript.current = true; scrollToLatest(); }
      let saved = false;
      try { localStorage.setItem(`fluently-agents.draft.${threadId}`, JSON.stringify(removeSubmittedDraft(draftFor(threadId), submitted))); saved = true; } catch { /* Storage may be unavailable. */ }
      if (saved) notifyRequest(threadId, true);
      else if (alive.current) setDraft(current => removeSubmittedDraft(current, submitted));
    });
  };
  deliverVoice.current = value => {
    setVoiceError(undefined);
    const next = { ...draft, text: [draft.text, value].filter(Boolean).join('\n') }; setDraft(next);
    if (!draft.text.trim() && !draft.attachments.length && !interactions.length && !uploading && !failedFiles.length && loaded) send(next, true);
  };
  const uploadFiles = (selected: File[]) => {
    if (!thread) return;
    const fresh = [...new Set(selected)].filter(file => !uploadingFiles.current.has(file));
    if (!fresh.length) return;
    fresh.forEach(file => uploadingFiles.current.add(file));
    pendingUploads.set(threadId, (pendingUploads.get(threadId) ?? 0) + fresh.length); notifyRequest(threadId);
    const failures = (failedUploads.get(threadId) ?? []).filter(item => !fresh.includes(item.file));
    if (failures.length) failedUploads.set(threadId, failures); else failedUploads.delete(threadId); notifyRequest(threadId);
    for (const file of fresh) void (async () => {
      try {
        const attachment = await sdk.projects.attachments.upload({ projectId: thread.projectId, clientFile: file });
        if (alive.current) setDraft(old => ({ ...old, attachments: [...old.attachments, attachment] }));
        else {
          const current = draftFor(threadId); current.attachments.push(attachment);
          localStorage.setItem(`fluently-agents.draft.${threadId}`, JSON.stringify(current)); notifyRequest(threadId, true);
        }
      } catch (cause) {
        failedUploads.set(threadId, [...(failedUploads.get(threadId) ?? []), { file, error: cause instanceof Error ? cause.message : String(cause) }]);
      } finally {
        uploadingFiles.current.delete(file);
        const remaining = (pendingUploads.get(threadId) ?? 1) - 1;
        if (remaining) pendingUploads.set(threadId, remaining); else pendingUploads.delete(threadId);
        notifyRequest(threadId);
      }
    })();
  };
  const transferFiles = (data: DataTransfer): File[] => data.files.length ? Array.from(data.files)
    : Array.from(data.items ?? []).filter(item => item.kind === 'file').flatMap(item => { const file = item.getAsFile(); return file ? [file] : []; });
  const running = !!thread && ['active', 'starting', 'pending', 'stopping'].includes(thread.status);
  return <div className={`fa-custom-chat ${className}`} onPaste={event => {
    if (advanced || event.defaultPrevented) return;
    const selected = transferFiles(event.clipboardData); if (!selected.length || !thread) return;
    event.preventDefault(); event.stopPropagation(); uploadFiles(selected);
  }} onDragOver={event => { if (!advanced && Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault(); }} onDrop={event => {
    if (advanced || event.defaultPrevented) return;
    const selected = transferFiles(event.dataTransfer); if (!selected.length || !thread) return;
    event.preventDefault(); event.stopPropagation(); uploadFiles(selected);
  }}>
    <div className="fa-chat-transcript" ref={transcript} onScroll={event => {
      const viewport = event.currentTarget; if (!viewport.clientHeight) return;
      // Our queued scroll event may arrive after native content grows again.
      if (followTranscript.current && assignedScrollTop.current !== null && Math.abs(viewport.scrollTop - assignedScrollTop.current) < 1) { scrollToLatest(); return; }
      followTranscript.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 48;
    }}>
      <div ref={transcriptContent}><ThreadChat threadId={threadId} variant="timeline" layout="document" className="fa-native-transcript" /></div>
    </div>
    {!!interactions.length && <div className="fa-interaction"><span>Your input is needed</span><button onClick={() => setAdvanced(true)}>Review request</button></div>}
    {error && <div role="alert" className="fa-chat-error">{error}<button aria-label="Refresh" title="Refresh" onClick={() => { setError(null); void refresh().catch(report); }}><RetryIcon /></button></div>}
    {!!draft.attachments.length && <div className="fa-draft-files">{draft.attachments.map((file, index) => { const remove = () => setDraft(old => ({ ...old, attachments: old.attachments.filter((_, i) => i !== index) })); return file.type === 'localImage' ? <AttachmentPreview key={`${file.path}-${index}`} file={file} projectId={thread?.projectId} onRemove={remove} /> : <span key={`${file.path}-${index}`}>{file.name}<button aria-label={`Remove ${file.name}`} onClick={remove}><Icon name="X" /></button></span>; })}</div>}
    {uploading && <div className="fa-upload-status" role="status">Attaching files…</div>}
    {failedFiles.map((item, index) => <div className="fa-upload-error" role="alert" key={index}><span>{item.file.name}: {item.error}</span><button type="button" aria-label="Retry upload" title="Retry upload" onClick={() => uploadFiles([item.file])}><RetryIcon /></button><button type="button" aria-label={`Dismiss ${item.file.name}`} title={`Dismiss ${item.file.name}`} onClick={() => { const remaining = (failedUploads.get(threadId) ?? []).filter(entry => entry !== item); if (remaining.length) failedUploads.set(threadId, remaining); else failedUploads.delete(threadId); notifyRequest(threadId); }}><Icon name="X" /></button></div>)}
    {!!queue?.length && <div className="fa-message-queue" role="region" aria-label="Queued messages">{queue.map(item => <div className="fa-queued-message" key={item.id}><small>Queued</small><span>{item.content.filter(part => part.visibility !== 'agent-only').filter(part => part.type === 'text').map(part => part.text).join('\n') || 'Attachments'}</span><button className="fa-queue-send" aria-label="Send queued message now" title="Send now" disabled={busy || !loaded || !!interactions.length} onClick={() => void mutate(() => sdk.threads.queuedMessages.send({ threadId, queuedMessageId: item.id, mode: 'steer' }))}><Icon name="ArrowUp" /></button><button aria-label="Remove queued message" title="Remove" disabled={busy} onClick={() => void mutate(() => sdk.threads.queuedMessages.delete({ threadId, queuedMessageId: item.id }))}><Icon name="X" /></button></div>)}</div>}
    <form className="fa-message-composer" onSubmit={event => { event.preventDefault(); send(); }}><textarea ref={input} value={draft.text} placeholder="Message…" aria-label="Message" rows={1} onChange={event => setDraft(old => ({ ...old, text: event.target.value }))} onKeyDown={event => {
      if (event.defaultPrevented || event.key !== 'Enter' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.shiftKey) return;
      // BB's modifier is Command on Apple platforms, Control elsewhere.
      const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
      const alternate = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      event.preventDefault();
      if (event.repeat || event.altKey || ((event.metaKey || event.ctrlKey) && !alternate) || (alternate && !running)) return;
      send(draft, false, alternate);
    }} />
      <div className="fa-compose-actions"><div className="fa-compose-left"><button className="fa-composer-tool" type="button" aria-label="Attach files" disabled={uploading || !thread} onClick={() => files.current?.click()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21 11-8 8a6 6 0 0 1-8.5-8.5L13 2a4 4 0 0 1 5.7 5.7l-8.5 8.5a2 2 0 0 1-2.8-2.8L15 6" /></svg></button>{composerAgents}</div><div className="fa-compose-right"><button type="button" aria-label={voiceLabel} title={voiceLabel} disabled={voice.state === 'transcribing' || voice.state === 'starting'} className={`fa-composer-tool fa-voice-button${voice.state === 'recording' ? ' fa-recording' : ''}`} style={{ '--voice-level': voice.level } as CSSProperties} onContextMenu={onVoiceContextMenu} onClick={() => { setVoiceError(undefined); if (voice.state === 'error' && voice.failedRecording) voice.retry(); else void voice.toggle(); }}>
          {voice.state === 'recording' ? <span className="fa-voice-orb" aria-hidden="true" /> : voice.state === 'starting' || voice.state === 'transcribing' ? <span className="fa-voice-spinner" aria-hidden="true" /> : (voice.state === 'error' || voiceError) ? <RetryIcon /> : <Icon name="Mic" />}
        </button>
        <button type="submit" className="fa-composer-tool fa-send-message" aria-label="Send message" disabled={busy || uploading || !!failedFiles.length || !loaded || !!interactions.length || voiceBusy || (!draft.text.trim() && !draft.attachments.length)}><Icon name="ArrowUp" /></button>
      </div></div>
    </form>
    <input className="fa-file-input" type="file" multiple ref={files} aria-label="Message attachments" onChange={event => { const selected = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; uploadFiles(selected); }} />
    {advanced && <div className="fa-advanced-overlay" role="dialog" aria-modal="true" aria-label="Review agent request"><header><strong>Review agent request</strong><button aria-label="Return to conversation" onClick={() => { setAdvanced(false); void refresh().catch(report); }}><Icon name="X" /></button></header><p>Answer this request using BB’s permission and question controls. Your conversation stays here.</p><ThreadChat threadId={threadId} variant="compact" layout="contained" /></div>}
  </div>;
}
