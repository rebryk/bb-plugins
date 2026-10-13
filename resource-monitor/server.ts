import { setTimeout as sleep } from "node:timers/promises";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { SAMPLE_CHANNEL } from "./shared";
import { createSampler } from "./stats";

const SAMPLE_EVERY_MS = 2000;

export default function plugin(bb: BbPluginApi): void {
  bb.background.service("sampler", {
    async start(signal) {
      const sample = createSampler();
      while (!signal.aborted) {
        await sleep(SAMPLE_EVERY_MS, undefined, { signal }).catch(() => {});
        if (signal.aborted) return;
        const next = await sample();
        if (signal.aborted) return;
        bb.realtime.publish(SAMPLE_CHANNEL, next);
      }
    },
  });
}
