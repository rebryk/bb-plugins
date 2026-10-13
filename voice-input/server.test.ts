import { expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";

const engine = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  status: vi.fn(() => ({ ready: false, message: "Building the recognizer" })),
  transcribe: vi.fn(async () => "Эм, привет, BB."),
  close: vi.fn(),
}));
vi.mock("./engine", () => ({ createEngine: () => engine }));

import plugin from "./server";

it("offers Parakeet Ultra for voice input, without hesitations", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "voice-input" });
  plugin(bb);
  expect(engine.start).toHaveBeenCalledOnce();

  const [service] = harness.inspection.registrations.aiServiceRegistrations;
  expect(service.id).toBe("parakeet");
  expect(await service.status!()).toEqual({
    ready: false,
    message: "Building the recognizer",
  });

  const audio = new File([new Uint8Array(8)], "take.webm");
  const signal = new AbortController().signal;
  expect(await service.transcribe!(audio, { signal, hint: null })).toBe(
    "Привет, BB.",
  );
  expect(engine.transcribe).toHaveBeenCalledWith(audio, signal);
});
