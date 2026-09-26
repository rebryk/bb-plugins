# Bookmarks

Bookmarks saves chat messages worth coming back to and lists them in a
**Bookmarks** tab in the thread's right panel. Clicking a bookmark opens its
thread scrolled to the message.

```text
Search                          [All | This thread]
─────────────────────────────────────────────────
Fix the flaky upload test · You                2h
Can we retry the upload before failing the job…
Plan the storage migration                     3d
│ Run the backfill before switching reads…
```

## Use

- **Bookmark a message**: hover a user or assistant message and click the
  bookmark button in its action bar. A bookmarked message keeps a filled
  bookmark button; clicking it again removes the bookmark (with Undo).
- **Bookmark a passage**: select text in an assistant message and choose
  **Bookmark** in the selection menu. The selection becomes the bookmark's
  quote; a message still has one bookmark.
- **Open the list**: the bookmark button in the thread header, **Bookmarks**
  in the side panel's new-tab actions (also on the New thread screen), or
  `Bookmarks: Show saved messages` in the quick palette.
- **Jump back**: click a bookmark. When it belongs to another thread, the
  Bookmarks tab follows you there on desktop-width windows.

## How it works

- Bookmarks are stored in the plugin's SQLite database
  (`<bb data dir>/plugins/bookmarks/data.db`), keyed by thread and the message's
  `sourceSeqEnd`, with a copy of the message text (up to 64,000 characters) and
  a snapshot of the thread title.
- The jump uses the same router state bb's thread search uses
  (`searchMessageSeq`), so bb itself pages back to the message, scrolls to it,
  and flashes it. If that state stops working in a future bb, clicking a
  bookmark still opens its thread.
- Bookmarked messages are marked by a stylesheet keyed on the timeline's
  `data-timeline-row-id` attribute, so the mark follows rows through the
  virtualized timeline without observing the DOM.

## Install

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install bookmarks@sf-plugins
```

Use `bb plugin install .` from this directory instead when working on it
locally.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
bb plugin reload bookmarks
```

## More San Francisco Plugins

Bookmarks is one of the
[San Francisco Plugins](https://github.com/rebryk/bb-plugins), a family of BB
plugins. The others:

- [Super Hotkeys](../super-hotkeys): Superhuman-like keyboard navigation, with
  shortcut hints, slash search, and number keys that set up a new thread.
- [Dia Sidebar](../dia-sidebar): the sidebar's navigation as a compact, wrapping
  grid of icons.
- [Terminal Paste](../terminal-paste): a Paste button for the terminal on phones
  and tablets.
- [Pool Usage](../pool-usage): how much of each provider's capacity is in use
  and when it frees up, in the sidebar footer.
- [Server Switcher](../server-switcher): if you run several servers on bb
  connect, one click opens the next online one.
