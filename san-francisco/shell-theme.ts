import { watchShellState } from "./shell-state";

const THEME_STYLE_ID = "bb-app-theme";

// Exact replacements for this theme's shell rules. Repeated attributes retain
// each original selector's specificity; declarations and rule order stay intact.
const SELECTORS: readonly (readonly [string, string])[] = [
  [
    "[data-testid=\"app-layout-root\"]:has(> :is([data-testid=\"app-sidebar-trigger-overlay\"], [data-testid=\"app-desktop-sidebar-trigger\"])) > main[data-sidebar=\"inset\"]",
    "[data-testid=\"app-layout-root\"][data-sf-shell~=\"toggle\"] > main[data-sidebar=\"inset\"]",
  ],
  [
    "[data-testid=\"app-layout-root\"]:has([data-testid=\"root-compose-main-window-drag-strip\"]) > [data-testid=\"app-desktop-sidebar-trigger\"] > [data-sidebar=\"trigger\"]",
    "[data-testid=\"app-layout-root\"][data-sf-shell~=\"home\"] > [data-testid=\"app-desktop-sidebar-trigger\"] > [data-sidebar=\"trigger\"]",
  ],
  [
    "[data-testid=\"app-layout-root\"]:has(> :is([data-testid=\"app-sidebar-trigger-overlay\"], [data-testid=\"app-desktop-sidebar-trigger\"]:not([class*=\"left-[84px]\"]))) [data-testid$=\"-sidebar-top-reserve-row\"]",
    "[data-testid=\"app-layout-root\"][data-sf-shell~=\"compact\"][data-sf-shell] [data-testid$=\"-sidebar-top-reserve-row\"]",
  ],
  [
    "[data-testid=\"app-layout-root\"]:has(> [data-testid=\"app-desktop-sidebar-trigger\"][class*=\"left-[84px]\"]) [data-testid$=\"-sidebar-top-reserve-row\"] > *",
    "[data-testid=\"app-layout-root\"][data-sf-shell~=\"window\"][data-sf-shell] [data-testid$=\"-sidebar-top-reserve-row\"] > *",
  ],
  [
    "[data-testid=\"app-layout-root\"]:has(> :is([data-testid=\"app-sidebar-trigger-overlay\"], [data-testid=\"app-desktop-sidebar-trigger\"]:not([class*=\"left-[84px]\"]))) [data-sidebar=\"sidebar\"]:has(> [data-testid=\"app-sidebar-top-reserve-row\"])",
    "[data-testid=\"app-layout-root\"][data-sf-shell~=\"compact\"][data-sf-shell] [data-sidebar=\"sidebar\"][data-sf-sidebar=\"app\"]",
  ],
  [
    "[data-testid=\"app-layout-root\"]:has(> :is([data-testid=\"app-sidebar-trigger-overlay\"], [data-testid=\"app-desktop-sidebar-trigger\"]:not([class*=\"left-[84px]\"]))) [data-sidebar=\"sidebar\"]:has(> [data-testid=\"settings-sidebar-top-reserve-row\"])",
    "[data-testid=\"app-layout-root\"][data-sf-shell~=\"compact\"][data-sf-shell] [data-sidebar=\"sidebar\"][data-sf-sidebar=\"settings\"]",
  ],
  [
    "[data-testid=\"app-layout-root\"]:has(> :is([data-testid=\"app-sidebar-trigger-overlay\"], [data-testid=\"app-desktop-sidebar-trigger\"])) [data-testid=\"app-page-header-content-row\"]:is([data-maximized] *, :not([data-split-resize-grid-root] > :not(:first-child) *))",
    "[data-testid=\"app-layout-root\"][data-sf-shell~=\"toggle\"] [data-testid=\"app-page-header-content-row\"]:is([data-maximized] *, :not([data-split-resize-grid-root] > :not(:first-child) *))",
  ],
  [
    "[data-testid=\"app-layout-root\"]:has(> [data-testid=\"app-desktop-sidebar-trigger\"][class*=\"left-[84px]\"]) [data-testid=\"app-page-header-content-row\"][class*=\"pl-[104px]\"]",
    "[data-testid=\"app-layout-root\"][data-sf-shell~=\"window\"][data-sf-shell] [data-testid=\"app-page-header-content-row\"][class*=\"pl-[104px]\"]",
  ],
  [
    "[data-testid=\"app-sidebar-trigger-overlay\"]:has(> [data-sidebar=\"trigger\"][aria-expanded=\"false\"])",
    "[data-testid=\"app-sidebar-trigger-overlay\"][data-sf-collapsed][data-sf-collapsed]",
  ],
];

