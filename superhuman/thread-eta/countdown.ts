import type { ThreadEta } from "./server";
import { formatEta } from "./shared";

const ROW = "[data-sidebar-rename-row]";
// Every row has this box at its end, empty or holding the row's indicator.
const SLOT = ".bb-sidebar-hover-actions-fade";

/** Shows each running ETA at the end of its thread's sidebar row. */
export function mountCountdowns(etas: Record<string, ThreadEta>) {
  function sync() {
    const now = Date.now();
    for (const row of document.querySelectorAll(ROW)) {
      const slot = row.querySelector<HTMLElement>(SLOT);
      if (!slot) continue;
      const id = row.querySelector<HTMLElement>("[data-sidebar-thread-id]")
        ?.dataset.sidebarThreadId;
      const eta = id === undefined ? undefined : etas[id];
      if (eta && eta.until > now) {
        const text = formatEta(eta.until - now);
        if (slot.dataset.superhumanEta !== text)
          slot.dataset.superhumanEta = text;
        slot.title = eta.label ?? "Time left";
      } else if (slot.dataset.superhumanEta !== undefined) {
        clear(slot);
      }
    }
  }

  const timer = setInterval(sync, 1000);
  // Rows re-render as threads change; ignore the chat and terminal output.
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        ({ target }) =>
          target instanceof Element && !target.closest("main, .xterm"),
      )
    )
      sync();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  sync();
  return () => {
    clearInterval(timer);
    observer.disconnect();
    for (const slot of document.querySelectorAll<HTMLElement>(
      "[data-superhuman-eta]",
    ))
      clear(slot);
  };
}

function clear(slot: HTMLElement) {
  delete slot.dataset.superhumanEta;
  slot.removeAttribute("title");
}
