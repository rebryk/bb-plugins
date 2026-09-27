import { toast } from "sonner";

// The header row of a pane in BB's right panel. Its parent's parent, the pane,
// also holds the content of the pane's active tab.
const HEADER = '[data-testid="thread-secondary-panel-top-chrome"]';
const TERMINAL = "[data-app-terminal] .xterm";

// Hugeicons' clipboard-paste icon, from the set BB draws its own icons from.
// MIT License, Copyright (c) 2025 Hugeicons.
const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M19.502 13.0005H10.502"/>' +
  '<path d="M17.502 10.0005C17.502 10.0005 20.5019 12.21 20.502 13.0005C20.502 13.7911 17.502 16.0005 17.502 16.0005"/>' +
  '<path d="M13.998 2.00049H8.99805C8.16962 2.00049 7.49805 2.67206 7.49805 3.50049C7.49805 4.32892 8.16962 5.00049 8.99805 5.00049H13.998C14.8265 5.00049 15.498 4.32892 15.498 3.50049C15.498 2.67206 14.8265 2.00049 13.998 2.00049Z"/>' +
  '<path d="M15.4981 3.50049C17.0515 3.5473 17.9781 3.72056 18.6194 4.36185C19.1913 4.93377 19.391 5.73255 19.4607 7.00049M7.49795 3.50049C5.94456 3.5473 5.01802 3.72056 4.37673 4.36184C3.49805 5.24053 3.49805 6.65474 3.49806 9.48318L3.49805 16C3.49805 18.8284 3.49806 20.2426 4.37674 21.1213C5.25541 22 6.66963 22 9.49805 22L13.498 22C16.3265 22 17.7407 22 18.6194 21.1213C19.1092 20.6315 19.3259 19.9753 19.4219 19.0005"/>' +
  "</svg>";

/** Adds Paste to the header of each pane that shows a terminal, on touch screens. */
export function start({ signal }: { signal: AbortSignal }) {
  const touchScreen = matchMedia("(pointer: coarse)");
  const buttons = new Map<Element, HTMLButtonElement>();
  let popup: HTMLElement | undefined;
  let returnFocus: Element | null = null;

  function sync() {
    const headers = touchScreen.matches
      ? [...document.querySelectorAll(HEADER)].filter(terminalOf)
      : [];
    for (const [header, button] of buttons)
      if (!headers.includes(header)) {
        button.remove();
        buttons.delete(header);
      }
    for (const header of headers) {
      const button = buttons.get(header) ?? pasteButton();
      buttons.set(header, button);
      place(button, header);
    }
  }

  function pasteButton() {
    const element = button(
      "Paste",
      () => {
        const header = element.closest(HEADER);
        const xterm = header && terminalOf(header);
        if (xterm) void read(xterm);
      },
      ICON,
    );
    element.className = "terminal-paste-button";
    return element;
  }

  /** Must start inside the tap on Paste, which the clipboard API requires. */
  async function read(xterm: Element) {
    let text: string | undefined;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // No clipboard API over plain HTTP, no permission in Android's WebView,
      // or iOS's own Paste button dismissed: the field opens instead. A missing
      // API fails at once, so the field still gets focus, and the keyboard,
      // inside the tap.
    }
    // The plugin may have stopped while the system asked about the paste.
    if (signal.aborted) return;
    if (text === undefined) sheet(xterm);
    else if (text) send(xterm, text);
    else toast.message("The clipboard has no text to paste.");
  }

  /** A field to paste into with the system's own Paste. */
  function sheet(xterm: Element) {
    // Replaces an earlier field, after it gives the focus back.
    close();
    const focused = document.activeElement;
    const element = document.createElement("div");
    element.className = "terminal-paste-sheet";
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-label", "Paste into the terminal");
    // BB's drawer, which holds the right panel on phones, pulls Tab back into
    // itself unless the focus is in an element with this mark.
    element.setAttribute("data-bb-portaled-overlay", "");
    const field = document.createElement("textarea");
    field.placeholder = "Paste the text here";
    field.setAttribute("aria-label", "Text to paste");
    for (const name of ["autocapitalize", "autocomplete", "autocorrect"])
      field.setAttribute(name, "off");
    field.spellcheck = false;
    const actions = document.createElement("div");
    actions.append(
      button("Cancel", close),
      button("Paste", () => {
        const text = field.value;
        close();
        if (text) send(xterm, text);
      }),
    );
    element.append(field, actions);
    document.body.append(element);
    popup = element;
    returnFocus = focused;
    field.focus();
  }

  function close() {
    popup?.remove();
    popup = undefined;
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected)
      returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  window.addEventListener(
    "pointerdown",
    ({ target }) => {
      if (popup && !(target instanceof Node && popup.contains(target))) close();
    },
    { capture: true, passive: true, signal },
  );

  window.addEventListener(
    "keydown",
    (event) => {
      if (!popup || event.key !== "Escape") return;
      // Closes only the field: not BB's panel, and not the program in the
      // terminal.
      event.preventDefault();
      event.stopPropagation();
      close();
    },
    { capture: true, signal },
  );

  const observer = new MutationObserver((records) => {
    // xterm redraws its rows all the time, and nothing in there moves a header.
    if (
      records.some(
        ({ target }) =>
          !(target instanceof Element && target.closest(".xterm")),
      )
    )
      sync();
  });

  /** Watches the page only where Paste shows, on touch screens. */
  function watch() {
    if (touchScreen.matches)
      observer.observe(document.body, { childList: true, subtree: true });
    else observer.disconnect();
    sync();
  }
  touchScreen.addEventListener("change", watch, { signal });
  watch();

  return () => {
    observer.disconnect();
    for (const button of buttons.values()) button.remove();
    buttons.clear();
    close();
  };
}

function terminalOf(header: Element) {
  return header.parentElement?.parentElement?.querySelector(TERMINAL) ?? null;
}

/** Puts the button first among BB's own buttons, such as Hide right panel. */
function place(button: HTMLElement, header: Element) {
  // They sit in the header's last group; the tabs sit in its toolbar.
  const controls = [...header.children]
    .reverse()
    .find(
      (child) => child !== button && child.getAttribute("role") !== "toolbar",
    );
  if (button.parentElement === (controls ?? header)) return;
  if (controls) controls.prepend(button);
  else header.append(button);
}

function button(label: string, onClick: () => void, icon?: string) {
  const element = document.createElement("button");
  element.type = "button";
  if (icon) {
    element.innerHTML = icon;
    element.setAttribute("aria-label", label);
  } else element.textContent = label;
  // Keeps the focus, and with it the keyboard, where it is.
  element.addEventListener("mousedown", (event) => event.preventDefault());
  element.addEventListener("click", onClick);
  return element;
}

/**
 * Hands the text to xterm as a paste event, so xterm treats it like a
 * keyboard paste: same line endings, bracketed when the program asks for it.
 */
function send(xterm: Element, text: string) {
  const input = xterm.querySelector(".xterm-helper-textarea");
  if (!input?.isConnected) {
    toast.error("The terminal closed before the paste.");
    return;
  }
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? text : "") },
  });
  input.dispatchEvent(event);
}