type RewrittenRule = { rule: CSSStyleRule; original: string; replacement: string };

/** Use the browser's own selector serialization without adopting a stylesheet. */
function selectorMap(doc: Document) {
  const Sheet = doc.defaultView?.CSSStyleSheet;
  let scratch: CSSStyleSheet | null = null;
  try {
    if (Sheet) scratch = new Sheet();
  } catch {
    // Exact source selectors still work if constructed sheets are unavailable.
  }
  const normalize = (selector: string) => {
    if (!scratch) return selector;
    try {
      scratch.insertRule(`${selector} {}`, 0);
      const normalized = (scratch.cssRules[0] as CSSStyleRule).selectorText;
      scratch.deleteRule(0);
      return normalized;
    } catch {
      return selector;
    }
  };
  return new Map(SELECTORS.map(([original, replacement]) => [normalize(original), normalize(replacement)]));
}

function ownTheme(doc: Document): HTMLStyleElement | null {
  const element = doc.getElementById(THEME_STYLE_ID);
  if (element?.nodeName !== "STYLE") return null;
  const css = element.textContent ?? "";
  if (!/--sf-accent-light\s*:/.test(css) || !/--sf-accent-light-text\s*:/.test(css)) return null;
  return element as HTMLStyleElement;
}

/**
 * Keep the shipped CSS intact for first paint, then substitute cheap shell
 * markers in its CSSOM once those markers exist. Only the active theme sheet's
 * nine known selectors change; cached/source CSS and declarations are untouched.
 */
export function watchShellTheme(doc: Document, signal?: AbortSignal): () => void {
  if (signal?.aborted) return () => {};

  const Observer = doc.defaultView?.MutationObserver ?? MutationObserver;
  const desktop = doc.defaultView?.matchMedia?.("(min-width: 768px)") ?? null;
  const replacements = selectorMap(doc);
  let rewritten: RewrittenRule[] = [];
  let stopState: (() => void) | null = null;
  let disposed = false;

  function restore() {
    for (const { rule, original, replacement } of rewritten) {
      // A later owner may have changed a rule; never undo its replacement.
      if (rule.selectorText === replacement) rule.selectorText = original;
    }
    rewritten = [];
  }

  function visit(rules: CSSRuleList) {
    for (const rule of rules) {
      if (rule.type === 1) {
        const style = rule as CSSStyleRule;
        const replacement = replacements.get(style.selectorText);
        if (replacement) {
          const original = style.selectorText;
          style.selectorText = replacement;
          if (style.selectorText !== original) {
            rewritten.push({ rule: style, original, replacement: style.selectorText });
          }
        }
      }
      if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  }

  function refresh() {
    if (disposed) return;
    restore();
    stopState?.();
    stopState = null;
    // All rewritten rules live in this desktop breakpoint. Phones keep the
    // original stylesheet without maintaining shell markers or DOM observers.
    if (desktop && !desktop.matches) return;
    const theme = ownTheme(doc);
    if (!theme?.sheet || theme.sheet.disabled || theme.hasAttribute("disabled")) return;
    // Theme replacement and shell replacement can share one mutation batch.
    // Refresh markers synchronously before any new sheet begins using them.
    stopState = watchShellState(doc);
    visit(theme.sheet.cssRules);
  }

  const themeNode = (node: Node | null) =>
    node?.nodeType === 1 && (node as Element).id === THEME_STYLE_ID;
  const head = new Observer((records) => {
    if (records.some((record) =>
      themeNode(record.target) || themeNode(record.target.parentNode)
      || (record.type === "attributes" && record.attributeName === "id" && record.oldValue === THEME_STYLE_ID)
      || [...record.addedNodes, ...record.removedNodes].some(themeNode),
    )) refresh();
  });
  head.observe(doc.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["id", "disabled"],
    attributeOldValue: true,
  });
  desktop?.addEventListener("change", refresh);
  refresh();

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener("abort", dispose);
    head.disconnect();
    desktop?.removeEventListener("change", refresh);
    // Restore fallback selectors before clearing the markers they replaced.
    restore();
    stopState?.();
    stopState = null;
  }
  signal?.addEventListener("abort", dispose, { once: true });
  return dispose;
}
