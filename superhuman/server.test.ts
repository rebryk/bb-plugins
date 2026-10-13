import { expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

it("defines a switch for each feature and starts Snooze and Brief Replies", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "superhuman" });
  await plugin(bb);
  const { registrations } = harness.inspection;
  const settings = Object.entries(registrations.settingsDescriptors).map(
    ([key, { type, default: on }]) => [key, type, on],
  );
  expect(settings).toEqual([
    ["threadShortcuts", "boolean", true],
    ["universalSearch", "boolean", true],
    ["snooze", "boolean", true],
    ["archiveButton", "boolean", true],
    ["phoneLayout", "boolean", true],
    ["hideTitleBar", "boolean", false],
    ["uiPolish", "boolean", true],
    ["briefReplies", "boolean", false],
  ]);
  expect(registrations.rpcMethods.sort()).toEqual([
    "listSnoozes",
    "snooze",
    "unsnooze",
  ]);
  expect(registrations.services.map(({ name }) => name)).toEqual([
    "snooze-wake",
  ]);
  expect(registrations.instructionProvider).not.toBeNull();
});
