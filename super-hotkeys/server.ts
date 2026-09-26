import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function plugin(bb: BbPluginApi) {
  bb.settings.define({
    hints: {
      type: "boolean",
      label: "Instant shortcut hints",
      description:
        "Hold a modifier to see the remaining keys beside available controls.",
      default: true,
    },
    slashSearch: {
      type: "boolean",
      label: "Slash opens Search threads",
      description: "Press / outside text fields and menus to search threads.",
      default: true,
    },
    numberedSetup: {
      type: "boolean",
      label: "Numbered new-thread setup",
      description:
        "While a new thread's prompt is empty, number keys open its project, model, machine and branch menus.",
      default: true,
    },
  });
}
