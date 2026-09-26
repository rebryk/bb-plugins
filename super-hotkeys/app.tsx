import { useEffect } from "react";
import { definePluginApp, useSdk, useSettings } from "@get-bb/plugin-sdk/app";
import { PLUGINS_SHORTCUT, start, update } from "./controller";
import "./app.css";

// Settings and keybindings reach the page script through this React bridge.
function Bridge() {
  const sdk = useSdk();
  const { values } = useSettings();
  useEffect(() => update({ settings: values ?? {} }), [values]);
  useEffect(() => {
    const refresh = () =>
      sdk.system.config().then(
        (config) => update({ config }),
        () => {}, // Keep the last bindings while the connection recovers.
      );
    void refresh();
    const stops = [
      sdk.subscribe({ event: "system:config-changed", callback: refresh }),
      sdk.subscribe({ event: "realtime:connection", callback: refresh }),
    ];
    return () => stops.forEach((stop) => stop());
  }, [sdk]);
  return null;
}

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "navigation", mount: start });
  app.slots.experimental_appOverlay({ id: "runtime", component: Bridge });
  // BB has no command for its Plugins page, and the SDK cannot navigate there.
  app.commands.register({
    id: "open-plugins",
    title: "Open plugins",
    defaultShortcut: PLUGINS_SHORTCUT,
    run: () => {
      if (location.pathname === "/plugins") return;
      history.pushState(history.state, "", "/plugins");
      dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    },
  });
});
