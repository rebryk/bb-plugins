import type { Block } from "./slack";
import type { Task } from "./store";

/** Slack's `markdown_text` holds 12,000 characters per message; leave room. */
const TEXT_CHARS = 3_000;
const PROGRESS_CHARS = 1_500;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const ICONS: Record<Task["state"], string> = {
  running: "⏳",
  waiting: "✋",
  done: "✅",
  failed: "❌",
};

const minutes = (task: Task) => {
  const end = task.finishedAt ?? null;
  if (end === null) return "";
  const elapsed = Math.max(1, Math.round((end - task.startedAt) / 60_000));
  return ` · ${elapsed} min`;
};

/** True when a coordinator reply fits above its tasks' status in one message. */
export const fitsStatus = (text: string) => text.length <= TEXT_CHARS;

/**
 * The message that shows the live status of the workers a coordinator turn
 * started: the coordinator's reply when it fits, one block per task, then the
 * muted footer.
 */
export function renderStatus(
  text: string,
  footer: string | null,
  tasks: readonly Task[],
): { text: string; blocks: Block[] } {
  const blocks: Block[] = [];
  if (text.trim()) {
    blocks.push({ type: "markdown", text: clip(text, TEXT_CHARS) });
  }
  for (const task of tasks) {
    const head = `${ICONS[task.state]} **${task.title}**${minutes(task)}`;
    const body = task.progress?.trim()
      ? `\n${clip(task.progress.trim(), PROGRESS_CHARS)}`
      : "";
    blocks.push({ type: "markdown", text: `${head}${body}` });
  }
  if (footer) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: footer }],
    });
  }
  const fallback =
    text.trim() ||
    tasks.map((task) => `${ICONS[task.state]} ${task.title}`).join(", ");
  return { text: clip(fallback, TEXT_CHARS), blocks };
}
