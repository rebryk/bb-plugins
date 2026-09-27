// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
  type RenderSlotOptions,
} from "@get-bb/plugin-sdk/testing/app";
import { ACCENTS, ACCENT_ATTRIBUTE, ACCENT_STORAGE_KEY, DEFAULT_ACCENT } from "./accents";

// Node's own localStorage, which needs a backing file, hides jsdom's; the
// tests get an in-memory one.
const storage = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, String(value)),
  removeItem: (key: string) => void storage.delete(key),
  clear: () => storage.clear(),
};
vi.stubGlobal("localStorage", memoryStorage);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", memoryStorage);
  document.documentElement.removeAttribute(ACCENT_ATTRIBUTE);
  document.head.replaceChildren();
  document.body.replaceChildren();
  localStorage.clear();
  // A fresh picker store for each test.
  vi.resetModules();
});

const here = dirname(fileURLToPath(import.meta.url));
const accentAttribute = () => document.documentElement.getAttribute(ACCENT_ATTRIBUTE);

/** Runs animation frames on demand, to watch the transition hold come and go. */
function stubFrames() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  return {
    holds: () => [...document.querySelectorAll("style")].filter((style) => style.textContent?.includes("transition: none !important")),
    nextFrame: () => {
      for (const callback of frames.splice(0)) callback(0);
    },
  };
}

async function renderAccentSync(settings?: Record<string, string>) {
  const app = await loadPluginApp(() => import("./app"));
  return renderSlot(app.appOverlays[0]!, {}, settings ? { settings } : {});
}

type UpdateSettings = (args: { pluginId: string; values: Record<string, unknown> }) => Promise<unknown>;

/** The overlay and the picker side by side, as in bb's Settings. */
async function renderPicker(options: { settings?: Record<string, string>; save?: UpdateSettings } = {}) {
  const app = await loadPluginApp(() => import("./app"));
  const settings = options.settings ?? { accent: "Pink" };
  const save: UpdateSettings = options.save ?? (async ({ values }) => ({ values }));
  renderSlot(app.appOverlays[0]!, {}, { settings });
  const sdk = { plugins: { updateSettings: save } } as NonNullable<RenderSlotOptions["sdk"]>;
  const slot = renderSlot(app.settingsSections[0]!, {}, { settings, sdk });
  const radios = await slot.findAllByRole("radio");
  const radio = (name: string) => radios.find((element) => element.title === name)!;
  const checked = () => radios.filter((element) => element.getAttribute("aria-checked") === "true").map((element) => element.title);
  const saved = () => slot.inspection.sdkCalls.filter((call) => call.method === "plugins.updateSettings").map((call) => call.args[0]);
  return { slot, radios, radio, checked, saved };
}

describe("registrations", () => {
  it("adds the accent overlay, the accent picker and the settings-title content script", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.appOverlays.map((overlay) => overlay.id)).toEqual(["accent"]);
    expect(app.settingsSections.map((section) => section.id)).toEqual(["accent-picker"]);
    expect(app.contentScripts.map((script) => script.id)).toEqual(["settings-title"]);
  });

  it("mounts and disposes the content script cleanly", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const scripts = await mountPluginContentScripts(app, { pluginId: "san-francisco", generation: 1 });
    await scripts.lifecycle.dispose();
  });
});

