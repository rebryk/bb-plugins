// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handle, start, update } from "./controller";

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
  update({ settings: {}, bindings: [], threadActions: undefined });
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
  update({ settings: { threadShortcuts: false } });
  expect(pills()).toEqual([]);
});

const press = (key: string, code: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", { key, code, ...init });
const binding = (command: "palette.open" | "thread.search" | "thread.new", key: string) => ({
  command, desktopOnly: false, when: { all: [], none: [] },
  shortcut: { key, mod: false, control: true, meta: false, shift: false, alt: false },
});

it.each([
  ["р", "KeyH", "snooze"], ["h", "KeyH", "snooze"], ["י", "KeyH", "snooze"],
  ["ا", "KeyH", "snooze"], ["у", "KeyE", "archive"], ["e", "KeyE", "archive"],
  ["h", "", "snooze"],
] as const)("runs %s at %s using the physical key", (key, code, action) => {
  const actions = { snooze: vi.fn(), archive: vi.fn() };
  update({ threadActions: actions });
  expect(handle(press(key, code))).toBe(true);
  expect(actions[action]).toHaveBeenCalledOnce();
  expect(actions[action === "snooze" ? "archive" : "snooze"]).not.toHaveBeenCalled();
});

it("uses the number row even when the layout prints a letter there", () => {
  const model = document.querySelector('button[aria-label="Provider, model and reasoning"]')!;
  const choose = vi.fn();
  model.addEventListener("click", choose);
  expect(handle(press("é", "Digit2"))).toBe(true);
  expect(choose).toHaveBeenCalledOnce();
});

it("opens search from the slash position in Russian", () => {
  update({ bindings: [binding("thread.search", "f")] });
  const receive = vi.fn();
  document.body.addEventListener("keydown", receive, { once: true });
  expect(handle(press(".", "Slash"))).toBe(true);
  expect(receive).toHaveBeenCalledOnce();
  expect(receive.mock.calls[0]![0].key).toBe("f");
});

it("preserves typing, composition, repeats, modifiers, dialogs and disabled shortcuts", () => {
  const actions = { snooze: vi.fn(), archive: vi.fn() };
  update({ threadActions: actions });
  expect(handle(press("h", "KeyJ"))).toBe(false);
  for (const init of [
    { isComposing: true }, { repeat: true }, { ctrlKey: true }, { metaKey: true },
    { altKey: true }, { shiftKey: true }, { keyCode: 229 },
  ]) expect(handle(press("р", "KeyH", init))).toBe(false);
  for (const html of [
    "<input>", "<textarea></textarea>", '<div contenteditable="true"></div>',
    "<div data-app-terminal></div>", "<div data-app-browser></div>",
  ]) {
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    container.addEventListener("keydown", (event) => expect(handle(event)).toBe(false));
    container.firstElementChild!.dispatchEvent(press("р", "KeyH", { bubbles: true }));
    container.remove();
  }
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  expect(handle(press("р", "KeyH"))).toBe(false);
  dialog.remove();
  update({ settings: { threadShortcuts: false } });
  expect(handle(press("р", "KeyH"))).toBe(false);
  expect(actions.snooze).not.toHaveBeenCalled();
  expect(actions.archive).not.toHaveBeenCalled();
});

it("normalizes registered modifier shortcuts, preserving custom character bindings", () => {
  update({ bindings: [binding("palette.open", "k")] });
  const event = press("л", "KeyK", { ctrlKey: true });
  handle(event);
  expect(event.key).toBe("k");
  for (const init of [
    { key: "р", code: "KeyH", ctrlKey: true },
    { key: "л", code: "KeyK" },
    { key: "л", code: "KeyK", ctrlKey: true, isComposing: true },
  ]) {
    const event = new KeyboardEvent("keydown", init);
    handle(event);
    expect(event.key).toBe(init.key);
  }
  update({ bindings: [binding("palette.open", "k"), binding("thread.new", "л")] });
  const custom = press("л", "KeyK", { ctrlKey: true });
  handle(custom);
  expect(custom.key).toBe("л");
});
