import type { BbPluginApi } from "@get-bb/plugin-sdk";
import registerSnoozeServer from "./snooze/server";
import registerThreadEtaServer from "./thread-eta/server";

export default async function plugin(bb: BbPluginApi) {
  // The browser reads these: the keyboard features in hotkeys/controller.ts,
  // the rest in their features' app.tsx. Thread ETA's server reads its own.
  const settings = bb.settings.define({
    threadShortcuts: {
      type: "boolean",
      label: "Shortcuts",
      description:
        "Keyboard shortcuts in any layout, with hints while holding a modifier.",
      default: true,
    },
    universalSearch: {
      type: "boolean",
      label: "Universal Search",
      description:
        "Search commands, threads and snoozed threads in both English and Russian keyboard layouts.",
      default: true,
    },
    phoneLayout: {
      type: "boolean",
      label: "Mobile layout",
      description: "Mobile bars and gestures, haptics, and a fixed interface scale. Images still zoom.",
      default: true,
    },
    archiveButton: {
      type: "boolean",
      label: "Archive button",
      description: "An Archive button next to Snooze.",
      default: true,
    },
    threadEta: {
      type: "boolean",
      label: "Thread ETA",
      description: "An agent's estimate of the time left counts down on its thread in the sidebar.",
      default: true,
    },
    threadPrefetch: {
      type: "boolean",
      label: "Preload threads",
      description: "Preload the latest part of recent and newly completed threads.",
      default: true,
    },
  });
  await registerSnoozeServer(bb);
  await registerThreadEtaServer(bb, settings);
}
