import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import type { Todo } from "./contract";
import { CHANGED_CHANNEL } from "./shared";

let dispose: (() => Promise<void>) | undefined;

afterEach(async () => {
  await dispose?.();
  vi.useRealTimers();
});

async function setup() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000);
  const { bb, harness } = createFakePluginHost({ pluginId: "todo" });
  await plugin(bb);
  dispose = () => harness.lifecycle.dispose();
  const call = (method: string, input: unknown = null) =>
    harness.behavior.callRpc(method, input);
  const todoOf = async (method: string, input: unknown) =>
    ((await call(method, input)) as { todo: Todo }).todo;
  /** Adds a to-do whose id is its text. */
  const add = (text: string, afterId: string | null = null) =>
    todoOf("addTodo", { id: text, text, afterId });
  const todos = async () =>
    ((await call("listTodos")) as { todos: Todo[] }).todos;
  /** Texts of the open to-dos, snoozed ones included, in list order. */
  const open = async () =>
    (await todos())
      .filter((todo) => todo.doneAt === null)
      .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt)
      .map((todo) => todo.text);
  const published = () =>
    harness.inspection.realtimeSignals.filter(
      (signal) => signal.channel === CHANGED_CHANNEL,
    ).length;
  return { call, todoOf, add, todos, open, published };
}

describe("to-do storage", () => {
  it("appends, and adds right after a to-do again and again", async () => {
    const { add, open } = await setup();
    const a = await add("a");
    await add("z");
    expect(await add("x", a.id)).toMatchObject({
      id: "x",
      text: "x",
      position: 1,
      createdAt: 1_000,
      doneAt: null,
      snoozedUntil: null,
    });
    const added = [];
    for (let i = 1; i <= 60; i++) added.push((await add(`n${i}`, a.id)).text);
    const c1 = await add("c1", a.id);
    await add("c2", c1.id);
    expect(await open()).toEqual(["a", "c1", "c2", ...added.reverse(), "x", "z"]);
  });

  it("edits the text", async () => {
    const { add, todoOf, todos } = await setup();
    const a = await add("a");
    expect(await todoOf("updateTodoText", { id: a.id, text: "edited" })).toMatchObject({
      id: a.id,
      text: "edited",
    });
    expect(await todos()).toMatchObject([{ text: "edited" }]);
  });

  it("moves a done to-do to Done and returns it to its place when undone", async () => {
    const { add, todoOf, open } = await setup();
    const a = await add("a");
    const b = await add("b");
    await add("c");
    await todoOf("snoozeTodo", { id: b.id, until: 5_000 });

    vi.setSystemTime(2_000);
    const done = await todoOf("setTodoDone", { id: b.id, done: true });
    expect(done).toMatchObject({ doneAt: 2_000, snoozedUntil: null });
    vi.setSystemTime(3_000);
    expect(await todoOf("setTodoDone", { id: b.id, done: true })).toMatchObject({ doneAt: 2_000 });
    expect(await open()).toEqual(["a", "c"]);

    await add("d", a.id);
    expect(await todoOf("setTodoDone", { id: b.id, done: false })).toMatchObject({ doneAt: null });
    expect(await open()).toEqual(["a", "d", "b", "c"]);
  });

  it("snoozes a to-do, then moves it to the top when it is back and seen", async () => {
    const { add, todoOf, open } = await setup();
    const a = await add("a");
    await add("b");
    const c = await add("c");
    await todoOf("setTodoDone", { id: a.id, done: true });
    expect(await todoOf("snoozeTodo", { id: c.id, until: 2_000 })).toMatchObject({
      snoozedUntil: 2_000,
    });

    vi.setSystemTime(2_000);
    expect(await todoOf("snoozeTodo", { id: c.id, until: null })).toMatchObject({
      position: -1,
      snoozedUntil: null,
    });
    expect(await open()).toEqual(["c", "b"]);
  });

  it("keeps the place of a to-do unsnoozed early", async () => {
    const { add, todoOf, open } = await setup();
    await add("a");
    const b = await add("b");
    await add("c");
    await todoOf("snoozeTodo", { id: b.id, until: 2_000 });
    vi.setSystemTime(1_500);
    expect(await todoOf("snoozeTodo", { id: b.id, until: null })).toMatchObject({
      position: 1,
      snoozedUntil: null,
    });
    expect(await open()).toEqual(["a", "b", "c"]);
  });

  it("reorders open to-dos and keeps unlisted ones after them", async () => {
    const { add, call, todoOf, todos, open } = await setup();
    const [a, , c, d] = [await add("a"), await add("b"), await add("c"), await add("d")];
    await todoOf("setTodoDone", { id: d.id, done: true });

    expect(await call("reorderTodos", { ids: [c.id, "missing", d.id, a.id] })).toEqual({ ok: true });
    expect(await open()).toEqual(["c", "a", "b"]);
    expect((await todos()).map((todo) => [todo.text, todo.position]).sort()).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 0],
      ["d", 3],
    ]);
  });

  it("deletes a to-do and clears Done", async () => {
    const { add, call, todoOf, todos } = await setup();
    const a = await add("a");
    const b = await add("b");
    await add("c");
    expect(await call("deleteTodo", { id: a.id })).toEqual({ ok: true });
    await todoOf("setTodoDone", { id: b.id, done: true });
    expect(await call("clearDoneTodos")).toEqual({ cleared: 1 });
    expect(await call("clearDoneTodos")).toEqual({ cleared: 0 });
    expect((await todos()).map((todo) => todo.text)).toEqual(["c"]);
  });

  it("refuses unknown ids", async () => {
    const { call, todos } = await setup();
    const id = "missing";
    for (const [method, input] of [
      ["addTodo", { id: "a", text: "a", afterId: id }],
      ["updateTodoText", { id, text: "a" }],
      ["setTodoDone", { id, done: true }],
      ["snoozeTodo", { id, until: null }],
      ["deleteTodo", { id }],
    ] as const) {
      await expect(call(method, input), method).rejects.toMatchObject({ code: "not_found" });
    }
    expect(await todos()).toEqual([]);
  });

  it("publishes a change after every write", async () => {
    const { add, call, published } = await setup();
    const { id } = await add("a");
    expect(published()).toBe(1);
    for (const [method, input] of [
      ["updateTodoText", { id, text: "b" }],
      ["snoozeTodo", { id, until: 2_000 }],
      ["snoozeTodo", { id, until: null }],
      ["reorderTodos", { ids: [id] }],
      ["setTodoDone", { id, done: true }],
      ["setTodoDone", { id, done: false }],
      ["setTodoDone", { id, done: true }],
      ["clearDoneTodos", null],
      ["addTodo", { id: "c", text: "c", afterId: null }],
      ["deleteTodo", { id: "c" }],
    ] as const) {
      const before = published();
      await call(method, input);
      expect(published(), method).toBe(before + 1);
    }
    const before = published();
    await call("listTodos");
    expect(published()).toBe(before);
  });
});
