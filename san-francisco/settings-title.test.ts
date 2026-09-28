// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DUPLICATE_ATTRIBUTE,
  PAGE_ATTRIBUTE,
  PARENT_ATTRIBUTE,
  PINNED_ATTRIBUTE,
  TITLE_ATTRIBUTE,
  findSettingsPage,
  isThemeActive,
  repeatsTitle,
  watchSettingsTitle,
} from "./settings-title";

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

function theme(active: boolean) {
  const style = document.createElement("style");
  style.id = "bb-app-theme";
  style.textContent = active ? ":root { --sf-accent: #007aff; }" : "";
  document.head.append(style);
  return style;
}

const PAGES: Record<string, string> = {
  General: "/settings",
  Appearance: "/settings/appearance",
  Keyboard: "/settings/keyboard",
  Machines: "/settings/machines",
  "Installed plugins": "/settings/plugins",
};

// The settings layout as bb 0.43 renders it, reduced to the hooks the script reads.
function settingsPage(current = "General", content = "<section><div><div><div><h2>Links</h2></div></div></div></section>", path = PAGES[current]) {
  history.replaceState(null, "", path);
  const links = Object.entries(PAGES).map(([name, href]) =>
    `<a href="${href}" ${current === name ? 'aria-current="page"' : ""}><svg></svg><span>${name}</span></a>`);
  document.body.innerHTML = `
    <div data-testid="app-layout-root">
      <div data-sidebar="sidebar">
        <div data-testid="settings-sidebar-top-reserve-row"></div>
        ${links.join("")}
      </div>
      <main data-sidebar="inset">
        <div data-testid="app-layout-content-shell">
          <header><div data-testid="app-page-header-content-row"><div><div class="title"><p>Settings</p></div></div></div></header>
          <main><div><div class="overflow-y-auto"><div class="mx-auto column">${content}</div></div></div></main>
        </div>
      </main>
    </div>`;
  return {
    header: document.querySelector<HTMLElement>(".title")!,
    column: document.querySelector<HTMLElement>(".column")!,
    heading: document.querySelector<HTMLElement>(".column h2"),
  };
}

// A machine's page: the sidebar keeps "Machines" current and the page names the machine.
function machinePage(name: string | null = "MacBook Pro") {
  const heading = name === null ? "" : `<h1 class="text-sm"><span>${name}</span></h1>`;
  return settingsPage(
    "Machines",
    `<div class="space-y-3"><a href="/settings/machines">Machines</a>${heading}</div>`
      + "<section><div><div><div><h2>Machines</h2></div></div></div></section>",
    "/settings/machines/host_1",
  );
}

// A plugin without settings: the sidebar lists no entry for it, so none is current.
function pluginPage(path = "/settings/plugins/bookmarks", name: string | null = "Bookmarks") {
  const heading = name === null ? "" : `<h1>${name}</h1>`;
  return settingsPage(
    "",
    `<div class="space-y-3">${heading}</div>`
      + "<section data-resource-detail-section><div><h2>Plugin details</h2></div></section>",
    path,
  );
}

function threadPage() {
  document.body.innerHTML = `
    <div data-testid="app-layout-root">
      <div data-sidebar="sidebar"><a href="/" aria-current="page">Thread</a></div>
      <main data-sidebar="inset"><div data-testid="app-layout-content-shell"><header><p>Settings</p></header><main><div class="mx-auto"></div></main></div></main>
    </div>`;
}

