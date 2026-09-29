// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  loadPluginApp,
  type CapturedPluginApp,
} from "@get-bb/plugin-sdk/testing/app";

/** The test runtime collects commands, though its type doesn't list them. */
function commands(app: CapturedPluginApp) {
  type Command = { id: string };
  return (app as CapturedPluginApp & { commandPaletteActions: Command[] })
    .commandPaletteActions;
}

it("registers every feature under an id of its own", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const ids = (registrations: { id: string }[]) =>
    registrations.map(({ id }) => id);
  const registered = {
    contentScripts: ids(app.contentScripts),
    appOverlays: ids(app.appOverlays),
    sidebarNavigations: ids(app.experimentalSidebarNavigations),
    threadHeaderActions: ids(app.threadHeaderActions),
    commands: ids(commands(app)),
    sidebarFooterItems: ids(app.experimentalSidebarFooterItems),
  };
  expect(registered).toEqual({
    contentScripts: [
      "hotkeys",
      "snooze-row-buttons",
      "terminal-paste",
      "ui-polish",
    ],
    appOverlays: [
      "hotkeys-bridge",
      "snooze-dialogs",
      "code-copy",
      "zoom-lock",
      "phone-layout",
      "haptics",
      "thread-prefetch",
      "thread-eta",
    ],
    sidebarNavigations: ["dia-sidebar"],
    threadHeaderActions: ["snooze", "archive", "new-thread"],
    commands: ["open-plugins", "snooze-thread", "show-snoozed-threads"],
    sidebarFooterItems: ["change-server"],
  });
  const all = Object.values(registered).flat();
  expect(new Set(all).size).toBe(all.length);
});
