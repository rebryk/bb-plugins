const PHONE = "(width < 48rem) and (pointer: coarse)";
const SETTINGS_LIST = '[data-testid="settings-sidebar-body"]';
const SIDEBAR = '[data-sidebar="panel"]';
const SIDEBAR_BUTTON = 'button[data-sidebar="trigger"]';

const inSettings = (path: string) =>
  path === "/settings" || path.startsWith("/settings/");

/**
 * Opens the sidebar with Settings' list of sections each time a phone enters
 * Settings, until the returned function runs. BB opens a section, General,
 * and closes the sidebar instead.
 */
export function startSettingsSidebar(doc: Document): () => void {
  const win = doc.defaultView;
  if (!win) return () => {};
  const phone = win.matchMedia(PHONE);
  // Whether the sidebar has had its chance to open since Settings was entered.
  // A page that starts in Settings, as after a reload, keeps its section.
  let shown = inSettings(win.location.pathname);

  // BB changes the route without an event, so every change to the page checks
  // it. BB puts the list in the sidebar only after the route has changed, and
  // closes the sidebar as it does.
  const watch = new win.MutationObserver(() => {
    if (!inSettings(win.location.pathname)) {
      shown = false;
      return;
    }
    if (shown || !doc.querySelector(SETTINGS_LIST)) return;
    shown = true;
    if (!phone.matches) return;
    if (doc.querySelector(SIDEBAR)?.getAttribute("data-state") === "open")
      return;
    // The button is hidden on a phone, where a swipe opens the sidebar, but
    // still takes a click.
    doc.querySelector<HTMLElement>(SIDEBAR_BUTTON)?.click();
  });
  watch.observe(doc.body, { childList: true, subtree: true });
  return () => watch.disconnect();
}
