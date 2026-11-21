import { openExternalWebLink } from './external-links';
import { avatarColors } from './avatar-colors';
import { countDescription } from './counts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { definePluginApp, experimental_Icon as Icon, ThreadChat, UrlLink, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import { CHANGED, type Agent, type Task, type rpcContract } from './shared';
import './styles.css';
import { Chat } from './chat';

const WIDTH_KEY = 'fluently-agents.sidebar-width';
const clampWidth = (width: number, viewport: number) => Math.max(280, Math.min(Number.isFinite(width) ? width : 440, 720, Math.max(280, viewport - 300)));
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

type Menu = { kind: 'agent'; agent: Agent; left: number; bottom: number } | { kind: 'mode'; left: number; bottom: number } | { kind: 'snooze' };
type Board = { agents: Agent[]; tasks: Task[]; runningAgents: number | null };
function AgentsPage() {
  const rpc = useRpc<typeof rpcContract>();
  const root = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [countStale, setCountStale] = useState(false);
  const countTitle = `${countDescription}${refreshing ? ' Refreshing; showing previous count.' : countStale ? ' Count unavailable; showing previous count.' : ''}`;
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [taskStatus, setTaskStatus] = useState<'running' | 'review'>('review');
  const [taskTarget, setTaskTarget] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [sidebarWidth, setSidebarWidth] = useState(() => clampWidth(Number(readPreference(WIDTH_KEY, '440')), window.innerWidth));
  const resize = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const changeWidth = (width: number) => { const next = clampWidth(width, viewportWidth); setSidebarWidth(next); writePreference(WIDTH_KEY, String(next)); };
  useEffect(() => {
    const element = root.current; if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width; setViewportWidth(width);
      if (width > 650) setSidebarWidth(previous => { const next = clampWidth(previous, width); writePreference(WIDTH_KEY, String(next)); return next; });
    });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const [status, setStatus] = useState<'running' | 'review'>('running');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState(() => readPreference(AGENT_KEY, ''));
  const [agentThreads, setAgentThreads] = useState<Record<string, string>>({});
  const attemptedAgents = useRef(new Set<string>());
  const pendingOpens = useRef(new Map<string, Promise<{ threadId: string }>>());
  const [workerThread, setWorkerThread] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<Agent | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [mode, setMode] = useState<'text' | 'voice'>(() => readPreference('fluently-agents.input-mode', 'text') === 'voice' ? 'voice' : 'text');
  const [voiceRequest, setVoiceRequest] = useState({ threadId: '', nonce: 0 });
  const onVoiceRequestHandled = useCallback((nonce: number) => setVoiceRequest(previous => previous.nonce === nonce ? { ...previous, threadId: '' } : previous), []);
  const [now, setNow] = useState(Date.now());
  const upload = useRef<HTMLInputElement>(null);
  const uploadAgent = useRef<Agent | null>(null);
  const openingSequence = useRef(0);
  const fetchSequence = useRef(0);
  const fetching = useRef(false);
  const refreshPending = useRef(false);
  const navigation = useRef({ taskId, status, taskTarget, selectedAgent });
  navigation.current = { taskId, status, taskTarget, selectedAgent };
  const report = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)), []);
  const refresh = useCallback(function refreshBoard() {
    if (fetching.current) { refreshPending.current = true; return; }
    fetching.current = true;
    const sequence = ++fetchSequence.current;
    setRefreshing(true);
    void rpc.call('board', null).then(result => {
      if (sequence === fetchSequence.current) { setBoard(result); setError(null); setRefreshing(false); setCountStale(false); }
    }, cause => {
      if (sequence !== fetchSequence.current) return;
      setRefreshing(false); setCountStale(true); report(cause);
    }).finally(() => {
      if (sequence !== fetchSequence.current) return;
      fetching.current = false;
      if (refreshPending.current) { refreshPending.current = false; refreshBoard(); }
    });
  }, [rpc, report]);
  useRealtime(CHANGED, refresh);
  useEffect(() => {
    refresh();
    const interval = window.setInterval(() => { setNow(Date.now()); if (!document.hidden) refresh(); }, 30000);
    return () => { window.clearInterval(interval); fetchSequence.current++; fetching.current = false; refreshPending.current = false; openingSequence.current++; };
  }, [refresh]);
  const agent = board?.agents.find(item => item.id === selectedAgent) ?? board?.agents[0] ?? null;
  const task = board?.tasks.find(item => item.id === taskId) ?? null;
  const threadId = task && taskTarget ? task.threadId : agent ? agentThreads[agent.id] ?? agent.threadId : null;
  const needs = board?.tasks.filter(item => item.state === 'needs-you') ?? [];
  const running = board?.tasks.filter(item => item.state === 'running' || item.state === 'queued') ?? [];

  const openAgent = useCallback(async (next: Agent, focusComposer = false) => {
    const sequence = ++openingSequence.current;
    setTaskTarget(false); setSelectedAgent(next.id); writePreference(AGENT_KEY, next.id);
    const existing = agentThreads[next.id] ?? next.threadId;
    attemptedAgents.current.add(next.id);
    setOpening(!existing); setWorkerThread(null);
    if (existing && focusComposer) setFocus(value => value + 1);
    try {
      let pending = pendingOpens.current.get(next.id);
      if (!pending) {
        pending = rpc.call('openAgent', { agentId: next.id });
        pendingOpens.current.set(next.id, pending);
        void pending.finally(() => pendingOpens.current.delete(next.id)).catch(() => {});
      }
      const result = await pending;
      setAgentThreads(current => ({ ...current, [next.id]: result.threadId }));
      if (sequence === openingSequence.current) {
        if (focusComposer && !existing) setFocus(value => value + 1);
        return result.threadId;
      }
    } catch (cause) { if (sequence === openingSequence.current) report(cause); }
    finally { if (sequence === openingSequence.current) setOpening(false); }
  }, [rpc, report, agentThreads]);
  useEffect(() => {
    if ((!task || !taskTarget) && agent && !threadId && !attemptedAgents.current.has(agent.id)) void openAgent(agent);
  }, [task, taskTarget, agent, threadId, openAgent]);
  const focusChat = useCallback(() => {
    if (task || threadId) setFocus(value => value + 1);
    else if (agent) void openAgent(agent, true);
  }, [task, threadId, agent, openAgent]);
  const activateVoice = useCallback(async () => {
    if (task && taskTarget && !threadId) return;
    const target = threadId ?? (agent ? await openAgent(agent) : undefined);
    if (target) setVoiceRequest(previous => ({ threadId: target, nonce: previous.nonce + 1 }));
  }, [task, taskTarget, threadId, agent, openAgent]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenu(null); setRenaming(null); setWorkerThread(null); }
      if (workerThread || renaming || root.current?.querySelector('dialog[open]')) return;
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
      if (event.target instanceof Element && !event.target.closest('.fa-menu, [aria-haspopup=menu]')) setMenu(null);
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
    setStatus(next.state === 'needs-you' ? 'review' : 'running');
    openingSequence.current++; setOpening(false); setTaskTarget(true); setTaskId(next.id); setWorkerThread(null); setMenu(null);
  };
  const returnHome = () => { openingSequence.current++; setOpening(false); setTaskTarget(false); setTaskId(null); setWorkerThread(null); setMenu(null); };
  const act = async (operation: () => Promise<unknown>, closeTask = false) => {
    const origin = { taskId, status, taskTarget, selectedAgent };
    setBusy(true); setMenu(null);
    try {
      await operation();
      if (closeTask && navigation.current.taskId === origin.taskId && navigation.current.status === origin.status && navigation.current.taskTarget === origin.taskTarget && navigation.current.selectedAgent === origin.selectedAgent) {
        const next = (origin.status === 'review' ? needs : running).find(item => item.id !== origin.taskId);
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
  const agentSelector = <div className="fa-avatars" aria-label="Conversation target">
    {task && <button type="button" className={`fa-avatar${taskTarget ? ' fa-selected' : ''}`} style={avatarColors(task.title)} title="Task worker" aria-label="Chat with task worker" aria-pressed={taskTarget} onClick={() => { openingSequence.current++; setOpening(false); setTaskTarget(true); setFocus(value => value + 1); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 4h8M12 2v2M6 8h12a2 2 0 0 1 2 2v9H4v-9a2 2 0 0 1 2-2M8 12h.01M16 12h.01M9 16h6M2 12v4M22 12v4" /></svg></button>}
    {board?.agents.map(item => <button type="button" className={`fa-avatar${(!task || !taskTarget) && agent?.id === item.id ? ' fa-selected' : ''}`} key={item.id} style={avatarColors(item.name)} title={item.name} aria-label={`Chat with ${item.name}`} aria-pressed={(!task || !taskTarget) && agent?.id === item.id} onContextMenu={event => showMenu(event, 'agent', item)} onClick={() => void openAgent(item, true)}><Avatar agent={item} /></button>)}
  </div>;

  return <div className="fa-app" onClickCapture={openExternalWebLink} ref={root} style={{ '--fa-sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
    <header className="fa-topbar">
      <nav className="fa-pill fa-breadcrumb" aria-label="Agents navigation">
        <button className="fa-root-crumb" onClick={returnHome}>Board</button>
        {task && <><span className="fa-crumb-divider">/</span><span className="fa-task-crumb" title={task.title}>Task</span></>}

      </nav>
      <div className="fa-top-actions">
        {task ? <div className="fa-pill">
          <button className="fa-icon-button" disabled={busy} title="Snooze" aria-label="Snooze task" onClick={() => setMenu(value => value?.kind === 'snooze' ? null : { kind: 'snooze' })}><Icon name="Clock" /></button>
          <button className="fa-icon-button" disabled={busy} title="Mark done" aria-label="Mark task done" onClick={() => void act(() => rpc.call('completeTask', { taskId: task.id }), true)}><Icon name="Check" /></button>
        </div> : <span className="fa-pill fa-agent-count" title={countTitle}><i className="fa-dot" />{board?.runningAgents == null ? 'Agents' : `${board.runningAgents} ${board.runningAgents === 1 ? 'agent' : 'agents'}`}</span>}
      </div>
    </header>

    {error && <div className="fa-error" role="alert"><span>{error}</span><button onClick={refresh}>Retry</button><button aria-label="Dismiss error" onClick={() => setError(null)}><Icon name="X" /></button></div>}
    <main className="fa-canvas">
      {!board ? <div className="fa-empty" role="status">Loading agents…</div> : task ? <div className="fa-task-canvas">
        {task.artifacts.length > 0 ? <div className="fa-artifacts">{task.artifacts.map((artifact, index) => <UrlLink className="fa-artifact" key={`${artifact.url}-${index}`} href={artifact.url}><Icon name="FileText" /><strong>{artifact.title}</strong><Icon name="ArrowUpRight" /></UrlLink>)}</div> : <div className="fa-empty">Results will appear here.</div>}
        {(task.state === 'snoozed' || task.state === 'done') && <button className="fa-reopen" disabled={busy} onClick={() => void act(() => rpc.call('reopenTask', { taskId: task.id }))}>Reopen task</button>}
      </div> : <div className="fa-board-columns">{([{ title: 'Running', items: running }, { title: 'Inbox', items: needs }]).map(column => <section className="fa-board-column" aria-label={`${column.title} tasks`} key={column.title}><h2>{column.title}<small>{column.items.length}</small></h2><div className="fa-board-cards">{column.items.map(item => <button key={item.id} className="fa-board-card fa-panel" onClick={() => openTask(item)}><strong>{item.title}</strong><span>{item.projectName}</span><small title={countTitle}><i className={`fa-dot${item.state === 'needs-you' ? ' fa-amber' : ''}`} />{item.state === 'needs-you' ? item.ask || 'Needs you' : item.state === 'queued' ? 'Queued' : item.runningAgents == null ? 'Running' : `${item.runningAgents} agents`}</small></button>)}</div>{column.items.length === 0 && <p className="fa-inbox-empty">All caught up.</p>}</section>)}</div>}
    </main>

    <aside className="fa-communications" aria-label="Conversations">
      <section className={`fa-inbox fa-panel${collapsed ? ' fa-inbox-collapsed' : ''}`} aria-label="Tasks">
        <div className="fa-inbox-header">
          <div className="fa-task-status" role="group" aria-label="Task status">
            <button aria-pressed={taskStatus === 'review'} onClick={() => setTaskStatus('review')}>Inbox <small>{needs.length}</small></button>
            <button aria-pressed={taskStatus === 'running'} onClick={() => setTaskStatus('running')}>Running <small>{running.length}</small></button>
          </div>
          <button className="fa-icon-button" aria-label={collapsed ? 'Expand tasks' : 'Collapse tasks'} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}><Icon name={collapsed ? 'ChevronRight' : 'ChevronDown'} /></button>
        </div>
        <div className="fa-inbox-list" hidden={collapsed}>{(taskStatus === 'running' ? running : needs).map(item => <button key={item.id} className={`fa-inbox-item${item.id === taskId ? ' fa-active' : ''}`} title={`${item.projectName} / ${item.title}${item.ask ? ` / ${item.ask}` : ''}`} onClick={() => openTask(item)}><i className={`fa-dot${item.state === 'needs-you' ? ' fa-amber' : ''}`} /><strong>{item.title}</strong>{(item.state === 'needs-you' || item.ask) && <span className="fa-inbox-task-title">{item.ask || 'Review task'}</span>}{item.state !== 'needs-you' && item.runningAgents !== null && <small className="fa-running-count" title={countTitle}>{item.runningAgents} agents</small>}<small>{item.state === 'needs-you' ? elapsed(item.needsSince ?? item.updatedAt, now).replace(' ago', '') : item.etaAt !== null ? `~${eta(item.etaAt, now)}` : item.state === 'queued' ? 'Queued' : ''}</small></button>)}{(taskStatus === 'running' ? running : needs).length === 0 && <p className="fa-inbox-empty">All caught up.</p>}</div>
      </section>
      <section className="fa-chat" aria-label="Chat">
        {task && task.pendingWorkers.length > 0 && <div className="fa-worker-actions">
          {task.pendingWorkers.map(worker => <button key={worker.threadId} onClick={() => { setWorkerThread(worker.threadId); setFocus(value => value + 1); }}><i className="fa-dot fa-amber" />{worker.title}<Icon name="ArrowRight" /></button>)}
        </div>}
        {opening ? <div className="fa-chat-empty" role="status">Opening conversation…{agentSelector}</div> : threadId ? <Chat key={threadId} threadId={threadId} focusRequest={focus} voiceRequest={voiceRequest.threadId === threadId ? voiceRequest.nonce : 0} composerAgents={agentSelector} placeholder={task && taskTarget ? 'Message worker…' : `Message ${agent?.name ?? 'agent'}…`} onVoiceContextMenu={event => showMenu(event, 'mode')} onVoiceRequestHandled={onVoiceRequestHandled} className="fa-native-chat" /> : <div className="fa-chat-empty">{task ? 'The task conversation is being created.' : agent ? <button onClick={() => void openAgent(agent, true)}>Open {agent.name} conversation</button> : 'Create an agent in the plugin settings.'}{agentSelector}</div>}
      </section>
    </aside>

    <div className="fa-sidebar-resizer" role="separator" tabIndex={0} aria-label="Sidebar width" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={clampWidth(720, viewportWidth)} aria-valuenow={sidebarWidth}
      onKeyDown={event => { const next = event.key === 'ArrowLeft' ? sidebarWidth - 16 : event.key === 'ArrowRight' ? sidebarWidth + 16 : event.key === 'Home' ? 280 : event.key === 'End' ? 720 : null; if (next !== null) { event.preventDefault(); changeWidth(next); } }}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); resize.current = { pointerId: event.pointerId, x: event.clientX, width: sidebarWidth }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { const start = resize.current; if (start?.pointerId === event.pointerId) changeWidth(start.width + event.clientX - start.x); }}
      onPointerUp={event => { resize.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={event => { resize.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onLostPointerCapture={() => { resize.current = null; }} />
    {menu && <div className={`fa-menu${menu.kind === 'snooze' ? ' fa-snooze-menu' : ''}`} role="menu" style={'left' in menu ? { left: menu.left, bottom: menu.bottom } : undefined}>
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
  app.slots.navPanel({ id: 'board', title: 'Agents', icon: 'GridView', path: 'board', component: AgentsPage });
});
