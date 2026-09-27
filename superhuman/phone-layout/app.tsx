import { useEffect } from "react";
import { useSettings, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { startPhoneLayout } from "./layout";
import { startPanelSlide } from "./slide";
import "./app.css";
import "./slide.css";

// The setting reaches the page through this React bridge.
function PhoneLayout() {
  const { values } = useSettings();
  const enabled = values?.phoneLayout !== false;
  useEffect(() => {
    if (!enabled) return;
    const stops = [startPhoneLayout(document), startPanelSlide(document)];
    return () => stops.forEach((stop) => stop());
  }, [enabled]);
  return null;
}

export default function registerPhoneLayout(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({ id: "phone-layout", component: PhoneLayout });
}
