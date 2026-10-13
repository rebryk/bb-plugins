import type { ComposerMention } from "@get-bb/plugin-sdk/app";
import { PROVIDER, type Note } from "./shared";

/** A note on a Save button, for tests. */
export const sampleNote = (overrides: Partial<Note> = {}): Note => ({
  id: "nabc123def",
  number: 1,
  comment: "Make this blue",
  url: "https://example.com/page#top",
  title: "Example",
  element: {
    name: 'button.primary "Save"',
    selector: "main > button:nth-of-type(2)",
    text: "Save",
    attributes: { class: "primary", type: "submit" },
    styles: { color: "rgb(0, 0, 0)" },
    rect: { x: 10, y: 900, width: 80, height: 30 },
    view: { x: 10, y: 100, width: 80, height: 30 },
    viewport: { width: 1280, height: 800 },
  },
  ...overrides,
});

/** The composer pill of note `id`, starting at `from`. */
export const pill = (
  id: string,
  from: number,
  label = "1 · Save",
): ComposerMention => ({
  kind: "plugin",
  pluginId: "annotate",
  provider: PROVIDER,
  id,
  label,
  from,
  to: from + label.length,
});
