/**
 * Names the open settings page so the theme can draw "Settings › Page" in the
 * header and a large page title above the content. Only data attributes are
 * written; the theme's CSS renders them, so nothing shows without the theme.
 *
 * Previewing a palette from Appearance swaps the theme in and out, and the page
 * moves with its layout. The column under an open menu is held so the menu's
 * trigger stays where it was, and Radix keeps the menu beside it; other open
 * menus are pinned where they were. Either way the palette list stays under the
 * pointer.
 */

export const PAGE_ATTRIBUTE = "data-sf-page";
export const PARENT_ATTRIBUTE = "data-sf-page-parent";
export const TITLE_ATTRIBUTE = "data-sf-page-title";
export const DUPLICATE_ATTRIBUTE = "data-sf-duplicate";
export const PINNED_ATTRIBUTE = "data-sf-pinned";

const SETTINGS_ROOT = "/settings";
const SETTINGS_LAYOUT = '[data-testid="settings-sidebar-top-reserve-row"]';
const CURRENT_PAGE = '[data-sidebar="sidebar"] a[aria-current="page"]';
const PLUGINS_PAGE = '[data-sidebar="sidebar"] a[href="/settings/plugins"]';
const PLUGIN_PATH = /^\/settings\/plugins\/[^/]+$/;
const HEADER_TITLE = 'main[data-sidebar="inset"] header [data-testid="app-page-header-content-row"] p';
const PAGE_BODY = 'main[data-sidebar="inset"] [data-testid="app-layout-content-shell"] > main';
const POPPER = "[data-radix-popper-content-wrapper]";
const PINNED_POSITION = "--sf-pinned";
// Outranks the position Radix writes inline; it lives outside the theme, which
// the preview removes.
const PIN_CSS = `[${PINNED_ATTRIBUTE}] { transform: var(${PINNED_POSITION}) !important; }`;

/** Whether San Francisco is the active (or previewed) bb theme. */
export function isThemeActive(doc: Document): boolean {
  return getComputedStyle(doc.documentElement).getPropertyValue("--sf-accent").trim() !== "";
}

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, " ").trim() ?? "";

function pathname(doc: Document, href: string) {
  return new URL(href, doc.location.href).pathname.replace(/\/+$/, "");
}

/**
 * Whether a first section heading only repeats the page title: "Machines" on
 * Machines, and as the page's only heading also a longer or plural form
 * ("Keyboard shortcuts" on Keyboard, "Browsers" on Browser).
 */
export function repeatsTitle(heading: string, title: string, only: boolean) {
  const h = heading.toLowerCase();
  const t = title.toLowerCase();
  return h === t || (only && (h.startsWith(`${t} `) || h === `${t}s`));
}

/**
 * The settings page: the name that ends the breadcrumb, the sidebar entry above
 * it on detail pages, the large title ("" where the page draws its own), the
 * header title row, the content column and a first section heading that only
 * repeats the title.
 */
export function findSettingsPage(doc: Document) {
  if (!doc.querySelector(SETTINGS_LAYOUT)) return null;
  const path = pathname(doc, doc.location.pathname);
  // The sidebar lists only plugins with settings; the others' pages sit below
  // Installed plugins.
  const current = doc.querySelector(CURRENT_PAGE);
  const link = current ?? (PLUGIN_PATH.test(path) ? doc.querySelector(PLUGINS_PAGE) : null);
  const entry = text(link);
  if (!link || !entry) return null;
  const title = [...doc.querySelectorAll<HTMLElement>(HEADER_TITLE)]
    .find((element) => text(element) === "Settings");
  // The first centered column of the page body holds its content.
  const column = doc.querySelector(PAGE_BODY)?.querySelector<HTMLElement>(".mx-auto") ?? null;
  const base = { header: title?.parentElement ?? null, column };

  // A machine, a project or a plugin's details open below their list's entry
  // and name themselves in their own heading. General's "/settings" also
  // answers at /settings/general; that is the page itself, not a detail.
  const href = link.getAttribute("href");
  const parent = href ? pathname(doc, href) : SETTINGS_ROOT;
  if (parent !== SETTINGS_ROOT && path.startsWith(`${parent}/`)) {
    const item = text(column?.querySelector("h1"));
    // An unlisted plugin's page is laid out like a listed one's, whose sections
    // keep a titled page's headings; its own name stands in for the title.
    return item
      ? { ...base, name: item, parent: entry, title: current ? "" : item, heading: null }
      : { ...base, name: entry, parent: null, title: "", heading: null };
  }

  const headings = column?.querySelectorAll<HTMLElement>("h2") ?? [];
  const first = headings[0] ?? null;
  const repeats = first !== null && repeatsTitle(text(first), entry, headings.length === 1);
  return { ...base, name: entry, parent: null, title: entry, heading: repeats ? first : null };
}

