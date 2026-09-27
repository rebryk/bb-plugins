import type { BbPluginApi } from "@get-bb/plugin-sdk";
import registerSnoozeServer from "./snooze/server";

export default async function plugin(bb: BbPluginApi) {
  // The browser reads these: the keyboard features in hotkeys/controller.ts,
  // the zoom lock and the phone layout in their app.tsx.
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
  });
  await registerSnoozeServer(bb);
}
