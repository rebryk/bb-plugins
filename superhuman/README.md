# Superhuman

Superhuman-style features for BB:

- **Hotkeys.** Shortcut hints on a held modifier, **/** to search threads, and
  number keys for a new thread's menus.
- **Snooze.** Hide a thread until a set time or until its agent needs you; use
  the moon in its header or before Archive in the sidebar row.
- **Archive Button.** Archive a thread from its header, next to Snooze.
- **Code Copy.** Click or tap a code block or inline command in an agent's
  reply to copy it. On by default; text selection still works.
- **Preload Threads.** Load the tail of recent and newly completed threads in
  the background. On by default; uses BB 0.44.0's cache and pauses when hidden.
- **Dia Sidebar.** The sidebar's navigation as a compact grid of icons.
- **Terminal Paste.** A Paste button for the terminal on phones and tablets.
- **Server Switcher.** A **Change Server** button in the sidebar footer.
- **Phone Layout.** BB's bars as cards at the bottom of a phone's screen, with
  thumb-sized buttons, New thread in a thread's bar, an optional thread title,
  and a swipe down a terminal to hide its keyboard.
- **Haptics.** A light tap as the phone's sidebar or right panel opens or
  closes, in BB's app or a browser that can vibrate.
- **Zoom Lock.** No zooming the page, off by default.
- **UI Polish.** Icons in one tone, even menu rows, and a thread bar without
  the git action or external editor picker.

## Install

Needs bb 0.43.4 or later. Install the plugin on every server you open, since a
BB page loads only its own server's plugins.

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
- [San Francisco](../san-francisco): a quiet macOS-style theme after the Aside
  browser, with your pick of the eight macOS accent colors.
- [Pool Usage](../pool-usage): how much of each provider's capacity is in use
  and when it frees up, in the sidebar footer.
