# Superhuman

Superhuman-style speed for BB:

- **Shortcuts.** Shortcut hints on a held modifier; **/** searches, **H**
  snoozes, **E** archives, and numbers open a new thread's menus, in any
  keyboard layout.
- **Universal Search.** Find commands, threads, and snoozed threads using both
  the typed query and its English/Russian keyboard equivalent.
- **Snooze.** Hide a thread until a time you pick or until its agent needs you,
  from the moon in its header or any thread menu; **Show snoozed threads** lists
  them.
- **Archive Button.** Archive a thread from its header, next to Snooze.
- **Mobile Layout.** Bottom bars, edge swipes, and haptics on phones, with a
  fixed interface scale and pinch-to-zoom images. Thread titles stay hidden.
- **Hide Title Bar.** In the macOS desktop app, no top row with back, forward,
  and the sidebar and right panel buttons; their shortcuts still work.
- **UI Polish.** Icons in one tone and a thread bar without the external editor
  picker, with fixes for Safari's layout and for a Tesla's keyboard.

Settings have a switch for each, all on by default except Hide Title Bar.
Turning Snooze off brings snoozed threads back.

## Install

Needs bb 0.46.0 or later. Install the plugin on every server you open, since a
BB page loads only its own server's plugins.

Shortcuts work on desktop, outside text fields, by key position, so **H** is
**H** in a Russian layout too; BB's own modified shortcuts accept the key
position as well when the typed character has no binding. While a modifier's
hints show, BB's own hints stay hidden. Snooze sits before Archive in every
thread menu. To snooze from a sidebar row in one click, add it in the row
menu's **Customize row actions**.

On a phone, Mobile Layout moves BB's bars into cards at the bottom of the
screen and the sidebar's navigation to its bottom, opens the sidebar and
the right panel with swipes from the screen's edges, and hides the bars while
the keyboard is open, leaving a terminal's row of keys above it. A swipe down a
terminal hides the keyboard.

UI Polish hides only the editor picker; **Show Git changes and Commit button**
in BB's settings hides Commit. On a Tesla, whose browser reports a mouse, BB
focuses a field only on a tap on it or a key press, so the car's keyboard stays
down when a thread or a tab opens.

Universal Search supports US English and Russian ЙЦУКЕН in both directions,
keeps the input unchanged, and combines matches without duplicate rows. BB has
no way for plugins to extend its search, so in the command palette and thread
search it reads the palette's React row handlers and wraps its thread-search
requests. That is verified for BB 0.46.0 and turns itself off on other
versions until checked again; the snoozed-thread filter works on any version.

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install superhuman@sf-plugins
```

Use `bb plugin install .` from this directory instead when working on it
locally.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
bb plugin reload superhuman
```

## More San Francisco Plugins

Superhuman is one of the
[San Francisco Plugins](https://github.com/rebryk/bb-plugins), a family of BB
plugins. The others:

- [Bookmarks](../bookmarks): save any chat message and jump back to it from the
  thread's right panel.
- [Canvas](../canvas): images, text, and drawing in each thread, with
  screenshots your agent can read.
- [Auto Update](../auto-update): updates for the plugins you pick, installed
  every hour, day, or week.
- [San Francisco](../san-francisco): a quiet macOS-style theme after the Aside
  browser, with your pick of the eight macOS accent colors.
- [Pool Usage](../pool-usage): how much of each provider's capacity is in use
  and when it frees up, in the sidebar footer.
