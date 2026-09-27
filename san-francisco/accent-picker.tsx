import { useSdk, useSettings } from "@get-bb/plugin-sdk/app";
import { useEffect, useId, useRef, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from "react";
import { ACCENTS, ACCENT_ATTRIBUTE, ACCENT_SETTING, PLUGIN_ID, accentOf, rememberedAccent, type Accent } from "./accents";

/*
 * A pick shows at once and stays until the saved setting catches up, or moves
 * to an accent this window didn't send, as when another window picks one.
 * Writes go out one at a time, and only the latest pick is sent after a running
 * one, so the setting ends on the last swatch chosen and never flickers back.
 */
interface Pick {
  accent: Accent | null;
  saving: boolean;
  error: string | null;
}

let pick: Pick = { accent: null, saving: false, error: null };
let queued: Accent | null = null;
// The accents sent since the last pick settled, which the setting passes through.
const sent = new Set<Accent>();
// The saved accent last seen, to tell when the setting moves.
let lastSaved: Accent | null = null;
const listeners = new Set<() => void>();

function update(next: Partial<Pick>) {
  pick = { ...pick, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const snapshot = () => pick;

/** The swatch picked but not yet saved, if any. */
export const pickedAccent = () => pick.accent;

async function choose(accent: Accent, save: (accent: Accent) => Promise<unknown>) {
  if (!pick.accent) sent.clear();
  queued = accent;
  update({ accent, error: null });
  if (pick.saving) return;
  update({ saving: true });
  let error: string | null = null;
  while (queued) {
    const next = queued;
    queued = null;
    sent.add(next);
    try {
      await save(next);
      error = null;
    } catch (cause) {
      // A newer pick goes out anyway; only the last write's failure counts.
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
  // After a failure, back to the saved accent.
  update(error === null ? { saving: false } : { accent: null, saving: false, error });
}

/** The accent <html> shows before the setting loads, if that is known. */
function shownAccent(): Accent | null {
  const id = document.documentElement.getAttribute(ACCENT_ATTRIBUTE);
  return id ? (ACCENTS.find((accent) => accent.id === id) ?? null) : rememberedAccent();
}

/**
 * The accent to show: a pick still on its way to the setting, else the saved
 * setting, else while it loads the accent <html> already shows.
 */
export function useAccent(): Accent | null {
  const { values } = useSettings();
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const saved = values ? accentOf(values[ACCENT_SETTING.key]) : null;

  useEffect(() => {
    if (!saved) return;
    const moved = lastSaved !== null && saved !== lastSaved && !sent.has(saved);
    lastSaved = saved;
    if (current.accent && !current.saving && (current.accent === saved || moved)) update({ accent: null });
  }, [current, saved]);

  return current.accent ?? (values ? saved : shownAccent());
}

const SWATCH = 22;
const GAP = 12;
// On a narrow phone the gaps close up to this rather than wrap a swatch.
const MIN_GAP = 8;
const STRIP = ACCENTS.length * SWATCH + (ACCENTS.length - 1) * GAP;
const MIN_STRIP = ACCENTS.length * SWATCH + (ACCENTS.length - 1) * MIN_GAP;
// Beside the label, the strip keeps a little room above the swatches, and the
// selected accent's name hangs 22px under its swatch, clear of a focus ring.
const STRIP_TOP = 4;
const NAME_SPACE = 24;
// Under the label, the strip is as tall as bb's select for the setting, so
// nothing below moves when it takes the select's place, and the name follows
// the strip on its line, with room for the longest one, Graphite.
const CONTROL = 28;
const NAME_WIDTH = 48;
const LINE_NAME_ROOM = GAP + NAME_WIDTH;
// The strip sits beside the label (sm:basis-60, sm:gap-x-5) from ROW_MIN on.
// Below NAME_ROW_MIN the name no longer fits on the strip's line and is left out.
const LABEL = 240;
const ROW_MIN = LABEL + 20 + STRIP;
const NAME_ROW_MIN = MIN_STRIP + LINE_NAME_ROOM;

/** The swatches' place in the row, which the theme keeps while it waits for them. */
export const PICKER_PLACE = {
  label: LABEL,
  beside: { width: STRIP, height: STRIP_TOP + SWATCH + NAME_SPACE },
  under: { width: STRIP + LINE_NAME_ROOM, height: CONTROL },
  rowMin: ROW_MIN,
};
// The selected swatch's ring, 2px out from it. The gap shows whatever is behind,
// so the ring suits bb's white cards and gray wells alike.
const RING = 2;
const RING_GAP = 2;

const UNDER_LABEL_CSS = `
  [data-sf-accent-picker] {
    position: relative;
    row-gap: ${MIN_GAP}px;
    width: ${STRIP + LINE_NAME_ROOM}px;
    padding: ${(CONTROL - SWATCH) / 2}px ${LINE_NAME_ROOM}px ${(CONTROL - SWATCH) / 2}px 0;
  }

  [data-sf-accent-picker] > span {
    position: static;
  }

  [data-sf-accent-picker] [data-sf-accent-name] {
    top: 50%;
    left: calc(100% - ${NAME_WIDTH}px);
    right: auto;
    margin-top: 0;
    transform: translateY(-50%);
  }
`;

// What inline styles can't do: keyboard focus, laying the strip out by the
// row's width, and hiding bb's own well for the setting (empty while settings
// load, then holding its select) while the swatches stand in for it. The focus
// ring takes the theme's accent text color where there is one, and on the
// selected swatch it sits right on the selection ring. Beside the label the
// strip ends at the row's edge, so the first and last names line up with its
// ends rather than center under their swatches and run past it.
const PICKER_CSS = `
[data-sf-accent-picker] {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: ${NAME_SPACE}px ${MIN_GAP}px;
  width: ${STRIP}px;
  max-width: 100%;
  padding: ${STRIP_TOP}px 0 ${NAME_SPACE}px;
}

[data-sf-accent-picker] > span {
  position: relative;
}

[data-sf-accent-picker] [data-sf-accent-name] {
  position: absolute;
  top: 100%;
  left: 50%;
  margin-top: ${8 - RING_GAP}px;
  transform: translateX(-50%);
}

[data-sf-accent-picker] [data-sf-accent-name="first"] {
  left: ${RING_GAP}px;
  transform: none;
}

[data-sf-accent-picker] [data-sf-accent-name="last"] {
  left: auto;
  right: ${RING_GAP}px;
  transform: none;
}

@media (width < 40rem) {${UNDER_LABEL_CSS}}

@container sf-accent-row (width < ${ROW_MIN}px) {${UNDER_LABEL_CSS}}

@container sf-accent-row (width < ${NAME_ROW_MIN}px) {
  [data-sf-accent-picker] {
    width: ${STRIP}px;
    padding-right: 0;
  }

  [data-sf-accent-picker] [data-sf-accent-name] {
    display: none;
  }
}

[data-sf-accent-picker] [data-sf-swatch]:focus-visible {
  outline: 2px solid var(--sf-accent-text, var(--ring));
  outline-offset: 2px;
}

[data-sf-accent-picker] [data-sf-swatch][aria-checked="true"]:focus-visible {
  outline-offset: 4px;
}

/* High Contrast keeps the swatches' colors, as it does in color pickers, and
   draws their edges, the selection ring and focus in system colors. */
@media (forced-colors: active) {
  [data-sf-accent-picker] > span {
    forced-color-adjust: none;
  }

  [data-sf-accent-picker] [data-sf-swatch] {
    box-shadow: inset 0 0 0 1px CanvasText !important;
  }

  [data-sf-accent-picker] > span:has(> [aria-checked="true"]) {
    border-color: CanvasText !important;
  }

  [data-sf-accent-picker] [data-sf-swatch]:focus-visible {
    outline-color: Highlight;
  }

  [data-sf-accent-picker] [data-sf-accent-name] {
    forced-color-adjust: auto;
  }
}

[data-testid="plugin-detail-${PLUGIN_ID}"]:has([data-sf-accent-picker]) > .rounded-md.border:empty,
[data-testid="plugin-detail-${PLUGIN_ID}"]:has([data-sf-accent-picker]) > .rounded-md.border:has(> .space-y-4 > [data-control-placement]:only-child button[aria-label="${ACCENT_SETTING.label}"]),
[data-testid="plugin-detail-${PLUGIN_ID}"]:has([data-sf-accent-picker]) > .rounded-md.border > .space-y-4 > [data-control-placement]:has(button[aria-label="${ACCENT_SETTING.label}"]) {
  display: none;
}
`;

const fillOf = (accent: Accent) => `light-dark(${accent.light}, ${accent.dark})`;

function swatchStyle(accent: Accent): CSSProperties {
  return {
    display: "grid",
    placeItems: "center",
    width: SWATCH,
    height: SWATCH,
    padding: 0,
    border: 0,
    borderRadius: "50%",
    backgroundColor: fillOf(accent),
    boxShadow: "inset 0 0 0 1px light-dark(rgb(0 0 0 / 0.12), rgb(255 255 255 / 0.14))",
    cursor: "pointer",
  };
}

function ringStyle(accent: Accent, checked: boolean): CSSProperties {
  return {
    display: "flex",
    margin: -(RING + RING_GAP),
    padding: RING_GAP,
    border: `${RING}px solid ${checked ? fillOf(accent) : "transparent"}`,
    borderRadius: "50%",
  };
}

// The dot takes the theme's mark color for checks and radio dots on the accent.
const dotStyle = (accent: Accent): CSSProperties => ({
  width: 6,
  height: 6,
  borderRadius: "50%",
  backgroundColor: accent.mark,
});

// The selected accent's name sits under its swatch, as in macOS System Settings,
// or after the strip under the label (PICKER_CSS places it).
const NAME_STYLE: CSSProperties = {
  fontSize: 11,
  lineHeight: "14px",
  whiteSpace: "nowrap",
  color: "var(--muted-foreground)",
  pointerEvents: "none",
};

const nameEdge = (index: number) => (index === 0 ? "first" : index === ACCENTS.length - 1 ? "last" : "");

const KEY_STEPS: Record<string, (index: number) => number> = {
  ArrowRight: (index) => (index + 1) % ACCENTS.length,
  ArrowDown: (index) => (index + 1) % ACCENTS.length,
  ArrowLeft: (index) => (index - 1 + ACCENTS.length) % ACCENTS.length,
  ArrowUp: (index) => (index - 1 + ACCENTS.length) % ACCENTS.length,
  Home: () => 0,
  End: () => ACCENTS.length - 1,
};

/**
 * The Accent color setting as a row of macOS color swatches. It uses the markup
 * of bb's plugin Configuration block, so every palette styles it like other
 * plugins' settings, and draws the swatches with inline styles, so no palette
 * restyles them. Where the label would get narrower than 240px, the swatches
 * move under it, as on a phone.
 */
export function AccentPicker() {
  const sdk = useSdk();
  const accent = useAccent();
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const { error } = state;
  // A failed save's message is for this visit; coming back starts clean. One
  // that fails after the page is left still says, on return, why the accent
  // went back.
  useEffect(
    () => () => {
      if (pick.error) update({ error: null });
    },
    [],
  );
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;

  const select = (next: Accent) => {
    if (next === accent) return;
    void choose(next, (value) =>
      sdk.plugins.updateSettings({ pluginId: PLUGIN_ID, values: { [ACCENT_SETTING.key]: value.name } }),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Modified arrows belong to the browser and bb's shortcuts, as in Radix.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const step = KEY_STEPS[event.key];
    const index = radios.current.indexOf(event.target as HTMLButtonElement);
    if (!step || index < 0) return;
    event.preventDefault();
    const next = step(index);
    radios.current[next]?.focus();
    select(ACCENTS[next]!);
  };

  // With nothing selected yet, Tab lands on the first swatch.
  const focusable = accent ?? ACCENTS[0];

  // When a save fails, the selection goes back, and focus in the strip follows
  // it, so a focus ring never marks a color that is not on. Each failure is a
  // new state with an error.
  useEffect(() => {
    if (!state.error || !radios.current.includes(document.activeElement as HTMLButtonElement)) return;
    radios.current[ACCENTS.indexOf(focusable)]?.focus();
  }, [state]);

  return (
    <>
      <style>{PICKER_CSS}</style>
      <div className="overflow-hidden rounded-md border border-border bg-surface-recessed/70 px-3 py-3">
        <div className="space-y-4">
          <div
            data-control-placement="inline"
            className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:justify-between sm:gap-x-5 sm:items-center"
            style={{ containerType: "inline-size", containerName: "sf-accent-row" }}
          >
            <div className="min-w-0 flex-1 sm:basis-60">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <p id={labelId} className="min-w-0 text-sm font-normal text-foreground">
                  {ACCENT_SETTING.label}
                </p>
              </div>
              <p id={descriptionId} className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
                {ACCENT_SETTING.description}
              </p>
              {error ? (
                <p role="alert" style={{ marginTop: 4, fontSize: 12, lineHeight: "16px", color: "var(--destructive)" }}>
                  Couldn't save the accent color: {error}
                </p>
              ) : null}
            </div>
            {/* Beside the label the strip keeps its width; under it, it may narrow to the row. */}
            <div className="min-w-0 sm:flex sm:justify-end">
              <div
                role="radiogroup"
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                data-sf-accent-picker=""
                onKeyDown={onKeyDown}
              >
                {ACCENTS.map((option, index) => {
                  const checked = option === accent;
                  // The title names the swatch and shows the name on hover, as in
                  // macOS. An aria-label as well would read the name twice.
                  return (
                    <span key={option.id} style={ringStyle(option, checked)}>
                      <button
                        ref={(element) => {
                          radios.current[index] = element;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        title={option.name}
                        tabIndex={option === focusable ? 0 : -1}
                        data-sf-swatch={option.id}
                        onClick={() => select(option)}
                        style={swatchStyle(option)}
                      >
                        {checked ? <span aria-hidden="true" style={dotStyle(option)} /> : null}
                      </button>
                      {checked ? (
                        <span aria-hidden="true" data-sf-accent-name={nameEdge(index)} style={NAME_STYLE}>
                          {option.name}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
