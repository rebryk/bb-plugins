// The RPC methods between the to-do list and the server.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { MAX_TEXT_LENGTH } from "./shared";

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  /** Sort key of an open to-do; lower comes first. */
  position: z.number(),
  createdAt: z.number().int(),
  /** Set while the to-do is done; done to-dos list newest first. */
  doneAt: z.number().int().nullable(),
  /**
   * Set while the to-do is snoozed. Before this time the list hides it; from
   * this time on it is back: shown first and highlighted until the user
   * touches it, which clears the field.
   */
  snoozedUntil: z.number().int().nullable(),
});

export type Todo = z.infer<typeof todoSchema>;

const idSchema = z.string().min(1).max(100);
const textSchema = z.string().max(MAX_TEXT_LENGTH);

export const rpcContract = defineRpcContract({
  /** Every to-do, open, snoozed and done, in no particular order. */
  listTodos: { input: z.null(), output: z.object({ todos: z.array(todoSchema) }) },
  /** Adds an open to-do with the app's `id` right after `afterId`, or last when it is null. */
  addTodo: {
    input: z.object({ id: idSchema, text: textSchema, afterId: idSchema.nullable() }).strict(),
    output: z.object({ todo: todoSchema }),
  },
  updateTodoText: {
    input: z.object({ id: idSchema, text: textSchema }).strict(),
    output: z.object({ todo: todoSchema }),
  },
  /** Done moves the to-do to Done; not done returns it to its old place. */
  setTodoDone: {
    input: z.object({ id: idSchema, done: z.boolean() }).strict(),
    output: z.object({ todo: todoSchema }),
  },
  /**
   * Snoozes until `until`, or with null ends the snooze: a to-do that is back
   * then moves to the top of the list, where the user saw it.
   */
  snoozeTodo: {
    input: z.object({ id: idSchema, until: z.number().int().nullable() }).strict(),
    output: z.object({ todo: todoSchema }),
  },
  /** Puts the open to-dos in this order; ids not listed keep their place after them. */
  reorderTodos: {
    input: z.object({ ids: z.array(idSchema).max(5_000) }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  deleteTodo: {
    input: z.object({ id: idSchema }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  clearDoneTodos: { input: z.null(), output: z.object({ cleared: z.number().int() }) },
});
