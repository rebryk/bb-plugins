import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { start } from "./paste";
import "./app.css";

export default function registerTerminalPaste(app: PluginAppBuilder) {
  app.contentScripts.register({ id: "terminal-paste", mount: start });
}
