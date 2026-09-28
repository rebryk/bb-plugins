/** Structural shell state for the theme, without relational selectors on the app root. */
export const SHELL_ATTRIBUTE = "data-sf-shell";
export const SIDEBAR_ATTRIBUTE = "data-sf-sidebar";
export const COLLAPSED_ATTRIBUTE = "data-sf-collapsed";

const ROOT = '[data-testid="app-layout-root"]';
const SIDEBAR = '[data-sidebar="sidebar"]';
const HOME = '[data-testid="root-compose-main-window-drag-strip"]';
const DISCOVER = `${ROOT}, ${SIDEBAR}, ${HOME}`;
const OVERLAY = "app-sidebar-trigger-overlay";
const DESKTOP = "app-desktop-sidebar-trigger";

type WatchTarget = { element: Element; attribute: "class" | "aria-expanded" };
type RootState = {
  observer: MutationObserver;
  watched: WatchTarget[];
  overlays: Set<Element>;
};

function mark(element: Element, attribute: string, value: string | null) {
  if (value === null) {
    if (element.hasAttribute(attribute)) element.removeAttribute(attribute);
  } else if (element.getAttribute(attribute) !== value) {
    element.setAttribute(attribute, value);
  }
}

/**
 * Update markers in mutation microtasks, before paint. Discovery only examines
 * added branches; class and expanded-state observers watch the small trigger
 * nodes. Streaming a conversation never causes another document/root scan.
 */
