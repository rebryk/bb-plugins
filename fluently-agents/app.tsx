import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent } from 'react';
import { definePluginApp, experimental_Icon as Icon, ThreadChat, UrlLink, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import { CHANGED, type Agent, type Task, type rpcContract } from './shared';
import './styles.css';
import { Chat } from './chat';
import type { VoiceState } from './voice';

const WIDTH_KEY = 'fluently-agents.communication-width';
const AGENT_KEY = 'fluently-agents.selected-agent';
function readPreference(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Private browsing still works. */ }
}
function elapsed(timestamp: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}
function eta(timestamp: number, now: number) {
  const minutes = Math.ceil((timestamp - now) / 60000);
  return minutes <= 0 ? 'Updating ETA' : `${minutes}m`;
}
function Avatar({ agent }: { agent: Agent }) {
  const image = /^(https?:\/\/|data:image\/(png|jpeg|webp|gif);base64,)/i.test(agent.avatar);
  return image ? <img src={agent.avatar} alt="" /> : <span>{agent.avatar || agent.name.slice(0, 2).toUpperCase()}</span>;
}
function TaskCard({ task, now, open }: { task: Task; now: number; open(): void }) {
  const needs = task.state === 'needs-you';
  return <button className="fa-task-card" onClick={open}>
    <span className="fa-card-heading"><strong title={task.title}>{task.title}</strong><span className="fa-project-tag">{task.projectName}</span></span>
    <span className="fa-card-status">
      {needs ? <span className="fa-ask"><i className="fa-dot fa-amber" />{task.ask || 'Review the task'}</span> : <>
        <span><i className="fa-dot" />{task.state === 'queued' ? 'Queued' : `${task.runningAgents} ${task.runningAgents === 1 ? 'agent' : 'agents'}`}</span>
        {task.etaAt !== null && <span>{eta(task.etaAt, now)}</span>}
      </>}
    </span>
    {!needs && <span className="fa-progress" role="progressbar" aria-label="Task progress" aria-valuemin={0} aria-valuemax={task.total || 1} aria-valuenow={Math.min(task.completed, task.total)}>
      <span style={{ width: task.total > 0 ? `${Math.min(100, task.completed / task.total * 100)}%` : '0%' }} />
    </span>}
  </button>;
}

