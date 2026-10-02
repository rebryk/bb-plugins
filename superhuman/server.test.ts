import { expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

it("defines the toggles and starts Snooze and Thread ETA", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "superhuman" });
  await plugin(bb);
  const { registrations } = harness.inspection;
  // Existing keys retain stored preferences; the final two form Experimental.
  const settings = Object.entries(registrations.settingsDescriptors).map(
    ([key, { type, default: on }]) => [key, type, on],
  );
  expect(settings).toEqual([
    ["threadShortcuts", "boolean", true],
    ["universalSearch", "boolean", true],
    ["phoneLayout", "boolean", true],
    ["archiveButton", "boolean", true],
    ["threadEta", "boolean", true],
    ["threadPrefetch", "boolean", true],
  ]);
  expect(registrations.rpcMethods.sort()).toEqual([
    "listSnoozes",
    "listThreadEtas",
    "snooze",
    "unsnooze",
  ]);
  expect(registrations.agentTools.map(({ name }) => name)).toEqual([
    "set_thread_eta",
  ]);
  expect(registrations.services.map(({ name }) => name)).toEqual([
    "snooze-wake",
  ]);
});
