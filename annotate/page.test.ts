// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installPage, type PageState } from "./page";
import type { PageMessage } from "./shared";

const scope = globalThis as unknown as {
  __bbAnnotate?: { sync(state: Partial<PageState>): void; root: ShadowRoot };
};
let messages: PageMessage[];
let target: HTMLElement;

beforeEach(() => {
  // jsdom has no layout: every element hits, and CSS.escape is missing.
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  document.body.innerHTML =
    '<main><p>Intro</p><button class="primary" type="submit">Save</button></main>';
  target = document.querySelector("button")!;
  document.elementFromPoint = () => target;
  messages = [];
  installPage({ postMessage: (data) => messages.push(data as PageMessage) });
});

afterEach(() => {
  document.querySelector("bb-annotate")?.remove();
  delete scope.__bbAnnotate;
  vi.unstubAllGlobals();
});

const page = () => scope.__bbAnnotate!;
const find = <E extends Element = HTMLElement>(selector: string) =>
  page().root.querySelector<E>(selector)!;
const pick = () => {
  find(".shield").dispatchEvent(
    new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 5 }),
  );
};
const write = (comment: string) => {
  const input = find<HTMLTextAreaElement>("textarea");
  input.value = comment;
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
};

it("joins the page once, when it has something to show", () => {
  installPage({ postMessage: () => {} });
  expect(document.querySelector("bb-annotate")).toBe(null);
  page().sync({ picking: true });
  installPage({ postMessage: () => {} });
  expect(document.querySelectorAll("bb-annotate")).toHaveLength(1);
});

it("adds a note to the clicked element", () => {
  page().sync({ picking: true, next: 4 });
  pick();
  expect(find(".editor").classList.contains("open")).toBe(true);
  expect(find(".label").textContent).toBe('4 · button.primary "Save"');
  write("Make it blue");

  expect(find(".editor").classList.contains("open")).toBe(false);
  expect(messages).toEqual([
    {
      kind: "add",
      id: expect.stringMatching(/^n[a-z0-9]+$/),
      number: 4,
      comment: "Make it blue",
      url: location.href,
      title: document.title,
      element: expect.objectContaining({
        name: 'button.primary "Save"',
        selector: "body > main > button",
        text: "Save",
        attributes: { class: "primary", type: "submit" },
      }),
    },
  ]);
  expect(find(".pin").textContent).toBe("4");
  // One pick makes one note.
  expect(find(".shield").parentElement!.classList.contains("picking")).toBe(
    false,
  );
});

it("ends the pick when a new note is dropped", () => {
  page().sync({ picking: true });
  pick();
  find("textarea").dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(messages).toEqual([{ kind: "stop" }]);
  expect(find(".shield").parentElement!.classList.contains("picking")).toBe(
    false,
  );
});

it("sends the shortcut from the page, in any keyboard layout", () => {
  const shortcut = {
    key: "a",
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
    metaKey: true,
  };
  page().sync({ shortcut });
  const press = (init: KeyboardEventInit) =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  press({ key: "a", code: "KeyA", metaKey: true });
  expect(messages).toEqual([]);
  // On AZERTY, the key labelled Q sits where QWERTY has A.
  press({ key: "Q", code: "KeyA", metaKey: true, shiftKey: true });
  expect(messages).toEqual([]);
  press({ key: "Ф", code: "KeyA", metaKey: true, shiftKey: true });
  expect(messages).toEqual([{ kind: "toggle" }]);
  page().sync({ shortcut: null });
  press({ key: "A", code: "KeyA", metaKey: true, shiftKey: true });
  expect(messages).toHaveLength(1);
});

it("keeps an empty note from being added", () => {
  page().sync({ picking: true });
  pick();
  write("   ");
  expect(messages).toEqual([]);
  expect(find<HTMLButtonElement>(".save").disabled).toBe(true);
});

it("edits and deletes a note from its pin", () => {
  page().sync({
    pins: [
      { id: "nnote0001", number: 2, comment: "Old", selector: "main > button" },
    ],
  });
  find(".pin").click();
  expect(find<HTMLTextAreaElement>("textarea").value).toBe("Old");
  write("New");
  expect(messages).toEqual([{ kind: "edit", id: "nnote0001", comment: "New" }]);
  expect(find(".pin").title).toBe("New");

  find(".pin").click();
  find(".delete").click();
  expect(messages.at(-1)).toEqual({ kind: "delete", id: "nnote0001" });
  expect(page().root.querySelector(".pin")).toBe(null);
});

it("draws the pins it is given and drops the rest", () => {
  const pin = { number: 1, comment: "", selector: "main > button" };
  page().sync({
    pins: [
      { ...pin, id: "nnote0001" },
      { ...pin, id: "nnote0002" },
    ],
  });
  expect(page().root.querySelectorAll(".pin")).toHaveLength(2);
  page().sync({ pins: [{ ...pin, id: "nnote0002" }] });
  expect(page().root.querySelectorAll(".pin")).toHaveLength(1);
});

it("stops on Escape and keeps keys from the page", () => {
  const pageKeys = vi.fn();
  document.addEventListener("keydown", pageKeys);
  page().sync({ picking: true });
  find(".shield").dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      composed: true,
    }),
  );
  expect(messages).toEqual([{ kind: "stop" }]);
  expect(find(".shield").parentElement!.classList.contains("picking")).toBe(
    false,
  );
  expect(pageKeys).not.toHaveBeenCalled();
  document.removeEventListener("keydown", pageKeys);
});

it("closes a new note's editor when the picker turns off", () => {
  page().sync({ picking: true });
  pick();
  page().sync({ picking: false });
  expect(find(".editor").classList.contains("open")).toBe(false);
});

it("picks the parent after ↑ while the pointer stays on the element", () => {
  page().sync({ picking: true });
  const shield = find(".shield");
  const move = (x: number) =>
    shield.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: 5 }),
    );
  move(5);
  shield.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
  );
  move(6);
  pick();
  expect(find(".label").textContent).toBe('1 · main "IntroSave"');
});

it("puts the overlay back when the page removes it", () => {
  page().sync({ picking: true });
  document.querySelector("bb-annotate")!.remove();
  expect(page().sync({})).toBe(true);
  expect(document.querySelector("bb-annotate")).not.toBe(null);
});

it("keeps focus changes from the page", () => {
  const pageFocus = vi.fn();
  document.addEventListener("focusin", pageFocus);
  page().sync({ picking: true });
  pick();
  expect(page().root.activeElement).toBe(find("textarea"));
  expect(pageFocus).not.toHaveBeenCalled();
  document.removeEventListener("focusin", pageFocus);
});
