# Superhuman

Superhuman-style features for BB:

- **Shortcuts.** Shortcut hints on a held modifier; **/** searches, **H** snoozes,
  **E** archives, and numbers open a new thread's menus, in any keyboard layout.
- **Universal Search.** Find commands, threads, and snoozed threads using both
  the typed query and its English/Russian keyboard equivalent. On by default.
- **Snooze.** Hide a thread until a set time or until its agent needs you; use
  the moon in its header or before Archive in the sidebar row.
- **Archive Button.** Archive a thread from its header, next to Snooze.
- **Thread ETA.** The time left on an agent's background process counts down
  at the end of its sidebar row until it runs out or the agent clears it.
- **Code Copy.** Click or tap a code block or inline command in an agent's
  reply to copy it. Always on; text selection still works.
- **Preload Threads.** Load the tail of recent and newly completed threads in
  the background. On by default; uses BB 0.44.0's cache and pauses when hidden.
- **Dia Sidebar.** The sidebar's navigation as a compact grid of icons.
- **Terminal Paste.** A Paste button for the terminal on phones and tablets.
- **Server Switcher.** A **Change Server** button in the sidebar footer.
- **Mobile Layout.** Bottom bars, gestures, and haptics on phones, with a fixed
  interface scale and pinch-to-zoom images. Thread titles stay hidden on phones.
- **UI Polish.** Icons in one tone, even menu rows, and a thread bar without
  the git action or external editor picker.

Settings include four main switches: **Shortcuts**, **Universal Search**,
**Mobile layout**, and **Archive button**. **Experimental** contains
**Thread ETA** and **Preload threads**. All six are on by default.

## Install

Needs bb 0.43.4 or later. Install the plugin on every server you open, since a
BB page loads only its own server's plugins.

Hotkeys use physical key positions outside text inputs; modified BB shortcuts
also accept their physical key when the typed character has no binding.
Universal Search supports US English and Russian ЙЦУКЕН in both directions,
keeps the input unchanged, and combines matches without duplicate rows. Turn it
off with **Universal Search** in Superhuman's settings. Built-in command and
thread search support is verified for BB 0.44.0 and disables itself on other
versions; the snoozed-thread filter works independently. The built-in adapters
read the palette's React row handlers and wrap its thread-search requests, so
BB updates require another compatibility check.

Preload Threads fetches up to four recent dialogue segments per thread, each
starting with a user message. Older history loads normally when scrolling back.
It keeps a bounded cache without marking threads read, uses BB's internal cache
layout, and disables itself on unverified BB versions. Other features work on
the versions listed above.

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
npm run test:browser
bb plugin reload superhuman
```

`npm run test:browser` checks Dia Sidebar's layout in Google Chrome, which must
be installed.

## More San Francisco Plugins

Superhuman is one of the
[San Francisco Plugins](https://github.com/rebryk/bb-plugins), a family of BB
plugins. The others:

- [Bookmarks](../bookmarks): save any chat message and jump back to it from the
  thread's right panel.
- [Canvas](../canvas): images, text, and drawing in each thread, with
  screenshots your agent can read.
- [San Francisco](../san-francisco): a quiet macOS-style theme after the Aside
  browser, with your pick of the eight macOS accent colors.
- [Pool Usage](../pool-usage): how much of each provider's capacity is in use
  and when it frees up, in the sidebar footer.
