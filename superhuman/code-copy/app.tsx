import { useEffect } from "react";
import { useSettings, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { startCodeCopy } from "./copy";
import "./app.css";

function CodeCopy() {
  const { values } = useSettings();
  const enabled = values?.codeCopy !== false;
  useEffect(() => (enabled ? startCodeCopy(document) : undefined), [enabled]);
  return null;
}

export default function registerCodeCopy(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({ id: "code-copy", component: CodeCopy });
}
