import type { BbPluginApi } from "@get-bb/plugin-sdk";
import registerSnoozeServer from "./snooze/server";
import registerThreadEtaServer from "./thread-eta/server";
import { experimentalSettings } from "./settings/options";

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
      label: "Mobile Layout",
      description: "Mobile bars and gestures, haptics, and a fixed interface scale. Images still zoom.",
      default: true,
    },
    archiveButton: {
      type: "boolean",
      label: "Archive Button",
      description: "An Archive button next to Snooze.",
      default: true,
    },
    ...experimentalSettings,
  });
  await registerSnoozeServer(bb);
  await registerThreadEtaServer(bb, settings);
}
