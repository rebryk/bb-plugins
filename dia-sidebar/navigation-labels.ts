const ROOT = "[data-dia-sidebar]";
const NAVIGATION =
  `${ROOT} [data-testid="plugin-nav-sidebar-items"]` +
  ':not([data-sidebar-navigation-customize-mode="true"])';
const BUTTONS =
  `${NAVIGATION} [data-sidebar-navigation-item] > button, ` +
  `${NAVIGATION} [data-testid="sidebar-navigation-more-trigger"]`;

type OwnedTitle = { previous: string | null; value: string };

/** Add hover labels without taking over BB's buttons, listeners, or state. */
export function mountNavigationLabels(doc: Document): () => void {
  const titles = new Map<HTMLElement, OwnedTitle>();

  function restore(button: HTMLElement, owned: OwnedTitle) {
    if (button.getAttribute("title") !== owned.value) return;
    if (owned.previous === null) button.removeAttribute("title");
    else button.setAttribute("title", owned.previous);
  }

  function refresh() {
    const buttons = new Set(doc.querySelectorAll<HTMLElement>(BUTTONS));
    for (const [button, owned] of titles) {
      if (buttons.has(button)) continue;
      restore(button, owned);
      titles.delete(button);
    }
    for (const button of buttons) {
      const title = button.getAttribute("title");
      const owned = titles.get(button);
      // A title authored by BB or another plugin always takes precedence.
      if (title !== null && title !== owned?.value) continue;
      const label =
        button.getAttribute("aria-label")?.trim() ||
        button.querySelector("span.truncate")?.textContent?.trim();
      if (!label) continue;
      titles.set(button, {
        previous: owned ? owned.previous : title,
        value: label,
      });
      if (title !== label) button.setAttribute("title", label);
    }
  }

  const observer = new MutationObserver((records) => {
    const affectsNavigation = records.some((record) => {
      const target =
        record.target instanceof Element
          ? record.target
          : record.target.parentElement;
      if (target?.closest(ROOT)) return true;
      return [...record.addedNodes, ...record.removedNodes].some(
        (node) =>
          node instanceof Element &&
          (node.matches(ROOT) || node.querySelector(ROOT) !== null),
      );
    });
    if (affectsNavigation) refresh();
  });
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-label", "data-sidebar-navigation-customize-mode"],
  });
  refresh();

  return () => {
    observer.disconnect();
    for (const [button, owned] of titles) restore(button, owned);
    titles.clear();
  };
}
