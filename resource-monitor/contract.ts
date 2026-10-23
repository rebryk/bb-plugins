// The RPC methods between the Resources page and the server.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { guardInfoSchema } from "./shared";

export const processSchema = z.object({
  pid: z.number(),
  /** The executable's file name, as Activity Monitor shows it. */
  name: z.string(),
  /** The command line, cut to its first characters. */
  command: z.string(),
  /** Share of one core since the last reading, like Activity Monitor: 0–100 × cores. */
  cpuPercent: z.number(),
  /** Resident memory. */
  memoryBytes: z.number(),
  /** Pid 1 or below, or one of BB's own processes: never quit. */
  protected: z.boolean(),
});

export type ProcessInfo = z.infer<typeof processSchema>;

export const rpcContract = defineRpcContract({
  listProcesses: { input: z.null(), output: z.array(processSchema) },
  quitProcesses: {
    input: z
      .object({
        pids: z.array(z.number().int().positive()).min(1).max(5000),
        /** SIGKILL instead of SIGTERM. */
        force: z.boolean(),
      })
      .strict(),
    output: z.object({
      quit: z.number(),
      failed: z.array(z.object({ pid: z.number(), reason: z.string() })),
    }),
  },
  /** Guard's setting, liveness, and full status file. */
  guardStatus: { input: z.null(), output: guardInfoSchema },
  /**
   * Turns Pause all on or off: what BB started, except its own helpers, is
   * stopped or resumed. Answers once control.json is written, before Guard
   * acts on it.
   */
  setPauseAll: {
    input: z.object({ paused: z.boolean() }).strict(),
    output: guardInfoSchema,
  },
});
