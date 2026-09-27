import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { ACCENTS, ACCENT_SETTING, DEFAULT_ACCENT } from "./accents";

// The select stores and validates the accent; in Settings the plugin's swatches
// (accent-picker.tsx) stand in for it.
export default function plugin(bb: BbPluginApi) {
  bb.settings.define({
    [ACCENT_SETTING.key]: {
      type: "select",
      label: ACCENT_SETTING.label,
      description: ACCENT_SETTING.description,
      options: ACCENTS.map((accent) => accent.name),
      default: DEFAULT_ACCENT.name,
    },
  });
}
