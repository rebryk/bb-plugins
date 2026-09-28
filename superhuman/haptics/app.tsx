import { useEffect } from "react";
import { useSettings, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { startDrawerHaptics } from "./drawers";

// The setting reaches the page through this React bridge.
function Haptics() {
  const { values } = useSettings();
  const enabled = values?.haptics !== false;
  useEffect(() => (enabled ? startDrawerHaptics(document) : undefined), [enabled]);
  return null;
}

export default function registerHaptics(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({ id: "haptics", component: Haptics });
}
