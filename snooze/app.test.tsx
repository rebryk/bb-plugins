// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  loadPluginApp,
  renderSlot,
  type CapturedPluginApp,
} from "@get-bb/plugin-sdk/testing/app";
import { toast } from "sonner";
import type { Snooze } from "./server";
import { nextThread, sidebarThreadIds } from "./sidebar";
import { parse } from "./time";

vi.mock("sonner", () => ({
  toast: { custom: vi.fn(), dismiss: vi.fn() },
}));

interface Command {
  id: string;
  title: string;
  defaultShortcut: unknown;
  isAvailable?: (context: { threadId: string | null }) => boolean;
  run: (context: { threadId: string | null; projectId: string | null }) => void;
}

/** The test runtime collects commands, though its type doesn't list them. */
function commands(app: CapturedPluginApp) {
  return (app as CapturedPluginApp & { commandPaletteActions: Command[] })
    .commandPaletteActions;
}

// Saturday, September 26, 2026, 2:30 PM.
const NOW = new Date(2026, 8, 26, 14, 30).getTime();

beforeAll(() => {
  // cmdk measures its list and scrolls the selected row into view.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  for (const nav of document.querySelectorAll("nav")) nav.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** A phone-sized viewport, where BB's dialogs become its drawer. */
function phone() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 767px)",
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

function sidebar(html: string) {
  const nav = document.createElement("nav");
  nav.innerHTML = html;
  document.body.append(nav);
}

const rows = () =>
  [...document.querySelectorAll("[cmdk-item]")].map((row) => row.textContent);
const selectedRow = () =>
  document.querySelector('[cmdk-item][data-selected="true"]')?.textContent;

/** Renders the card of the last toast the plugin showed, as BB's toaster would. */
function renderToast() {
  const [card, options] = vi.mocked(toast.custom).mock.calls.at(-1)!;
  expect(options).toEqual({ className: "bb-app-toast" });
  render(card("toast-1"));
}

async function openDialog(
  command: "snooze-thread" | "show-snoozed-threads",
  list: { snoozes: Snooze[]; last: unknown },
  rpc: Record<string, (input: unknown) => unknown> = {},
) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(
    app.appOverlays[0]!,
    {},
    {
      context: { threadId: "t2", projectId: "p1" },
      rpc: {
        list: () => list,
        snooze: (input) => ({
          title: "Fix the login bug",
          previous: null,
          hidden: [(input as { threadId: string }).threadId],
        }),
        unsnooze: () => null,
        ...rpc,
      },
    },
  );
  await vi.waitFor(() => {
    expect(slot.inspection.rpcCalls).toContainEqual({
      method: "list",
      input: null,
    });
  });
  act(() => runCommand(app, command));
  return { app, slot };
}

function runCommand(app: CapturedPluginApp, command: string) {
  commands(app)
    .find((candidate) => candidate.id === command)
    ?.run({ threadId: "t2", projectId: "p1" });
}

describe("registrations", () => {
  it("adds the header moon, the dialogs, and two commands without keys", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.threadHeaderActions.map((action) => action.title)).toEqual([
      "Snooze thread",
    ]);
    expect(app.appOverlays).toHaveLength(1);
    expect(
      commands(app).map(({ id, title, defaultShortcut }) => ({
        id,
        title,
        defaultShortcut,
      })),
    ).toEqual([
      { id: "snooze-thread", title: "Snooze thread", defaultShortcut: null },
      {
        id: "show-snoozed-threads",
        title: "Show snoozed threads",
        defaultShortcut: null,
      },
    ]);
    const snooze = commands(app)[0];
    expect(snooze?.isAvailable?.({ threadId: null })).toBe(false);
    expect(snooze?.isAvailable?.({ threadId: "t1" })).toBe(true);
  });
});

describe("sidebar order", () => {
  it("reads rows and windowed placeholders, skipping the overflow", () => {
    sidebar(`
      <a data-sidebar-thread-shortcut-target data-sidebar-thread-id="t1"></a>
      <div data-sidebar-windowed-nav="t2:p1 bad: :x t3:p1"></div>
      <div data-sidebar-overflow="true">
        <a data-sidebar-thread-shortcut-target data-sidebar-thread-id="t9"></a>
      </div>
      <a data-sidebar-thread-shortcut-target data-sidebar-thread-id="t4"></a>`);
    expect(sidebarThreadIds()).toEqual(["t1", "t2", "t3", "t4"]);
  });

  it("opens the next thread, else the nearest one above", () => {
    const order = ["t1", "t2", "t3", "t4"];
    expect(nextThread(order, "t2", ["t2", "t3"])).toBe("t4");
    expect(nextThread(order, "t4", ["t4"])).toBe("t3");
    expect(nextThread(order, "t3", ["t3", "t4"])).toBe("t2");
    expect(nextThread(["t1"], "t1", ["t1"])).toBeNull();
  });
});

