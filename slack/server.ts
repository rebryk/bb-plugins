import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract";
import { STATE_CHANNEL, sameState, type SlackState } from "./shared";
import { SignedOutError, createReader, parseSession } from "./slack";

const READ_EVERY_MS = 20_000;
/** After this many failed reads in a row, the count is unknown. */
const FAILURES_BEFORE_UNKNOWN = 3;

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const settings = bb.settings.define({
    token: {
      type: "string",
      label: "Session token",
      description:
        "The xoxc- token of Slack in a browser; for several workspaces, one per workspace, separated by spaces",
      secret: true,
    },
    cookie: {
      type: "string",
      label: "Session cookie",
      description: "The value of Slack's d cookie",
      secret: true,
    },
  });

  const initial = await settings.get();
  if (!parseSession(initial.token, initial.cookie)) {
    bb.status.needsConfiguration(
      "Set the Slack session token and cookie in this plugin's settings. The count starts within 20 seconds; `bb plugin reload slack` clears this notice.",
    );
  }

  let state: SlackState = null;
  const update = (next: SlackState) => {
    if (sameState(state, next)) return;
    state = next;
    bb.realtime.publish(STATE_CHANNEL, next);
  };

  bb.rpc.register(rpcContract, { slackState: () => state });

  // A settings change wakes the reader, also when it comes mid-read.
  let changed = false;
  let wake = () => {};
  settings.onChange(() => {
    changed = true;
    wake();
  });

  /** Waits `ms`, or until settings change when null, or until abort. */
  const pause = (ms: number | null, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted || changed) return resolve();
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        wake = () => {};
        resolve();
      };
      const timer = ms === null ? undefined : setTimeout(done, ms);
      wake = done;
      signal.addEventListener("abort", done, { once: true });
    });

  bb.background.service("reader", {
    async start(signal) {
      const read = createReader();
      let failures = 0;
      let rejected = 0;
      while (!signal.aborted) {
        changed = false;
        const { token, cookie } = await settings.get();
        const session = parseSession(token, cookie);
        // A rejected or missing session only changes with the settings.
        let next: number | null = null;
        if (!session) {
          failures = 0;
          update({ kind: "signedOut" });
        } else {
          try {
            const reading = await read(session, signal);
            if (changed) continue;
            if (reading.rejected !== rejected && reading.rejected > 0) {
              bb.log.warn(
                `Slack rejected ${reading.rejected} of ${session.tokens.length} sessions`,
              );
            }
            rejected = reading.rejected;
            failures = 0;
            update({ kind: "counts", badge: reading.badge, unread: reading.unread });
            next = READ_EVERY_MS;
          } catch (error) {
            if (signal.aborted) return;
            if (changed) continue;
            bb.log.warn(error instanceof Error ? error.message : String(error));
            if (error instanceof SignedOutError) {
              failures = 0;
              update({ kind: "signedOut" });
            } else {
              if (++failures >= FAILURES_BEFORE_UNKNOWN) update(null);
              next = READ_EVERY_MS;
            }
          }
        }
        await pause(next, signal);
      }
    },
  });
}
