// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

afterEach(cleanup);

it("prefers the built-in microphone only while the setting says so", async () => {
  const getUserMedia = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: Object.create({ getUserMedia }),
  });
  const app = await loadPluginApp(() => import("./app"));
  const overlay = app.appOverlays[0]!;
  renderSlot(overlay, {}, { settings: { microphone: "automatic" } });
  expect(navigator.mediaDevices.getUserMedia).toBe(getUserMedia);
  cleanup();
  renderSlot(overlay, {}, { settings: { microphone: "built-in" } });
  expect(navigator.mediaDevices.getUserMedia).not.toBe(getUserMedia);
  cleanup();
  expect(navigator.mediaDevices.getUserMedia).toBe(getUserMedia);
});
