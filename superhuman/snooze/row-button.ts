import Moon02Icon from "@hugeicons/core-free-icons/Moon02Icon";
import { changedOutside } from "../lib/mutations";

const ROW = "[data-sidebar-rename-row]";
const BUTTON = "[data-superhuman-snooze-button]";
const TITLE = "data-superhuman-snooze-title";
const ARCHIVE =
  '[data-sidebar-row-controls] > button[aria-label="Archive thread"]';

export function mountRowButtons(
  { signal }: { signal: AbortSignal },
  open: (threadId: string) => void,
) {
  // The buttons this mount added, so a sync need not search the page for them,
  // each with the box of its row's title. app.css makes room for the button
  // there, and the mark spares it a :has() test of every element on the page.
  const buttons = new Map<Element, Element | null>();
  function sync() {
    for (const [button, title] of buttons)
      if (!button.isConnected || !button.nextElementSibling?.matches(ARCHIVE)) {
        button.remove();
        title?.removeAttribute(TITLE);
        buttons.delete(button);
      }
    for (const archive of document.querySelectorAll<HTMLButtonElement>(
      ARCHIVE,
    )) {
      const link = archive
        .closest(ROW)
        ?.querySelector("[data-sidebar-thread-id]");
      if (!link) continue;
      let button = archive.previousElementSibling as HTMLButtonElement | null;
      if (!button?.matches(BUTTON)) {
        button = document.createElement("button");
        button.type = "button";
        button.title = "Snooze thread";
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-haspopup", "dialog");
        button.setAttribute("data-superhuman-snooze-button", "");
        // Reuse the header's Moon02 path and the host's button styling.
        button.innerHTML = `<svg data-icon-root viewBox="0 0 24 24" fill="none" aria-hidden="true" class="size-4 max-md:pointer-coarse:size-5"><path d="${Moon02Icon[0][1].d}" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>`;
        archive.before(button);
      }
      const title = link.parentElement;
      const marked = buttons.get(button);
      if (marked !== title) marked?.removeAttribute(TITLE);
      if (title && !title.hasAttribute(TITLE)) title.setAttribute(TITLE, "");
      buttons.set(button, title);
      if (button.className !== archive.className)
        button.className = archive.className;
      if (button.disabled !== archive.disabled)
        button.disabled = archive.disabled;
    }
    // The sync covers the whole page, so the changes it made itself need no
    // second one.
    observer.takeRecords();
  }

  // One delegated handler survives row replacement and leaves drag/navigation
  // to the row only when the user actually interacts with the row.
  function onEvent(event: Event) {
    const button =
      event.target instanceof Element ? event.target.closest(BUTTON) : null;
    if (!button) return;
    if (event instanceof KeyboardEvent && !["Enter", " "].includes(event.key))
      return;
    event.stopPropagation();
    if (event.type !== "click") return;
    event.preventDefault();
    const archive = button.nextElementSibling;
    const id = button
      .closest(ROW)
      ?.querySelector<HTMLElement>("[data-sidebar-thread-id]")
      ?.dataset.sidebarThreadId;
    if (id && archive?.matches(ARCHIVE) && !archive.hasAttribute("disabled"))
      open(id);
  }
  for (const type of [
    "click",
    "pointerdown",
    "pointerup",
    "dblclick",
    "keydown",
    "keyup",
  ])
    document.addEventListener(type, onEvent, { capture: true, signal });

  // Ignore changes inside the chat and terminal while they stream output, and
  // sync once a frame however many changes it brings.
  let frame = 0;
  const observer = new MutationObserver((records) => {
    if (!frame && changedOutside(records, "main, .xterm"))
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label", "disabled", "class"],
  });
  sync();
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    for (const button of document.querySelectorAll(BUTTON)) button.remove();
    for (const title of document.querySelectorAll(`[${TITLE}]`))
      title.removeAttribute(TITLE);
  };
}