/**
 * Holds every open popper where Radix last placed it, except the given ones.
 * Called as the theme comes or goes, before Radix measures the moved anchor. A
 * popper stays pinned until it closes, which removes it.
 */
export function pinPoppers(doc: Document, except: ReadonlySet<Element> = new Set()) {
  for (const popper of doc.querySelectorAll<HTMLElement>(POPPER)) {
    const position = popper.style.transform;
    // Radix parks a popper at translate(0, -200%) until it is placed.
    if (except.has(popper) || popper.hasAttribute(PINNED_ATTRIBUTE) || !position || position.includes("%")) continue;
    popper.style.setProperty(PINNED_POSITION, position);
    popper.setAttribute(PINNED_ATTRIBUTE, "");
  }
}

/** The element that opened a popper: Radix names the popper's content in its aria-controls. */
function findTrigger(doc: Document, popper: Element) {
  const id = popper.firstElementChild?.id;
  if (!id) return null;
  return [...doc.querySelectorAll<HTMLElement>("[aria-controls]")]
    .find((element) => element.getAttribute("aria-controls") === id) ?? null;
}

/** The point of a trigger that a popper hangs from: the edge on its side, at its alignment. */
function anchorPoint(rect: DOMRect, popper: Element) {
  const side = popper.firstElementChild?.getAttribute("data-side");
  const align = popper.firstElementChild?.getAttribute("data-align");
  const along = (start: number, end: number) =>
    align === "end" ? end : align === "center" ? (start + end) / 2 : start;
  if (side === "left" || side === "right") {
    return { x: side === "left" ? rect.left : rect.right, y: along(rect.top, rect.bottom) };
  }
  return { x: along(rect.left, rect.right), y: side === "top" ? rect.top : rect.bottom };
}

function sync(doc: Document, attribute: string, target: HTMLElement | null, value: string | null) {
  for (const element of doc.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
    if (element !== target || value === null) element.removeAttribute(attribute);
  }
  if (target && value !== null && target.getAttribute(attribute) !== value) {
    target.setAttribute(attribute, value);
  }
}

/**
 * Keep the attributes current while the theme is active, and hold or pin open
 * menus when it comes or goes; returns the disposer.
 */