describe("snooze picker", () => {
  const lastText = { snoozes: [], last: { kind: "text", text: "fri 3pm" } };

  it("shows Last used and the presets with their times, without headings", async () => {
    await openDialog("snooze-thread", lastText);
    await screen.findByText("Last used");
    expect(document.querySelector("[cmdk-group-heading]")).toBeNull();
    // Like BB's palette: no close button.
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(rows()).toEqual([
      "Last usedFri, Oct 2, 3:00 PM",
      "Later todayToday, 6:00 PM",
      "TomorrowSun, Sep 27, 9:00 AM",
      "Next weekMon, Sep 28, 9:00 AM",
    ]);
  });

  it("offers Unsnooze first for a snoozed thread, also after a search", async () => {
    const until = new Date(2026, 8, 27, 9).getTime();
    await openDialog("snooze-thread", {
      snoozes: [{ threadId: "t2", title: "Two", until }],
      last: { kind: "preset", id: "tomorrow" },
    });
    await screen.findByText("Unsnooze");
    expect(document.querySelector("[cmdk-group-heading]")).toBeNull();
    const all = [
      "Unsnooze",
      "Last usedSun, Sep 27, 9:00 AM",
      "Later todayToday, 6:00 PM",
      "TomorrowSun, Sep 27, 9:00 AM",
      "Next weekMon, Sep 28, 9:00 AM",
    ];
    expect(rows()).toEqual(all);

    // cmdk sorts by how well a row matches and moves Next week up.
    const input = screen.getByPlaceholderText("Try: 8 am, 3 days, aug 7");
    fireEvent.change(input, { target: { value: "n" } });
    expect(rows()).toEqual(["Next weekMon, Sep 28, 9:00 AM", "Unsnooze"]);
    fireEvent.change(input, { target: { value: "" } });
    await vi.waitFor(() => {
      expect(rows()).toEqual(all);
      expect(selectedRow()).toBe("Unsnooze");
    });
  });

  it("keeps the typed row first and filters Last used by its title", async () => {
    const { slot } = await openDialog("snooze-thread", {
      snoozes: [],
      last: { kind: "text", text: "tue" },
    });
    const input = await screen.findByPlaceholderText(
      "Try: 8 am, 3 days, aug 7",
    );
    await screen.findByText("Last used");
    fireEvent.change(input, { target: { value: "used" } });
    expect(rows()).toEqual(["Last usedTue, Sep 29, 9:00 AM"]);
    for (const value of ["t", "tu", "tue"]) {
      fireEvent.change(input, { target: { value } });
    }
    await vi.waitFor(() => {
      expect(rows()).toEqual([
        "tueTue, Sep 29, 9:00 AM",
        "Last usedTue, Sep 29, 9:00 AM",
      ]);
      expect(selectedRow()).toBe("tueTue, Sep 29, 9:00 AM");
    });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => {
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "snooze",
        input: {
          threadId: "t2",
          until: parse("tue", NOW),
          choice: { kind: "text", text: "tue" },
        },
      });
    });
  });

  it("snoozes until a typed time, opens the next thread, and undoes", async () => {
    sidebar(`
      <a data-sidebar-thread-shortcut-target data-sidebar-thread-id="t1"></a>
      <a data-sidebar-thread-shortcut-target data-sidebar-thread-id="t2"></a>
      <a data-sidebar-thread-shortcut-target data-sidebar-thread-id="t3"></a>`);
    const { slot } = await openDialog("snooze-thread", lastText);
    const input = await screen.findByPlaceholderText(
      "Try: 8 am, 3 days, aug 7",
    );
    fireEvent.change(input, { target: { value: "8 am" } });
    expect(rows()).toEqual(["8 amSun, Sep 27, 8:00 AM"]);
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() => {
      expect(slot.inspection.navigateCalls).toEqual([
        { method: "toThread", threadId: "t3" },
      ]);
    });
    expect(slot.inspection.rpcCalls).toContainEqual({
      method: "snooze",
      input: {
        threadId: "t2",
        until: parse("8 am", NOW),
        choice: { kind: "text", text: "8 am" },
      },
    });
    await vi.waitFor(() => expect(toast.custom).toHaveBeenCalledTimes(1));
    renderToast();
    expect(screen.getByText("Snoozed until tomorrow at 8:00 AM")).toBeTruthy();
    expect(screen.getByText("Fix the login bug")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(toast.dismiss).toHaveBeenCalledWith("toast-1");
    await vi.waitFor(() => {
      expect(slot.inspection.navigateCalls.at(-1)).toEqual({
        method: "toThread",
        threadId: "t2",
      });
    });
    expect(slot.inspection.rpcCalls).toContainEqual({
      method: "unsnooze",
      input: { threadId: "t2" },
    });
  });

  it("shows an error card without Undo when snoozing fails", async () => {
    await openDialog("snooze-thread", lastText, {
      snooze: () => {
        throw new Error("Thread not found");
      },
    });
    fireEvent.click(await screen.findByText("Tomorrow"));
    await vi.waitFor(() => expect(toast.custom).toHaveBeenCalledTimes(1));
    renderToast();
    expect(screen.getByText("Could not snooze the thread")).toBeTruthy();
    expect(screen.getByText("Thread not found")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    expect(toast.dismiss).toHaveBeenCalledWith("toast-1");
  });

  it("keeps a matching preset instead of a typed row with its time", async () => {
    await openDialog("snooze-thread", lastText);
    const input = await screen.findByPlaceholderText(
      "Try: 8 am, 3 days, aug 7",
    );
    fireEvent.change(input, { target: { value: "tomorrow" } });
    expect(rows()).toEqual(["TomorrowSun, Sep 27, 9:00 AM"]);
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(rows()).toEqual([]);
    expect(screen.getByText("No matching times")).toBeTruthy();
  });

  it("starts afresh each time on phones, where BB's drawer stays mounted", async () => {
    phone();
    const { app } = await openDialog("snooze-thread", lastText);
    const input = await screen.findByPlaceholderText(
      "Try: 8 am, 3 days, aug 7",
    );
    fireEvent.change(input, { target: { value: "8 am" } });
    expect(rows()).toEqual(["8 amSun, Sep 27, 8:00 AM"]);
    fireEvent.keyDown(input, { key: "Escape" });

    act(() => runCommand(app, "snooze-thread"));
    await vi.waitFor(() => {
      expect(
        screen.getByPlaceholderText<HTMLInputElement>(
          "Try: 8 am, 3 days, aug 7",
        ).value,
      ).toBe("");
    });
    expect(rows()).toHaveLength(4);
  });
});

