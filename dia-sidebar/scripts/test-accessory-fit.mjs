import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import ts from "typescript";

// Use real layout and the shipped CSS, including BB's CSS compilation step.
const css = await readFile(new URL("../dist/app.css", import.meta.url), "utf8");
const source = await readFile(new URL("../navigation.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.setContent(`
    <style>
      * { box-sizing: border-box; }
      [data-plugin-nav-sidebar-accessory] {
        position: absolute; top: 50%; right: 4px;
        --tw-translate-x: 0px; --tw-translate-y: -50%;
        translate: var(--tw-translate-x) var(--tw-translate-y);
        min-width: 20px; max-width: 64px; max-height: 20px;
        overflow: hidden; font-size: 12px; line-height: 20px;
      }
      [data-bb-plugin-root] { display: contents; }
    </style>
    <div class="dia-sidebar" data-dia-sidebar>
      <div data-testid="plugin-nav-sidebar-items"></div>
    </div>`);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({
    type: "module",
    content: `${outputText}\nwindow.disposeFit = enhanceNavigation(document.querySelector("[data-dia-sidebar]"));`,
  });
  await page.waitForFunction(() => typeof window.disposeFit === "function");

  // Late mounts use several independent plugin shapes, not a mock badge API.
  await page.evaluate(() => {
    const shapes = {
      small: '<span style="width:8px;height:8px;border-radius:50%;background:green"></span>',
      dot: '<span style="width:16px;height:16px;border-radius:50%;background:orange"></span>',
      count: '<span style="width:72px;height:18px;background:lightblue">123456</span>',
      tall: '<span style="width:10px;height:80px;background:purple"></span>',
      svg: '<svg width="96" height="64" viewBox="0 0 96 64"><path d="M0 32h90L60 2m30 30L60 62" fill="none" stroke="blue" stroke-width="4"/></svg>',
      group: '<span style="width:9px;height:9px;background:green"></span><span style="width:24px;height:16px;background:lightblue">99</span>',
    };
    const nav = document.querySelector('[data-testid="plugin-nav-sidebar-items"]');
    nav.innerHTML = Object.entries(shapes).map(([id, shape]) => `
      <div data-sidebar-navigation-item="${id}">
        <button><svg></svg><span>${id}</span></button>
        <span data-plugin-nav-sidebar-accessory>
          <div data-bb-plugin-root>${shape}</div>
        </span>
      </div>`).join("");
    window.originalCount = nav.querySelector('[data-sidebar-navigation-item="count"] [data-bb-plugin-root]');
    window.originalChild = window.originalCount.firstElementChild;
    window.initialTiles = [...nav.children].map((tile) => tile.getBoundingClientRect().toJSON());
  });

  async function geometry() {
    await page.waitForFunction(() =>
      [...document.querySelectorAll("[data-bb-plugin-root]")].every((node) =>
        Number(node.style.getPropertyValue("--dia-sidebar-accessory-scale")) > 0));
    return page.locator("[data-plugin-nav-sidebar-accessory]").evaluateAll((viewports) =>
      viewports.map((viewport) => {
        const content = viewport.firstElementChild;
        return {
          id: viewport.parentElement.dataset.sidebarNavigationItem,
          tile: viewport.parentElement.getBoundingClientRect().toJSON(),
          viewport: viewport.getBoundingClientRect().toJSON(),
          content: content.getBoundingClientRect().toJSON(),
          children: [...content.children].map((child) => child.getBoundingClientRect().toJSON()),
          scale: Number(content.style.getPropertyValue("--dia-sidebar-accessory-scale")),
          overflow: getComputedStyle(viewport).overflow,
          contain: getComputedStyle(viewport).contain,
        };
      }));
  }

  function assertContained(items, width = 20, height = 12) {
    for (const item of items) {
      assert.equal(item.viewport.width, width, item.id);
      assert.equal(item.viewport.height, height, item.id);
      assert.equal(item.tile.right - item.viewport.right, 2, item.id);
      assert.equal(item.tile.bottom - item.viewport.bottom, 2, item.id);
      assert(item.scale > 0 && item.scale <= 1, item.id);
      assert.equal(item.overflow, "hidden");
      assert(item.contain.includes("paint"));
      for (const rect of [item.content, ...item.children]) {
        assert(rect.left >= item.viewport.left - 0.05, item.id);
        assert(rect.top >= item.viewport.top - 0.05, item.id);
        assert(rect.right <= item.viewport.right + 0.05, item.id);
        assert(rect.bottom <= item.viewport.bottom + 0.05, item.id);
      }
    }
  }

  const initial = await geometry();
  assertContained(initial);
  assert.equal(initial.find((item) => item.id === "small").scale, 1);
  const arrow = initial.find((item) => item.id === "svg").content;
  assert(Math.abs(arrow.width / arrow.height - 96 / 64) < 0.01);

  // Real content updates retain the original node and need no plugin-specific handling.
  await page.evaluate(() => {
    window.originalChild.style.width = "180px";
    window.originalChild.textContent = "123456789";
  });
  await page.waitForFunction(() =>
    window.originalCount.getBoundingClientRect().width <= 20.05);
  assertContained(await geometry());
  assert(await page.evaluate(() =>
    window.originalCount.firstElementChild === window.originalChild &&
    JSON.stringify([...document.querySelector('[data-testid="plugin-nav-sidebar-items"]').children]
      .map((tile) => tile.getBoundingClientRect().toJSON())) === JSON.stringify(window.initialTiles)));

  // Changes to the allotted area are also observed.
  await page.locator("[data-dia-sidebar]").evaluate((root) => {
    root.style.setProperty("--dia-sidebar-accessory-width", "14px");
    root.style.setProperty("--dia-sidebar-accessory-height", "10px");
  });
  await page.waitForFunction(() => window.originalCount.getBoundingClientRect().width <= 14.05);
  assertContained(await geometry(), 14, 10);

  // Detached React roots are released; unmount stops all future writes.
  await page.evaluate(() => window.originalCount.parentElement.parentElement.remove());
  await page.waitForFunction(() =>
    !window.originalCount.style.getPropertyValue("--dia-sidebar-accessory-scale"));
  await page.evaluate(() => {
    window.disposeFit();
    document.querySelector("[data-bb-plugin-root]").firstElementChild.style.width = "300px";
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert(await page.locator("[data-bb-plugin-root]").evaluateAll((nodes) =>
    nodes.every((node) => !node.style.getPropertyValue("--dia-sidebar-accessory-scale"))));
  assert.deepEqual(errors, []);
  console.log("Accessory layout passed: shapes, aspect ratio, live updates, containment and cleanup.");
} finally {
  await browser.close();
}
