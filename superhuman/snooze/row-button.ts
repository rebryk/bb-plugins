import Moon02Icon from "@hugeicons/core-free-icons/Moon02Icon";

const ROW = "[data-sidebar-rename-row]";
const BUTTON = "[data-superhuman-snooze-button]";
const ARCHIVE =
  '[data-sidebar-row-controls] > button[aria-label="Archive thread"]';

export function mountRowButtons(
  { signal }: { signal: AbortSignal },
  open: (threadId: string) => void,
) {
  function sync() {
    for (const button of document.querySelectorAll(BUTTON))
      if (!button.nextElementSibling?.matches(ARCHIVE)) button.remove();
    for (const archive of document.querySelectorAll<HTMLButtonElement>(
      ARCHIVE,
    )) {
      if (!archive.closest(ROW)?.querySelector("[data-sidebar-thread-id]"))
        continue;
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
      if (button.className !== archive.className)
        button.className = archive.className;
      if (button.disabled !== archive.disabled)
        button.disabled = archive.disabled;
    }
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

  const observer = new MutationObserver((records) => {
    // Ignore changes inside the chat and terminal while they stream output.
    if (
      records.some(
        ({ target }) =>
          target instanceof Element && !target.closest("main, .xterm"),
      )
    )
      sync();
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
    for (const button of document.querySelectorAll(BUTTON)) button.remove();
  };
}
