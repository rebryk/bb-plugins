# Changelog

Newest version first. [Releases](../README.md#releases) explains when a change
gets a new version. Each version is tagged `san-francisco/v<version>`.

## 0.1.2 (2026-09-27)

- Speed up thread switching by tracking window and sidebar structure instead
  of repeatedly matching broad CSS conditions. Preserve the original layout
  before the plugin frontend loads.
- Skip unrelated stylesheet work and settings animation frames while reading
  threads, while preserving palette preview positioning in Settings.

## 0.1.1 (2026-09-27)

- Superhuman's phone bars take the composer's rounded corners and text inset.

## 0.1.0 (2026-09-25)

- First release: a palette under Settings → Appearance → Palette that restyles
  BB in the quiet macOS style of the Aside browser, with an Accent color
  setting for the eight macOS accent colors.
