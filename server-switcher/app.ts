import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { appKind, openDeviceSettings, switchServer, SwitchError } from "./client";

export default definePluginApp((app) => {
  const kind = appKind(window);
  // BB Desktop changes servers only from its native Window → Server menu, which
  // plugins can't reach, so the button stays out of the desktop sidebar.
  if (kind === "desktop") return;
  let switching = false;
  app.experimental_sidebarFooter.register({
    kind: "action",
    id: "change-server",
    label: "Change Server",
    icon: "Repeat",
    async onActivate() {
      if (switching) return;
      switching = true;
      try {
        // The mobile shell can't switch servers for a page, so a tap opens This
        // device, where Servers lists the saved servers.
        if (kind === "mobile") openDeviceSettings(window);
        else await switchServer(window, AbortSignal.timeout(8000));
      } catch (cause) {
        toast.error(cause instanceof SwitchError ? cause.message : "Couldn't change server. Try again.");
      } finally {
        switching = false;
      }
    },
  });
});
