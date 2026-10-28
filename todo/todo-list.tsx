// The Notes-style list: a round checkbox and one line of text per row, a
// "New to-do" line last, and Snoozed and Done folded away below.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import {
  experimental_Icon as Icon,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { Todo, rpcContract } from "./contract";
import { CHANGED_CHANNEL, MAX_TEXT_LENGTH } from "./shared";

const cx = (...names: (string | false)[]) => names.filter(Boolean).join(" ");
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** "9:00 AM" today, "Mon, Nov 3, 9:00 AM" on another day. */
function when(ms: number): string {
  const today = new Date(ms).toDateString() === new Date().toDateString();
  const day = today ? {} : ({ weekday: "short", month: "short", day: "numeric" } as const);
  return new Date(ms).toLocaleString([], { ...day, hour: "numeric", minute: "2-digit" });
}

/** 9:00 on the day `days` from today. */
function nineOn(days: number): number {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.setHours(9, 0, 0, 0);
}

/** The value of a datetime-local input for `ms`. */
const localInput = (ms: number) =>
  new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** An input that takes `text` from the server unless the user is in it. */
function TextInput({ text, ...props }: { text: string } & InputHTMLAttributes<HTMLInputElement>) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current && ref.current !== document.activeElement) ref.current.value = text;
  }, [text]);
  return <input ref={ref} className="td-text" autoComplete="off" maxLength={MAX_TEXT_LENGTH}
    defaultValue={text} {...props} />;
}

function Snooze({ onPick }: { onPick: (until: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      const target = event.target as Node;
      if (event instanceof globalThis.KeyboardEvent ? event.key === "Escape"
        : !ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    // On the window, so Escape closes the menu wherever focus is.
    const stop = new AbortController();
    document.addEventListener("pointerdown", close, { signal: stop.signal });
    window.addEventListener("keydown", close, { capture: true, signal: stop.signal });
    return () => stop.abort();
  }, [open]);
  // On a phone the menu is a bottom sheet, on the body: BB's bars cover what
  // its main pane holds.
  const sheet = (menu: ReactElement) =>
    window.matchMedia("(max-width: 640px)").matches ? createPortal(menu, document.body) : menu;
  const pick = (until: number) => {
    setOpen(false);
    onPick(until);
  };
  // Later today stays today; This weekend is Saturday 9:00, gone once that
  // has passed, when Tomorrow covers Sunday.
  const now = Date.now();
  const day = new Date(now).getDay();
  const later = now + 3 * 3_600_000;
  const presets: [string, number | false][] = [
    ["Later today", new Date(later).getDate() === new Date(now).getDate() && later],
    ["Tomorrow", nineOn(1)],
    ["This weekend", day > 0 && (day < 6 ? nineOn(6 - day) : now < nineOn(0) && nineOn(0))],
    ["Next week", nineOn((8 - day) % 7 || 7)],
  ];
  return (
    <span ref={ref}>
      <button type="button" className="td-act" aria-label="Snooze" title="Snooze"
        aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="Clock" className="td-ic" />
      </button>
      {open && sheet(
        <div ref={menuRef} className="td-pop" role="menu">
          {presets.map(([label, until]) => until && (
            <button key={label} type="button" role="menuitem" onClick={() => pick(until)}>
              {label} <span>{when(until)}</span>
            </button>
          ))}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const until = new Date(event.currentTarget.until.value).getTime();
              if (until > Date.now()) pick(until);
            }}
          >
            <input name="until" type="datetime-local" aria-label="Snooze until" required
              min={localInput(Date.now())} defaultValue={localInput(nineOn(1))} />
            <button type="submit">Snooze</button>
          </form>
        </div>,
      )}
    </span>
  );
}

