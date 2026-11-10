import type {
  PluginBbSdk,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";

export type Interaction =
  PluginThreadEventPayloads["interaction.pending"]["interaction"];
type Resolution = Parameters<
  PluginBbSdk["threads"]["interactions"]["resolve"]
>[0]["resolution"];

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const APPROVE =
  /^(approve[ds]?|allow|yes|y|ok|okay|lgtm|go( ahead)?|👍|✅)\b/iu;
const ALWAYS = /^(always|allow (for )?(the )?session)\b/iu;
const DENY = /^(deny|denied|reject|no|n|stop|cancel|👎|❌)\b/iu;

/** The Slack text that asks people to answer an interaction. */
export function describeInteraction(interaction: Interaction): string {
  const payload = interaction.payload;
  switch (payload.kind) {
    case "approval": {
      const subject = payload.subject;
      const what =
        subject.kind === "command"
          ? `run \`${clip(subject.command, 500)}\``
          : subject.kind === "file_change"
            ? `change files${subject.writeScope ? ` in \`${subject.writeScope}\`` : ""}`
            : subject.kind === "plan"
              ? `follow this plan:\n\n${clip(subject.plan, 3000)}`
              : subject.kind === "tool_use"
                ? `use ${subject.presentation.title ?? subject.tool}`
                : `get extra permissions${subject.toolName ? ` for ${subject.toolName}` : ""}`;
      const reason = payload.reason ? `\n\n${clip(payload.reason, 500)}` : "";
      const always = payload.availableDecisions.includes("allow_for_session")
        ? ", `always`"
        : "";
      return `✋ The agent asks to ${what}${reason}\n\nReply \`approve\`${always} or \`deny\`.`;
    }
    case "user_question": {
      const many = payload.questions.length > 1;
      const questions = payload.questions.map((question, index) => {
        const options = (question.options ?? [])
          .map((option, n) => `  ${n + 1}. ${option.label}`)
          .join("\n");
        const prompt = `${many ? `${index + 1}. ` : ""}${question.prompt}`;
        return options ? `${prompt}\n${options}` : prompt;
      });
      const how = many
        ? "Reply with one answer per line, in order."
        : "Reply with your answer (an option number, label, or your own words).";
      return `❓ ${questions.join("\n\n")}\n\n${how}`;
    }
    case "plugin":
      return `⏳ The agent is waiting for: ${payload.presentation?.label.pending ?? "input"}. Answer it in bb.`;
    default:
      return `⏳ The agent is waiting for: ${payload.title}. Answer it in bb.`;
  }
}

/**
 * Resolves an interaction from a Slack reply. Returns `null` when the reply
 * does not answer it, or a hint to post back when it cannot be parsed.
 */
export function answerFromText(
  interaction: Interaction,
  text: string,
): { resolution: Resolution } | { hint: string } | null {
  const payload = interaction.payload;
  const reply = text.trim();
  if (payload.kind === "approval") {
    const allowed = payload.availableDecisions;
    if (ALWAYS.test(reply) && allowed.includes("allow_for_session")) {
      return {
        resolution: { decision: "allow_for_session", grantedPermissions: null },
      };
    }
    if (APPROVE.test(reply) && allowed.includes("allow_once")) {
      return {
        resolution: { decision: "allow_once", grantedPermissions: null },
      };
    }
    if (DENY.test(reply) && allowed.includes("deny")) {
      return { resolution: { decision: "deny" } };
    }
    return {
      hint: "The agent is waiting for approval: reply `approve` or `deny`.",
    };
  }
  if (payload.kind !== "user_question") return null;

  const lines =
    payload.questions.length === 1
      ? [reply]
      : reply
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
  if (lines.length !== payload.questions.length) {
    return {
      hint: `The agent asked ${payload.questions.length} questions: reply with one answer per line, in order.`,
    };
  }
  const answers: Record<string, { selected: string[]; freeText?: string }> = {};
  for (const [index, question] of payload.questions.entries()) {
    const line = lines[index] ?? "";
    const options = question.options ?? [];
    const number = Number.parseInt(line, 10);
    const option =
      (String(number) === line ? options[number - 1] : undefined) ??
      options.find(
        (candidate) =>
          candidate.label.toLowerCase() === line.toLowerCase() ||
          candidate.value.toLowerCase() === line.toLowerCase(),
      );
    if (option) {
      answers[question.id] = { selected: [option.value] };
    } else if (question.allowFreeText || options.length === 0) {
      answers[question.id] = { selected: [], freeText: line };
    } else {
      return {
        hint: `Pick one of: ${options.map((candidate, n) => `${n + 1}. ${candidate.label}`).join(", ")}.`,
      };
    }
  }
  return { resolution: { kind: "user_answer", answers } };
}
