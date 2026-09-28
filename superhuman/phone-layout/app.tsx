import { useEffect } from "react";
import { useSettings, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { startKeyboardSwipe } from "./keyboard";
import { startPhoneLayout } from "./layout";
import { startPanelSlide } from "./slide";
import "./app.css";
import "./slide.css";

// The settings reach the page through this React bridge.
function PhoneLayout() {
  const { values } = useSettings();
  const enabled = values?.phoneLayout !== false;
  const title = values?.threadTitle !== false;
  useEffect(() => {
    if (!enabled) return;
    const stops = [
      startPhoneLayout(document),
      startPanelSlide(document),
      startKeyboardSwipe(document),
    ];
    return () => stops.forEach((stop) => stop());
  }, [enabled]);
  useEffect(() => {
    if (title) return;
    const root = document.documentElement;
    root.dataset.hideThreadTitle = "";
    return () => {
      delete root.dataset.hideThreadTitle;
    };
  }, [title]);
  return null;
}

export default function registerPhoneLayout(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({ id: "phone-layout", component: PhoneLayout });
}