type Menu = { kind: 'agent'; agent: Agent; left: number; bottom: number } | { kind: 'mode'; left: number; bottom: number } | { kind: 'snooze' };
type Board = { agents: Agent[]; tasks: Task[]; runningAgents: number };
function AgentsPage() {
  const rpc = useRpc<typeof rpcContract>();
  const root = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'board' | 'inbox'>('board');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState(() => readPreference(AGENT_KEY, ''));
  const [agentThread, setAgentThread] = useState<{ agentId: string; threadId: string } | null>(null);
  const [workerThread, setWorkerThread] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const [width, setWidth] = useState(() => Math.max(280, Math.min(560, Number(readPreference(WIDTH_KEY, '360')) || 360)));
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<Agent | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [mode, setMode] = useState<'text' | 'voice'>(() => readPreference('fluently-agents.input-mode', 'text') === 'voice' ? 'voice' : 'text');
  const [voiceRequest, setVoiceRequest] = useState({ threadId: '', nonce: 0 });
  const [voice, setVoice] = useState<{ state: VoiceState; level: number }>({ state: 'idle', level: 0 });
  const onVoiceRequestHandled = useCallback((nonce: number) => setVoiceRequest(previous => previous.nonce === nonce ? { ...previous, threadId: '' } : previous), []);
  const onVoiceState = useCallback((next: { state: VoiceState; level: number }) => setVoice(next), []);
  const [now, setNow] = useState(Date.now());
  const upload = useRef<HTMLInputElement>(null);
  const uploadAgent = useRef<Agent | null>(null);
  const openingSequence = useRef(0);
  const fetchSequence = useRef(0);
  const navigation = useRef({ taskId, view });
  navigation.current = { taskId, view };
  const report = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)), []);
  const refresh = useCallback(() => {
    const sequence = ++fetchSequence.current;
    void rpc.call('board', null).then(result => {
      if (sequence === fetchSequence.current) { setBoard(result); setError(null); }
    }, report);
  }, [rpc, report]);
  useRealtime(CHANGED, refresh);
  useEffect(() => {
    refresh();
    const interval = window.setInterval(() => { setNow(Date.now()); if (!document.hidden) refresh(); }, 30000);
    return () => { window.clearInterval(interval); fetchSequence.current++; openingSequence.current++; };
  }, [refresh]);
  const agent = board?.agents.find(item => item.id === selectedAgent) ?? board?.agents[0] ?? null;
  const task = board?.tasks.find(item => item.id === taskId) ?? null;
  const threadId = task ? task.threadId : agentThread && agentThread.agentId === agent?.id ? agentThread.threadId : null;
  const needs = board?.tasks.filter(item => item.state === 'needs-you') ?? [];
  const running = board?.tasks.filter(item => item.state === 'running' || item.state === 'queued') ?? [];

  const openAgent = useCallback(async (next: Agent, focusComposer = false) => {
    const sequence = ++openingSequence.current;
    setSelectedAgent(next.id); writePreference(AGENT_KEY, next.id);
    setOpening(true); setChatOpen(true); setWorkerThread(null);
    try {
      const result = await rpc.call('openAgent', { agentId: next.id });
      if (sequence === openingSequence.current) {
        setAgentThread({ agentId: next.id, threadId: result.threadId });
        if (focusComposer) setFocus(value => value + 1);
        return result.threadId;
      }
    } catch (cause) { report(cause); }
    finally { if (sequence === openingSequence.current) setOpening(false); }
  }, [rpc, report]);
  const focusChat = useCallback(() => {
    setChatOpen(true);
    if (task || threadId) setFocus(value => value + 1);
    else if (agent) void openAgent(agent, true);
  }, [task, threadId, agent, openAgent]);
  const activateVoice = useCallback(async () => {
    setChatOpen(true);
    const target = threadId ?? (agent ? await openAgent(agent) : undefined);
    if (target) setVoiceRequest(previous => ({ threadId: target, nonce: previous.nonce + 1 }));
  }, [threadId, agent, openAgent]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenu(null); setRenaming(null); setWorkerThread(null); }
      if (workerThread || renaming) return;
      const target = event.target;
      const editing = target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input,textarea,select,[role="textbox"],[role="dialog"]'));
      if (event.key.toLowerCase() === 'n' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !editing) {
        event.preventDefault(); if (mode === 'voice') void activateVoice(); else focusChat();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusChat, activateVoice, mode, workerThread, renaming]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.fa-menu')) setMenu(null);
    };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [menu]);
  const showMenu = (event: MouseEvent<HTMLButtonElement>, kind: 'agent' | 'mode', next?: Agent) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const frame = root.current?.getBoundingClientRect();
    if (!frame) return;
    const position = { left: Math.max(8, Math.min(bounds.left - frame.left, frame.width - 200)), bottom: frame.bottom - bounds.top + 8 };
    setMenu(kind === 'agent' && next ? { kind, agent: next, ...position } : { kind: 'mode', ...position });
  };
  const openTask = (next: Task) => {
    openingSequence.current++; setOpening(false); setTaskId(next.id); setWorkerThread(null); setMenu(null); setVoice({ state: 'idle', level: 0 });
    setChatOpen(true);
  };
  const returnHome = () => { setTaskId(null); setWorkerThread(null); setMenu(null); };
  const act = async (operation: () => Promise<unknown>, closeTask = false) => {
    const origin = { taskId, view };
    setBusy(true); setMenu(null);
    try {
      await operation();
      if (closeTask && navigation.current.taskId === origin.taskId && navigation.current.view === origin.view) {
        const next = origin.view === 'inbox' ? needs.find(item => item.id !== origin.taskId) : null;
        if (next) openTask(next); else returnHome();
      }
      refresh();
    }
    catch (cause) { report(cause); }
    finally { setBusy(false); }
  };
  const saveAgent = (next: Agent, fields: Partial<Pick<Agent, 'name' | 'avatar'>>) => act(async () => {
    await rpc.call('saveAgent', { id: next.id, name: next.name, avatar: next.avatar, instructions: next.instructions, projectId: next.projectId, execution: next.execution, ...fields });
    setRenaming(null);
  });
  const resize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX, startWidth = width;
    const target = event.currentTarget;
    const move = (next: globalThis.PointerEvent) => {
      const maximum = Math.min(560, (root.current?.clientWidth ?? 584) - 24);
      const value = Math.max(280, Math.min(maximum, startWidth + next.clientX - startX));
      setWidth(value); writePreference(WIDTH_KEY, String(value));
    };
    const stop = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', stop); target.removeEventListener('pointercancel', stop); };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', stop); target.addEventListener('pointercancel', stop);
  };
  const resizeHandle = <div role="separator" aria-label="Communication panel width" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={560} aria-valuenow={Math.round(width)} tabIndex={0} className="fa-resize" onPointerDown={resize} onKeyDown={event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); const next = Math.max(280, Math.min(560, width + (event.key === 'ArrowRight' ? 20 : -20))); setWidth(next); writePreference(WIDTH_KEY, String(next));
  }} />;

  return <div className="fa-app" ref={root} style={{ '--fa-column-width': `${width}px` } as CSSProperties}>
    <header className="fa-topbar">
      <nav className="fa-pill fa-breadcrumb" aria-label="Agents navigation">
        <button className="fa-icon-button" title={view === 'board' ? 'Show inbox' : 'Show board'} aria-label={view === 'board' ? 'Show inbox' : 'Show board'} onClick={() => { setView(value => value === 'board' ? 'inbox' : 'board'); setMenu(null); }}><Icon name={view === 'board' ? 'Columns2' : 'MailOpen'} /></button>
        <button className="fa-root-crumb" onClick={returnHome}>{view === 'board' ? 'Board' : 'Inbox'}</button>
        {task && <><span className="fa-crumb-divider">/</span><span className="fa-task-crumb">{task.title}</span></>}
      </nav>
      <div className="fa-top-actions">
        {task ? <div className="fa-pill">
          <button className="fa-icon-button" disabled={busy} title="Snooze" aria-label="Snooze task" onClick={() => setMenu(value => value?.kind === 'snooze' ? null : { kind: 'snooze' })}><Icon name="Clock" /></button>
          <button className="fa-icon-button" disabled={busy} title="Mark done" aria-label="Mark task done" onClick={() => void act(() => rpc.call('completeTask', { taskId: task.id }), true)}><Icon name="Check" /></button>
        </div> : <span className="fa-pill fa-agent-count"><i className="fa-dot" />{board?.runningAgents ?? 0} {board?.runningAgents === 1 ? 'agent' : 'agents'}</span>}
      </div>
    </header>

    {error && <div className="fa-error" role="alert"><span>{error}</span><button onClick={refresh}>Retry</button><button aria-label="Dismiss error" onClick={() => setError(null)}><Icon name="X" /></button></div>}
    <main className="fa-canvas">
      {!board ? <div className="fa-empty" role="status">Loading agents…</div> : task ? <div className="fa-task-canvas">
        {task.artifacts.length > 0 ? <div className="fa-artifacts">{task.artifacts.map((artifact, index) => <UrlLink className="fa-artifact" key={`${artifact.url}-${index}`} href={artifact.url}><Icon name="FileText" /><strong>{artifact.title}</strong><Icon name="ArrowUpRight" /></UrlLink>)}</div> : <div className="fa-empty">Results will appear here.</div>}
        {(task.state === 'snoozed' || task.state === 'done') && <button className="fa-reopen" disabled={busy} onClick={() => void act(() => rpc.call('reopenTask', { taskId: task.id }))}>Reopen task</button>}
      </div> : <div className="fa-board">
        {([{ label: 'Running', tasks: running, warning: false }, { label: 'Needs you', tasks: needs, warning: true }]).map(column => <section className="fa-board-column" key={column.label}>
          <h2><i className={`fa-dot${column.warning ? ' fa-amber' : ''}`} />{column.label}<span>{column.tasks.length}</span></h2>
          <div className="fa-card-list">{column.tasks.map(item => <TaskCard key={item.id} task={item} now={now} open={() => openTask(item)} />)}</div>
          {column.tasks.length === 0 && <p className="fa-column-empty">{column.warning ? 'Nothing needs your attention.' : 'Message an agent to get started.'}</p>}
        </section>)}
      </div>}
    </main>

    {(view === 'inbox' || chatOpen) && <aside className="fa-communications" aria-label="Conversations">
      {view === 'inbox' && <section className="fa-inbox fa-panel" aria-label="Needs you">
        <h2>Needs you<span>{needs.length}</span></h2>
        <div className="fa-inbox-list">{needs.map(item => <button key={item.id} className={`fa-inbox-item${item.id === taskId ? ' fa-active' : ''}`} onClick={() => openTask(item)}><i className="fa-dot fa-amber" /><span><strong>{item.title}</strong><small>Waiting · {elapsed(item.needsSince ?? item.updatedAt, now)}</small></span></button>)}{needs.length === 0 && <p className="fa-inbox-empty">All caught up.</p>}</div>
        {resizeHandle}
      </section>}
      {chatOpen && <section className="fa-chat fa-panel" aria-label="Chat">
        {task && task.pendingWorkers.length > 0 && <div className="fa-worker-actions">
          {task.pendingWorkers.map(worker => <button key={worker.threadId} onClick={() => { setWorkerThread(worker.threadId); setFocus(value => value + 1); }}><i className="fa-dot fa-amber" />{worker.title}<Icon name="ArrowRight" /></button>)}
        </div>}
        {opening ? <div className="fa-chat-empty" role="status">Opening conversation…</div> : threadId ? <Chat key={threadId} threadId={threadId} focusRequest={focus} voiceRequest={voiceRequest.threadId === threadId ? voiceRequest.nonce : 0} onVoiceState={onVoiceState} onVoiceRequestHandled={onVoiceRequestHandled} className="fa-native-chat" /> : <div className="fa-chat-empty">{task ? 'The task conversation is being created.' : agent ? <button onClick={() => void openAgent(agent, true)}>Open {agent.name} conversation</button> : 'Create an agent in the plugin settings.'}</div>}
        {resizeHandle}
      </section>}
    </aside>}

    <footer className="fa-footer">
      <button className={`fa-chat-toggle${chatOpen ? ' fa-selected' : ''}${voice.state === 'recording' ? ' fa-recording' : ''}`} style={{ '--voice-level': voice.level } as CSSProperties} title={mode === 'voice' ? 'Voice · N' : 'Chat · N'} aria-label={voice.state === 'recording' ? 'Stop and send voice message' : mode === 'voice' ? 'Record voice message' : chatOpen ? 'Close chat' : 'Open chat'} disabled={voice.state === 'starting' || voice.state === 'transcribing'} aria-expanded={chatOpen} onContextMenu={event => showMenu(event, 'mode')} onClick={() => { if (mode === 'voice') void activateVoice(); else if (chatOpen) setChatOpen(false); else focusChat(); }}><Icon name={voice.state === 'recording' ? 'Square' : mode === 'voice' ? 'Mic' : 'MessageSquare'} /></button>
      {!task && board && board.agents.length > 0 && <div className="fa-pill fa-avatars" aria-label="Agents">{board.agents.map(item => <button className={`fa-avatar${agent?.id === item.id ? ' fa-selected' : ''}`} key={item.id} title={item.name} aria-label={`Chat with ${item.name}`} aria-pressed={agent?.id === item.id} onContextMenu={event => showMenu(event, 'agent', item)} onClick={() => { if (agent?.id === item.id && chatOpen) setChatOpen(false); else void openAgent(item, true); }}><Avatar agent={item} /></button>)}</div>}
    </footer>

    {menu && <div className={`fa-menu${menu.kind === 'snooze' ? ' fa-snooze-menu' : ''}`} role="menu" style={menu.kind === 'snooze' ? undefined : { left: menu.left, bottom: menu.bottom }}>
      {menu.kind === 'snooze' && task ? <><div className="fa-menu-label">Snooze until</div>{[
        { label: 'Later today', until: now + 3 * 60 * 60 * 1000 },
        { label: 'Tomorrow', until: new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() + 1, 9).getTime() },
        { label: 'Forever', until: null },
      ].map(option => <button role="menuitem" key={option.label} disabled={busy} onClick={() => void act(() => rpc.call('snoozeTask', { taskId: task.id, until: option.until }), true)}>{option.label}</button>)}</> : menu.kind === 'agent' ? <><button role="menuitem" onClick={() => { uploadAgent.current = menu.agent; upload.current?.click(); setMenu(null); }}><Icon name="FileAttachment" />Change avatar</button><button role="menuitem" onClick={() => { setRenaming(menu.agent); setName(menu.agent.name); setMenu(null); }}><Icon name="Edit" />Rename</button></> : <><button role="menuitem" onClick={() => { setMenu(null); setMode('text'); writePreference('fluently-agents.input-mode', 'text'); focusChat(); }}><Icon name="AlignLeft" />Write a message</button><button role="menuitem" onClick={() => { setMenu(null); setMode('voice'); writePreference('fluently-agents.input-mode', 'voice'); }}><Icon name="Mic" />Voice input</button></>}
    </div>}
    <input ref={upload} className="fa-file-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Agent avatar" onChange={event => {
      const file = event.currentTarget.files?.[0]; const next = uploadAgent.current; event.currentTarget.value = '';
      if (!file || !next) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 100000) { setError('Choose a PNG, JPEG, or WebP image smaller than 100 KB.'); return; }
      const reader = new FileReader(); reader.onload = () => { if (typeof reader.result === 'string') void saveAgent(next, { avatar: reader.result }); }; reader.onerror = () => setError('Could not read this image.'); reader.readAsDataURL(file);
    }} />
    {workerThread && task && <div className="fa-dialog-shade"><section className="fa-worker-dialog fa-panel" role="dialog" aria-modal="true" aria-label="Worker approval">
      <header><div><strong>Worker approval</strong><small>{task.pendingWorkers.find(worker => worker.threadId === workerThread)?.title || 'Worker conversation'}</small></div><button autoFocus className="fa-icon-button" aria-label="Back to task" title="Back to task" onClick={() => setWorkerThread(null)}><Icon name="X" /></button></header>
      <p>This conversation is with the worker. Return to the task chat for instructions to the task lead.</p>
      <ThreadChat threadId={workerThread} variant="compact" layout="contained" className="fa-native-chat" />
    </section></div>}
    {renaming && <div className="fa-dialog-shade" onClick={() => setRenaming(null)}><form className="fa-rename-dialog fa-panel" role="dialog" aria-modal="true" aria-labelledby="fa-rename-title" onClick={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); if (name.trim()) void saveAgent(renaming, { name: name.trim() }); }}><h2 id="fa-rename-title">Rename agent</h2><input autoFocus aria-label="Agent name" value={name} maxLength={60} onChange={event => setName(event.target.value)} /><div><button type="button" onClick={() => setRenaming(null)}>Cancel</button><button type="submit" disabled={busy || !name.trim()}>Save</button></div></form></div>}
  </div>;
}

export default definePluginApp(app => {
  app.slots.navPanel({ id: 'board', title: 'Agents', icon: 'Bot', path: 'board', component: AgentsPage });
});
