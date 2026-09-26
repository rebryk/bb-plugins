// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  loadPluginApp,
  mountPluginContentScripts,
  type MountedPluginContentScripts,
} from "@get-bb/plugin-sdk/testing/app";
import { experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";

const TERMINAL = `
  <section aria-label="Terminal" data-app-terminal>
    <div class="xterm">
      <div class="xterm-screen"><canvas></canvas></div>
      <textarea class="xterm-helper-textarea"></textarea>
    </div>
  </section>`;

/** A pane of BB's right panel: the header row, then the active tab. */
function pane(content: string) {
  return `
    <section>
      <div>
        <div data-testid="thread-secondary-panel-top-chrome">
          <div role="toolbar" aria-label="Right panel views">
            <button type="button">Terminal</button>
          </div>
          <div>
            <button type="button" aria-label="Hide right panel"></button>
          </div>
        </div>
      </div>
      <div><div>${content}</div></div>
    </section>`;
}

// jsdom has no matchMedia. Phones and tablets match (pointer: coarse).
const touchScreen = Object.assign(new EventTarget(), { matches: true });

let mounted: MountedPluginContentScripts;
let pasted: string[];

beforeEach(async () => {
  document.body.innerHTML = `${pane(TERMINAL)}
    <button type="button" id="outside">Outside</button>`;
  pasted = [];
  terminalInput().addEventListener("paste", (event) => {
    pasted.push(event.clipboardData?.getData("text/plain") ?? "");
  });
  touchScreen.matches = true;
  vi.stubGlobal("matchMedia", (query: string) => {
    expect(query).toBe("(pointer: coarse)");
    return touchScreen;
  });
  const app = await loadPluginApp(() => import("./app"));
  mounted = await mountPluginContentScripts(app, {
    pluginId: "terminal-paste",
  });
});

afterEach(async () => {
  if (!mounted.inspection.disposed) await mounted.lifecycle.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
  document.body.replaceChildren();
});

const header = () =>
  document.querySelector('[data-testid="thread-secondary-panel-top-chrome"]')!;
const outside = () => document.querySelector<HTMLElement>("#outside")!;
const terminalInput = () =>
  document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")!;
const pasteButtons = () =>
  document.querySelectorAll<HTMLButtonElement>(".terminal-paste-button");
const sheet = () =>
  document.querySelector<HTMLElement>(".terminal-paste-sheet");

function paste() {
  const [button] = pasteButtons();
  if (!button) throw new Error("No Paste button");
  button.click();
}

function buttonIn(container: Element | null, label: string) {
  const button = [...(container?.querySelectorAll("button") ?? [])].find(
    (element) => element.textContent === label,
  );
  if (!button) throw new Error(`No ${label} button`);
  return button;
}

function clipboard(readText: () => Promise<string>) {
  const mock = vi.fn(readText);
  Object.defineProperty(navigator, "clipboard", {
    value: { readText: mock },
    configurable: true,
  });
  return mock;
}

/** Lets the page's observers and a clipboard read finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

it("mounts one content script", () => {
  expect(mounted.inspection.mountedIds).toEqual(["paste"]);
});

it("puts Paste first among the buttons in the terminal's header", () => {
  const [button] = pasteButtons();
  expect(pasteButtons()).toHaveLength(1);
  expect(button?.getAttribute("aria-label")).toBe("Paste");
  expect(button?.querySelector("svg")).not.toBeNull();
  expect(header().lastElementChild?.firstElementChild).toBe(button);
});

it("shows Paste on touch screens only", () => {
  touchScreen.matches = false;
  touchScreen.dispatchEvent(new Event("change"));
  expect(pasteButtons()).toHaveLength(0);
  touchScreen.matches = true;
  touchScreen.dispatchEvent(new Event("change"));
  expect(pasteButtons()).toHaveLength(1);
});

it("watches the page on touch screens only", async () => {
  const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  touchScreen.matches = false;
  touchScreen.dispatchEvent(new Event("change"));
  expect(disconnect).toHaveBeenCalled();
  // A terminal that opens meanwhile gets Paste once the screen is a touch
  // screen again, and so does one that opens after that.
  document.body.insertAdjacentHTML("beforeend", pane(TERMINAL));
  touchScreen.matches = true;
  touchScreen.dispatchEvent(new Event("change"));
  expect(pasteButtons()).toHaveLength(2);
  document.body.insertAdjacentHTML("beforeend", pane(TERMINAL));
  await settle();
  expect(pasteButtons()).toHaveLength(3);
});

it("leaves panes without a terminal alone", async () => {
  // A split pane that shows a file, and a terminal outside the right panel.
  document.body.insertAdjacentHTML(
    "beforeend",
    `${pane("<p>README.md</p>")}<main>${TERMINAL}</main>`,
  );
  await settle();
  expect(pasteButtons()).toHaveLength(1);
  expect(header().contains(pasteButtons()[0]!)).toBe(true);
});

it("follows the terminal as tabs switch and BB redraws the header", async () => {
  const content = document.querySelector("[data-app-terminal]")!.parentElement!;
  content.innerHTML = "<p>README.md</p>";
  await settle();
  expect(pasteButtons()).toHaveLength(0);
  content.innerHTML = TERMINAL;
  await settle();
  expect(pasteButtons()).toHaveLength(1);
  // React draws BB's buttons again, without Paste.
  header().lastElementChild!.replaceWith(document.createElement("div"));
  await settle();
  expect(header().lastElementChild?.firstElementChild).toBe(pasteButtons()[0]);
});

it("pastes the clipboard's text into the pane's terminal", async () => {
  const readText = clipboard(async () => "ls -la\n");
  paste();
  expect(readText).toHaveBeenCalledOnce();
  await settle();
  expect(pasted).toEqual(["ls -la\n"]);
});

it("says so when the clipboard has no text", async () => {
  const message = vi.spyOn(toast, "message").mockReturnValue(1);
  clipboard(async () => "");
  paste();
  await settle();
  expect(message).toHaveBeenCalledExactlyOnceWith(
    "The clipboard has no text to paste.",
  );
  expect(pasted).toEqual([]);
});

it("says so when the terminal closes before the paste", async () => {
  const error = vi.spyOn(toast, "error").mockReturnValue(1);
  let resolve = (_: string) => {};
  clipboard(() => new Promise((done) => (resolve = done)));
  paste();
  document.querySelector("[data-app-terminal]")!.remove();
  resolve("ls\n");
  await settle();
  expect(error).toHaveBeenCalledExactlyOnceWith(
    "The terminal closed before the paste.",
  );
  expect(pasted).toEqual([]);
});

it("offers a field for the system's Paste when the clipboard can't be read", async () => {
  clipboard(() =>
    Promise.reject(new DOMException("Denied", "NotAllowedError")),
  );
  paste();
  await settle();
  const field = sheet()!.querySelector("textarea")!;
  expect(document.activeElement).toBe(field);
  field.value = "echo one\necho two";
  buttonIn(sheet(), "Paste").click();
  expect(sheet()).toBeNull();
  expect(pasted).toEqual(["echo one\necho two"]);
});

it("opens the field within the tap when the page has no clipboard API", () => {
  // As over plain HTTP.
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
  terminalInput().focus();
  paste();
  // Focus within the tap is what opens a phone's keyboard.
  expect(document.activeElement).toBe(sheet()?.querySelector("textarea"));
  buttonIn(sheet(), "Cancel").click();
  expect(sheet()).toBeNull();
  expect(document.activeElement).toBe(terminalInput());
  expect(pasted).toEqual([]);
});

it("gives the focus back to the terminal after a field replaces another", async () => {
  const refusals: ((error: Error) => void)[] = [];
  clipboard(() => new Promise((_, reject) => refusals.push(reject)));
  terminalInput().focus();
  // Two taps before the system answers either read, then it refuses both.
  paste();
  paste();
  refusals[0]!(new Error("No"));
  await settle();
  refusals[1]!(new Error("No"));
  await settle();
  expect(document.querySelectorAll(".terminal-paste-sheet")).toHaveLength(1);
  buttonIn(sheet(), "Cancel").click();
  expect(document.activeElement).toBe(terminalInput());
});

it("lets Tab move through the field in BB's drawer", async () => {
  clipboard(() => Promise.reject(new Error("No")));
  paste();
  await settle();
  // BB's drawer, which holds the right panel on phones, pulls Tab back into
  // itself unless the focus is in an element with this mark.
  expect(sheet()?.hasAttribute("data-bb-portaled-overlay")).toBe(true);
});

it("closes the field on a press elsewhere", async () => {
  clipboard(() => Promise.reject(new Error("No")));
  paste();
  await settle();
  sheet()!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(sheet()).not.toBeNull();
  outside().dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(sheet()).toBeNull();
});

it("closes the field on Escape, which goes no further", async () => {
  const heard = vi.fn();
  document.addEventListener("keydown", heard);
  const escape = () => {
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    terminalInput().dispatchEvent(event);
    return event;
  };
  clipboard(() => Promise.reject(new Error("No")));
  paste();
  await settle();
  expect(escape().defaultPrevented).toBe(true);
  expect(sheet()).toBeNull();
  expect(heard).not.toHaveBeenCalled();
  expect(escape().defaultPrevented).toBe(false);
  expect(heard).toHaveBeenCalledOnce();
  document.removeEventListener("keydown", heard);
});

it("leaves the focus, and the keyboard, where they are when Paste is pressed", () => {
  const press = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
  });
  expect(pasteButtons()[0]!.dispatchEvent(press)).toBe(false);
});

it("removes Paste and stops watching when the plugin stops", async () => {
  await mounted.lifecycle.dispose();
  expect(pasteButtons()).toHaveLength(0);
  document.body.insertAdjacentHTML("beforeend", pane(TERMINAL));
  touchScreen.dispatchEvent(new Event("change"));
  await settle();
  expect(pasteButtons()).toHaveLength(0);
});

it("drops a clipboard read that ends after the plugin stops", async () => {
  const reads: {
    resolve: (text: string) => void;
    reject: (error: Error) => void;
  }[] = [];
  clipboard(
    () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
  );
  paste();
  paste();
  await mounted.lifecycle.dispose();
  reads[0]!.resolve("ls\n");
  reads[1]!.reject(new Error("No"));
  await settle();
  expect(pasted).toEqual([]);
  expect(sheet()).toBeNull();
});

it("uses public SDK imports", () => {
  const scan = experimental_scanPublicSdkOnly(process.cwd(), {
    allow: [/^sonner$/],
  });
  expect(scan.violations).toEqual([]);
  expect(scan.privateDependencies).toEqual([]);
});
