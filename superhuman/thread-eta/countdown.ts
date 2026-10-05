import { changedOutside } from "../lib/mutations";
import type { ThreadEta } from "./server";
import { formatEta } from "./shared";

const ROW = "[data-sidebar-rename-row]";
// Every row has this box at its end, empty or holding the row's indicator.
const SLOT = ".bb-sidebar-hover-actions-fade";
// The 28px box around the slot, which grows to fit the digits. Marking it
// spares app.css a :has() test of every element on the page.
const BOX = "data-superhuman-eta-box";

/** Shows each running ETA at the end of its thread's sidebar row. */
export function mountCountdowns(etas: Record<string, ThreadEta>) {
  let shown = new Set<HTMLElement>();

  function sync() {
    const now = Date.now();
    const next = new Set<HTMLElement>();
    // Only rows with a running ETA need their slot looked up.
    for (const link of document.querySelectorAll<HTMLElement>(
      `${ROW} [data-sidebar-thread-id]`,
    )) {
      const eta = etas[link.dataset.sidebarThreadId!];
      if (!eta || eta.until <= now) continue;
      const row = link.closest(ROW)!;
      // A row counts down for its first thread only.
      if (row.querySelector("[data-sidebar-thread-id]") !== link) continue;
      const slot = row.querySelector<HTMLElement>(SLOT);
      if (!slot) continue;
      const text = formatEta(eta.until - now);
      if (slot.dataset.superhumanEta !== text) slot.dataset.superhumanEta = text;
      const title = eta.label ?? "Time left";
      if (slot.title !== title) slot.title = title;
      const box = slot.parentElement;
      if (box?.classList.contains("relative") && !box.hasAttribute(BOX))
        box.setAttribute(BOX, "");
      next.add(slot);
    }
    for (const slot of shown) if (!next.has(slot)) clear(slot);
    shown = next;
  }

  const timer = setInterval(sync, 1000);
  // Rows re-render as threads change; ignore the chat and terminal output,
  // and sync once a frame however many changes it brings.
  let frame = 0;
  const observer = new MutationObserver((records) => {
    if (!frame && changedOutside(records, "main, .xterm"))
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  sync();
  return () => {
    clearInterval(timer);
    observer.disconnect();
    cancelAnimationFrame(frame);
    for (const slot of shown) clear(slot);
    shown.clear();
  };
}

function clear(slot: HTMLElement) {
  delete slot.dataset.superhumanEta;
  slot.removeAttribute("title");
  slot.parentElement?.removeAttribute(BOX);
}