describe("findSettingsPage", () => {
  it("names the current settings page, its header title row and its column", () => {
    const { header, column } = settingsPage("Appearance");
    expect(findSettingsPage(document)).toEqual({
      name: "Appearance", parent: null, title: "Appearance", header, column, heading: null,
    });
  });

  it("points at a first section heading that only repeats the title", () => {
    const { heading } = settingsPage("Appearance", "<section><h2> appearance </h2></section><section><h2>Theme</h2></section>");
    expect(findSettingsPage(document)?.heading).toBe(heading);

    settingsPage("Appearance", "<section><h2>Theme</h2></section><section><h2>Appearance</h2></section>");
    expect(findSettingsPage(document)?.heading).toBeNull();
  });

  it("also points at a page's only heading when it extends the title", () => {
    const { heading } = settingsPage("Keyboard", "<section><h2>Keyboard shortcuts</h2></section>");
    expect(findSettingsPage(document)?.heading).toBe(heading);

    // Beside other sections it names one of them.
    settingsPage("Keyboard", "<section><h2>Keyboard shortcuts</h2></section><section><h2>Hints</h2></section>");
    expect(findSettingsPage(document)?.heading).toBeNull();
  });

  it("names a detail page after its own heading, below its sidebar entry, without a large title", () => {
    machinePage();
    expect(findSettingsPage(document)).toMatchObject({ name: "MacBook Pro", parent: "Machines", title: "", heading: null });

    // Until the page loads its heading, the header keeps the entry's name.
    machinePage(null);
    expect(findSettingsPage(document)).toMatchObject({ name: "Machines", parent: null, title: "", heading: null });
  });

  it("puts a plugin without a sidebar entry below Installed plugins, with a titled page's sections", () => {
    pluginPage();
    expect(findSettingsPage(document)).toMatchObject({
      name: "Bookmarks", parent: "Installed plugins", title: "Bookmarks", heading: null,
    });

    pluginPage("/settings/plugins/bookmarks", null);
    expect(findSettingsPage(document)).toMatchObject({ name: "Installed plugins", parent: null, title: "" });

    // The installed plugin's details, opened from its card, keep Installed plugins current.
    settingsPage("Installed plugins", "<h1>Bookmarks</h1><section><h2>Overview</h2></section>", "/settings/plugins/bookmarks");
    expect(findSettingsPage(document)).toMatchObject({ name: "Bookmarks", parent: "Installed plugins", title: "" });

    // Other pages without a current entry stay unnamed.
    for (const path of ["/settings/plugins/bookmarks/extra", "/settings/machines/host_1"]) {
      pluginPage(path);
      expect(findSettingsPage(document)).toBeNull();
    }
  });

  it("keeps General's title at /settings/general and with a trailing slash", () => {
    for (const path of ["/settings/general", "/settings/"]) {
      settingsPage("General", undefined, path);
      expect(findSettingsPage(document)).toMatchObject({ name: "General", parent: null, title: "General" });
    }

    machinePage();
    history.replaceState(null, "", "/settings/machines/host_1/");
    expect(findSettingsPage(document)).toMatchObject({ name: "MacBook Pro", parent: "Machines", title: "" });
  });

  it("ignores pages outside the settings layout", () => {
    threadPage();
    expect(findSettingsPage(document)).toBeNull();
  });

  it("ignores the settings layout once the address leaves settings", () => {
    settingsPage("General", undefined, "/");
    expect(findSettingsPage(document)).toBeNull();
  });
});

describe("repeatsTitle", () => {
  it("matches the title, and as the only heading its longer or plural forms", () => {
    expect(repeatsTitle("Machines", "Machines", false)).toBe(true);
    expect(repeatsTitle("Keyboard shortcuts", "Keyboard", true)).toBe(true);
    expect(repeatsTitle("Browsers", "Browser", true)).toBe(true);
    expect(repeatsTitle("Keyboard shortcuts", "Keyboard", false)).toBe(false);
    expect(repeatsTitle("Keyboards2", "Keyboard", true)).toBe(false);
    expect(repeatsTitle("Machine access", "Machines", true)).toBe(false);
  });
});

