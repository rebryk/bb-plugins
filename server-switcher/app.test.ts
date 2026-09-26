// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { loadPluginApp, type CapturedPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";

function footerAction(app: CapturedPluginApp) {
  expect(app.experimentalSidebarFooterItems).toHaveLength(1);
  const action = app.experimentalSidebarFooterItems[0]!;
  if (action.kind !== "action") throw new Error("Expected a footer action");
  expect(action).toMatchObject({ id: "change-server", label: "Change Server", icon: "Repeat" });
  return action;
}

afterEach(() => {
  for (const key of ["bb", "ReactNativeWebView", "bbDesktop"]) Reflect.deleteProperty(window, key);
  vi.restoreAllMocks();
});

it("switches from a browser click, and says why when the page isn't on bb connect", async () => {
  const error = vi.spyOn(toast, "error").mockReturnValue(1);
  const fetch = vi.spyOn(window, "fetch");
  const app = await loadPluginApp(() => import("./app"));
  expect(app.appOverlays).toEqual([]);
  expect(app.contentScripts).toEqual([]);
  // jsdom serves the page from localhost, which has no bb connect account.
  await footerAction(app).onActivate({ openPluginDetails: vi.fn() });
  expect(fetch).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledExactlyOnceWith("Open BB through bb connect to switch servers.");
});

it("sends a mobile tap straight to device settings", async () => {
  const post = vi.fn();
  Object.assign(window, { bb: { native: { platform: "ios", capabilities: ["open-native"], post } } });
  const app = await loadPluginApp(() => import("./app"));
  await footerAction(app).onActivate({ openPluginDetails: vi.fn() });
  expect(post).toHaveBeenCalledExactlyOnceWith({ type: "open-native", screen: "device-settings" });
});

it("names the settings path in a toast when an older mobile app can't open it", async () => {
  const error = vi.spyOn(toast, "error").mockReturnValue(1);
  Object.assign(window, { ReactNativeWebView: {} });
  const app = await loadPluginApp(() => import("./app"));
  await footerAction(app).onActivate({ openPluginDetails: vi.fn() });
  expect(error).toHaveBeenCalledExactlyOnceWith("Open Settings → This device → Servers in the BB app.");
});

it("registers nothing in BB Desktop, whose server only its native menu can change", async () => {
  Object.assign(window, { bbDesktop: {} });
  const app = await loadPluginApp(() => import("./app"));
  expect(app.experimentalSidebarFooterItems).toEqual([]);
});

it("uses public SDK imports", () => {
  const scan = experimental_scanPublicSdkOnly(process.cwd(), { allow: [/^sonner$/] });
  expect(scan.violations).toEqual([]);
  expect(scan.privateDependencies).toEqual([]);
});
