import { z } from "zod";
import type { Block } from "./slack";
import type { Task } from "./store";

export const stepSchema = z.object({
  title: z.string().min(1),
  status: z.enum(["done", "running", "next"]),
});
export type Step = z.infer<typeof stepSchema>;

/** What a worker reports: its steps and the time left for the whole task. */
export const progressSchema = z.object({
  steps: z.array(stepSchema).min(1).max(12),
  remaining: z.string().min(1),
});
export type Progress = z.infer<typeof progressSchema>;

const TITLE_CHARS = 150;
const ICONS: Record<Step["status"], string> = {
  done: "✓",
  running: "•",
  next: "☐",
};

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** A task's stored progress; anything unreadable counts as none. */
export function progressOf(task: Task): Progress | null {
  try {
    return progressSchema.parse(JSON.parse(task.progress ?? ""));
  } catch {
    return null;
  }
}

const CARD_STATUS = {
  running: "in_progress",
  waiting: "in_progress",
  done: "complete",
  failed: "error",
} as const;

/** "Step… · 6 min" while a task runs, its title once it is over. */
const titleOf = (task: Task, progress: Progress | null) => {
  if (task.state === "done" || task.state === "failed" || !progress) {
    return task.title;
  }
  const current =
    progress.steps.find((step) => step.status === "running") ??
    progress.steps.find((step) => step.status === "next");
  // The time left is an estimate anyway, so no "~".
  const remaining = progress.remaining.replace(/^[~≈]\s*/u, "");
  return `${current?.title ?? task.title}… · ${remaining}`;
};

/** The steps, one per line: ✓ done, • running, ☐ next. */
const stepsText = (task: Task, progress: Progress) =>
  progress.steps
    .map(
      (step) =>
        `${ICONS[task.state === "done" ? "done" : step.status]}  ${step.title}`,
    )
    .join("\n");

/**
 * The message that shows a coordinator turn's tasks: one Slack task card per
 * task, with Slack's spinner, check, or error mark and the steps folded under
 * it. `version` gives every edit new block IDs, as Slack asks.
 */
export function renderStatus(
  tasks: readonly Task[],
  version = Date.now().toString(36),
): { text: string; blocks: Block[] } {
  const blocks = tasks.map((task) => {
    const progress = progressOf(task);
    return {
      type: "task_card",
      block_id: `task-${task.id}-${version}`,
      task_id: `task-${task.id}`,
      title: clip(titleOf(task, progress), TITLE_CHARS),
      status: CARD_STATUS[task.state],
      ...(progress
        ? {
            details: {
              type: "rich_text",
              elements: [
                {
                  type: "rich_text_section",
                  elements: [{ type: "text", text: stepsText(task, progress) }],
                },
              ],
            },
          }
        : {}),
      // Task cards are newer than the Slack SDK's block types.
    } as unknown as Block;
  });
  return { text: tasks.map((task) => task.title).join(", "), blocks };
}
