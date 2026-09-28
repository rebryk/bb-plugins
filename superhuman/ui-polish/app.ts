import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { start } from "./focus";
import "./app.css";

// app.css hides BB's editor/git buttons, evens out icons and menu rows, and
// fixes its layout in Safari;
// focus.ts keeps a Tesla's keyboard from coming up each time a thread or a tab
// opens.
export default function registerUiPolish(app: PluginAppBuilder) {
  app.contentScripts.register({ id: "ui-polish", mount: start });
}
