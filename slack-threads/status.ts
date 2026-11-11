import type { Block } from "./slack";
import type { Task } from "./store";

/** The most a worker's progress keeps. */
export const PROGRESS_CHARS = 1_500;
/** Slack holds 12,000 characters across a message's `markdown` blocks. */
const MESSAGE_CHARS = 11_000;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;

const ICONS: Record<Task["state"], string> = {
  running: "⏳",
  waiting: "✋",
  done: "✅",
  failed: "❌",
};

const duration = (task: Task) =>
  task.finishedAt === null
    ? ""
    : ` · ${Math.max(1, Math.round((task.finishedAt - task.startedAt) / 60_000))} min`;

/** The message that shows the live status of a coordinator turn's tasks. */
export function renderStatus(tasks: readonly Task[]): {
  text: string;
  blocks: Block[];
} {
  const budget = Math.floor(MESSAGE_CHARS / Math.max(1, tasks.length));
  const blocks: Block[] = tasks.map((task) => {
    const head = `${ICONS[task.state]} **${task.title}**${duration(task)}`;
    const progress = task.progress?.trim();
    const body = progress
      ? `\n${clip(progress, Math.min(PROGRESS_CHARS, budget - head.length - 1))}`
      : "";
    return { type: "markdown", text: `${head}${body}` };
  });
  const text = tasks
    .map((task) => `${ICONS[task.state]} ${task.title}`)
    .join(", ");
  return { text, blocks };
}
