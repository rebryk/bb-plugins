import {
  experimental_PluginRpcRefusal as PluginRpcRefusal,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { rpcContract, type Todo } from "./contract";
import { CHANGED_CHANNEL } from "./shared";

// Append-only: the index of a statement is its migration id.
const MIGRATIONS = [
  `CREATE TABLE todos (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    position REAL NOT NULL,
    created_at INTEGER NOT NULL,
    done_at INTEGER,
    snoozed_until INTEGER
  )`,
];

// Selects a row in the shape of `Todo`.
const TODO_COLUMNS =
  "id, text, position, created_at AS createdAt, done_at AS doneAt, snoozed_until AS snoozedUntil";

const notFound = () =>
  new PluginRpcRefusal({
    code: "not_found",
    message: "This to-do no longer exists.",
  });

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);

  const selectAll = db.prepare<[], Todo>(`SELECT ${TODO_COLUMNS} FROM todos`);
  const selectById = db.prepare<[string], Todo>(
    `SELECT ${TODO_COLUMNS} FROM todos WHERE id = ?`,
  );
  const selectOpenIds = db.prepare<[], { id: string }>(
    "SELECT id FROM todos WHERE done_at IS NULL ORDER BY position, created_at",
  );
  const shiftAfter = db.prepare<[number]>(
    "UPDATE todos SET position = position + 1 WHERE position > ?",
  );
  // Appending and moving to the top count done to-dos too, so one that is
  // undone later never ties with a to-do placed past it since.
  const insertRow = db.prepare<[string, string, number | null, number]>(
    `INSERT INTO todos (id, text, position, created_at)
     VALUES (?, ?, COALESCE(?, (SELECT MAX(position) FROM todos), -1) + 1, ?)`,
  );
  const setText = db.prepare<[string, string]>(
    "UPDATE todos SET text = ? WHERE id = ?",
  );
  const setPosition = db.prepare<[number, string]>(
    "UPDATE todos SET position = ? WHERE id = ?",
  );
  // Marking a done to-do done again keeps its place in Done.
  const markDone = db.prepare<[number, string]>(
    "UPDATE todos SET done_at = COALESCE(done_at, ?), snoozed_until = NULL WHERE id = ?",
  );
  const markOpen = db.prepare<[string]>(
    "UPDATE todos SET done_at = NULL WHERE id = ?",
  );
  const setSnooze = db.prepare<[number | null, string]>(
    "UPDATE todos SET snoozed_until = ? WHERE id = ?",
  );
  const moveToTop = db.prepare<[string]>(
    `UPDATE todos SET position = (SELECT MIN(position) FROM todos) - 1, snoozed_until = NULL
     WHERE id = ?`,
  );
  const deleteById = db.prepare<[string]>("DELETE FROM todos WHERE id = ?");
  const deleteDone = db.prepare<[]>(
    "DELETE FROM todos WHERE done_at IS NOT NULL",
  );

  const publishChange = () => bb.realtime.publish(CHANGED_CHANNEL, null);

  function findTodo(id: string): Todo {
    const todo = selectById.get(id);
    if (todo === undefined) throw notFound();
    return todo;
  }

  /** Refuses a write that found no to-do, else publishes it and returns the to-do. */
  function changed(id: string, { changes }: { changes: number }) {
    if (changes === 0) throw notFound();
    publishChange();
    return { todo: findTodo(id) };
  }

  const add = db.transaction((id: string, text: string, afterId: string | null) => {
    const after = afterId === null ? null : findTodo(afterId).position;
    // Make room right after `afterId`, so the to-dos past it keep their order.
    if (after !== null) shiftAfter.run(after);
    insertRow.run(id, text, after, Date.now());
    return findTodo(id);
  });

  /** Numbers the open to-dos 0..n-1: `ids` first, then the rest as they were. */
  const reorder = db.transaction((ids: readonly string[]) => {
    const open = selectOpenIds.all().map((row) => row.id);
    const isOpen = new Set(open);
    // Done and deleted ids are skipped, so a drag racing another device lands.
    const order = new Set(ids.filter((id) => isOpen.has(id)));
    for (const id of open) order.add(id);
    [...order].forEach((id, index) => setPosition.run(index, id));
  });

  bb.rpc.register(rpcContract, {
    listTodos() {
      return { todos: selectAll.all() };
    },
    addTodo({ id, text, afterId }) {
      const todo = add(id, text, afterId);
      publishChange();
      return { todo };
    },
    updateTodoText({ id, text }) {
      return changed(id, setText.run(text, id));
    },
    setTodoDone({ id, done }) {
      return changed(id, done ? markDone.run(Date.now(), id) : markOpen.run(id));
    },
    snoozeTodo({ id, until }) {
      const { snoozedUntil } = findTodo(id);
      // A to-do that is back shows first, so once seen it stays on top; an
      // early unsnooze returns it to its place.
      if (until === null && snoozedUntil !== null && snoozedUntil <= Date.now())
        return changed(id, moveToTop.run(id));
      return changed(id, setSnooze.run(until, id));
    },
    reorderTodos({ ids }) {
      reorder(ids);
      publishChange();
      return { ok: true as const };
    },
    deleteTodo({ id }) {
      if (deleteById.run(id).changes === 0) throw notFound();
      publishChange();
      return { ok: true as const };
    },
    clearDoneTodos() {
      const cleared = deleteDone.run().changes;
      if (cleared > 0) publishChange();
      return { cleared };
    },
  });
}
