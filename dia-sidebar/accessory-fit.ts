const ROOT = "[data-dia-sidebar]";
const CONTENT =
  `${ROOT} [data-testid="plugin-nav-sidebar-items"]` +
  ':not([data-sidebar-navigation-customize-mode="true"]) ' +
  "[data-plugin-nav-sidebar-accessory] > [data-bb-plugin-root]";
const SCALE = "--dia-sidebar-accessory-scale";

type Accessory = {
  viewport: HTMLElement;
  previousValue: string;
  previousPriority: string;
  value: string;
};

/** Fit the original, still-mounted plugin UI into a bounded corner viewport. */
export function mountAccessoryFit(doc: Document): () => void {
  const win = doc.defaultView!;
  const accessories = new Map<HTMLElement, Accessory>();

  function fit(content: HTMLElement, accessory: Accessory) {
    // Computed dimensions and scroll sizes are independent of our transform.
    // Keep subpixel sizes: offsetWidth alone can round a badge down too far.
    const style = win.getComputedStyle(content);
    const width = Math.max(parseFloat(style.width) || 0, content.scrollWidth);
    const height = Math.max(parseFloat(style.height) || 0, content.scrollHeight);
    const scale =
      width > 0 && height > 0
        ? Math.min(
            1,
            accessory.viewport.clientWidth / width,
            accessory.viewport.clientHeight / height,
          )
        : 0;
    const value = String(scale);
    accessory.value = value;
    if (content.style.getPropertyValue(SCALE) !== value) {
      content.style.setProperty(SCALE, value);
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    for (const [content, accessory] of accessories) fit(content, accessory);
  });

  function release(content: HTMLElement, accessory: Accessory) {
    resizeObserver.unobserve(content);
    resizeObserver.unobserve(accessory.viewport);
    if (content.style.getPropertyValue(SCALE) !== accessory.value) return;
    if (accessory.previousValue) {
      content.style.setProperty(
        SCALE,
        accessory.previousValue,
        accessory.previousPriority,
      );
    } else {
      content.style.removeProperty(SCALE);
    }
  }

  function refresh() {
    const contents = new Set(doc.querySelectorAll<HTMLElement>(CONTENT));
    for (const [content, accessory] of accessories) {
      if (contents.has(content)) continue;
      release(content, accessory);
      accessories.delete(content);
    }
    for (const content of contents) {
      let accessory = accessories.get(content);
      if (!accessory) {
        accessory = {
          viewport: content.parentElement!,
          previousValue: content.style.getPropertyValue(SCALE),
          previousPriority: content.style.getPropertyPriority(SCALE),
          value: "",
        };
        accessories.set(content, accessory);
        resizeObserver.observe(content);
        resizeObserver.observe(accessory.viewport);
      }
      fit(content, accessory);
    }
  }

  const mutations = new MutationObserver((records) => {
    const relevant = records.some((record) => {
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
    if (relevant) refresh();
  });
  mutations.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "class", "style", "width", "height", "hidden",
      "data-sidebar-navigation-customize-mode",
    ],
  });
  refresh();

  return () => {
    mutations.disconnect();
    resizeObserver.disconnect();
    for (const [content, accessory] of accessories) release(content, accessory);
    accessories.clear();
  };
}
