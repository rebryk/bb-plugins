// BB has no route-scoped chrome API yet. This content script decorates only
// the mounted Agents surface; it never changes saved sidebar/panel settings.
const marker = 'data-fa-focused-shell';
const pageSelector = '[data-bb-plugin="fluently-agents"] .fa-app';
const css = `
[${marker}="shell"] > [data-side="left"],
[${marker}="shell"] > [data-testid="app-sidebar-trigger-overlay"],
[${marker}="header"],
[${marker}="hidden"],
[${marker}="shell"] > [data-sidebar-mobile-backdrop],
[${marker}="panels"] > :not([${marker}="main"]) { display: none !important; }
[${marker}="shell"] > main[data-sidebar="inset"] {
  margin: 0 !important; border: 0 !important; border-radius: 0 !important;
  box-shadow: none !important; translate: none !important;
}
[${marker}="main"] { flex: 1 1 0% !important; min-width: 0 !important; }
`;

export function mountFocusedShell() {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  let marked = new Map<Element, string>();
  function update() {
    const next = new Map<Element, string>();
    const page = document.querySelector(pageSelector);
    const shell = page?.closest('[data-testid="app-layout-root"]');
    const main = page?.closest('[data-panel]');
    const panels = main?.parentElement;
    let ancestor = page?.parentElement;
    let header: Element | null = null;
    while (ancestor && ancestor !== main && !header) {
      header = ancestor.querySelector(':scope > header');
      ancestor = ancestor.parentElement;
    }
    // Another split must keep its own BB controls and navigation usable.
    if (shell && main && panels?.hasAttribute('data-panel-group') && header
      && shell.querySelectorAll('[data-split-pane-id]').length <= 1) {
      next.set(shell, 'shell'); next.set(header, 'header');
      next.set(main, 'main'); next.set(panels, 'panels');
      const shelf = document.querySelector('[data-testid="secondary-panel-shelf"]');
      if (shelf) next.set(shelf, 'hidden');
    }
    for (const element of marked.keys()) if (!next.has(element)) element.removeAttribute(marker);
    for (const [element, value] of next) if (marked.get(element) !== value) element.setAttribute(marker, value);
    marked = next;
  }
  const observer = new MutationObserver(update);
  observer.observe(document.body, { childList: true, subtree: true });
  update();
  return () => {
    observer.disconnect();
    for (const element of marked.keys()) element.removeAttribute(marker);
    style.remove();
  };
}