describe("accent overlay", () => {
  it("marks <html> with the chosen accent", async () => {
    await renderAccentSync({ accent: "Pink" });
    expect(accentAttribute()).toBe("pink");
  });

  it("leaves Blue, the stylesheet's own color, unmarked", async () => {
    document.documentElement.setAttribute(ACCENT_ATTRIBUTE, "green");
    await renderAccentSync({ accent: "Blue" });
    expect(accentAttribute()).toBeNull();
  });

  it("falls back to Blue for a value it does not know", async () => {
    document.documentElement.setAttribute(ACCENT_ATTRIBUTE, "green");
    await renderAccentSync({ accent: "Teal" });
    expect(accentAttribute()).toBeNull();
  });

  it("keeps the current accent while settings load", async () => {
    document.documentElement.setAttribute(ACCENT_ATTRIBUTE, "green");
    await renderAccentSync();
    expect(accentAttribute()).toBe("green");
  });

  it("remembers the accent in this browser", async () => {
    await renderAccentSync({ accent: "Orange" });
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("orange");
  });

  it("marks <html> with the remembered accent before settings load", async () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, "yellow");
    await loadPluginApp(() => import("./app"));
    expect(accentAttribute()).toBe("yellow");
    await renderAccentSync();
    expect(accentAttribute()).toBe("yellow");
  });

  it("holds transitions for two frames while it restores the accent", async () => {
    const { holds, nextFrame } = stubFrames();
    localStorage.setItem(ACCENT_STORAGE_KEY, "pink");
    await loadPluginApp(() => import("./app"));
    expect(accentAttribute()).toBe("pink");
    expect(holds()).toHaveLength(1);
    nextFrame();
    expect(holds()).toHaveLength(1);
    nextFrame();
    expect(holds()).toHaveLength(0);
  });

  it.each([
    ["an accent remembered from another device", "pink", "Green", "green"],
    ["Blue on a first visit", null, "Pink", "pink"],
    ["a remembered accent back to Blue", "pink", "Blue", null],
  ])("snaps from %s to the loaded setting", async (_name, shown, setting, expected) => {
    const { holds, nextFrame } = stubFrames();
    if (shown) document.documentElement.setAttribute(ACCENT_ATTRIBUTE, shown);
    await renderAccentSync({ accent: setting });
    expect(accentAttribute()).toBe(expected);
    expect(holds()).toHaveLength(1);
    nextFrame();
    nextFrame();
    expect(holds()).toHaveLength(0);
  });

  it("holds no transitions when the loaded setting is the accent shown", async () => {
    const { holds } = stubFrames();
    document.documentElement.setAttribute(ACCENT_ATTRIBUTE, "green");
    await renderAccentSync({ accent: "Green" });
    expect(accentAttribute()).toBe("green");
    expect(holds()).toHaveLength(0);
  });

  it("holds no transitions when there is no accent to restore", async () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, "blue");
    await loadPluginApp(() => import("./app"));
    expect(document.querySelectorAll("style")).toHaveLength(0);
  });

  it("lets the loaded setting replace the remembered accent", async () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, "yellow");
    await renderAccentSync({ accent: "Blue" });
    expect(accentAttribute()).toBeNull();
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("blue");
  });

  it.each(["blue", "teal"])("leaves <html> unmarked for a remembered %s", async (id) => {
    localStorage.setItem(ACCENT_STORAGE_KEY, id);
    await loadPluginApp(() => import("./app"));
    expect(accentAttribute()).toBeNull();
  });

  it("removes the mark when the plugin unloads", async () => {
    const slot = await renderAccentSync({ accent: "Graphite" });
    expect(accentAttribute()).toBe("graphite");
    slot.lifecycle.unmount();
    expect(accentAttribute()).toBeNull();
  });

  it("keeps the mark when a plugin reload swaps in the new overlay", async () => {
    const slot = await renderAccentSync({ accent: "Pink" });
    expect(accentAttribute()).toBe("pink");
    // bb keys overlays by the plugin's generation, so a reload unmounts the old
    // overlay and mounts the new one, from a fresh module, in one commit.
    vi.resetModules();
    const reloaded = await loadPluginApp(() => import("./app"));
    act(() => slot.lifecycle.rerender(createElement(reloaded.appOverlays[0]!.component)));
    expect(accentAttribute()).toBe("pink");
  });
});

