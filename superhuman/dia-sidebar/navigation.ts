const NAVIGATION = '[data-testid="plugin-nav-sidebar-items"]:not([data-sidebar-navigation-customize-mode="true"])';
const BUTTON = "[data-sidebar-navigation-item] > button";
const ACCESSORY = "[data-plugin-nav-sidebar-accessory] > [data-bb-plugin-root]";
const SCALE = "--dia-sidebar-accessory-scale";

/** Enhance BB's mounted controls without copying their state or components. */
export function enhanceNavigation(root: HTMLElement): () => void {
  const titles = new Map<HTMLElement, string>();
  let accessories = new Map<HTMLElement, HTMLElement>();

  function restoreTitle(button: HTMLElement, title: string) {
    if (button.title === title) button.removeAttribute("title");
  }

  function fitAccessories() {
    // Read every box before writing, so no write forces the next read to relayout.
    const scales = [...accessories].map(([content, viewport]) => {
      // These dimensions are independent of our transform, including fractions.
      const style = getComputedStyle(content);
      const width = Math.max(parseFloat(style.width) || 0, content.scrollWidth);
      const height = Math.max(parseFloat(style.height) || 0, content.scrollHeight);
      const scale = width && height
        ? Math.min(1, viewport.clientWidth / width, viewport.clientHeight / height)
        : 0;
      return [content, String(scale)] as const;
    });
    for (const [content, scale] of scales) {
      if (content.style.getPropertyValue(SCALE) !== scale) content.style.setProperty(SCALE, scale);
    }
  }

  // The only place that measures: it runs after layout, so reads are free, and
  // newly observed boxes get an initial callback. Zero-size ones keep CSS scale 0.
  const resize = new ResizeObserver(fitAccessories);
  function refresh() {
    const buttons = new Set(root.querySelectorAll<HTMLElement>(
      `${NAVIGATION} :is(${BUTTON}, [data-testid="sidebar-navigation-more-trigger"])`,
    ));
    for (const [button, title] of titles) {
      if (buttons.has(button)) continue;
      restoreTitle(button, title);
      titles.delete(button);
    }
    for (const button of buttons) {
      // Leave titles supplied by BB or another plugin alone.
      if (button.hasAttribute("title") && button.title !== titles.get(button)) continue;
      const label = button.getAttribute("aria-label")?.trim()
        || button.querySelector("span.truncate")?.textContent?.trim();
      if (label) {
        // Titles are observed; rewriting an unchanged one would refresh forever.
        if (button.title !== label) button.title = label;
        titles.set(button, label);
      }
    }
    const next = new Map([...root.querySelectorAll<HTMLElement>(`${NAVIGATION} ${ACCESSORY}`)]
      .map(content => [content, content.parentElement!]));
    for (const [content, viewport] of accessories) {
      if (next.has(content)) continue;
      resize.unobserve(content);
      resize.unobserve(viewport);
      content.style.removeProperty(SCALE);
    }
    for (const [content, viewport] of next) {
      if (accessories.has(content)) continue;
      resize.observe(content);
      resize.observe(viewport);
    }
    accessories = next;
  }

  function tileButton(event: Event) {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>(BUTTON) : null;
    return button?.closest(NAVIGATION) ? button : null;
  }

  function openMenu(event: KeyboardEvent) {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    const button = tileButton(event);
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const { left, bottom } = button.getBoundingClientRect();
    button.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: left, clientY: bottom,
    }));
  }

  function preventListDrag(event: Event) {
    // BB's Mouse/Touch sensors sort a vertical list. Reorder in Customize;
    // leave pointerdown intact for BB's separate drag-to-split gesture.
    if (tileButton(event)) event.stopPropagation();
  }

  // Only what refresh reads; geometry is the ResizeObserver's, so our scale writes
  // never come back here. A host dropping its own title frees the tile for ours.
  const mutations = new MutationObserver(refresh);
  mutations.observe(root, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ["aria-label", "title", "data-sidebar-navigation-customize-mode"],
  });
  root.addEventListener("keydown", openMenu);
  root.addEventListener("mousedown", preventListDrag, true);
  root.addEventListener("touchstart", preventListDrag, true);
  refresh();

  return () => {
    mutations.disconnect();
    resize.disconnect();
    root.removeEventListener("keydown", openMenu);
    root.removeEventListener("mousedown", preventListDrag, true);
    root.removeEventListener("touchstart", preventListDrag, true);
    for (const [button, title] of titles) restoreTitle(button, title);
    for (const content of accessories.keys()) content.style.removeProperty(SCALE);
  };
}
