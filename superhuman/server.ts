import type { BbPluginApi } from "@get-bb/plugin-sdk";
import registerSnoozeServer from "./snooze/server";
import registerThreadEtaServer from "./thread-eta/server";

export default async function plugin(bb: BbPluginApi) {
  // The browser reads these: the keyboard features in hotkeys/controller.ts,
  // the rest in their features' app.tsx.
  bb.settings.define({
    threadShortcuts: {
      type: "boolean",
      label: "Thread shortcuts",
      description: "/ searches threads; number keys open a new thread's menus.",
      default: true,
    },
    shortcutHints: {
      type: "boolean",
      label: "Shortcut hints",
      description: "Hold a modifier to see the shortcuts.",
      default: true,
    },
    zoomLock: {
      type: "boolean",
      label: "Zoom lock",
      description: "The page never zooms.",
      default: false,
    },
    phoneLayout: {
      type: "boolean",
      label: "Phone layout",
      description: "On a phone, the bars move to the bottom.",
      default: true,
    },
    haptics: {
      type: "boolean",
      label: "Haptics",
      description: "On a phone, a light tap as the sidebar or right panel opens or closes.",
      default: true,
    },
    threadTitle: {
      type: "boolean",
      label: "Thread title",
      description: "On a phone, the bar shows the thread's title.",
      default: true,
    },
    archiveButton: {
      type: "boolean",
      label: "Archive button",
      description: "An Archive button next to Snooze.",
      default: true,
    },
    codeCopy: {
      type: "boolean",
      label: "Code copy",
      description: "Click or tap code in an agent's reply to copy it.",
      default: true,
    },
    threadPrefetch: {
      type: "boolean",
      label: "Preload threads",
      description: "Preload the latest part of recent and newly completed threads.",
      default: true,
    },
    threadEta: {
      type: "boolean",
      label: "Thread ETA",
      description: "An agent's estimate of the time left counts down on its thread in the sidebar.",
      default: true,
    },
  });
  await registerSnoozeServer(bb);
  registerThreadEtaServer(bb);
}