describe("watchSettingsTitle", () => {
  it("labels the settings page while San Francisco is active", async () => {
    theme(true);
    const { header, column } = settingsPage();
    disposers.push(watchSettingsTitle(document));
    await frame();
    expect(header.getAttribute(PAGE_ATTRIBUTE)).toBe("General");
    expect(header.hasAttribute(PARENT_ATTRIBUTE)).toBe(false);
    expect(column.getAttribute(TITLE_ATTRIBUTE)).toBe("General");
    expect(document.querySelector(`[${DUPLICATE_ATTRIBUTE}]`)).toBeNull();
  });

  it("follows navigation between settings pages, into a detail page and out of settings", async () => {
    theme(true);
    settingsPage();
    disposers.push(watchSettingsTitle(document));
    await frame();

    const { header, heading } = settingsPage("Machines", "<section><div><div><div><h2>Machines</h2></div></div></div></section>");
    await frame();
    await frame();
    expect(header.getAttribute(PAGE_ATTRIBUTE)).toBe("Machines");
    expect(heading?.getAttribute(DUPLICATE_ATTRIBUTE)).toBe("");

    const detail = machinePage();
    await frame();
    await frame();
    expect(detail.header.getAttribute(PAGE_ATTRIBUTE)).toBe("MacBook Pro");
    expect(detail.header.getAttribute(PARENT_ATTRIBUTE)).toBe("Machines");
    expect(detail.column.getAttribute(TITLE_ATTRIBUTE)).toBe("");
    expect(detail.heading?.hasAttribute(DUPLICATE_ATTRIBUTE)).toBe(false);

    const back = settingsPage("Appearance");
    await frame();
    await frame();
    expect(back.header.getAttribute(PAGE_ATTRIBUTE)).toBe("Appearance");
    expect(back.header.hasAttribute(PARENT_ATTRIBUTE)).toBe(false);

    threadPage();
    await frame();
    await frame();
    expect(document.querySelector(
      [PAGE_ATTRIBUTE, PARENT_ATTRIBUTE, TITLE_ATTRIBUTE, DUPLICATE_ATTRIBUTE].map((name) => `[${name}]`).join(", "),
    )).toBeNull();
  });

  it("does nothing under another theme and reacts when San Francisco is chosen", async () => {
    const style = theme(false);
    const { header } = settingsPage();
    disposers.push(watchSettingsTitle(document));
    await frame();
    expect(isThemeActive(document)).toBe(false);
    expect(header.hasAttribute(PAGE_ATTRIBUTE)).toBe(false);

    style.textContent = ":root { --sf-accent: #62ba46; }";
    await frame();
    await frame();
    expect(header.getAttribute(PAGE_ATTRIBUTE)).toBe("General");

    style.textContent = "";
    await frame();
    await frame();
    expect(header.hasAttribute(PAGE_ATTRIBUTE)).toBe(false);
  });

  it("skips animation frames for thread updates and still notices Settings navigation", async () => {
    theme(true);
    history.replaceState(null, "", "/projects/project/threads/thread");
    threadPage();
    disposers.push(watchSettingsTitle(document));
    const frames = vi.spyOn(window, "requestAnimationFrame");
    const styles = vi.spyOn(window, "getComputedStyle");

    document.querySelector("main main")!.append(document.createElement("p"));
    await Promise.resolve();
    expect(frames).not.toHaveBeenCalled();
    expect(styles).not.toHaveBeenCalled();
    frames.mockRestore();
    styles.mockRestore();

    const { header } = settingsPage("Appearance");
    await frame();
    await frame();
    expect(header.getAttribute(PAGE_ATTRIBUTE)).toBe("Appearance");
  });

  it("clears a marked settings page when navigation leaves its DOM mounted", async () => {
    theme(true);
    const { header, column, heading } = settingsPage("Machines", "<section><h2>Machines</h2></section>");
    disposers.push(watchSettingsTitle(document));
    await frame();
    expect(header.getAttribute(PAGE_ATTRIBUTE)).toBe("Machines");
    expect(heading?.hasAttribute(DUPLICATE_ATTRIBUTE)).toBe(true);

    history.replaceState(null, "", "/projects/project/threads/thread");
    column.append(document.createElement("p"));
    await frame();
    await frame();
    expect(header.hasAttribute(PAGE_ATTRIBUTE)).toBe(false);
    expect(column.hasAttribute(TITLE_ATTRIBUTE)).toBe(false);
    expect(heading?.hasAttribute(DUPLICATE_ATTRIBUTE)).toBe(false);
  });

  it("follows theme insertion, replacement, text edits and removal", async () => {
    const { header } = settingsPage();
    disposers.push(watchSettingsTitle(document));
    await frame();
    expect(header.hasAttribute(PAGE_ATTRIBUTE)).toBe(false);

    const original = theme(true);
    await frame();
    expect(header.getAttribute(PAGE_ATTRIBUTE)).toBe("General");

    const replacement = document.createElement("style");
    replacement.id = "bb-app-theme";
    replacement.append(document.createTextNode(":root { --other-theme: blue; }"));
    original.replaceWith(replacement);
    await frame();
    expect(header.hasAttribute(PAGE_ATTRIBUTE)).toBe(false);

    replacement.firstChild!.nodeValue = ":root { --sf-accent: #007aff; }";
    await frame();
    expect(header.getAttribute(PAGE_ATTRIBUTE)).toBe("General");

    replacement.remove();
    await frame();
    expect(header.hasAttribute(PAGE_ATTRIBUTE)).toBe(false);
  });

  it("removes every attribute on abort and disposes once", async () => {
    theme(true);
    const { header, column, heading } = settingsPage("Machines", "<section><h2>Machines</h2></section>");
    const controller = new AbortController();
    const dispose = watchSettingsTitle(document, controller.signal);
    await frame();
    expect(heading?.getAttribute(DUPLICATE_ATTRIBUTE)).toBe("");
    controller.abort();
    expect(header.hasAttribute(PAGE_ATTRIBUTE)).toBe(false);
    expect(column.hasAttribute(TITLE_ATTRIBUTE)).toBe(false);
    expect(heading?.hasAttribute(DUPLICATE_ATTRIBUTE)).toBe(false);
    expect(() => dispose()).not.toThrow();

    const detail = machinePage();
    const again = new AbortController();
    watchSettingsTitle(document, again.signal);
    await frame();
    expect(detail.header.getAttribute(PARENT_ATTRIBUTE)).toBe("Machines");
    again.abort();
    expect(detail.header.hasAttribute(PARENT_ATTRIBUTE)).toBe(false);

    settingsPage("Appearance");
    await frame();
    expect(document.querySelector(`[${PAGE_ATTRIBUTE}]`)).toBeNull();
  });

  it("does nothing when its signal is already aborted", async () => {
    const style = theme(true);
    const { header } = settingsPage();
    const controller = new AbortController();
    controller.abort();
    watchSettingsTitle(document, controller.signal);
    await frame();
    style.textContent = ":root { --sf-accent: #62ba46; }";
    await frame();
    await frame();
    expect(header.hasAttribute(PAGE_ATTRIBUTE)).toBe(false);
  });

  it("skips document title changes", async () => {
    theme(true);
    const title = document.createElement("title");
    title.textContent = "bb";
    document.head.append(title);
    disposers.push(watchSettingsTitle(document));
    const styles = vi.spyOn(window, "getComputedStyle");
    title.textContent = "(1) bb";
    title.firstChild!.nodeValue = "(2) bb";
    await frame();
    expect(styles).not.toHaveBeenCalled();
    styles.mockRestore();
  });

  it("ignores unrelated head styles and preloads outside Settings without reading style or menu geometry", async () => {
    theme(true);
    history.replaceState(null, "", "/projects/project/threads/thread");
    threadPage();
    const column = document.querySelector("main main")!;
    column.innerHTML = '<button aria-controls="palette">Palette</button>';
    disposers.push(watchSettingsTitle(document));
    const menu = document.createElement("div");
    menu.setAttribute("data-radix-popper-content-wrapper", "");
    menu.innerHTML = '<div id="palette"></div>';
    document.body.append(menu);
    await frame();
    await frame();

    const styles = vi.spyOn(window, "getComputedStyle");
    const geometry = vi.spyOn(column.querySelector("button")!, "getBoundingClientRect");
    const frames = vi.spyOn(window, "requestAnimationFrame");
    const unrelated = document.createElement("style");
    unrelated.textContent = ".other-plugin { color: red; }";
    const preload = document.createElement("link");
    preload.rel = "modulepreload";
    preload.href = "/assets/another-route.js";
    document.head.append(unrelated, preload);
    await Promise.resolve();
    unrelated.textContent = ".other-plugin { color: blue; }";
    await Promise.resolve();
    unrelated.remove();
    preload.remove();
    await Promise.resolve();

    expect(styles).not.toHaveBeenCalled();
    expect(geometry).not.toHaveBeenCalled();
    expect(frames).not.toHaveBeenCalled();
  });

  it("tracks a menu trigger moved by another stylesheet before a palette preview", async () => {
    const style = theme(true);
    const { column } = settingsPage("Appearance", '<button aria-controls="palette">Palette</button>');
    const trigger = column.querySelector("button")!;
    let shift = { x: 0, y: 0 };
    // jsdom has no layout; model the stylesheet's movement and our translation.
    trigger.getBoundingClientRect = () => {
      const [x, y] = [...column.style.translate.split(" "), ""].map((value) => parseFloat(value) || 0);
      return new DOMRect(100 + shift.x + x, 100 + shift.y + y, 120, 28);
    };
    disposers.push(watchSettingsTitle(document));
    const menu = document.createElement("div");
    menu.setAttribute("data-radix-popper-content-wrapper", "");
    menu.style.transform = "translate(100px, 128px)";
    menu.innerHTML = '<div id="palette" data-side="bottom" data-align="end"></div>';
    document.body.append(menu);
    await frame();
    await frame();

    const styles = vi.spyOn(window, "getComputedStyle");
    const unrelated = document.createElement("style");
    unrelated.textContent = ".column { margin-left: 50px; margin-top: 20px; }";
    shift = { x: 50, y: 20 };
    document.head.append(unrelated);
    await Promise.resolve();
    expect(styles).not.toHaveBeenCalled();
    styles.mockRestore();

    // Previewing another palette moves the trigger by (3, -53). Hold it at
    // the position after the stylesheet arrived, rather than its first position.
    shift = { x: 53, y: -33 };
    style.textContent = "";
    await frame();
    expect(column.style.translate).toBe("-3px 53px");
  });

  it("pins open menus where they were while a palette preview swaps the theme", async () => {
    const style = theme(true);
    settingsPage("Appearance");
    const menu = document.createElement("div");
    menu.setAttribute("data-radix-popper-content-wrapper", "");
    menu.style.transform = "translate(1024px, 361px)";
    document.body.append(menu);
    const parked = document.createElement("div");
    parked.setAttribute("data-radix-popper-content-wrapper", "");
    parked.style.transform = "translate(0, -200%)";
    document.body.append(parked);
    disposers.push(watchSettingsTitle(document));
    await frame();
    expect(menu.hasAttribute(PINNED_ATTRIBUTE)).toBe(false);

    // Hovering Nord previews it: the theme leaves and Radix will follow the moved trigger.
    style.textContent = "";
    await frame();
    menu.style.transform = "translate(1037px, 308px)";
    expect(menu.hasAttribute(PINNED_ATTRIBUTE)).toBe(true);
    expect(menu.style.getPropertyValue("--sf-pinned")).toBe("translate(1024px, 361px)");
    expect(parked.hasAttribute(PINNED_ATTRIBUTE)).toBe(false);
    expect([...document.head.querySelectorAll("style")].some((element) =>
      element.textContent?.includes(`[${PINNED_ATTRIBUTE}] { transform: var(--sf-pinned) !important; }`))).toBe(true);

    // Back on San Francisco the menu keeps its first position.
    style.textContent = ":root { --sf-accent: #007aff; }";
    await frame();
    expect(menu.style.getPropertyValue("--sf-pinned")).toBe("translate(1024px, 361px)");
  });

  it("holds the column under an open menu so its trigger stays put while a palette preview swaps the theme", async () => {
    const style = theme(true);
    const { column } = settingsPage("Appearance", '<button aria-haspopup="menu" aria-controls="palette">San Francisco</button>');
    const trigger = column.querySelector("button")!;
    // jsdom has no layout: without San Francisco the page loses its title and some inset.
    let shift = { x: 0, y: 0 };
    trigger.getBoundingClientRect = () => {
      const [x, y] = [...column.style.translate.split(" "), ""].map((value) => parseFloat(value) || 0);
      return new DOMRect(1131 + shift.x + x, 329 + shift.y + y, 129, 28);
    };
    disposers.push(watchSettingsTitle(document));
    const menu = document.createElement("div");
    menu.setAttribute("data-radix-popper-content-wrapper", "");
    menu.style.transform = "translate(1030px, 361px)";
    menu.innerHTML = '<div id="palette" data-side="bottom" data-align="end"></div>';
    document.body.append(menu);
    await frame();
    await frame();

    // Hovering Nord previews it; the trigger's bottom right corner stays where it was.
    shift = { x: 3, y: -53 };
    style.textContent = "";
    await frame();
    expect(column.style.translate).toBe("-3px 53px");
    expect(menu.hasAttribute(PINNED_ATTRIBUTE)).toBe(false);

    shift = { x: 0, y: 0 };
    style.textContent = ":root { --sf-accent: #007aff; }";
    await frame();
    expect(column.style.translate).toBe("");

    // A narrower window moves the trigger, and Radix the menu with it; a
    // preview then holds the trigger at its new place.
    shift = { x: -100, y: 0 };
    window.dispatchEvent(new Event("resize"));
    shift = { x: -97, y: -53 };
    style.textContent = "";
    await frame();
    expect(column.style.translate).toBe("-3px 53px");

    // Closing the menu during a preview lets the page take its layout.
    menu.remove();
    await frame();
    expect(column.style.translate).toBe("");
  });

  it("leaves menus alone while the theme stays", async () => {
    const style = theme(true);
    const menu = document.createElement("div");
    menu.setAttribute("data-radix-popper-content-wrapper", "");
    menu.style.transform = "translate(10px, 20px)";
    document.body.append(menu);
    const dispose = watchSettingsTitle(document);
    style.textContent = ":root { --sf-accent: #62ba46; }";
    await frame();
    expect(menu.hasAttribute(PINNED_ATTRIBUTE)).toBe(false);

    style.textContent = "";
    await frame();
    expect(menu.hasAttribute(PINNED_ATTRIBUTE)).toBe(true);
    dispose();
    expect(menu.hasAttribute(PINNED_ATTRIBUTE)).toBe(false);
    expect(menu.style.getPropertyValue("--sf-pinned")).toBe("");
    expect(document.head.querySelectorAll("style")).toHaveLength(1);
  });
});