export function watchSettingsTitle(doc: Document, signal?: AbortSignal): () => void {
  let frame = 0;
  let body: MutationObserver | null = null;

  function apply() {
    frame = 0;
    const page = body ? findSettingsPage(doc) : null;
    sync(doc, PAGE_ATTRIBUTE, page?.header ?? null, page?.name ?? null);
    sync(doc, PARENT_ATTRIBUTE, page?.header ?? null, page?.parent ?? null);
    sync(doc, TITLE_ATTRIBUTE, page?.column ?? null, page?.title ?? null);
    sync(doc, DUPLICATE_ATTRIBUTE, page?.heading ?? null, page?.heading ? "" : null);
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(apply);
  }

  // Where each open popper's trigger sat when it opened, and the offsets that
  // hold the page columns under held poppers.
  const anchors = new WeakMap<Element, { trigger: HTMLElement; rect: DOMRect }>();
  const held = new Set<Element>();
  const offsets = new Map<HTMLElement, { x: number; y: number }>();
  let recordFrame = 0;

  function record() {
    recordFrame = 0;
    for (const popper of doc.querySelectorAll(POPPER)) {
      const trigger = anchors.has(popper) ? null : findTrigger(doc, popper);
      if (trigger) anchors.set(popper, { trigger, rect: trigger.getBoundingClientRect() });
    }
  }

  /** Moves the page column under a popper so its trigger is back where it was; whether it could. */
  function hold(popper: Element) {
    const anchor = anchors.get(popper);
    const column = anchor?.trigger.isConnected ? anchor.trigger.closest<HTMLElement>(`${PAGE_BODY} .mx-auto`) : null;
    if (!anchor || !column || popper.hasAttribute(PINNED_ATTRIBUTE)) return false;
    const was = anchorPoint(anchor.rect, popper);
    const now = anchorPoint(anchor.trigger.getBoundingClientRect(), popper);
    const offset = offsets.get(column) ?? { x: 0, y: 0 };
    const next = { x: offset.x + was.x - now.x, y: offset.y + was.y - now.y };
    offsets.set(column, next);
    if (next.x || next.y) column.style.translate = `${next.x}px ${next.y}px`;
    else column.style.removeProperty("translate");
    held.add(popper);
    return true;
  }

  function release() {
    for (const popper of held) if (!popper.isConnected) held.delete(popper);
    if (held.size) return;
    for (const column of offsets.keys()) column.style.removeProperty("translate");
    offsets.clear();
  }

  // Radix portals each popper into <body>.
  const poppers = new MutationObserver(() => {
    if (!recordFrame) recordFrame = requestAnimationFrame(record);
    release();
  });
  poppers.observe(doc.body, { childList: true });

  let wasActive = isThemeActive(doc);
  const pinStyle = doc.createElement("style");
  pinStyle.textContent = PIN_CSS;

  // Themes arrive and change through bb's <style id="bb-app-theme"> in <head>.
  function refreshActive() {
    const active = isThemeActive(doc);
    const changed = active !== wasActive;
    wasActive = active;
    if (active && !body) {
      body = new MutationObserver(schedule);
      body.observe(doc.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-current"],
      });
    } else if (!active && body) {
      body.disconnect();
      body = null;
    }
    if (!changed) {
      schedule();
      return;
    }
    // The page takes the new theme's layout at once, so the held columns
    // measure it before Radix follows the moved triggers.
    if (frame) cancelAnimationFrame(frame);
    apply();
    pinPoppers(doc, new Set([...doc.querySelectorAll(POPPER)].filter(hold)));
    if (!pinStyle.isConnected && doc.querySelector(`[${PINNED_ATTRIBUTE}]`)) doc.head.append(pinStyle);
  }

  const head = new MutationObserver(refreshActive);
  head.observe(doc.head, { childList: true, subtree: true, characterData: true });
  refreshActive();

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    head.disconnect();
    poppers.disconnect();
    body?.disconnect();
    body = null;
    if (frame) cancelAnimationFrame(frame);
    if (recordFrame) cancelAnimationFrame(recordFrame);
    held.clear();
    release();
    pinStyle.remove();
    for (const popper of doc.querySelectorAll<HTMLElement>(`[${PINNED_ATTRIBUTE}]`)) {
      popper.style.removeProperty(PINNED_POSITION);
    }
    for (const attribute of [PAGE_ATTRIBUTE, PARENT_ATTRIBUTE, TITLE_ATTRIBUTE, DUPLICATE_ATTRIBUTE, PINNED_ATTRIBUTE]) {
      sync(doc, attribute, null, null);
    }
  }
  signal?.addEventListener("abort", dispose, { once: true });
  return dispose;
}
