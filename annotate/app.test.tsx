// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  ComposerMention,
  ExperimentalPluginBrowserToolbarActionProps,
  JsonValue,
} from "@get-bb/plugin-sdk/app";
import { PROVIDER, type Note } from "./shared";
import { pill, sampleNote } from "./test-fixtures";

let listeners: Set<(data: JsonValue) => void>;
let page: {
  evaluate: ReturnType<typeof vi.fn>;
  onMessage: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  listeners = new Set();
  page = {
    evaluate: vi.fn(async () => null),
    onMessage: vi.fn((listener: (data: JsonValue) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  // jsdom decodes no images; the screenshot step gives up quietly.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function setup({
  stored = [] as Note[],
  mentions = [] as ComposerMention[],
  url = "https://example.com/page",
  withPage = true,
} = {}) {
  const app = await loadPluginApp(() => import("./app"));
  const rpc = {
    saveNote: vi.fn(async () => null),
    getNotes: vi.fn(async () => stored),
    captureNoteTab: vi.fn(async () => ({
      base64: "",
      width: 1280,
      height: 800,
      mimeType: "image/jpeg" as const,
    })),
    saveNoteImage: vi.fn(async () => null),
  };
  const props = {
    threadId: "thr_a",
    tabId: "tab-1",
    url,
    isCompactViewport: false,
    experimental_page: withPage ? page : null,
  } as unknown as ExperimentalPluginBrowserToolbarActionProps;
  const slot = renderSlot(app.browserToolbarActions[0]!, props, {
    rpc,
    composer: {
      text: mentions.map((mention) => mention.label).join(" "),
      mentions,
    },
  });
  const emit = (data: unknown) =>
    act(async () => {
      listeners.forEach((listener) => listener(data as JsonValue));
    });
  const lastState = () =>
    JSON.parse(
      String(page.evaluate.mock.calls.at(-1)?.[0]).match(
        /__bbAnnotate\.sync\((.*)\), null\)$/,
      )![1]!,
    );
  return { slot, rpc, emit, lastState };
}

it("shows nothing outside the desktop app", async () => {
  const { slot } = await setup({ withPage: false });
  expect(slot.container.innerHTML).toBe("");
});

it("leaves a page alone until there is something to show", async () => {
  const { slot, lastState } = await setup();
  expect(page.evaluate).not.toHaveBeenCalled();
  fireEvent.click(slot.getByRole("button", { name: "Annotate" }));
  await waitFor(() => expect(page.evaluate).toHaveBeenCalled());
  expect(lastState()).toEqual({ picking: true, next: 1, pins: [] });
  expect(
    slot
      .getByRole("button", { name: "Stop annotating" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});

it("turns a note from the page into a pill and a pin", async () => {
  const { slot, rpc, emit, lastState } = await setup();
  fireEvent.click(slot.getByRole("button", { name: "Annotate" }));
  const note = sampleNote({ url: "https://example.com/page" });
  await emit({ kind: "add", ...note });

  await waitFor(() => expect(rpc.captureNoteTab).toHaveBeenCalled());
  expect(rpc.saveNote).toHaveBeenCalledWith({ threadId: "thr_a", note });
  expect(slot.inspection.composer.draft.mentions).toEqual([
    expect.objectContaining({
      kind: "plugin",
      provider: PROVIDER,
      id: note.id,
      label: "1 · Save",
    }),
  ]);
  expect(rpc.captureNoteTab).toHaveBeenCalledWith({
    threadId: "thr_a",
    tabId: "tab-1",
  });
  expect(lastState()).toEqual({
    picking: true,
    next: 2,
    pins: [
      {
        id: note.id,
        number: 1,
        comment: note.comment,
        selector: note.element.selector,
      },
    ],
  });
});

it("ignores what the page sends that does not fit", async () => {
  const { slot, rpc, emit } = await setup();
  await emit({ kind: "add", ...sampleNote(), id: "../../etc" });
  await emit({ kind: "add", ...sampleNote(), comment: "  " });
  await emit("hello");
  expect(rpc.saveNote).not.toHaveBeenCalled();
  expect(slot.inspection.composer.draft.mentions).toEqual([]);
  // The page drew a pin for the note; drawing the state again removes it.
  expect(page.evaluate).toHaveBeenCalledTimes(3);
});

it("restores the pins of earlier pills on this page only", async () => {
  const here = sampleNote({ url: "https://example.com/page#part" });
  const there = sampleNote({
    id: "nother0002",
    number: 2,
    url: "https://x.dev",
  });
  const { rpc, lastState } = await setup({
    stored: [here, there],
    mentions: [pill(here.id, 0), pill(there.id, 9)],
  });
  await waitFor(() => expect(page.evaluate).toHaveBeenCalled());
  expect(rpc.getNotes).toHaveBeenCalledWith({
    threadId: "thr_a",
    ids: [here.id, there.id],
  });
  expect(lastState()).toEqual({
    picking: false,
    next: 3,
    pins: [expect.objectContaining({ id: here.id })],
  });
});

it("edits a note and deletes its pill", async () => {
  const note = sampleNote({ url: "https://example.com/page" });
  const { slot, rpc, emit, lastState } = await setup({
    stored: [note],
    mentions: [pill(note.id, 0)],
  });
  await waitFor(() => expect(page.evaluate).toHaveBeenCalled());

  await emit({ kind: "edit", id: note.id, comment: "Make it red" });
  expect(rpc.saveNote).toHaveBeenCalledWith({
    threadId: "thr_a",
    note: { ...note, comment: "Make it red" },
  });

  await emit({ kind: "delete", id: note.id });
  expect(slot.inspection.composer.draft.mentions).toEqual([]);
  expect(lastState()).toEqual({ picking: false, next: 1, pins: [] });
});

it("stops picking when the page says so", async () => {
  const { slot, emit } = await setup();
  fireEvent.click(slot.getByRole("button", { name: "Annotate" }));
  await emit({ kind: "stop" });
  expect(
    slot.getByRole("button", { name: "Annotate" }).getAttribute("aria-pressed"),
  ).toBe("false");
});

it("stops picking on Escape in the toolbar", async () => {
  const { slot } = await setup();
  fireEvent.click(slot.getByRole("button", { name: "Annotate" }));
  fireEvent.keyDown(slot.getByRole("button", { name: "Stop annotating" }), {
    key: "Escape",
  });
  expect(slot.getByRole("button", { name: "Annotate" })).toBeTruthy();
});

it("clears the page's pins when it unmounts", async () => {
  const note = sampleNote({ url: "https://example.com/page" });
  const { slot } = await setup({
    stored: [note],
    mentions: [pill(note.id, 0)],
  });
  await waitFor(() => expect(page.evaluate).toHaveBeenCalled());
  slot.lifecycle.unmount();
  expect(String(page.evaluate.mock.calls.at(-1)?.[0])).toContain(
    "sync({ picking: false, pins: [] })",
  );
});

it("puts the script back after the page reloads", async () => {
  vi.useFakeTimers();
  try {
    const { slot } = await setup();
    fireEvent.click(slot.getByRole("button", { name: "Annotate" }));
    // The reloaded page has no script, so the check answers null.
    page.evaluate.mockClear();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(
      page.evaluate.mock.calls.map(([expression]) =>
        String(expression).slice(0, 40),
      ),
    ).toEqual([
      "(globalThis.__bbAnnotate?.sync({}) ?? fa",
      expect.stringContaining("((function installPage"),
    ]);
  } finally {
    vi.useRealTimers();
  }
});
