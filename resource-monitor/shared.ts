import { z } from "zod";

/** Realtime channel that carries each new sample. */
export const SAMPLE_CHANNEL = "sample";

export const sampleSchema = z.object({
  at: z.number(),
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
  gpu: z
    .object({
      percent: z.number(),
      name: z.string(),
      memoryUsedBytes: z.number().nullable(),
      memoryTotalBytes: z.number().nullable(),
    })
    .nullable(),
  hostname: z.string(),
  uptimeSeconds: z.number(),
});

export type Sample = z.infer<typeof sampleSchema>;

/** How the sidebar icon draws the load. */
export const ICON_STYLES = {
  bars: "Bars: CPU, memory, GPU",
  rings: "Rings: CPU outside, memory inside",
  spark: "Sparkline: CPU, last minute",
  digits: "Number: CPU percent",
  chip: "Chip: fills with CPU load",
} as const;

/** What the hover card shows. */
export const CARD_STYLES = {
  columns: "Bars: a column per resource",
  rings: "Rings: a gauge per resource",
  numbers: "Numbers: big percent, thin bar",
} as const;

export type IconStyle = keyof typeof ICON_STYLES;
export type CardStyle = keyof typeof CARD_STYLES;

export const lookSchema = z.object({
  iconStyle: z.enum(Object.keys(ICON_STYLES) as [IconStyle, ...IconStyle[]]),
  cardStyle: z.enum(Object.keys(CARD_STYLES) as [CardStyle, ...CardStyle[]]),
});

export type Look = z.infer<typeof lookSchema>;

export const DEFAULT_LOOK: Look = { iconStyle: "bars", cardStyle: "columns" };
