// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { asPluginApp, bbVersion } from "../testing";
import { searchCache } from "./host";
import { installThreadSearch } from "./threads";
import { installPaletteSearch } from "./palette";

vi.mock("./host", () => ({ searchCache: vi.fn() }));
vi.mock("./threads", () => ({ installThreadSearch: vi.fn() }));
vi.mock("./palette", () => ({ installPaletteSearch: vi.fn() }));
const invalidate = vi.fn(), stopThreads = vi.fn(), stopPalette = vi.fn();
const version = vi.fn(async () => bbVersion());

beforeEach(() => {
  vi.mocked(searchCache).mockReturnValue(invalidate);
  vi.mocked(installThreadSearch).mockReturnValue(stopThreads);
  vi.mocked(installPaletteSearch).mockReturnValue(stopPalette);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
async function mount(enabled = true) {
  const app = await loadPluginApp(asPluginApp(() => import("./app")));
  return renderSlot(app.appOverlays[0]!, {}, {
    settings: { universalSearch: enabled }, sdk: { system: { version } },
  });
}

it("installs after the compatibility check, clears cached searches and cleans up", async () => {
  const slot = await mount();
  await vi.waitFor(() => expect(installThreadSearch).toHaveBeenCalledOnce());
  expect(installPaletteSearch).toHaveBeenCalledOnce();
  expect(invalidate).toHaveBeenCalledTimes(1);
  slot.lifecycle.unmount();
  expect(stopThreads).toHaveBeenCalledOnce();
  expect(stopPalette).toHaveBeenCalledOnce();
  expect(invalidate).toHaveBeenCalledTimes(2);
});

it("does not touch native search when switched off", async () => {
  await mount(false);
  expect(version).not.toHaveBeenCalled();
  expect(installThreadSearch).not.toHaveBeenCalled();
});

it("leaves an unverified BB version unchanged", async () => {
  version.mockResolvedValueOnce(bbVersion("0.45.0"));
  await mount();
  await Promise.resolve();
  expect(installThreadSearch).not.toHaveBeenCalled();
  expect(installPaletteSearch).not.toHaveBeenCalled();
});

it("rolls back a partially installed adapter", async () => {
  vi.mocked(installPaletteSearch).mockImplementationOnce(() => { throw Error("host changed"); });
  await mount();
  await vi.waitFor(() => expect(stopThreads).toHaveBeenCalledOnce());
});

it("does not install after the overlay has gone away", async () => {
  let resolve!: (value: ReturnType<typeof bbVersion>) => void;
  version.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const slot = await mount();
  slot.lifecycle.unmount();
  resolve(bbVersion());
  await Promise.resolve();
  expect(installThreadSearch).not.toHaveBeenCalled();
});