export function watchShellState(doc: Document, signal?: AbortSignal): () => void {
  if (signal?.aborted) return () => {};

  const Observer = doc.defaultView?.MutationObserver ?? MutationObserver;
  const roots = new Map<Element, RootState>();
  const sidebars = new Set<Element>();
  const homes = new Set<Element>();
  const dirtyRoots = new Set<Element>();
  const dirtySidebars = new Set<Element>();
  let homesChanged = false;
  let disposed = false;

  const connected = (element: Element) => element.isConnected && element.ownerDocument === doc;

  function syncRoot(root: Element, state: RootState) {
    if (disposed || !connected(root)) return;
    let toggle = false;
    let compact = false;
    let trafficLights = false;
    const overlays = new Set<Element>();
    const watched: WatchTarget[] = [];

    for (const child of root.children) {
      const testId = child.getAttribute("data-testid");
      if (testId === OVERLAY) {
        toggle = compact = true;
        overlays.add(child);
        let collapsed = false;
        for (const trigger of child.children) {
          if (trigger.getAttribute("data-sidebar") !== "trigger") continue;
          watched.push({ element: trigger, attribute: "aria-expanded" });
          collapsed ||= trigger.getAttribute("aria-expanded") === "false";
        }
        mark(child, COLLAPSED_ATTRIBUTE, collapsed ? "" : null);
      } else if (testId === DESKTOP) {
        toggle = true;
        if (child.getAttribute("class")?.includes("left-[84px]")) trafficLights = true;
        else compact = true;
        watched.push({ element: child, attribute: "class" });
      }
    }

    for (const previous of state.overlays) {
      // A moved overlay may already have been synced by its new root this turn.
      const nextRoot = previous.parentElement;
      const transferred = nextRoot && roots.has(nextRoot) && previous.getAttribute("data-testid") === OVERLAY;
      if (!overlays.has(previous) && !transferred) mark(previous, COLLAPSED_ATTRIBUTE, null);
    }
    state.overlays = overlays;

    const tokens = [
      toggle && "toggle",
      compact && "compact",
      trafficLights && "window",
      [...homes].some((home) => root.contains(home)) && "home",
    ].filter(Boolean).join(" ");
    mark(root, SHELL_ATTRIBUTE, tokens || null);

    if (watched.length !== state.watched.length || watched.some((target, index) =>
      target.element !== state.watched[index]?.element || target.attribute !== state.watched[index]?.attribute)) {
      state.observer.disconnect();
      for (const target of watched) {
        state.observer.observe(target.element, { attributes: true, attributeFilter: [target.attribute] });
      }
      state.watched = watched;
    }
  }

  function syncSidebar(sidebar: Element) {
    let value: string | null = null;
    for (const child of sidebar.children) {
      const testId = child.getAttribute("data-testid");
      if (testId === "app-sidebar-top-reserve-row") value = "app";
      if (testId === "settings-sidebar-top-reserve-row") {
        // Both rules can match during a transition; Settings comes last in CSS.
        value = "settings";
        break;
      }
    }
    mark(sidebar, SIDEBAR_ATTRIBUTE, value);
  }

  function removeRoot(root: Element, state: RootState) {
    state.observer.disconnect();
    state.watched = [];
    for (const overlay of state.overlays) mark(overlay, COLLAPSED_ATTRIBUTE, null);
    state.overlays.clear();
    mark(root, SHELL_ATTRIBUTE, null);
    roots.delete(root);
    dirtyRoots.delete(root);
  }

  function identify(element: Element) {
    if (element.matches(ROOT)) {
      if (!roots.has(element)) {
        const state: RootState = {
          observer: new Observer(() => syncRoot(element, state)),
          watched: [],
          overlays: new Set(),
        };
        roots.set(element, state);
      }
      dirtyRoots.add(element);
    } else {
      const state = roots.get(element);
      if (state) removeRoot(element, state);
    }

    if (element.matches(SIDEBAR)) {
      sidebars.add(element);
      dirtySidebars.add(element);
    } else if (sidebars.delete(element)) {
      mark(element, SIDEBAR_ATTRIBUTE, null);
      dirtySidebars.delete(element);
    }

    if (element.matches(HOME)) {
      homes.add(element);
      homesChanged = true;
    } else if (homes.delete(element)) {
      homesChanged = true;
    }
  }

  function discover(element: Element) {
    if (!connected(element)) return;
    identify(element);
    if (element.firstElementChild) {
      for (const match of element.querySelectorAll(DISCOVER)) identify(match);
    }
  }

  function dirtyContainer(element: Element | null) {
    if (!element) return;
    if (roots.has(element)) dirtyRoots.add(element);
    if (sidebars.has(element)) dirtySidebars.add(element);
    // Overlay children are the buttons whose aria-expanded state is watched.
    if (element.getAttribute("data-testid") === OVERLAY && element.parentElement && roots.has(element.parentElement)) {
      dirtyRoots.add(element.parentElement);
    }
  }

  function flush() {
    for (const [root, state] of roots) {
      if (!connected(root)) removeRoot(root, state);
    }
    for (const sidebar of sidebars) {
      if (!connected(sidebar)) {
        mark(sidebar, SIDEBAR_ATTRIBUTE, null);
        sidebars.delete(sidebar);
        dirtySidebars.delete(sidebar);
      }
    }
    for (const home of homes) {
      if (!connected(home)) {
        homes.delete(home);
        homesChanged = true;
      }
    }
    if (homesChanged) {
      for (const root of roots.keys()) dirtyRoots.add(root);
      homesChanged = false;
    }
    for (const root of dirtyRoots) {
      const state = roots.get(root);
      if (state) syncRoot(root, state);
    }
    for (const sidebar of dirtySidebars) syncSidebar(sidebar);
    dirtyRoots.clear();
    dirtySidebars.clear();
  }

  const structure = new Observer((records) => {
    if (disposed) return;
    const added = new Set<Element>();
    for (const record of records) {
      const target = record.target.nodeType === 1 ? record.target as Element : null;
      if (record.type === "attributes" && target) {
        identify(target);
        dirtyContainer(target.parentElement);
      } else {
        dirtyContainer(target);
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) added.add(node as Element);
        }
      }
    }
    for (const element of added) {
      // A connected subtree can produce records for both its root and children.
      let ancestor = element.parentElement;
      while (ancestor && !added.has(ancestor)) ancestor = ancestor.parentElement;
      if (!ancestor) discover(element);
    }
    flush();
  });

  structure.observe(doc, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-testid", "data-sidebar"],
  });
  for (const element of doc.querySelectorAll(DISCOVER)) identify(element);
  flush();

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener("abort", dispose);
    structure.disconnect();
    for (const [root, state] of roots) removeRoot(root, state);
    for (const sidebar of sidebars) mark(sidebar, SIDEBAR_ATTRIBUTE, null);
    sidebars.clear();
    homes.clear();
    dirtyRoots.clear();
    dirtySidebars.clear();
  }
  signal?.addEventListener("abort", dispose, { once: true });
  return dispose;
}
