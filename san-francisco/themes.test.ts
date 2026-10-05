import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { ACCENTS, ACCENT_ATTRIBUTE, DEFAULT_ACCENT, PLUGIN_ID, THEME_ID, accentOf } from "./accents";
import { insideHasSelectors } from "./has-selectors";
import plugin from "./server";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const read = (relative: string) => readFileSync(path(relative), "utf8");
const manifest = JSON.parse(read("./package.json"));
const css = read("./themes/san-francisco.css");

// bb reads at most this many characters of a theme stylesheet.
const THEME_CSS_MAX_LENGTH = 256_000;

function luminance(hex: string) {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** A hex color, or rgb(r g b / alpha) painted over a hex backdrop. */
function paint(color: string, backdrop: string) {
  const rgba = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(color);
  if (!rgba) return color;
  const alpha = Number(rgba[4]);
  const channel = (i: number) => {
    const under = parseInt(backdrop.slice(2 * i - 1, 2 * i + 1), 16);
    return Math.round(Number(rgba[i]) * alpha + under * (1 - alpha)).toString(16).padStart(2, "0");
  };
  return `#${channel(1)}${channel(2)}${channel(3)}`;
}

/** The declarations of the first rule with exactly this selector. */
function block(selector: string) {
  const start = css.indexOf(`\n${selector} {\n`);
  if (start < 0) throw new Error(`no ${selector} rule`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/^\s+(--[\w-]+):\s*([^;]+);/gm)].map((match) => [match[1], match[2]]));
}

const accentSelector = (id: string) => (id === DEFAULT_ACCENT.id ? ":root" : `:root[${ACCENT_ATTRIBUTE}="${id}"]`);

const MODES = { light: block(":root,\n.light"), dark: block(".dark") };

// bb 0.43's default palette. No San Francisco text may have less contrast
// than bb's on the same surface.
const BB = {
  light: {
    surfaces: { canvas: "#ffffff", sidebar: "#fafafa", popover: "#ffffff", raised: "#f9f9f9", recessed: "#f3f3f3" },
    text: { foreground: "#333333", muted: "#525252", subtle: "#636363", readback: "#5b5b5b", destructive: "#a5000f", destructiveText: "#a5000f", warning: "#b0540e", accent: "#4075aa" },
  },
  dark: {
    surfaces: { canvas: "#151515", sidebar: "#1b1b1b", popover: "#151515", raised: "#181818", recessed: "#1f1f1f" },
    text: { foreground: "#c1c1c1", muted: "#b7b7b7", subtle: "#989898", readback: "#a3a3a3", destructive: "#cc323d", destructiveText: "#e06062", warning: "#fc8c45", accent: "#79a9db" },
  },
} as const;

type Surface = keyof typeof BB.light.surfaces;
const SURFACES = Object.keys(BB.light.surfaces) as Surface[];

/** San Francisco's surface for each of bb's; code blocks recess into the canvas. */
function surfaces(colors: Record<string, string>): Record<Surface, string> {
  return {
    canvas: colors["--canvas"]!,
    sidebar: colors["--sidebar"]!,
    popover: colors["--popover"]!,
    raised: colors["--surface-raised-solid"]!,
    recessed: paint(colors["--surface-recessed"]!, colors["--canvas"]!),
  };
}

describe("manifest", () => {
  it("declares one theme", () => {
    expect(manifest.bb.themes.map((theme: { id: string }) => theme.id)).toEqual(["san-francisco"]);
    expect(existsSync(path(manifest.bb.themes[0].css))).toBe(true);
    expect(THEME_ID).toBe(`plugin:${PLUGIN_ID}:${manifest.bb.themes[0].id}`);
  });

  it("uses the plugin id bb derives from the package name", () => {
    expect(manifest.name.replace(/^bb-plugin-/, "")).toBe(PLUGIN_ID);
  });

  it("offers every accent in the Accent color setting", () => {
    let settings: Record<string, { options?: string[]; default?: unknown }> = {};
    plugin({ settings: { define: (descriptors: typeof settings) => { settings = descriptors; } } } as unknown as BbPluginApi);
    expect(settings.accent?.options).toEqual(ACCENTS.map((accent) => accent.name));
    expect(settings.accent?.default).toBe(DEFAULT_ACCENT.name);
  });
});

