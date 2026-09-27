/**
 * The macOS accent colors, in System Settings order, with their fills in light
 * and dark mode and the color of marks drawn on them. The theme's CSS repeats
 * these as --sf-accent-light, --sf-accent-dark and --sf-on-accent and adds a
 * darker or lighter shade for text.
 */
export const ACCENTS = [
  { id: "blue", name: "Blue", light: "#007aff", dark: "#0a84ff", mark: "#ffffff" },
  { id: "purple", name: "Purple", light: "#953d96", dark: "#a550a7", mark: "#ffffff" },
  { id: "pink", name: "Pink", light: "#f74f9e", dark: "#f74f9e", mark: "#ffffff" },
  { id: "red", name: "Red", light: "#e0383e", dark: "#ff5257", mark: "#ffffff" },
  { id: "orange", name: "Orange", light: "#f7821b", dark: "#f7821b", mark: "#ffffff" },
  { id: "yellow", name: "Yellow", light: "#ffc600", dark: "#ffc600", mark: "rgb(0 0 0 / 0.78)" },
  { id: "green", name: "Green", light: "#62ba46", dark: "#62ba46", mark: "#ffffff" },
  { id: "graphite", name: "Graphite", light: "#8c8c8c", dark: "#8c8c8c", mark: "#ffffff" },
] as const;

export type Accent = (typeof ACCENTS)[number];

/** The theme's own colors; the other accents override them through this attribute on <html>. */
export const DEFAULT_ACCENT: Accent = ACCENTS[0];
export const ACCENT_ATTRIBUTE = "data-sf-accent";

/** The Accent color setting, shared by its manifest select and the swatch picker. */
export const ACCENT_SETTING = {
  key: "accent",
  label: "Accent color",
  description: "Underlines links and colors file names, focus rings, selections, switches and checkboxes while San Francisco is the palette.",
} as const;

export const PLUGIN_ID = "san-francisco";

/** The accent last mirrored to <html>, kept in this browser for the next load. */
export const ACCENT_STORAGE_KEY = `${PLUGIN_ID}.accent`;
export const THEME_ID = `plugin:${PLUGIN_ID}:san-francisco`;

/** The accent an Accent color setting names; anything unknown falls back to Blue. */
export function accentOf(value: unknown): Accent {
  return ACCENTS.find((accent) => accent.name === value) ?? DEFAULT_ACCENT;
}

/** The accent this browser showed last, if it remembers one. */
export function rememberedAccent(): Accent | null {
  try {
    const id = localStorage.getItem(ACCENT_STORAGE_KEY);
    return ACCENTS.find((accent) => accent.id === id) ?? null;
  } catch {
    // Storage can be unavailable.
    return null;
  }
}
