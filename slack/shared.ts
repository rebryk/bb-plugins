import { z } from "zod";

/** Realtime channel that carries each change of the state. */
export const STATE_CHANNEL = "state";

export const stateSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("counts"),
        /** Mentions and direct messages, as on Slack's own badge. */
        badge: z.number().int().min(0),
        /** True when an unmuted conversation or thread has unread messages. */
        unread: z.boolean(),
      })
      .strict(),
    /** No session is set, or Slack rejected it. */
    z.object({ kind: z.literal("signedOut") }).strict(),
  ])
  .nullable();

/** Null until the first reading, and while Slack is unreachable. */
export type SlackState = z.infer<typeof stateSchema>;

export function sameState(a: SlackState, b: SlackState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Slack's own pages: the web client, sign-in, and workspace domains. */
export function isSlackUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === "https:" &&
      (hostname === "slack.com" || hostname.endsWith(".slack.com"))
    );
  } catch {
    return false;
  }
}
