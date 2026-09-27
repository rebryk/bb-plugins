// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { start, update } from "./controller";

// jsdom lays nothing out, and only phones and tablets match (pointer: coarse).
vi.stubGlobal("matchMedia", () => ({ matches: false }));
vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({
  length: 1,
} as DOMRectList);

let running: AbortController;
let stop: (() => void) | undefined;

beforeEach(() => {
  document.body.innerHTML = `
    <button aria-keyshortcuts="Shift+Meta+M">Switch model</button>
    <div data-promptbox-shell>
      <div contenteditable="true"></div>
      <button data-promptbox-project-control>Project</button>
      <button aria-label="Provider, model and reasoning">Model</button>
      <button aria-label="Machine">Machine</button>
      <button aria-label="Branch">Branch</button>
    </div>`;
  update({ settings: {} });
  running = new AbortController();
  stop = start({ signal: running.signal });
});

afterEach(() => {
  stop?.();
  running.abort();
});

/** Each control with a pill, and the pill's text. */
const pills = () =>
  [...document.querySelectorAll("[data-superhuman-key]")].map((element) => [
    element.textContent,
    element.getAttribute("data-superhuman-key"),
  ]);

it("numbers a new thread's setup controls unless thread shortcuts are off", () => {
  expect(pills()).toEqual([
    ["Project", "1"],
    ["Model", "2"],
    ["Machine", "3"],
    ["Branch", "4"],
  ]);
  update({ settings: { threadShortcuts: false } });
  expect(pills()).toEqual([]);
});

it("shows the remaining keys under a held modifier unless hints are off", () => {
  window.dispatchEvent(
    new KeyboardEvent("keyup", { key: "Shift", metaKey: true }),
  );
  expect(pills()).toEqual([["Switch model", "Shift + M"]]);
  update({ settings: { shortcutHints: false } });
  expect(pills()).toEqual([]);
});
