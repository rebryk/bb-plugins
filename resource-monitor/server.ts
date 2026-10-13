import { setTimeout as sleep } from "node:timers/promises";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  CARD_STYLES,
  DEFAULT_LOOK,
  ICON_STYLES,
  SAMPLE_CHANNEL,
  lookSchema,
  sampleSchema,
  type Sample,
} from "./shared";
import { createSampler } from "./stats";

const SAMPLE_EVERY_MS = 2000;
/** A minute of samples, for the sparkline icon. */
const HISTORY_LENGTH = 30;

export const rpcContract = defineRpcContract({
  /** Recent samples, oldest first. */
  listResourceSamples: {
    input: z.null(),
    output: z.array(sampleSchema),
  },
  setResourceLook: {
    input: lookSchema.partial(),
    output: lookSchema,
  },
});

export default function plugin(bb: BbPluginApi): void {
  const settings = bb.settings.define({
    iconStyle: {
      type: "select",
      label: "Sidebar icon",
      options: Object.keys(ICON_STYLES),
      experimental_optionLabels: ICON_STYLES,
      default: DEFAULT_LOOK.iconStyle,
    },
    cardStyle: {
      type: "select",
      label: "Hover card",
      options: Object.keys(CARD_STYLES),
      experimental_optionLabels: CARD_STYLES,
      default: DEFAULT_LOOK.cardStyle,
    },
  });
  const history: Sample[] = [];

  bb.rpc.register(rpcContract, {
    async listResourceSamples() {
      return history;
    },
    async setResourceLook(look) {
      return lookSchema.parse(await settings.experimental_set(look));
    },
  });

  bb.background.service("sampler", {
    async start(signal) {
      const sample = createSampler();
      while (!signal.aborted) {
        await sleep(SAMPLE_EVERY_MS, undefined, { signal }).catch(() => {});
        if (signal.aborted) return;
        const next = await sample();
        history.push(next);
        if (history.length > HISTORY_LENGTH) history.shift();
        bb.realtime.publish(SAMPLE_CHANNEL, next);
      }
    },
  });
}
