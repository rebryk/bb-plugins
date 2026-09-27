import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import "./app.css";

// app.css evens out BB's icons and menu rows and fixes its layout in Safari;
// nothing to register.
export default function registerUiPolish(_app: PluginAppBuilder) {}
