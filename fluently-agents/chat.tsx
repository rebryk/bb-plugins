import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode, type CSSProperties, type MouseEvent } from 'react';
import { Markdown, ThreadChat, UrlLink, experimental_ImageLightbox as ImageLightbox, experimental_Icon as Icon, experimental_FileLink as FileLink, experimental_saveFile as saveFile, useBbNavigate, useSdk } from '@get-bb/plugin-sdk/app';
import { useVoiceTranscript, type VoiceState } from './voice';
import './chat.css';
type Sdk = ReturnType<typeof useSdk>;
async function timeline(sdk: Sdk, threadId: string, signal?: AbortSignal) { return sdk.threads.timeline({ threadId, segmentLimit: '40', includeNestedRows: 'true', deferContent: 'false', signal }); }
type Page = Awaited<ReturnType<typeof timeline>>;
export type ChatRow = Page['rows'][number];
type Attachment = Awaited<ReturnType<Sdk['projects']['attachments']['upload']>>;
type Thread = Awaited<ReturnType<Sdk['threads']['get']>>;
type Interactions = Awaited<ReturnType<Sdk['threads']['interactions']['list']>>;
type MarkdownDocument = NonNullable<ComponentProps<typeof Markdown>['experimental_document']>;
type StorageLocation = Awaited<ReturnType<Sdk['threads']['storageLocation']>>;
type Queue = Awaited<ReturnType<Sdk['threads']['queuedMessages']['list']>>;
export interface ChatProps { threadId: string; focusRequest?: number; voiceRequest?: number; onVoiceRequestHandled?(nonce: number): void; onVoiceState?(value: { state: VoiceState; level: number }): void; composerAgents?: ReactNode; onVoiceContextMenu?(event: MouseEvent<HTMLButtonElement>): void; className?: string; }
export function mergeRows(old: ChatRow[], next: ChatRow[]) { const map = new Map(old.map(row => [row.id, row])); next.forEach(row => map.set(row.id, row)); return [...map.values()].sort((a, b) => a.sourceSeqStart - b.sourceSeqStart); }
export function reconcileRows(old: ChatRow[], snapshot: ChatRow[]) {
  if (!snapshot.length) return [];
  const boundary = Math.min(...snapshot.map(row => row.sourceSeqStart));
  return mergeRows(old.filter(row => row.sourceSeqEnd < boundary), snapshot);
}
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
function Detail({ value }: { value: unknown }) { return <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>; }
function AttachmentLink({ path, name, projectId, storage }: { path: string; name: string; projectId?: string; storage?: StorageLocation }) {
  const sdk = useSdk(); const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  if (path.startsWith('/') && storage) return <FileLink target={{ kind: 'host', hostId: storage.hostId, path }}>{name}</FileLink>;
  if (!projectId) return <span>{name}</span>;
  return <span><button type="button" title={`Download ${name}`} disabled={busy} onClick={() => {
    setBusy(true); setError(undefined);
    void sdk.projects.attachments.read({ projectId, path }).then(file => saveFile({ fileName: name, blob: new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }) })).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusy(false));
  }}>{busy ? 'Loading…' : name}</button>{error && <small role="alert">{error}</small>}</span>;
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
    {src && !failed ? <><button type="button" className="fa-attachment-preview" aria-label={`Preview ${file.name}`} onClick={() => setOpen(true)}><img src={src} alt={file.name} onError={() => { setFailed(true); setOpen(false); }} /></button><ImageLightbox imageSrc={src} imageAlt={file.name} title={file.name} isOpen={open} onClose={() => setOpen(false)} /></> : <div className="fa-image-fallback"><span role="img" aria-label={`${failed ? 'Preview unavailable' : 'Loading preview'}: ${file.name}`}><Icon name="Image" /><small>{failed ? 'Preview unavailable' : 'Loading…'}</small></span>{failed && fallback}</div>}
    {onRemove && <button type="button" className="fa-remove-attachment" aria-label={`Remove ${file.name}`} title={`Remove ${file.name}`} onClick={onRemove}><Icon name="X" /></button>}
  </div>;
}
type RowContext = { document?: MarkdownDocument; storage?: StorageLocation; projectId?: string };
function activityLabel(rows: ChatRow[]) {
  const current = [...rows].reverse().find(row => 'status' in row && row.status === 'pending') ?? rows.at(-1);
  if (!current || !('presentation' in current) || !current.presentation) return 'Activity';
  const presentation = current.presentation;
  return presentation.title || (current.status === 'pending' ? presentation.label.pending : current.status === 'completed' ? presentation.label.completed : undefined) || 'Activity';
}
function Activity({ rows, ...context }: RowContext & { rows: ChatRow[] }) {
  const [open, setOpen] = useState(false);
  return <details className="fa-activity-group" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><Icon name="ChevronRight" /><span>{activityLabel(rows)}</span></summary>
    {open && rows.map(row => <Row key={row.id} row={row} {...context} />)}
  </details>;
}
function Rows({ rows, ...context }: RowContext & { rows: ChatRow[] }) {
  const groups: ChatRow[][] = [];
  for (const row of rows) {
    const previous = groups.at(-1);
    if (row.kind !== 'conversation' && row.kind !== 'turn' && previous && previous[0].kind !== 'conversation' && previous[0].kind !== 'turn') previous.push(row);
    else groups.push([row]);
  }
  return <>{groups.map(group => group[0].kind === 'conversation' || group[0].kind === 'turn'
    ? <Row key={group[0].id} row={group[0]} {...context} />
    : <Activity key={group[0].id} rows={group} {...context} />)}</>;
}
function Row({ row, document, storage, projectId }: { row: ChatRow; document?: MarkdownDocument; storage?: StorageLocation; projectId?: string }) {
  if (row.kind === 'turn') return <>{row.children && <Rows rows={row.children} document={document} storage={storage} projectId={projectId} />}{!row.children && <small>Earlier turn · {row.summaryCount} events</small>}</>;
  if (row.kind === 'conversation') return <article className={`fa-message fa-message-${row.role}`}><Markdown content={row.text} experimental_document={document} />{row.attachments && <div className="fa-message-files">{row.attachments.imageUrls.map(url => <UrlLink key={url} href={url}>Image attachment</UrlLink>)}{row.attachments.localFileDetails.map(file => <AttachmentLink key={file.path} path={file.path} name={file.name} projectId={projectId} storage={storage} />)}{row.attachments.localImagePaths?.map(path => { const name = path.split('/').at(-1) || 'Image attachment'; return <AttachmentPreview key={path} file={{ type: 'localImage', path, name }} projectId={projectId} fallback={<AttachmentLink path={path} name={name} projectId={projectId} storage={storage} />} />; })}</div>}</article>;
  if (row.kind === 'system') return <details className="fa-tool-event"><summary>{row.title}<small>{row.status}</small></summary>{row.detail && <Markdown content={row.detail} experimental_document={document} />}</details>;
  const p = 'presentation' in row ? row.presentation : undefined;
  return <details className="fa-tool-event"><summary><Icon name={p?.icon.glyph || 'Toolbox'} /><span>{p?.title || p?.label[row.status === 'pending' ? 'pending' : 'completed'] || row.workKind}</span><small>{row.status}</small></summary>{p?.detail && <Markdown content={p.detail} experimental_document={document} />}{'toolName' in row && <small>{row.toolName}</small>}{'toolArgs' in row && row.toolArgs && <Detail value={row.toolArgs} />}{'command' in row && <Detail value={row.command} />}{'output' in row && row.output && <Detail value={row.output} />}{'childRows' in row && row.childRows?.map(child => <Row key={child.id} row={child} document={document} storage={storage} projectId={projectId} />)}{!('output' in row) && <Detail value={row} />}{'outputPreview' in row && row.outputPreview && <small>Output preview · {row.outputPreview.totalChars} characters total</small>}</details>;
}
function draftFor(id: string): { text: string; attachments: Attachment[] } {
  try { const item = JSON.parse(localStorage.getItem(`fluently-agents.draft.${id}`) || '{}'); return { text: typeof item.text === 'string' ? item.text : '', attachments: Array.isArray(item.attachments) ? item.attachments.filter((file: Attachment) => file && typeof file.path === 'string' && (file.type === 'localFile' || file.type === 'localImage')) : [] }; } catch { return { text: '', attachments: [] }; }
}
export function Chat(props: ChatProps) { return <ChatSession key={props.threadId} {...props} />; }
function ChatSession({ threadId, focusRequest, voiceRequest, onVoiceState, onVoiceRequestHandled, composerAgents, onVoiceContextMenu, className = '' }: ChatProps) {
  const sdk = useSdk(), navigate = useBbNavigate();
  const [draft, setDraft] = useState(() => draftFor(threadId));
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [older, setOlder] = useState<Page['timelinePage']['olderCursor']>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [storage, setStorage] = useState<StorageLocation>();
  const [documentContext, setDocumentContext] = useState<MarkdownDocument>();
  const [interactions, setInteractions] = useState<Interactions>([]);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(() => activeRequests.has(threadId)), [uploading, setUploading] = useState(() => !!pendingUploads.get(threadId));
  const [failedFiles, setFailedFiles] = useState<FailedUpload[]>(() => failedUploads.get(threadId) ?? []);
  const uploadingFiles = useRef(new WeakSet<File>());
  const [error, setError] = useState<string | null>(null), [advanced, setAdvanced] = useState(false), [steer, setSteer] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null), files = useRef<HTMLInputElement>(null), scroll = useRef<HTMLDivElement>(null);
  const alive = useRef(true), sending = useRef(false), stick = useRef(true), olderLoaded = useRef(false);
  const abort = useRef(new AbortController());
  const refreshSequence = useRef(0), active = useRef(false);
  useEffect(() => {
    const listener = (draftChanged: boolean) => { setBusy(activeRequests.has(threadId)); setUploading(!!pendingUploads.get(threadId)); setFailedFiles(failedUploads.get(threadId) ?? []); if (draftChanged) setDraft(draftFor(threadId)); };
    const listeners = requestListeners.get(threadId) ?? new Set(); listeners.add(listener); requestListeners.set(threadId, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) requestListeners.delete(threadId); };
  }, [threadId]);
  const report = useCallback((cause: unknown) => { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }, []);
  const deliverVoice = useRef<(value: string) => void>(() => {});
  const voice = useVoiceTranscript({ threadId, onTranscript: value => deliverVoice.current(value), onError: report });
  const notifyVoice = useRef(onVoiceState); notifyVoice.current = onVoiceState;
  useEffect(() => { onVoiceState?.({ state: voice.state, level: voice.level }); }, [voice.state, voice.level, onVoiceState]);
  useEffect(() => () => { notifyVoice.current?.({ state: 'idle', level: 0 }); }, []);
  const lastVoice = useRef(0);
  useEffect(() => { if (voiceRequest && voiceRequest !== lastVoice.current) { lastVoice.current = voiceRequest; input.current?.blur(); onVoiceRequestHandled?.(voiceRequest); void voice.toggle(); } }, [voiceRequest, voice.toggle, onVoiceRequestHandled]);
  const lastFocus = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (focusRequest === lastFocus.current) return;
    lastFocus.current = focusRequest;
    if (focusRequest && !voiceRequest) input.current?.focus();
  }, [focusRequest, voiceRequest]);
  useEffect(() => { try { localStorage.setItem(`fluently-agents.draft.${threadId}`, JSON.stringify(draft)); } catch { /* The draft remains available in memory. */ } }, [draft, threadId]);
  useEffect(() => {
    if (!thread?.environmentId) return;
    let current = true;
    void sdk.environments.get({ environmentId: thread.environmentId }).then(environment => {
      if (current && environment.path) setDocumentContext({ threadId, rootPath: environment.path, target: { kind: 'workspace', environmentId: environment.id, path: '.fluently-conversation.md' } });
    }).catch(report);
    return () => { current = false; };
  }, [sdk, thread?.environmentId, threadId, report]);
  useEffect(() => {
    let current = true;
    void sdk.threads.storageLocation({ threadId }).then(location => { if (current) setStorage(location); }).catch(report);
    return () => { current = false; };
  }, [sdk, threadId, report]);
  const openStorageLink = (event: MouseEvent) => {
    if (!storage || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target.closest('a') : null;
    const href = target?.getAttribute('href');
    if (!href) return;
    let path: string;
    try {
      if (href.startsWith('file:')) {
        const url = new URL(href); if (url.hostname && url.hostname !== 'localhost') return;
        path = decodeURIComponent(url.pathname);
      } else path = decodeURIComponent(href);
    } catch { return; }
    if (!path.startsWith(`${storage.storageRootPath}/`) || path.split('/').some(part => part === '..' || part === '.')) return;
    const match = /^(.*?)(?::(\d+)(?::(\d+))?)?$/.exec(path);
    if (!match) return;
    event.preventDefault(); event.stopPropagation();
    navigate.experimental_openFilePreview({ target: { kind: 'thread-storage', threadId, path: match[1].slice(storage.storageRootPath.length + 1) }, location: match[2] ? { kind: 'line', line: Number(match[2]), column: match[3] ? Number(match[3]) : null } : null });
  };
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const [page, current, pending, queued] = await Promise.all([timeline(sdk, threadId, abort.current.signal), sdk.threads.get({ threadId, signal: abort.current.signal }), sdk.threads.interactions.list({ threadId, signal: abort.current.signal }), sdk.threads.queuedMessages.list({ threadId, signal: abort.current.signal })]);
    if (!alive.current || sequence !== refreshSequence.current) return;
    setRows(old => reconcileRows(mergeRows(old, page.timelinePage.olderRowUpdates || []), page.rows));
    if (!olderLoaded.current) setOlder(page.timelinePage.olderCursor);
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
  useEffect(() => { if (stick.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [rows, queue, interactions]);
  const mutate = async (operation: () => Promise<unknown>) => { if (sending.current || activeRequests.has(threadId)) return; sending.current = true; activeRequests.add(threadId); notifyRequest(threadId); setBusy(true); setError(null); try { await operation(); await refresh(); } catch (cause) { report(cause); } finally { sending.current = false; activeRequests.delete(threadId); notifyRequest(threadId); if (alive.current) setBusy(false); } };
  const voiceBusy = ['starting', 'recording', 'transcribing'].includes(voice.state);
  const send = (submitted = draft, fromVoice = false) => {
    if ((!submitted.text.trim() && !submitted.attachments.length) || pendingUploads.get(threadId) || failedUploads.get(threadId)?.length || uploading || !loaded || interactions.length || (voiceBusy && !fromVoice)) return;
    void mutate(async () => {
      await sdk.threads.send({ threadId, mode: steer ? 'steer-if-active' : 'queue-if-active', input: [...(submitted.text.trim() ? [{ type: 'text' as const, text: submitted.text, mentions: [] }] : []), ...submitted.attachments] });
      let saved = false;
      try { localStorage.setItem(`fluently-agents.draft.${threadId}`, JSON.stringify(removeSubmittedDraft(draftFor(threadId), submitted))); saved = true; } catch { /* Storage may be unavailable. */ }
      if (saved) notifyRequest(threadId, true);
      else if (alive.current) setDraft(current => removeSubmittedDraft(current, submitted));
      stick.current = true;
    });
  };
  deliverVoice.current = value => {
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
    <div className="fa-chat-transcript" ref={scroll} role="log" aria-label="Conversation" onClickCapture={openStorageLink} onScroll={() => { const el = scroll.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
      {older && <button className="fa-load-history" disabled={busy} onClick={() => void mutate(async () => { const page = await sdk.threads.timeline({ threadId, beforeAnchorId: older.anchorId, beforeAnchorSeq: String(older.anchorSeq), includeNestedRows: 'true', deferContent: 'false', segmentLimit: '40' }); if (alive.current) { olderLoaded.current = true; setRows(old => mergeRows(old, page.rows)); setOlder(page.timelinePage.olderCursor); } })}>Load earlier messages</button>}
      {!loaded && <p className="fa-chat-note">Loading conversation…</p>}{loaded && !rows.length && <p className="fa-chat-note">What would you like to work on?</p>}
      <Rows rows={rows} document={documentContext} storage={storage} projectId={thread?.projectId} />
      {interactions.map(item => <div className="fa-interaction" key={item.id}><strong>{item.payload.kind === 'approval' ? 'Permission requested' : 'Your input is needed'}</strong>{item.payload.kind === 'approval' && item.payload.reason && <p>{item.payload.reason}</p>}<details><summary>Request details</summary><Detail value={item.payload} /></details>{item.payload.kind === 'approval' && item.payload.subject.kind !== 'permission_grant' && item.payload.availableDecisions.filter(decision => decision !== 'allow_for_session').map(decision => <button key={decision} disabled={busy} onClick={() => void mutate(() => sdk.threads.interactions.resolve({ threadId, interactionId: item.id, resolution: decision === 'deny' ? { decision } : { decision, grantedPermissions: null } }))}>{decision === 'allow_once' ? 'Allow once' : 'Deny'}</button>)}<button onClick={() => setAdvanced(true)}>Review request</button></div>)}
      {queue && queue.map(item => <div className="fa-queued-message" key={item.id}><small>Queued</small><span>{item.content.filter(part => part.visibility !== 'agent-only').filter(part => part.type === 'text').map(part => part.text).join('\n') || 'Attachments'}</span><button aria-label="Remove queued message" onClick={() => void mutate(() => sdk.threads.queuedMessages.delete({ threadId, queuedMessageId: item.id }))}><Icon name="X" /></button></div>)}
    </div>
    {running && !interactions.length && <div className="fa-chat-activity" role="status"><i />{thread.status === 'pending' ? 'Waiting to start…' : thread.status === 'starting' ? 'Starting…' : thread.status === 'stopping' ? 'Stopping…' : 'Working…'}</div>}
    {error && <div role="alert" className="fa-chat-error">{error}<button onClick={() => { setError(null); void refresh().catch(report); }}>Refresh</button></div>}
    {!!draft.attachments.length && <div className="fa-draft-files">{draft.attachments.map((file, index) => { const remove = () => setDraft(old => ({ ...old, attachments: old.attachments.filter((_, i) => i !== index) })); return file.type === 'localImage' ? <AttachmentPreview key={`${file.path}-${index}`} file={file} projectId={thread?.projectId} onRemove={remove} /> : <span key={`${file.path}-${index}`}>{file.name}<button aria-label={`Remove ${file.name}`} onClick={remove}><Icon name="X" /></button></span>; })}</div>}
    {uploading && <div className="fa-upload-status" role="status">Attaching files…</div>}
    {failedFiles.map((item, index) => <div className="fa-upload-error" role="alert" key={index}><span>{item.file.name}: {item.error}</span><button type="button" onClick={() => uploadFiles([item.file])}>Retry upload</button><button type="button" aria-label={`Dismiss ${item.file.name}`} onClick={() => { const remaining = (failedUploads.get(threadId) ?? []).filter(entry => entry !== item); if (remaining.length) failedUploads.set(threadId, remaining); else failedUploads.delete(threadId); notifyRequest(threadId); }}>×</button></div>)}
    {(running || voiceBusy || voice.state === 'error') && <div className="fa-compose-status">        {voice.state === 'recording' && <button type="button" onClick={voice.cancel}>Cancel</button>}{voice.state === 'transcribing' && <small>Transcribing…</small>}{voice.state === 'error' && <button type="button" onClick={() => void voice.retry()}>Retry voice</button>}
        {running && <><button type="button" aria-pressed={steer} title="Choose how to send while running" onClick={() => setSteer(value => !value)}>{steer ? 'Steer' : 'Queue'}</button><button type="button" aria-label="Stop work" disabled={busy} onClick={() => void mutate(() => sdk.threads.stop({ threadId }))}><Icon name="Square" /></button></>}
</div>}
    <form className="fa-message-composer" onSubmit={event => { event.preventDefault(); send(); }}><textarea ref={input} value={draft.text} placeholder="Message…" aria-label="Message" rows={1} onChange={event => setDraft(old => ({ ...old, text: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
      <div className="fa-compose-actions"><div className="fa-compose-left"><button className="fa-composer-tool" type="button" aria-label="Attach files" disabled={uploading || !thread} onClick={() => files.current?.click()}><Icon name="FileAttachment" /></button>{composerAgents}</div><div className="fa-compose-right"><button type="button" aria-label={voice.state === 'recording' ? 'Finish recording' : 'Record voice message'} disabled={voice.state === 'transcribing' || voice.state === 'starting'} className={`fa-composer-tool${voice.state === 'recording' ? ' fa-recording' : ''}`} style={{ '--voice-level': voice.level } as CSSProperties} onContextMenu={onVoiceContextMenu} onClick={() => void voice.toggle()}><Icon name={voice.state === 'recording' ? 'Square' : 'Mic'} /></button>
        <button type="submit" className="fa-composer-tool fa-send-message" aria-label="Send message" disabled={busy || uploading || !!failedFiles.length || !loaded || !!interactions.length || voiceBusy || (!draft.text.trim() && !draft.attachments.length)}><Icon name="ArrowUp" /></button>
      </div></div>
    </form>
    <input className="fa-file-input" type="file" multiple ref={files} aria-label="Message attachments" onChange={event => { const selected = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; uploadFiles(selected); }} />
    {advanced && <div className="fa-advanced-overlay" role="dialog" aria-modal="true" aria-label="Review agent request"><header><strong>Review agent request</strong><button aria-label="Return to conversation" onClick={() => { setAdvanced(false); void refresh().catch(report); }}><Icon name="X" /></button></header><p>Answer this request using BB’s permission and question controls. Your conversation stays here.</p><ThreadChat threadId={threadId} variant="compact" layout="contained" /></div>}
  </div>;
}
