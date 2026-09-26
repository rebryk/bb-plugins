import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { start } from "./paste";
import "./app.css";

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "paste", mount: start });
});