describe("accent picker", () => {
  it("offers every macOS accent as a labelled radio group", async () => {
    const { slot, radios } = await renderPicker();
    const group = slot.getByRole("radiogroup", { name: "Accent color" });
    expect(group.hasAttribute("data-sf-accent-picker")).toBe(true);
    expect(group.getAttribute("aria-describedby")).toBeTruthy();
    expect(radios.map((radio) => radio.getAttribute("data-sf-swatch"))).toEqual(ACCENTS.map((accent) => accent.id));
    expect(radios.every((radio) => radio.getAttribute("type") === "button")).toBe(true);
  });

  it("names each swatch once, by a title that shows on hover", async () => {
    const { slot, radios } = await renderPicker();
    expect(radios.map((radio) => radio.title)).toEqual(ACCENTS.map((accent) => accent.name));
    for (const accent of ACCENTS) expect(slot.getAllByRole("radio", { name: accent.name })).toHaveLength(1);
    // An aria-label as well would read each name a second time, as the description.
    expect(radios.some((radio) => radio.hasAttribute("aria-label"))).toBe(false);
  });

  it("keeps the swatches' colors in High Contrast and draws the selection in system colors", async () => {
    const { slot } = await renderPicker();
    const style = slot.container.querySelector("style")?.textContent ?? "";
    const forced = style.slice(style.indexOf("@media (forced-colors: active)"));
    expect(forced).toMatch(/^@media \(forced-colors: active\) \{\s*\[data-sf-accent-picker\] > span \{\s*forced-color-adjust: none;/);
    expect(forced).toMatch(/> span:has\(> \[aria-checked="true"\]\) \{\s*border-color: CanvasText !important;/);
    expect(forced).toMatch(/\[data-sf-swatch\]:focus-visible \{\s*outline-color: Highlight;/);
    // The selected accent's name is text, so it takes the system colors.
    expect(forced).toMatch(/\[data-sf-accent-name\] \{\s*forced-color-adjust: auto;/);
  });

  it("checks the saved accent, names it and makes it the tab stop", async () => {
    const { radios, checked, radio, slot } = await renderPicker({ settings: { accent: "Green" } });
    expect(checked()).toEqual(["Green"]);
    expect(radios.filter((element) => element.tabIndex === 0)).toEqual([radio("Green")]);
    expect(radio("Green").parentElement?.textContent).toBe("Green");
    expect(slot.getAllByText("Green")).toHaveLength(1);
  });

  it("checks Blue for a value it does not know", async () => {
    const { checked } = await renderPicker({ settings: { accent: "Teal" } });
    expect(checked()).toEqual(["Blue"]);
  });

  it("checks nothing while an unknown setting loads and keeps the first swatch reachable", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.settingsSections[0]!, {}, {});
    const radios = await slot.findAllByRole("radio");
    expect(radios.some((radio) => radio.getAttribute("aria-checked") === "true")).toBe(false);
    expect(radios.map((radio) => radio.tabIndex)).toEqual(ACCENTS.map((_, index) => (index === 0 ? 0 : -1)));
  });

  it.each([
    ["the accent <html> shows", () => document.documentElement.setAttribute(ACCENT_ATTRIBUTE, "green"), "Green"],
    ["the remembered accent", () => localStorage.setItem(ACCENT_STORAGE_KEY, "blue"), "Blue"],
  ])("checks %s while settings load", async (_name, arrange, expected) => {
    arrange();
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.settingsSections[0]!, {}, {});
    const radios = await slot.findAllByRole("radio");
    const checked = radios.filter((radio) => radio.getAttribute("aria-checked") === "true");
    expect(checked.map((radio) => radio.title)).toEqual([expected]);
    expect(checked[0]!.tabIndex).toBe(0);
  });

  it("draws the selected swatch's dot in the theme's mark color", async () => {
    const { radio } = await renderPicker({ settings: { accent: "Yellow" } });
    const dot = radio("Yellow").firstElementChild as HTMLElement;
    expect(dot.style.backgroundColor).toBe("rgba(0, 0, 0, 0.78)");
    expect(radio("Green").firstElementChild).toBeNull();
  });

  it("uses the markup of bb's plugin Configuration block", async () => {
    const { slot } = await renderPicker();
    const group = slot.getByRole("radiogroup", { name: "Accent color" });
    const row = group.closest("[data-control-placement]")!;
    const well = row.parentElement!.parentElement!;
    expect(row.parentElement!.className).toBe("space-y-4");
    expect(well.className).toContain("rounded-md border border-border bg-surface-recessed/70");
    // Only the row sits in the block, so a palette's rules for bb's own block apply.
    expect(well.children).toHaveLength(1);
    expect(row.parentElement!.children).toHaveLength(1);
  });

  it.each([
    ["Blue", "first"],
    ["Pink", ""],
    ["Graphite", "last"],
  ])("marks where %s's name sits on the strip", async (name, edge) => {
    const { radio } = await renderPicker({ settings: { accent: name } });
    const label = radio(name).nextElementSibling as HTMLElement;
    expect(label.textContent).toBe(name);
    expect(label.getAttribute("data-sf-accent-name")).toBe(edge);
    // The stylesheet places it, by the row's width.
    expect([label.style.position, label.style.left, label.style.right, label.style.transform]).toEqual(["", "", "", ""]);
  });

  it("keeps the first and last accent names inside the strip beside the label", async () => {
    const { slot } = await renderPicker();
    const row = slot.getByRole("radiogroup").closest<HTMLElement>("[data-control-placement]")!;
    expect(row.style.containerName).toBe("sf-accent-row");
    const style = slot.container.querySelector("style")?.textContent ?? "";
    expect(style).toMatch(/\[data-sf-accent-name\] \{\s*position: absolute;\s*top: 100%;\s*left: 50%;/);
    expect(style).toMatch(/\[data-sf-accent-name="first"\] \{\s*left: 2px;\s*transform: none;/);
    expect(style).toMatch(/\[data-sf-accent-name="last"\] \{\s*left: auto;\s*right: 2px;\s*transform: none;/);
  });

  it("is as tall as bb's select under the label, so nothing moves when it replaces it", async () => {
    const { slot } = await renderPicker();
    const style = slot.container.querySelector("style")?.textContent ?? "";
    // Under the label: on a phone, and where the row is too narrow for both.
    const underLabel = /\{\s*\[data-sf-accent-picker\] \{\s*position: relative;\s*row-gap: 8px;\s*width: 320px;\s*padding: 3px 60px 3px 0;/;
    expect(style).toMatch(new RegExp(/@media \(width < 40rem\) /.source + underLabel.source));
    expect(style).toMatch(new RegExp(/@container sf-accent-row \(width < 520px\) /.source + underLabel.source));
    // The name follows the strip on its line, or is left out where it does not fit.
    expect(style).toMatch(/\[data-sf-accent-name\] \{\s*top: 50%;\s*left: calc\(100% - 48px\);/);
    expect(style).toMatch(/@container sf-accent-row \(width < 292px\) \{[^@]*\[data-sf-accent-name\] \{\s*display: none;/);
  });

  it("rings keyboard focus in the theme's accent text color, on the selection ring", async () => {
    const { slot } = await renderPicker();
    const style = slot.container.querySelector("style")?.textContent ?? "";
    expect(style).toContain("outline: 2px solid var(--sf-accent-text, var(--ring));");
    expect(style).toMatch(/\[aria-checked="true"\]:focus-visible \{\s*outline-offset: 4px;/);
  });

  it("hides bb's own Accent color select only while it shows", async () => {
    const { slot } = await renderPicker();
    const style = slot.container.querySelector("style")?.textContent ?? "";
    expect(style).toContain('[data-testid="plugin-detail-san-francisco"]:has([data-sf-accent-picker])');
    expect(style).toContain('button[aria-label="Accent color"]');
    // Also while it is still empty, as settings load.
    expect(style).toContain('[data-testid="plugin-detail-san-francisco"]:has([data-sf-accent-picker]) > .rounded-md.border:empty,');
  });

  it("applies a clicked accent at once and saves it", async () => {
    const { radio, checked, saved } = await renderPicker();
    fireEvent.click(radio("Green"));
    expect(accentAttribute()).toBe("green");
    expect(checked()).toEqual(["Green"]);
    await waitFor(() => expect(saved()).toEqual([{ pluginId: "san-francisco", values: { accent: "Green" } }]));
  });

  it("lets a picked accent fade in like any other change", async () => {
    const { holds, nextFrame } = stubFrames();
    const { radio } = await renderPicker();
    nextFrame();
    nextFrame();
    expect(holds()).toHaveLength(0);
    fireEvent.click(radio("Green"));
    expect(accentAttribute()).toBe("green");
    expect(holds()).toHaveLength(0);
  });

  it("removes the mark at once for Blue", async () => {
    const { radio } = await renderPicker();
    expect(accentAttribute()).toBe("pink");
    fireEvent.click(radio("Blue"));
    expect(accentAttribute()).toBeNull();
  });

  it("does not save the accent that is already on", async () => {
    const { radio, saved } = await renderPicker();
    fireEvent.click(radio("Pink"));
    await act(async () => {});
    expect(saved()).toEqual([]);
  });

  it("goes back to the saved accent and says why when saving fails", async () => {
    let fail!: (error: Error) => void;
    const save: UpdateSettings = () => new Promise((_, reject) => { fail = reject; });
    const { radio, checked, slot } = await renderPicker({ save });
    fireEvent.click(radio("Green"));
    expect(accentAttribute()).toBe("green");
    await act(async () => fail(new Error("Settings are read-only")));
    expect(accentAttribute()).toBe("pink");
    expect(checked()).toEqual(["Pink"]);
    expect(slot.getByRole("alert").textContent).toContain("Settings are read-only");

    // The next pick clears the message.
    fireEvent.click(radio("Red"));
    expect(slot.queryByRole("alert")).toBeNull();
  });

  it("drops a failed save's message when the page is left", async () => {
    let fail!: (error: Error) => void;
    const save: UpdateSettings = () => new Promise((_, reject) => { fail = reject; });
    const first = await renderPicker({ save });
    fireEvent.click(first.radio("Green"));
    await act(async () => fail(new Error("Settings are read-only")));
    expect(first.slot.getByRole("alert").textContent).toContain("Settings are read-only");
    cleanup();
    // The same module, as when Settings navigates away and back.
    const again = await renderPicker({ save });
    expect(again.slot.queryByRole("alert")).toBeNull();
  });

  it("says on return why the accent went back when a save fails after the page is left", async () => {
    let fail!: (error: Error) => void;
    const save: UpdateSettings = () => new Promise((_, reject) => { fail = reject; });
    const first = await renderPicker({ save });
    fireEvent.click(first.radio("Green"));
    cleanup();
    await act(async () => fail(new Error("Settings are read-only")));
    const again = await renderPicker({ save });
    expect(again.checked()).toEqual(["Pink"]);
    expect(again.slot.getByRole("alert").textContent).toContain("Settings are read-only");
  });

  it("sends picks one at a time and ends on the last one", async () => {
    const pending: (() => void)[] = [];
    const save: UpdateSettings = ({ values }) => new Promise((resolve) => pending.push(() => resolve({ values })));
    const { radio, checked, saved } = await renderPicker({ save });
    fireEvent.click(radio("Green"));
    fireEvent.click(radio("Red"));
    fireEvent.click(radio("Orange"));
    expect(accentAttribute()).toBe("orange");
    expect(saved()).toEqual([{ pluginId: "san-francisco", values: { accent: "Green" } }]);
    await act(async () => pending.shift()!());
    expect(saved().map((args) => (args as { values: { accent: string } }).values.accent)).toEqual(["Green", "Orange"]);
    await act(async () => pending.shift()!());
    expect(checked()).toEqual(["Orange"]);
    expect(accentAttribute()).toBe("orange");
  });
});

describe("accent picker keyboard", () => {
  it("moves and selects with the arrow keys, wrapping around", async () => {
    const { radio, checked, radios } = await renderPicker({ settings: { accent: "Blue" } });
    radio("Blue").focus();
    fireEvent.keyDown(radio("Blue"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(radio("Purple"));
    expect(checked()).toEqual(["Purple"]);
    expect(radios.filter((element) => element.tabIndex === 0)).toEqual([radio("Purple")]);

    fireEvent.keyDown(radio("Purple"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(radio("Pink"));

    fireEvent.keyDown(radio("Pink"), { key: "ArrowUp" });
    fireEvent.keyDown(radio("Purple"), { key: "ArrowLeft" });
    fireEvent.keyDown(radio("Blue"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(radio("Graphite"));
    expect(checked()).toEqual(["Graphite"]);
    expect(accentAttribute()).toBe("graphite");

    fireEvent.keyDown(radio("Graphite"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(radio("Blue"));
    expect(accentAttribute()).toBeNull();
  });

  it("jumps to the ends with Home and End", async () => {
    const { radio, checked } = await renderPicker();
    fireEvent.keyDown(radio("Pink"), { key: "End" });
    expect(document.activeElement).toBe(radio("Graphite"));
    expect(checked()).toEqual(["Graphite"]);
    fireEvent.keyDown(radio("Graphite"), { key: "Home" });
    expect(document.activeElement).toBe(radio(DEFAULT_ACCENT.name));
    expect(checked()).toEqual([DEFAULT_ACCENT.name]);
  });

  it.each(["altKey", "ctrlKey", "metaKey", "shiftKey"])("leaves arrows with %s to the browser and bb", async (modifier) => {
    const { radio, checked, saved } = await renderPicker();
    radio("Pink").focus();
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]) {
      expect(fireEvent.keyDown(radio("Pink"), { key, [modifier]: true })).toBe(true);
    }
    expect(document.activeElement).toBe(radio("Pink"));
    expect(checked()).toEqual(["Pink"]);
    await act(async () => {});
    expect(saved()).toEqual([]);
  });

  it("brings focus back to the saved accent when saving fails", async () => {
    let fail!: (error: Error) => void;
    const save: UpdateSettings = () => new Promise((_, reject) => { fail = reject; });
    const { radio, radios, checked } = await renderPicker({ save });
    radio("Pink").focus();
    fireEvent.keyDown(radio("Pink"), { key: "ArrowRight" });
    fireEvent.keyDown(radio("Red"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(radio("Orange"));
    await act(async () => fail(new Error("Settings are read-only")));
    expect(checked()).toEqual(["Pink"]);
    expect(document.activeElement).toBe(radio("Pink"));
    expect(radios.filter((element) => element.tabIndex === 0)).toEqual([radio("Pink")]);
  });

  it("leaves focus elsewhere alone when saving fails", async () => {
    let fail!: (error: Error) => void;
    const save: UpdateSettings = () => new Promise((_, reject) => { fail = reject; });
    const { radio } = await renderPicker({ save });
    const outside = document.body.appendChild(document.createElement("button"));
    fireEvent.click(radio("Green"));
    outside.focus();
    await act(async () => fail(new Error("Settings are read-only")));
    expect(document.activeElement).toBe(outside);
  });

  it("leaves other keys alone", async () => {
    const { radio, checked } = await renderPicker();
    const tab = fireEvent.keyDown(radio("Pink"), { key: "Tab" });
    expect(tab).toBe(true);
    expect(checked()).toEqual(["Pink"]);
  });
});

describe("theme stylesheet", () => {
  const css = readFileSync(join(here, "themes/san-francisco.css"), "utf8");

  /** The declarations of the first rule with exactly this selector. */
  function block(selector: string) {
    const start = css.indexOf(`\n${selector} {\n`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("\n}", start));
  }

  it.each(ACCENTS.map((accent) => [accent.name, accent] as const))("fills %s as the swatches do", (_name, accent) => {
    const body = block(accent === DEFAULT_ACCENT ? ":root" : `:root[${ACCENT_ATTRIBUTE}="${accent.id}"]`);
    expect(body).toContain(`--sf-accent-light: ${accent.light};`);
    expect(body).toContain(`--sf-accent-dark: ${accent.dark};`);
    // Marks on the accent are white unless the accent says otherwise.
    if (accent.mark === DEFAULT_ACCENT.mark && accent !== DEFAULT_ACCENT) expect(body).not.toContain("--sf-on-accent:");
    else expect(body).toContain(`--sf-on-accent: ${accent.mark};`);
  });

  it("defines, in light and dark, every token the frontend reads", () => {
    const sources = readdirSync(here).filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file));
    const tokens = new Set(
      sources.flatMap((file) =>
        [...readFileSync(join(here, file), "utf8").matchAll(/(?:var\(|getPropertyValue\(["'])(--sf-[\w-]+)/g)].map((match) => match[1]!),
      ),
    );
    // The swatches' focus ring and the check that San Francisco is the palette.
    expect([...tokens]).toEqual(expect.arrayContaining(["--sf-accent-text", "--sf-accent"]));
    for (const selector of [":root,\n.light", ".dark"]) {
      const body = block(selector);
      for (const token of tokens) expect(body, `${token} in ${selector}`).toMatch(new RegExp(`^\\s+${token}:`, "m"));
    }
  });
});
