import { useEffect } from "react";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { startCodeCopy } from "./copy";
import "./app.css";

function CodeCopy() {
  useEffect(() => startCodeCopy(document), []);
  return null;
}

export default function registerCodeCopy(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({ id: "code-copy", component: CodeCopy });
}
