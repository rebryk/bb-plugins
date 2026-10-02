// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { toast } from "sonner";
import { asPluginApp } from "../testing";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
afterEach(cleanup);

it("renders a peer section, saves only the toggled field, and rolls back a failed save", async () => {
  const app = await loadPluginApp(asPluginApp(() => import("./app")));
  const slot = app.settingsSections[0]!;
  const Settings = slot.component;
  let finish!: () => void;
  const updateSettings = vi.fn(async () => {
    await new Promise<void>((resolve) => { finish = resolve; });
    return { schema: {}, values: { threadEta: false } };
  });
  const mounted = renderSlot({ ...slot, component: () => (
    <div><section data-resource-detail-section="configuration">
      <div><h2>Configuration</h2></div><Settings />
    </section></div>
  ) }, {}, {
    settings: { threadEta: true, threadPrefetch: true },
    sdk: { plugins: { updateSettings } },
  });
  const sections = document.querySelectorAll("section");
  expect(sections[0].nextElementSibling).toBe(sections[1]);
  expect(sections[1].querySelector("h2")?.textContent).toBe("Experimental");
  const toggle = screen.getByRole("switch", { name: "Thread ETA" });
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(toggle.hasAttribute("disabled")).toBe(true);
  expect(updateSettings).toHaveBeenCalledExactlyOnceWith({ pluginId: "superhuman", values: { threadEta: false } });
  finish();
  await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
  updateSettings.mockRejectedValueOnce(new Error("Save failed"));
  fireEvent.click(toggle);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Save failed"));
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(screen.getByRole("switch", { name: "Preload Threads" }).getAttribute("aria-checked")).toBe("true");
  mounted.lifecycle.unmount();
  expect(document.querySelector('[data-resource-detail-section="experimental"]')).toBeNull();
});