describe("snoozed threads", () => {
  const list = {
    snoozes: [
      {
        threadId: "t1",
        title: "One",
        until: new Date(2026, 8, 26, 18).getTime(),
      },
      {
        threadId: "t3",
        title: "Three",
        until: new Date(2026, 8, 28, 9).getTime(),
      },
    ],
    last: null,
  };

  it("lists the snoozes and opens one without waking it", async () => {
    const { slot } = await openDialog("show-snoozed-threads", list);
    const input = await screen.findByPlaceholderText("Search snoozed threads…");
    await vi.waitFor(() => {
      expect(rows()).toEqual([
        "Oneuntil today at 6:00 PMUnsnoozeCtrl ↵",
        "Threeuntil Mon, Sep 28 at 9:00 AMUnsnoozeCtrl ↵",
      ]);
    });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toThread", threadId: "t3" },
    ]);
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "unsnooze"),
    ).toEqual([]);
  });

  it("unsnoozes the selected row with ⌘↵ and stays open", async () => {
    const { slot } = await openDialog("show-snoozed-threads", list);
    const input = await screen.findByPlaceholderText("Search snoozed threads…");
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    await vi.waitFor(() => {
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "unsnooze",
        input: { threadId: "t1" },
      });
    });
    expect(slot.inspection.navigateCalls).toEqual([]);
    expect(screen.getByPlaceholderText("Search snoozed threads…")).toBeTruthy();
  });

  it("unsnoozes a row from its hint, which says ⌘ on a Mac", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { slot } = await openDialog("show-snoozed-threads", list);
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    const hint = screen.getAllByRole("button", { name: "Unsnooze⌘ ↵" })[1]!;
    // The search field keeps focus.
    expect(fireEvent.mouseDown(hint)).toBe(false);
    fireEvent.click(hint);

    await vi.waitFor(() => {
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "unsnooze",
        input: { threadId: "t3" },
      });
    });
    expect(slot.inspection.navigateCalls).toEqual([]);
    expect(screen.getByPlaceholderText("Search snoozed threads…")).toBeTruthy();
  });

  it("starts afresh each time on phones, where BB's drawer stays mounted", async () => {
    phone();
    const { app } = await openDialog("show-snoozed-threads", list);
    const input = await screen.findByPlaceholderText("Search snoozed threads…");
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.change(input, { target: { value: "three" } });
    expect(rows()).toHaveLength(1);
    fireEvent.keyDown(input, { key: "Escape" });

    act(() => runCommand(app, "show-snoozed-threads"));
    await vi.waitFor(() => {
      expect(
        screen.getByPlaceholderText<HTMLInputElement>("Search snoozed threads…")
          .value,
      ).toBe("");
    });
    expect(rows()).toHaveLength(2);
  });

  it("says when nothing is snoozed", async () => {
    await openDialog("show-snoozed-threads", { snoozes: [], last: null });
    await screen.findByText("No snoozed threads");
  });
});
