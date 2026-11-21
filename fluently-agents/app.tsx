import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { definePluginApp, experimental_Icon as Icon, ThreadChat, UrlLink, useBbNavigate, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import { CHANGED, type Agent, type Task, type rpcContract } from './shared';
import './styles.css';
import { Chat } from './chat';
import { mountFocusedShell } from './focus-shell';

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

type Menu = { kind: 'agent'; agent: Agent; left: number; bottom: number } | { kind: 'mode'; left: number; bottom: number } | { kind: 'snooze' | 'status' | 'tasks' };
type Board = { agents: Agent[]; tasks: Task[]; runningAgents: number };
function AgentsPage() {
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const root = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(true);
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
  const navigation = useRef({ taskId, status });
  navigation.current = { taskId, status };
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
  const threadId = task ? task.threadId : agent ? agentThreads[agent.id] ?? agent.threadId : null;
  const needs = board?.tasks.filter(item => item.state === 'needs-you') ?? [];
  const running = board?.tasks.filter(item => item.state === 'running' || item.state === 'queued') ?? [];

  const openAgent = useCallback(async (next: Agent, focusComposer = false) => {
    const sequence = ++openingSequence.current;
    setSelectedAgent(next.id); writePreference(AGENT_KEY, next.id);
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
    if (!taskId && agent && !threadId && !attemptedAgents.current.has(agent.id)) void openAgent(agent);
  }, [taskId, agent, threadId, openAgent]);
  const focusChat = useCallback(() => {
    if (task || threadId) setFocus(value => value + 1);
    else if (agent) void openAgent(agent, true);
  }, [task, threadId, agent, openAgent]);
  const activateVoice = useCallback(async () => {
    const target = threadId ?? (agent ? await openAgent(agent) : undefined);
    if (target) setVoiceRequest(previous => ({ threadId: target, nonce: previous.nonce + 1 }));
  }, [threadId, agent, openAgent]);
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
    openingSequence.current++; setOpening(false); setTaskId(next.id); setWorkerThread(null); setMenu(null);
  };
  const returnHome = () => { setTaskId(null); setWorkerThread(null); setMenu(null); };
  const act = async (operation: () => Promise<unknown>, closeTask = false) => {
    const origin = { taskId, status };
    setBusy(true); setMenu(null);
    try {
      await operation();
      if (closeTask && navigation.current.taskId === origin.taskId && navigation.current.status === origin.status) {
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
  const agentSelector = task ? <div className="fa-avatars"><span className="fa-avatar fa-selected" title="Task worker"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 4h8M12 2v2M6 8h12a2 2 0 0 1 2 2v9H4v-9a2 2 0 0 1 2-2M8 12h.01M16 12h.01M9 16h6M2 12v4M22 12v4" /></svg></span></div> : board && board.agents.length > 0 && <div className="fa-avatars" aria-label="Agents">{board.agents.map(item => <button type="button" className={`fa-avatar${agent?.id === item.id ? ' fa-selected' : ''}`} key={item.id} title={item.name} aria-label={`Chat with ${item.name}`} aria-pressed={agent?.id === item.id} onContextMenu={event => showMenu(event, 'agent', item)} onClick={() => void openAgent(item, true)}><Avatar agent={item} /></button>)}</div>;

  return <div className="fa-app" ref={root}>
    <header className="fa-topbar">
      <nav className="fa-pill fa-breadcrumb" aria-label="Agents navigation">
        <button className="fa-icon-button" title={task ? `Back to ${status}` : 'Back to BB'} aria-label={task ? `Back to ${status}` : 'Back to BB'} onClick={() => task ? returnHome() : navigate.toCompose()}><Icon name="ArrowLeft" /></button>
        <button className="fa-root-crumb" aria-haspopup="menu" aria-expanded={menu?.kind === 'status'} onClick={() => setMenu(value => value?.kind === 'status' ? null : { kind: 'status' })}>{status === 'running' ? 'Running' : 'Review'}<Icon name="ChevronDown" /></button>
        {task && <><span className="fa-crumb-divider">/</span><button className="fa-task-crumb" aria-label="Switch task" title={task.title} aria-haspopup="menu" aria-expanded={menu?.kind === 'tasks'} onClick={() => setMenu(value => value?.kind === 'tasks' ? null : { kind: 'tasks' })}><span>{task.title}</span><Icon name="ChevronDown" /></button></>}

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
      </div> : null}

    </main>

    <aside className="fa-communications" aria-label="Conversations">
      {!task && <section className={`fa-inbox fa-panel${inboxOpen ? '' : ' fa-inbox-collapsed'}`} aria-label="Task list">
        <button className="fa-inbox-header" aria-expanded={inboxOpen} onClick={() => setInboxOpen(value => !value)}><span>{status === 'running' ? 'Running' : 'Review'}</span><small>{(status === 'running' ? running : needs).length}</small><Icon name={inboxOpen ? 'ChevronDown' : 'ChevronRight'} /></button>
        <div className="fa-inbox-list" hidden={!inboxOpen}>{(status === 'running' ? running : needs).map(item => <button key={item.id} className="fa-inbox-item" title={`${item.projectName} / ${item.title}`} onClick={() => openTask(item)}><i className={`fa-dot${item.state === 'needs-you' ? ' fa-amber' : ''}`} /><strong>{item.state === 'needs-you' ? item.ask || 'Review task' : item.title}</strong><span className="fa-inbox-task-title">{item.state === 'needs-you' ? item.title : item.projectName}</span>{item.state !== 'needs-you' && <small className="fa-running-count">{item.runningAgents} agents</small>}<small>{item.state === 'needs-you' ? elapsed(item.needsSince ?? item.updatedAt, now).replace(' ago', '') : item.etaAt !== null ? `~${eta(item.etaAt, now)}` : item.state === 'queued' ? 'Queued' : ''}</small></button>)}{(status === 'running' ? running : needs).length === 0 && <p className="fa-inbox-empty">All caught up.</p>}</div>
      </section>}
      <section className="fa-chat" aria-label="Chat">
        {task && task.pendingWorkers.length > 0 && <div className="fa-worker-actions">
          {task.pendingWorkers.map(worker => <button key={worker.threadId} onClick={() => { setWorkerThread(worker.threadId); setFocus(value => value + 1); }}><i className="fa-dot fa-amber" />{worker.title}<Icon name="ArrowRight" /></button>)}
        </div>}
        {opening ? <div className="fa-chat-empty" role="status">Opening conversation…{agentSelector}</div> : threadId ? <Chat key={threadId} threadId={threadId} focusRequest={focus} voiceRequest={voiceRequest.threadId === threadId ? voiceRequest.nonce : 0} composerAgents={agentSelector} placeholder={task ? 'Message worker…' : `Message ${agent?.name ?? 'agent'}…`} onVoiceContextMenu={event => showMenu(event, 'mode')} onVoiceRequestHandled={onVoiceRequestHandled} className="fa-native-chat" /> : <div className="fa-chat-empty">{task ? 'The task conversation is being created.' : agent ? <button onClick={() => void openAgent(agent, true)}>Open {agent.name} conversation</button> : 'Create an agent in the plugin settings.'}{agentSelector}</div>}
      </section>
    </aside>

    {menu && <div className={`fa-menu${menu.kind === 'snooze' ? ' fa-snooze-menu' : menu.kind === 'status' ? ' fa-status-menu' : menu.kind === 'tasks' ? ' fa-navigation-menu' : ''}`} role="menu" style={'left' in menu ? { left: menu.left, bottom: menu.bottom } : undefined}>
      {menu.kind === 'status' ? <>{(['running', 'review'] as const).map(value => <button key={value} role="menuitemradio" aria-checked={status === value} onClick={() => { setStatus(value); returnHome(); }}><i className={`fa-dot${value === 'review' ? ' fa-amber' : ''}`} />{value === 'running' ? 'Running' : 'Review'}<small>{(value === 'running' ? running : needs).length}</small></button>)}</> : menu.kind === 'tasks' ? <>{[{ label: 'Running', items: running }, { label: 'Review', items: needs }].map(group => <div key={group.label}><div className="fa-menu-label">{group.label}</div>{group.items.map(item => <button key={item.id} role="menuitemradio" aria-checked={item.id === taskId} onClick={() => openTask(item)}><i className={`fa-dot${item.state === 'needs-you' ? ' fa-amber' : ''}`} /><span>{item.title}</span>{item.id === taskId && <Icon name="Check" />}</button>)}</div>)}</> : menu.kind === 'snooze' && task ? <><div className="fa-menu-label">Snooze until</div>{[
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
  app.contentScripts.register({ id: 'focused-board', mount: mountFocusedShell });
  app.slots.navPanel({ id: 'board', title: 'Agents', icon: 'GridView', path: 'board', component: AgentsPage });
});
