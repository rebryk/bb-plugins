import { z } from "zod";

/** Realtime channel that carries each new sample. */
export const SAMPLE_CHANNEL = "sample";

export const sampleSchema = z.object({
  cpu: z.object({
    /** Busy share of all cores, 0–100. */
    percent: z.number(),
    coreCount: z.number(),
    model: z.string(),
  }),
  memory: z.object({
    usedBytes: z.number(),
    totalBytes: z.number(),
  }),
  /** Null when this machine reports no GPU load. */
  gpu: z.object({ percent: z.number(), name: z.string() }).nullable(),
  hostname: z.string(),
  uptimeSeconds: z.number(),
  /** True where Guard runs (BB's app on macOS). Absent from older servers. */
  guard: z.boolean().optional(),
});

export type Sample = z.infer<typeof sampleSchema>;

/** Guard's `status.json`; the guard daemon rewrites it at least every 5 s. */
export const guardStatusSchema = z.object({
  /** Epoch milliseconds. */
  updatedAt: z.number(),
  /** overload: busy processes run on the efficiency cores; paused: Pause all. */
  mode: z.enum(["normal", "overload", "paused"]),
  counts: z.object({ background: z.number(), paused: z.number() }),
  /** The last 20, oldest first; `at` in epoch milliseconds. */
  events: z.array(
    z.object({
      at: z.number(),
      message: z.string(),
      error: z.boolean().optional(),
    }),
  ),
});

export type GuardStatus = z.infer<typeof guardStatusSchema>;

/** The guardStatus and setPauseAll answer. */
export const guardInfoSchema = z.object({
  /** The plugin setting. */
  enabled: z.boolean(),
  /** A fresh status file exists. */
  running: z.boolean(),
  /** Pause all is on (control.json). */
  pauseAll: z.boolean(),
  status: guardStatusSchema.nullable(),
});

export type GuardInfo = z.infer<typeof guardInfoSchema>;
