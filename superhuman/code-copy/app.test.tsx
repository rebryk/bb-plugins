// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { toast } from "sonner";
import { asPluginApp } from "../testing";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

const TEXT = "printf 'Hello\\n'\n  pwd\n";
const BLOCK = `<div><button aria-label="Copy code">Copy</button>
  <pre><code><span>printf 'Hello\\n'</span>\n  pwd\n</code></pre></div>`;
function message(content = BLOCK, role = "assistant") {
  return `<div data-timeline-row-id="thread:${role}:item">
    <div data-message-column><div data-markdown-preview>${content}</div></div>
  </div>`;
}

const writeText = vi.fn(async (_text: string) => {});

beforeEach(() => {
  document.body.innerHTML = message();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  Reflect.deleteProperty(navigator, "clipboard");
  vi.clearAllMocks();
});

async function mount(enabled = true) {
  const app = await loadPluginApp(asPluginApp(() => import("./app")));
  return renderSlot(app.appOverlays[0]!, {}, {
    settings: { codeCopy: enabled },
  });
}

function pointer(type: string, target: Element, x = 10, y = 10) {
  const event = new MouseEvent(type, {
    bubbles: true, button: 0, clientX: x, clientY: y,
  });
  Object.defineProperty(event, "isPrimary", { value: true });
  target.dispatchEvent(event);
}

it("copies highlighted code with its exact whitespace and confirms success", async () => {
  await mount();
  fireEvent.click(document.querySelector("code span")!);
  await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
  expect(writeText).toHaveBeenCalledExactlyOnceWith(TEXT);
});

it("uses current text in blocks added while a reply streams", async () => {
  await mount();
  document.body.insertAdjacentHTML("beforeend", message());
  const code = document.querySelectorAll("code")[1]!;
  code.textContent = "npm test\nnpm run build";
  fireEvent.click(code);
  expect(writeText).toHaveBeenCalledExactlyOnceWith(code.textContent);
});

it("makes inline commands clickable and keyboard accessible, except links", async () => {
  document.body.innerHTML = message(`<p><code>npm install</code>
    <a href="#file"><code>file.ts</code></a></p>`);
  const mounted = await mount();
  const [command, link] = document.querySelectorAll("code");
  expect(command.getAttribute("role")).toBe("button");
  expect(command.tabIndex).toBe(0);
  fireEvent.click(command);
  fireEvent.keyDown(command, { key: "Enter" });
  fireEvent.keyDown(command, { key: " " });
  fireEvent.click(link);
  expect(writeText.mock.calls).toEqual(Array(3).fill(["npm install"]));
  expect(link.hasAttribute("role")).toBe(false);
  mounted.lifecycle.unmount();
  expect(command.hasAttribute("role")).toBe(false);
  expect(command.hasAttribute("tabindex")).toBe(false);
  expect(command.hasAttribute("title")).toBe(false);
});

it("decorates new inline code and restores attributes when it leaves the DOM", async () => {
  await mount();
  document.body.insertAdjacentHTML("beforeend", message(
    '<p><code title="Original">npm test</code></p>',
  ));
  const code = document.querySelector("p code")!;
  await vi.waitFor(() => expect(code.getAttribute("role")).toBe("button"));
  code.remove();
  await vi.waitFor(() => expect(code.getAttribute("title")).toBe("Original"));
  expect(code.hasAttribute("role")).toBe(false);
});

it("leaves native controls, user messages, tool output and file previews alone", async () => {
  await mount();
  document.body.insertAdjacentHTML("beforeend", message(BLOCK, "user") +
    message(BLOCK, "tool") + `<div data-markdown-preview>${BLOCK}</div>`);
  fireEvent.click(document.querySelector("button")!);
  for (const code of [...document.querySelectorAll("code")].slice(1)) {
    fireEvent.click(code);
  }
  expect(writeText).not.toHaveBeenCalled();
});

it("preserves text selection and modified or repeated clicks", async () => {
  await mount();
  const code = document.querySelector("code")!;
  const range = document.createRange();
  range.selectNodeContents(code);
  document.getSelection()!.addRange(range);
  fireEvent.click(code);
  expect(document.getSelection()!.toString()).toBe(TEXT);
  document.getSelection()!.removeAllRanges();
  for (const init of [{ detail: 2 }, { ctrlKey: true }, { metaKey: true },
    { altKey: true }, { shiftKey: true }, { button: 2 }]) {
    fireEvent.click(code, init);
  }
  expect(writeText).not.toHaveBeenCalled();
});

it("does not copy after a drag, wheel, cancelled touch or long press", async () => {
  await mount();
  const code = document.querySelector("code")!;
  for (const cancel of [
    () => pointer("pointermove", code, 40),
    () => fireEvent.wheel(document.querySelector("pre")!),
    () => pointer("pointercancel", code),
  ]) {
    pointer("pointerdown", code);
    cancel();
    fireEvent.click(code);
  }
  const down = new MouseEvent("pointerdown", { bubbles: true });
  Object.defineProperties(down, {
    isPrimary: { value: true }, timeStamp: { value: 0 },
  });
  code.dispatchEvent(down);
  const click = new MouseEvent("click", { bubbles: true });
  Object.defineProperty(click, "timeStamp", { value: 700 });
  code.dispatchEvent(click);
  expect(writeText).not.toHaveBeenCalled();
  pointer("pointerdown", code);
  fireEvent.click(code);
  expect(writeText).toHaveBeenCalledExactlyOnceWith(TEXT);
});

it("allows clicks while BB automatically scrolls a streaming reply", async () => {
  await mount();
  const code = document.querySelector("code")!;
  pointer("pointerdown", code);
  fireEvent.scroll(document.body);
  fireEvent.click(code);
  expect(writeText).toHaveBeenCalledExactlyOnceWith(TEXT);
});

it("reports a clipboard denial without claiming success", async () => {
  await mount();
  writeText.mockRejectedValueOnce(new Error("Denied"));
  fireEvent.click(document.querySelector("code")!);
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(toast.success).not.toHaveBeenCalled();
});

it("can be disabled and removes listeners and pending feedback on unmount", async () => {
  const disabled = await mount(false);
  fireEvent.click(document.querySelector("code")!);
  expect(writeText).not.toHaveBeenCalled();
  disabled.lifecycle.unmount();
  const mounted = await mount();
  let finish!: () => void;
  writeText.mockImplementationOnce(() => new Promise<void>((resolve) => {
    finish = resolve;
  }));
  fireEvent.click(document.querySelector("code")!);
  mounted.lifecycle.unmount();
  finish();
  await Promise.resolve();
  fireEvent.click(document.querySelector("code")!);
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(toast.success).not.toHaveBeenCalled();
  expect(document.documentElement.hasAttribute("data-superhuman-code-copy"))
    .toBe(false);
});
