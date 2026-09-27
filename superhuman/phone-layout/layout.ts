const PHONE = "(width < 48rem) and (pointer: coarse)";
const PAGE = 'main[data-sidebar="inset"]';
const BUTTON = '[data-testid="app-sidebar-trigger-overlay"]';
const EVENTS = ["touchstart", "pointerdown", "keydown"] as const;

/**
 * Lets app.css move BB's bars to the bottom on a phone, and keeps the sidebar
 * button, down in the page's bar, on the page as the sidebar or the right
 * panel pushes it aside, until the returned function runs.
 */
export function startPhoneLayout(doc: Document): () => void {
  const win = doc.defaultView;
  if (!win) return () => {};
  const root = doc.documentElement;
  root.dataset.phoneLayout = "";
  const phone = win.matchMedia(PHONE);

  // BB moves the page with a finger, with inline styles, and with its
  // classes, so the button copies where the page is each frame until the page
  // rests.
  let page: HTMLElement | null = null;
  let frame = 0;
  const follow = () => {
    frame = 0;
    const button = doc.querySelector<HTMLElement>(BUTTON);
    if (!button) return;
    if (!page || !phone.matches) {
      button.style.translate = "";
      return;
    }
    button.style.translate = `${page.getBoundingClientRect().left}px`;
    if (page.getAnimations().length) frame = win.requestAnimationFrame(follow);
  };
  const moves = new win.MutationObserver(() => {
    win.cancelAnimationFrame(frame);
    follow();
  });
  // BB may render the page again; whatever moves it starts with one of
  // these events.
  const watch = () => {
    if (page?.isConnected) return;
    page = doc.querySelector<HTMLElement>(PAGE);
    moves.disconnect();
    if (!page) return;
    moves.observe(page, {
      attributes: true,
      attributeFilter: ["style", "class", "data-sidebar-shelf", "data-panel-shelf"],
    });
    follow();
  };
  const listen = { capture: true, passive: true };
  for (const type of EVENTS) doc.addEventListener(type, watch, listen);
  phone.addEventListener("change", follow);
  watch();

  return () => {
    for (const type of EVENTS) doc.removeEventListener(type, watch, listen);
    phone.removeEventListener("change", follow);
    moves.disconnect();
    win.cancelAnimationFrame(frame);
    const button = doc.querySelector<HTMLElement>(BUTTON);
    if (button) button.style.translate = "";
    delete root.dataset.phoneLayout;
  };
}
