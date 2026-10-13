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
});

export type Sample = z.infer<typeof sampleSchema>;
