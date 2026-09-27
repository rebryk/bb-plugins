// Checks the theme and this checkout's built frontend against the running bb's
// real markup, which is not a versioned API. Both are served to this headless
// page only; the selected bb theme and the installed plugin do not change, and
// the page's own writes are dropped.
// Usage: npm run build && npm run test:browser [-- <bb url>]
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { chromium } from "playwright-core";
import ts from "typescript";

async function serverUrl() {
  if (process.argv[2]) return process.argv[2].replace(/\/$/, "");
  const runtime = JSON.parse(await readFile(`${homedir()}/.bb/bb-app-runtime.json`, "utf8"));
  return runtime.serverUrl;
}

const dist = new URL("../dist/", import.meta.url);
if (!existsSync(new URL("app.js", dist))) {
  console.error("dist/app.js is missing: run npm run build first");
  process.exit(1);
}

const base = await serverUrl();
const css = await readFile(new URL("../themes/san-francisco.css", import.meta.url), "utf8");
const source = await readFile(new URL("../settings-title.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});

// System Chrome when installed, else Playwright's own Chromium build.
const channel = existsSync("/Applications/Google Chrome.app") ? "chrome" : "chromium";
const browser = await chromium.launch({ channel, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/api/v1/system/config", async (route) => {
  const response = await route.fetch();
  const json = await response.json();
  json.appearance = { ...json.appearance, themeId: "plugin:san-francisco:san-francisco", customCss: css };
  await route.fulfill({ response, json });
});
// An installed San Francisco loads this checkout's dist/ in place of its own build.
const ASSETS = "/api/v1/plugin-app-assets/check-live/";
let installed = false;
await page.route("**/api/v1/plugins", async (route) => {
  const response = await route.fetch();
  const json = await response.json();
  const plugin = json.plugins?.find((plugin) => plugin.id === "san-francisco");
  if (plugin?.app?.bundle) {
    installed = true;
    plugin.app.bundle = { ...plugin.app.bundle, jsUrl: `${ASSETS}app.js`, cssUrl: `${ASSETS}app.css`, hash: "check-live" };
  }
  await route.fulfill({ response, json });
});
await page.route(`**${ASSETS}*`, async (route) => {
  const file = new URL(route.request().url()).pathname.endsWith(".css") ? "app.css" : "app.js";
  const body = existsSync(new URL(file, dist)) ? await readFile(new URL(file, dist), "utf8") : "";
  await route.fulfill({ contentType: file.endsWith(".css") ? "text/css" : "text/javascript", body });
});
// Registered last, so it runs first: reads pass, writes never reach bb.
await page.route("**/api/**", (route) =>
  ["GET", "HEAD"].includes(route.request().method()) ? route.fallback() : route.fulfill({ status: 204, body: "" }),
);

const style = (selector, properties) => page.evaluate(({ selector, properties }) => {
  const element = document.querySelector(selector);
  if (!element) return null;
  const computed = getComputedStyle(element);
  return Object.fromEntries(properties.map((property) => [property, computed.getPropertyValue(property)]));
}, { selector, properties });
const box = (selector) => page.evaluate((selector) => {
  const rect = document.querySelector(selector)?.getBoundingClientRect();
  return rect ? { width: rect.width, height: rect.height } : null;
}, selector);
async function accent(id) {
  await page.evaluate((id) => {
    if (id) document.documentElement.setAttribute("data-sf-accent", id);
    else document.documentElement.removeAttribute("data-sf-accent");
  }, id);
  await page.waitForTimeout(400); // Switches animate their color.
}
async function open(trigger, content) {
  await page.click(trigger);
  await page.waitForSelector(content);
  await page.waitForTimeout(300); // Menus animate in.
}
async function close() {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

try {
  await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  // Without the installed plugin, run the shipped content script here.
  if (!(await page.$("[data-sf-page]"))) {
    await page.addScriptTag({ type: "module", content: `${outputText}\nwatchSettingsTitle(document);` });
    await page.waitForTimeout(300);
  }

  assert.deepEqual(
    await style('[data-testid="app-layout-root"] > main[data-sidebar="inset"]', ["margin-top", "border-top-left-radius"]),
    { "margin-top": "6px", "border-top-left-radius": "14px" },
    "the content area floats as a card",
  );
  assert.equal((await style('[data-side="left"] > [data-sidebar="panel"]', ["border-right-color"]))?.["border-right-color"], "rgba(0, 0, 0, 0)", "the sidebar has no seam");
  assert.equal(await page.$eval('[data-testid$="-sidebar-top-reserve-row"]', (row) => getComputedStyle(row).display), "none", "the sidebar starts at the top, without its top row");
  const toggleInHeader = () => page.evaluate(() => {
    const main = document.querySelector('main[data-sidebar="inset"]');
    const card = main?.getBoundingClientRect();
    const header = main?.querySelector("header")?.getBoundingClientRect();
    const toggle = document.querySelector('[data-testid="app-sidebar-trigger-overlay"] [data-sidebar="trigger"]')?.getBoundingClientRect();
    const title = document.querySelector('[data-testid="app-page-header-content-row"] > :first-child')?.getBoundingClientRect();
    if (!card || !header || !toggle || !title) return null;
    return {
      middle: toggle.top + toggle.height / 2 - (header.top + header.height / 2),
      inset: toggle.left - card.left - parseFloat(getComputedStyle(main).borderLeftWidth),
      gap: title.left - toggle.right,
    };
  });
  const inHeader = { middle: 0, inset: 16, gap: 8 };
  assert.deepEqual(await toggleInHeader(), inHeader, "the sidebar toggle starts the card's header, before the title");
  await page.click('[data-testid="app-sidebar-trigger-overlay"] [data-sidebar="trigger"]');
  await page.waitForTimeout(500);
  assert.deepEqual(await toggleInHeader(), inHeader, "the toggle keeps its place with the sidebar collapsed");
  await page.click('[data-testid="app-sidebar-trigger-overlay"] [data-sidebar="trigger"]');
  await page.waitForTimeout(500);
  assert.equal(await page.getAttribute("[data-sf-page]", "data-sf-page"), "General", "breadcrumb names the page");
  assert.equal(await page.getAttribute("[data-sf-page-title]", "data-sf-page-title"), "General", "large title names the page");
  assert.equal((await style('main[data-sidebar="inset"] section h2', ["text-transform"]))?.["text-transform"], "uppercase", "section headings are small caps");
  assert.ok(parseFloat((await style('[data-control-placement] button[aria-haspopup="menu"]', ["width"]))?.width) < 144, "selects size to their text, under bb's 144 px");

  const checked = 'button[role="switch"][data-state="checked"]';
  await accent(null); // An installed San Francisco marks its configured accent.
  assert.equal((await style(checked, ["background-color"]))?.["background-color"], "rgb(0, 122, 255)", "switches use the default Blue accent");
  await accent("pink");
  assert.equal((await style(checked, ["background-color"]))?.["background-color"], "rgb(247, 79, 158)", "switches follow the accent attribute");

  if (installed) {
    await page.goto(`${base}/settings/plugins/san-francisco`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-sf-accent-picker]");
    await page.waitForTimeout(500);
    assert.equal(await page.getAttribute("[data-sf-page]", "data-sf-page"), "San Francisco", "a plugin's page is named in the breadcrumb");
    assert.equal(await page.locator('[data-sf-accent-picker] [role="radio"]').count(), 8, "the accent is picked from eight swatches");
    assert.equal(await page.locator('[data-sf-accent-picker] [role="radio"][aria-checked="true"]').count(), 1, "one swatch shows the saved accent");
    // isVisible() is false for a missing select too, so first make sure bb renders it.
    const select = page.locator('[data-testid="plugin-detail-san-francisco"] button[aria-label="Accent color"]');
    assert.equal(await select.count(), 1, "bb still renders its Accent color select");
    assert.equal(await select.isVisible(), false, "the swatches stand in for bb's Accent color select");
  } else {
    console.log("San Francisco is not installed in this bb: skipped the accent swatches");
  }

  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  assert.equal((await style("form[data-promptbox]", ["border-top-left-radius"]))?.["border-top-left-radius"], "18px", "the composer is rounded");
  assert.deepEqual(
    await style("[data-promptbox-submit-action]", ["width", "height", "border-top-left-radius"]),
    { width: "30px", height: "30px", "border-top-left-radius": "50%" },
    "send is a round button",
  );
  assert.match((await style("body", ["font-family"]))?.["font-family"] ?? "", /^-apple-system/, "the UI uses the system font");

  // Menus: compact 26 px rows in 12.5 px text on a 4 px inset.
  const menu = '[data-radix-menu-content][role="menu"]';
  await open('button[aria-label="Prompt actions"]', menu);
  assert.deepEqual(await style(menu, ["padding", "border-top-left-radius"]), { padding: "4px", "border-top-left-radius": "10px" }, "menus sit on a 4 px inset");
  assert.equal((await box(`${menu} [role="menuitem"]`))?.height, 26, "menu rows are 26 px");
  assert.deepEqual(await style(`${menu} [role="menuitem"]`, ["padding", "font-size"]), { padding: "4px 8px", "font-size": "12.5px" }, "menu rows are compact");
  assert.equal((await style(`${menu} [role="separator"]`, ["margin"]))?.margin, "4px -4px", "separators run edge to edge");
  await close();

  // Options with a description keep a 4 px top and bottom and align to the top.
  await open('button[aria-label="Permission mode"]', menu);
  assert.deepEqual(
    await style(`${menu} .px-2.text-xs.font-medium.text-muted-foreground:not([role])`, ["padding", "font-weight"]),
    { padding: "6px 8px 4px", "font-weight": "500" },
    "menu group labels take the row inset",
  );
  assert.deepEqual(
    await style(`${menu} [role^="menuitem"]:has(.block + .block)`, ["padding", "align-items"]),
    { padding: "4px 8px", "align-items": "flex-start" },
    "described options are padded and top-aligned",
  );
  await close();

  // The model picker's Reasoning control is a segmented track.
  await open('button[aria-label^="Provider, model and reasoning"]', '[role="radiogroup"][aria-label="Reasoning"]');
  assert.equal((await style('[data-radix-popper-content-wrapper] > [role="dialog"]', ["width"]))?.width, "352px", "the model picker is 352 px wide");
  const reasoning = '[role="radiogroup"][aria-label="Reasoning"]';
  assert.deepEqual(
    await style(reasoning, ["padding", "border-top-left-radius", "height"]),
    { padding: "2px", "border-top-left-radius": "8px", height: "28px" },
    "the reasoning track is a 28 px plate",
  );
  assert.notEqual((await style(reasoning, ["background-color"]))?.["background-color"], "rgba(0, 0, 0, 0)", "the reasoning track is tinted");
  const on = `${reasoning} > [role="radio"][data-state="on"]`;
  assert.deepEqual(
    await style(on, ["height", "background-color", "border-top-left-radius"]),
    { height: "24px", "background-color": "rgb(255, 255, 255)", "border-top-left-radius": "6px" },
    "the chosen reasoning level is a white 24 px segment",
  );
  assert.notEqual((await style(on, ["box-shadow"]))?.["box-shadow"], "none", "the chosen segment is raised");
  const segments = await page.evaluate((reasoning) => {
    const track = document.querySelector(reasoning);
    const computed = getComputedStyle(track);
    const buttons = [...track.querySelectorAll(':scope > [role="radio"]')];
    return {
      track: track.clientWidth - parseFloat(computed.paddingLeft) - parseFloat(computed.paddingRight),
      filled: buttons.reduce((sum, button) => sum + button.getBoundingClientRect().width, 0) + parseFloat(computed.columnGap) * (buttons.length - 1),
      off: buttons.filter((button) => button.dataset.state !== "on").map((button) => getComputedStyle(button).backgroundColor),
    };
  }, reasoning);
  assert.ok(Math.abs(segments.track - segments.filled) <= 1, `the segments fill the track (${segments.filled} of ${segments.track} px)`);
  assert.ok(segments.off.length > 0 && segments.off.every((color) => color === "rgba(0, 0, 0, 0)"), "the other levels sit flat on the track");
  await close();

  // Customize sidebar's checkboxes: 16 px, filled with the accent, a white check.
  await open('[data-testid="sidebar-navigation-more-trigger"]', '[data-testid="sidebar-navigation-customize-trigger"]');
  await page.click('[data-testid="sidebar-navigation-customize-trigger"]');
  await page.waitForSelector("[data-plugin-nav-customize-checkbox]");
  await accent("pink");
  const box16 = { width: 16, height: 16 };
  const on16 = '[data-plugin-nav-customize-checkbox][data-state="checked"]';
  const off16 = '[data-plugin-nav-customize-checkbox][data-state="unchecked"]';
  assert.deepEqual(await box(on16), box16, "a checked box is 16 px");
  assert.equal((await style(on16, ["background-color"]))?.["background-color"], "rgb(247, 79, 158)", "a checked box fills with the accent");
  assert.ok((await box(`${on16} svg`))?.width >= 12, "the check mark is drawn at size");
  assert.deepEqual(await style(`${on16} svg path`, ["stroke", "visibility"]), { stroke: "rgb(255, 255, 255)", visibility: "visible" }, "the check mark is white on the accent");
  if (await page.$(off16)) {
    assert.deepEqual(await box(off16), box16, "an unchecked box is 16 px");
    assert.equal((await style(off16, ["background-color"]))?.["background-color"], "rgba(0, 0, 0, 0)", "an unchecked box is empty");
  }

  // A new thread's send stays a circle once there is text, on a phone too,
  // where bb sizes the button by its padding.
  const send = 'form[data-promptbox] [data-promptbox-submit-action]:not([aria-label*="voice" i])';
  for (const [device, size] of [["desktop", "30px"], ["phone", "36px"]]) {
    if (device === "phone") {
      await page.setViewportSize({ width: 390, height: 844 });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    }
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.locator("form[data-promptbox] [contenteditable=true]").first().click();
    await page.keyboard.type("hello");
    await page.waitForTimeout(300);
    assert.deepEqual(
      await style(send, ["width", "height", "border-top-left-radius"]),
      { width: size, height: size, "border-top-left-radius": "50%" },
      `a new thread's send with text is a ${size} circle on a ${device}`,
    );
  }

  assert.deepEqual(errors, []);
  console.log("San Francisco matches the running bb");
} finally {
  await browser.close();
}
