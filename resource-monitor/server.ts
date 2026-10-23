import { setTimeout as sleep } from "node:timers/promises";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract";
import { createGuard } from "./guard-install";
import { createProcessMonitor } from "./processes";
import { SAMPLE_CHANNEL } from "./shared";
import { createSampler } from "./stats";

const SAMPLE_EVERY_MS = 2000;
const GUARD_EVERY_MS = 10_000;

export default function plugin(bb: BbPluginApi): void {
  const settings = bb.settings.define({
    guard: {
      type: "boolean",
      label: "Guard",
      description:
        "Keep BB responsive when the Mac is overloaded: what BB starts runs at a lower priority, moves to the efficiency cores under load, and Pause all can stop it. macOS only.",
      default: true,
    },
  });
  const guard = createGuard();
  const guardOn = async () => (await settings.get()).guard;

  bb.rpc.register(rpcContract, {
    ...createProcessMonitor(),
    guardStatus: async () => guard.info(await guardOn()),
    async setPauseAll({ paused }) {
      const on = await guardOn();
      // Resume all always works, so nothing stays stopped.
      if (paused && !(on && guard.supported)) throw new Error("Guard is off.");
      return guard.setPauseAll(paused, on);
    },
  });

  bb.background.service("sampler", {
    async start(signal) {
      const sample = createSampler();
      while (!signal.aborted) {
        await sleep(SAMPLE_EVERY_MS, undefined, { signal }).catch(() => {});
        if (signal.aborted) return;
        const next = await sample();
        if (signal.aborted) return;
        next.guard = guard.supported;
        bb.realtime.publish(SAMPLE_CHANNEL, next);
      }
    },
  });

  if (!guard.supported) return;
  // The guard runs under launchd, apart from BB: a reload leaves it running.
  let changed = new AbortController();
  settings.onChange(() => changed.abort());
  bb.background.service("guard", {
    async start(signal) {
      let lastError = "";
      while (!signal.aborted) {
        changed = new AbortController();
        try {
          await guard.apply(await guardOn());
          lastError = "";
        } catch (error) {
          const message = String((error as Error)?.message ?? error);
          if (message !== lastError) bb.log.warn(`Guard: ${message}`);
          lastError = message;
        }
        const wake = AbortSignal.any([signal, changed.signal]);
        await sleep(GUARD_EVERY_MS, null, { signal: wake }).catch(() => {});
      }
    },
  });
}
