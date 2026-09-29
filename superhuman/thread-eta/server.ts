import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { ETA_CHANNEL, formatEta } from "./shared";

const etaSchema = z.object({
  /** When the countdown reaches zero, in epoch milliseconds. */
  until: z.number(),
  label: z.string().nullable(),
});

export type ThreadEta = z.infer<typeof etaSchema>;

type Etas = Record<string, ThreadEta>;

export const rpcContract = defineRpcContract({
  listThreadEtas: {
    input: z.null(),
    output: z.record(z.string(), etaSchema),
  },
});

export default function registerThreadEtaServer(bb: BbPluginApi) {
  const { kv } = bb.storage;

  // Every change to the ETAs runs in this queue, one at a time.
  let queue: Promise<unknown> = Promise.resolve();
  function update(change: (etas: Etas) => void) {
    const result = queue.then(async () => {
      const etas = (await kv.get<Etas>("threadEtas")) ?? {};
      change(etas);
      const now = Date.now();
      for (const [id, { until }] of Object.entries(etas))
        if (until <= now) delete etas[id];
      await kv.set("threadEtas", etas);
      bb.realtime.publish(ETA_CHANNEL, null);
    });
    queue = result.catch(() => undefined);
    return result;
  }

  bb.agents.registerTool({
    name: "set_thread_eta",
    description:
      "Show the user a countdown to when a background process you started should finish, on this thread's row in the BB sidebar. It stays until it runs out or you remove it, even after your turn ends. Each call replaces the previous one; seconds 0 removes it.",
    instructions:
      "Call set_thread_eta only for a background process you started that runs for minutes or longer, such as a training run, a long test suite, a benchmark, or a data job, and only once its progress (steps, items, log timestamps) lets you estimate when it will finish. Never use it for your own work: coding, editing, reading, searching, or answering. Update it when the process's progress changes the estimate noticeably. The countdown outlives your turn, so call it with seconds 0 as soon as the process finishes, fails, or is stopped.",
    presentation: { label: { pending: "Setting ETA", completed: "Set ETA" } },
    parameters: z.object({
      seconds: z
        .number()
        .int()
        .min(0)
        .max(24 * 60 * 60)
        .describe(
          "Seconds until the process should finish; 0 removes the countdown.",
        ),
      label: z
        .string()
        .max(80)
        .optional()
        .describe("The process the countdown is for, such as Training."),
    }),
    async execute({ seconds, label }, { threadId }) {
      await update((etas) => {
        if (seconds === 0) delete etas[threadId];
        else
          etas[threadId] = {
            until: Date.now() + seconds * 1000,
            label: label || null,
          };
      });
      return seconds === 0
        ? "Countdown removed."
        : `Countdown set to ${formatEta(seconds * 1000)}.`;
    },
  });

  bb.rpc.register(rpcContract, {
    async listThreadEtas() {
      return (await kv.get<Etas>("threadEtas")) ?? {};
    },
  });

  const drop = ({ thread }: { thread: { id: string } }) =>
    update((etas) => delete etas[thread.id]).catch((error: unknown) =>
      bb.log.warn(`Could not drop the ETA of ${thread.id}: ${String(error)}`),
    );
  bb.events.on("thread.archived", drop);
  bb.events.on("thread.deleted", drop);
}
