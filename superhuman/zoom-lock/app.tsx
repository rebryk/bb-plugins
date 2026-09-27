import { useEffect } from "react";
import { useSettings, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { lockZoom } from "./lock";

// The setting reaches the page through this React bridge.
function ZoomLock() {
  const { values } = useSettings();
  const locked = values?.zoomLock === true;
  useEffect(() => (locked ? lockZoom(document) : undefined), [locked]);
  return null;
}

export default function registerZoomLock(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({ id: "zoom-lock", component: ZoomLock });
}
