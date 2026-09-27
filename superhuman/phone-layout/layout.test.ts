// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startPhoneLayout } from "./layout";
import { startPanelSlide } from "./slide";

// jsdom has no matchMedia; a test flips `matches` to leave the phone.
const phone = Object.assign(new EventTarget(), { matches: true });
let left = 0;

beforeEach(() => {
  phone.matches = true;
  left = 0;
  window.matchMedia = vi.fn(() => phone) as unknown as typeof window.matchMedia;
  document.body.innerHTML = `
    <main data-sidebar="inset"></main>
    <button data-testid="app-sidebar-trigger-overlay"></button>
    <div data-testid="secondary-panel-shelf"></div>`;
  const page = document.querySelector("main")!;
  page.getBoundingClientRect = () => ({ left }) as DOMRect;
  page.getAnimations = () => [];
});

afterEach(() => {
  document.body.replaceChildren();
});

const page = () => document.querySelector<HTMLElement>("main")!;
const button = () =>
  document.querySelector<HTMLElement>(
    '[data-testid="app-sidebar-trigger-overlay"]',
  )!;
const panel = () =>
  document.querySelector<HTMLElement>(
    '[data-testid="secondary-panel-shelf"]',
  )!;
const settle = () => new Promise((resolve) => setTimeout(resolve));

it("marks the page for app.css until it stops", () => {
  const stop = startPhoneLayout(document);
  expect(document.documentElement.dataset.phoneLayout).toBe("");
  stop();
  expect(document.documentElement.dataset.phoneLayout).toBeUndefined();
});

it("keeps the sidebar button on the page as the page moves", async () => {
  const stop = startPhoneLayout(document);
  expect(button().style.translate).toBe("0px");

  left = 240;
  page().style.translate = "240px";
  await settle();
  expect(button().style.translate).toBe("240px");

  phone.matches = false;
  phone.dispatchEvent(new Event("change"));
  expect(button().style.translate).toBe("");

  phone.matches = true;
  phone.dispatchEvent(new Event("change"));
  stop();
  expect(button().style.translate).toBe("");
});

it("slides the right panel out with the page on a phone only", async () => {
  const stop = startPanelSlide(document);
  document.dispatchEvent(new Event("touchstart"));

  page().style.transition = "translate 200ms";
  page().style.translate = "-120px";
  await settle();
  expect(panel().style.translate).toBe("calc(100% - 120px)");
  expect(panel().style.transition).toBe("translate 200ms");

  phone.matches = false;
  page().style.translate = "-60px";
  await settle();
  expect(panel().style.translate).toBe("");

  stop();
});