export function TodoList({ onStartThread }: { onStartThread: (text: string) => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; ids: string[] } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const latest = useRef(0);
  // Writes go out in order; a list fetched before they land would undo them.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const focusedText = useRef("");
  const dragging = useRef<AbortController>(null);

  const refetch = useCallback(() => {
    const request = ++latest.current;
    rpc.call("listTodos", null).then(
      ({ todos }) => {
        if (request !== latest.current || pending.current > 0) return;
        setTodos(todos);
        setLoadError(null);
      },
      (cause: unknown) => request === latest.current && setLoadError(errorText(cause)),
    );
  }, [rpc]);
  useEffect(refetch, [refetch, connection]);
  useRealtime(CHANGED_CHANNEL, refetch);
  // A row focused on mount does it once, not again when it remounts.
  useEffect(() => setFocusId(null), [focusId]);
  useEffect(() => () => dragging.current?.abort(), []);

  const send = (op: () => Promise<unknown>) => {
    pending.current += 1;
    queue.current = queue.current
      .then(op)
      .then(
        () => setWriteError(null),
        (cause: unknown) => setWriteError(errorText(cause)),
      )
      .finally(() => --pending.current === 0 && refetch());
  };
  const patch = (id: string, fields: Partial<Todo>) =>
    setTodos((list) => list.map((t) => (t.id === id ? { ...t, ...fields } : t)));

  const isBack = (t: Todo) => t.snoozedUntil !== null && t.snoozedUntil <= now;
  const snoozed = todos
    .filter((t) => t.doneAt === null && (t.snoozedUntil ?? 0) > now)
    .sort((a, b) => a.snoozedUntil! - b.snoozedUntil!);
  const open = todos
    .filter((t) => t.doneAt === null && (t.snoozedUntil ?? 0) <= now)
    .sort((a, b) =>
      (a.snoozedUntil ?? Infinity) - (b.snoozedUntil ?? Infinity) ||
      a.position - b.position ||
      a.createdAt - b.createdAt);
  const done = todos.filter((t) => t.doneAt !== null).sort((a, b) => b.doneAt! - a.doneAt!);
  const shown = drag ? drag.ids.flatMap((id) => open.find((t) => t.id === id) ?? []) : open;

  // Bring the next snoozed to-do back on time, and after the Mac sleeps.
  const wake = snoozed[0]?.snoozedUntil;
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const stop = new AbortController();
    window.addEventListener("focus", tick, { signal: stop.signal });
    document.addEventListener("visibilitychange", tick, { signal: stop.signal });
    const timer = wake == null ? undefined
      : setTimeout(tick, Math.min(wake - Date.now(), 2 ** 31 - 1));
    return () => {
      stop.abort();
      clearTimeout(timer);
    };
  }, [wake, now]);

  /** A to-do that is back stays highlighted until the user touches it. */
  const touch = (t: Todo) => {
    if (!isBack(t)) return;
    patch(t.id, { snoozedUntil: null, position: Math.min(...open.map((o) => o.position)) - 1 });
    send(() => rpc.call("snoozeTodo", { id: t.id, until: null }));
  };
  /** Shows the to-do at once, placed as the server places it, and returns its id. */
  const add = (text: string, after: Todo | null) => {
    // randomUUID needs a secure context; BB may be served over plain http.
    const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    setTodos((list) => {
      const at = after?.position ?? Math.max(-1, ...list.map((t) => t.position));
      return [
        ...list.map((t) => (t.position > at ? { ...t, position: t.position + 1 } : t)),
        { id, text, position: at + 1, createdAt: Date.now(), doneAt: null, snoozedUntil: null },
      ];
    });
    send(() => rpc.call("addTodo", { id, text, afterId: after?.id ?? null }));
    return id;
  };
  const setDone = (t: Todo, isDone: boolean) => {
    if (isDone) touch(t);
    patch(t.id, { doneAt: isDone ? Date.now() : null });
    send(() => rpc.call("setTodoDone", { id: t.id, done: isDone }));
  };
  const snooze = (t: Todo, until: number | null) => {
    patch(t.id, { snoozedUntil: until });
    send(() => rpc.call("snoozeTodo", { id: t.id, until }));
  };

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, t: Todo | null) {
    const input = event.currentTarget;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      // A new row takes focus, so blur saves this one.
      if (t === null) onBlur(input, null);
      else if (input.value.trim()) setFocusId(add("", t));
    } else if (event.key === "Backspace" && t !== null && input.value === "") {
      // Leaving the empty row deletes it.
      event.preventDefault();
      const inputs = [...listRef.current!.querySelectorAll<HTMLInputElement>("input.td-text")];
      const previous = inputs[inputs.indexOf(input) - 1];
      if (!previous) return input.blur();
      previous.focus();
      previous.setSelectionRange(previous.value.length, previous.value.length);
    }
  }

  function onBlur(input: HTMLInputElement, t: Todo | null) {
    const text = input.value;
    if (t && text.trim()) {
      // Only the user's own edit, so an untouched row never undoes another device's.
      // It also catches up with an edit from another device made meanwhile.
      if (text === focusedText.current) {
        input.value = t.text;
        return;
      }
      patch(t.id, { text });
      return send(() => rpc.call("updateTodoText", { id: t.id, text }));
    }
    // Switching windows keeps a half-typed or emptied row as it is.
    if (!document.hasFocus()) return;
    if (t) {
      setTodos((list) => list.filter((o) => o.id !== t.id));
      send(() => rpc.call("deleteTodo", { id: t.id }));
    } else {
      if (text.trim()) add(text.trim(), null);
      input.value = "";
    }
  }

  function startDrag(event: PointerEvent, t: Todo) {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    touch(t);
    let ids = shown.map((o) => o.id);
    const before = ids.join();
    setDrag({ id: t.id, ids });
    const stop = (dragging.current = new AbortController());
    const mine = (e: globalThis.PointerEvent) => e.pointerId === event.pointerId;
    window.addEventListener("pointermove", (e) => {
      if (!mine(e)) return;
      const rows = [...listRef.current!.querySelectorAll<HTMLElement>(".td-row[data-id]")]
        .filter((row) => row.dataset.id !== t.id);
      const at = rows.findIndex((row) => {
        const box = row.getBoundingClientRect();
        return e.clientY < box.top + box.height / 2;
      });
      ids = rows.map((row) => row.dataset.id!);
      ids.splice(at < 0 ? ids.length : at, 0, t.id);
      setDrag({ id: t.id, ids });
    }, { signal: stop.signal });
    const end = (e: globalThis.PointerEvent) => {
      if (!mine(e)) return;
      stop.abort();
      setDrag(null);
      // A cancelled drag, like one the browser takes over, puts the row back.
      if (e.type === "pointercancel" || ids.join() === before) return;
      setTodos((list) => list.map((o) =>
        ids.includes(o.id) ? { ...o, position: ids.indexOf(o.id) } : o));
      send(() => rpc.call("reorderTodos", { ids }));
    };
    window.addEventListener("pointerup", end, { signal: stop.signal });
    window.addEventListener("pointercancel", end, { signal: stop.signal });
  }

  return (
    <div ref={listRef} className="td">
      {loadError && <p className="td-note">Could not load the to-do list: {loadError}</p>}
      {writeError && <p className="td-note">{writeError}</p>}
      {shown.map((t) => (
        <div key={t.id} data-id={t.id} className={cx("td-row", isBack(t) && "is-back",
          drag?.id === t.id && "is-dragging")}>
          <button type="button" className="td-check" role="checkbox" aria-checked={false}
            aria-label="Done" onClick={() => setDone(t, true)} />
          <TextInput text={t.text} aria-label="To-do" autoFocus={t.id === focusId}
            onFocus={(event) => {
              focusedText.current = event.currentTarget.value;
              touch(t);
            }}
            onKeyDown={(event) => onKeyDown(event, t)}
            onBlur={(event) => onBlur(event.currentTarget, t)} />
          {isBack(t) && <span className="td-back">back · {when(t.snoozedUntil!)}</span>}
          <button type="button" className="td-act" aria-label="Start thread"
            title="Start thread" onClick={() => t.text.trim() && onStartThread(t.text.trim())}>
            <Icon name="ArrowUpRight" className="td-ic" />
          </button>
          <Snooze onPick={(until) => snooze(t, until)} />
          <span className="td-act td-handle" title="Drag to reorder"
            onPointerDown={(event) => startDrag(event, t)}>
            <Icon name="DragDropVertical" className="td-ic" />
          </span>
        </div>
      ))}
      <div className="td-row">
        <span className="td-check" />
        <TextInput text="" placeholder="New to-do" aria-label="New to-do"
          onKeyDown={(event) => onKeyDown(event, null)}
          onBlur={(event) => onBlur(event.currentTarget, null)} />
      </div>
      {snoozed.length > 0 && (
        <details>
          <summary>Snoozed · {snoozed.length}</summary>
          {snoozed.map((t) => (
            <div key={t.id} className="td-row">
              <button type="button" className="td-act" aria-label="Unsnooze" title="Unsnooze"
                onClick={() => snooze(t, null)}>
                <Icon name="Clock" className="td-ic" />
              </button>
              <span className="td-text">{t.text}</span>
              <span className="td-when">{when(t.snoozedUntil!)}</span>
            </div>
          ))}
        </details>
      )}
      {done.length > 0 && (
        <details>
          <summary>Done · {done.length}</summary>
          {done.map((t) => (
            <div key={t.id} className="td-row is-done">
              <button type="button" className="td-check" role="checkbox" aria-checked
                aria-label="Not done" onClick={() => setDone(t, false)}>
                <Icon name="Check" className="td-ic" />
              </button>
              <span className="td-text">{t.text}</span>
            </div>
          ))}
          <button type="button" className="td-clear" onClick={() => {
            setTodos((list) => list.filter((t) => t.doneAt === null));
            send(() => rpc.call("clearDoneTodos", null));
          }}>
            Clear
          </button>
        </details>
      )}
    </div>
  );
}
