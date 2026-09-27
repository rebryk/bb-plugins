import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { useLayoutEffect } from "react";
import { AccentPicker, pickedAccent, useAccent } from "./accent-picker";
import { ACCENT_ATTRIBUTE, ACCENT_STORAGE_KEY, DEFAULT_ACCENT, rememberedAccent, type Accent } from "./accents";
import { watchSettingsTitle } from "./settings-title";

const HOLD_TRANSITIONS = "*, *::before, *::after { transition: none !important; }";

/**
 * Marks <html> with an accent. Blue is the stylesheet's own color, so it needs
 * no attribute. bb has painted by the time an accent comes from storage or the
 * loaded setting, so with hold transitions stay off for two frames: its
 * switches snap to the accent rather than fade over from the one shown before.
 */
function applyAccent(accent: Accent, { hold }: { hold: boolean }) {
  const root = document.documentElement;
  const id = accent === DEFAULT_ACCENT ? null : accent.id;
  if (root.getAttribute(ACCENT_ATTRIBUTE) === id) return;
  if (hold) {
    const style = document.createElement("style");
    style.textContent = HOLD_TRANSITIONS;
    document.head.append(style);
    requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
  }
  if (id) root.setAttribute(ACCENT_ATTRIBUTE, id);
  else root.removeAttribute(ACCENT_ATTRIBUTE);
}

/**
 * Marks <html> with the accent this browser showed last, before settings load,
 * so a reload does not show Blue until they do.
 */
export function restoreAccent() {
  const accent = rememberedAccent();
  if (accent) applyAccent(accent, { hold: true });
}

/**
 * Mirrors the Accent color setting to <html>, where the theme's CSS reads it.
 * A swatch picked in Settings shows before the setting saves, and fades in like
 * any other change; the loaded setting snaps into place. Other palettes ignore
 * the attribute.
 */
export function AccentSync() {
  // While settings load, keep the current accent rather than flash Blue.
  const accent = useAccent();

  useLayoutEffect(() => {
    if (!accent) return;
    applyAccent(accent, { hold: accent !== pickedAccent() });
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, accent.id);
    } catch {
      // Without storage the next load waits for the setting.
    }
  }, [accent]);

  // A layout cleanup: a plugin reload swaps in the new overlay in the same
  // commit, and the new one marks <html> only after this one has cleared it.
  useLayoutEffect(() => () => document.documentElement.removeAttribute(ACCENT_ATTRIBUTE), []);

  return null;
}

export default definePluginApp((app) => {
  restoreAccent();
  app.slots.experimental_appOverlay({ id: "accent", component: AccentSync });
  app.slots.settingsSection({ id: "accent-picker", component: AccentPicker });
  app.contentScripts.register({
    id: "settings-title",
    mount: ({ signal }) => watchSettingsTitle(document, signal),
  });
});