describe("stylesheet", () => {
  it("fits bb's limit and stands alone", () => {
    expect(css.length).toBeLessThan(THEME_CSS_MAX_LENGTH);
    expect(css).not.toMatch(/@import/);
  });

  it("never styles an element's inside by what the element holds", () => {
    expect(insideHasSelectors(css)).toEqual([]);
  });

  it("defines every token it uses and uses every token it defines", () => {
    const defined = new Set([...css.matchAll(/(--sf-[\w-]+)\s*:/g)].map((match) => match[1]));
    // Markers for style queries are read by @container style(), not var().
    const used = new Set([...css.matchAll(/(?:var|style)\((--sf-[\w-]+)/g)].map((match) => match[1]));
    expect([...used].filter((token) => !defined.has(token))).toEqual([]);
    expect([...defined].filter((token) => !used.has(token))).toEqual([]);
  });

  it("keeps palette values in the two top-level mode blocks", () => {
    expect(css).toMatch(/^:root,\n\.light \{$/m);
    expect(css).toMatch(/^\.dark \{$/m);
  });

  it("redefines every light token in dark mode", () => {
    // :root also matches html.dark, so a token only the light block sets
    // would leak into dark mode.
    expect(Object.keys(MODES.light).filter((token) => !(token in MODES.dark))).toEqual([]);
  });

  it("colors exactly the known accents", () => {
    const overridden = [...css.matchAll(new RegExp(`\\[${ACCENT_ATTRIBUTE}="([\\w-]+)"\\]`, "g"))].map((match) => match[1]);
    expect(overridden).toEqual(ACCENTS.filter((accent) => accent !== DEFAULT_ACCENT).map((accent) => accent.id));
  });
});

describe("contrast", () => {
  // Each San Francisco text token and the bb color it stands in for.
  const TOKENS = [
    ["--ink", "foreground"],
    ["--sf-soft", "foreground"],
    ["--muted-foreground", "muted"],
    ["--subtle-foreground", "subtle"],
    ["--readback-foreground", "readback"],
    ["--destructive", "destructive"],
    ["--destructive-text", "destructiveText"],
    ["--warning-text", "warning"],
  ] as const;

  it.each(["light", "dark"] as const)("keeps %s text at least as legible as bb's", (mode) => {
    const colors = MODES[mode];
    const ours = surfaces(colors);
    const bb = BB[mode];
    for (const [token, role] of TOKENS) {
      for (const surface of SURFACES) {
        expect(contrast(colors[token]!, ours[surface]), `${token} on ${surface}`).toBeGreaterThanOrEqual(contrast(bb.text[role], bb.surfaces[surface]));
      }
    }
  });

  // bb's dark terminal, diff and status colors. Light mode keeps bb's own on
  // bb's own surfaces; --ansi-15 is white already.
  const BB_DARK = {
    ansi: {
      "--ansi-0": "#858585", "--ansi-1": "#d85e5e", "--ansi-2": "#0dbc79", "--ansi-3": "#e5e510", "--ansi-4": "#3c88dc",
      "--ansi-5": "#c85ac8", "--ansi-6": "#11a8cd", "--ansi-7": "#e5e5e5", "--ansi-8": "#9a9a9a", "--ansi-9": "#ff6f6f",
      "--ansi-10": "#23d18b", "--ansi-11": "#f5f543", "--ansi-12": "#5aaaf2", "--ansi-13": "#d670d6", "--ansi-14": "#29b8db",
    },
    status: {
      "--diff-added": "#00d594", "--diff-removed": "#ff696d", "--success": "#4bc680", "--attention": "#f0b135", "--warning": "#fc8c45", "--pr-merged": "#a27dfa",
    },
  } as const;

  it.each([
    // Command output sits on the canvas, the terminal on the sidebar color.
    ["terminal", BB_DARK.ansi, ["canvas", "sidebar"]],
    ["diff and status", BB_DARK.status, SURFACES],
  ] as const)("keeps bb's dark %s colors as legible", (_name, colors, where) => {
    const ours = surfaces(MODES.dark);
    for (const [token, bb] of Object.entries(colors)) {
      for (const surface of where) {
        expect(contrast(MODES.dark[token]!, ours[surface]), `${token} on ${surface}`).toBeGreaterThanOrEqual(contrast(bb, BB.dark.surfaces[surface]));
      }
    }
  });

  it("keeps bb's dark syntax colors as legible in code blocks", () => {
    const syntax = block(":root.dark .bb-code-highlight");
    const bb = { "--sh-keyword": "#f68389", "--sh-string": "#7ccd8e", "--sh-class": "#79b6f4", "--sh-property": "#97b7f8", "--sh-entity": "#b9a9fe", "--sh-jsxliterals": "#b9a9fe" };
    const recessed = surfaces(MODES.dark).recessed;
    for (const [token, color] of Object.entries(bb)) {
      expect(contrast(syntax[token]!, recessed), token).toBeGreaterThanOrEqual(contrast(color, BB.dark.surfaces.recessed));
    }
  });
});

describe("accents", () => {
  it.each(ACCENTS.map((accent) => [accent.name, accent.id] as const))("%s text is at least as legible as bb's accent", (_name, id) => {
    const colors = block(accentSelector(id));
    for (const mode of ["light", "dark"] as const) {
      expect(colors[`--sf-accent-${mode}`]).toMatch(/^#[0-9a-f]{6}$/);
      const ours = surfaces(MODES[mode]);
      for (const surface of SURFACES) {
        expect(contrast(colors[`--sf-accent-${mode}-text`]!, ours[surface]), `${mode} on ${surface}`).toBeGreaterThanOrEqual(contrast(BB[mode].text.accent, BB[mode].surfaces[surface]));
      }
    }
  });

  it("reads setting values by name", () => {
    for (const accent of ACCENTS) expect(accentOf(accent.name)).toBe(accent);
    expect(accentOf("pink")).toBe(DEFAULT_ACCENT);
    expect(accentOf(undefined)).toBe(DEFAULT_ACCENT);
  });
});
