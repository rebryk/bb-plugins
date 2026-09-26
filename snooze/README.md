# Snooze

Snooze hides a thread from the sidebar until a time you pick, the way
[Superhuman](https://superhuman.com/mail) snoozes email. The thread comes back
at that time, marked unread, or sooner when its agent finishes or needs an
answer. A moon button in the thread header and two commands in the command
palette open the time picker and the list of snoozed threads.

```text
Try: 8 am, 3 days, aug 7
───────────────────────────────────────────────
Last used                   Fri, Oct 2, 3:00 PM
Later today                      Today, 6:00 PM
Tomorrow                   Sun, Sep 27, 9:00 AM
Next week                  Mon, Sep 28, 9:00 AM
```

## Use

- **Snooze a thread**: click the moon in the thread header, or run
  **Snooze thread** from the command palette. Pick **Later today**,
  **Tomorrow**, or **Next week**, or type a time such as `8 am`, `in 2 hours`,
  `3 days`, `fri 3pm`, `next mon`, `aug 7`, or `tomorrow evening`. The first
  row shows the moment a typed time means, and **Enter** snoozes until then.
  **Last used** repeats your last pick from now, so after `fri 3pm` it means the
  coming Friday.
- **Keep going**: snoozing the open thread opens the next thread in the sidebar,
  the one above it when it was the last, or the new-thread screen when none is
  left. A toast shows until when and the thread's title, with **Undo**.
- **See what's snoozed**: a snoozed thread's moon is filled, and its tooltip
  says until when. **Show snoozed threads** in the command palette lists every
  snoozed thread, soonest first. Type to filter and press **Enter** to open a
  thread without waking it. To unsnooze the selected one, press **⌘↵** on a Mac
  and **Ctrl+Enter** elsewhere, or click **Unsnooze** at the end of its row.
- **Wake it or move it**: the picker of a snoozed thread starts with
  **Unsnooze**, and picking another time moves the snooze.
- **Keys**: neither command has a default key. Bind them in Settings → Keyboard.

Later today is the first of 9:00 AM, 3:00 PM, and 6:00 PM at least an hour away,
so it isn't offered after 5:00 PM. Tomorrow, Next week (Monday), and a typed day
without a time mean 9:00 AM. Without am or pm, an hour from 1 to 6 means the
afternoon, and 7 to 11 the morning.

A snoozed thread comes back at its time, marked unread. It comes back at once
when its agent finishes a turn or fails, or when it or a thread hidden with it
needs an answer. Archiving or deleting a snoozed thread ends its snooze.

On phones, the picker and the list open in BB's bottom drawer. The list can't
unsnooze there, so open the thread and pick **Unsnooze** from its moon.

## How it works

- Snoozing hides the thread and its visible sub-threads with BB's own thread
  visibility, the setting `bb thread update --visibility` changes. It hides the
  deepest first, since BB moves a visible sub-thread of a hidden thread to the
  top of the sidebar. The threads keep running; only the sidebar stops listing
  them. Waking shows the same threads again, so threads you hid yourself stay
  hidden.
- Snoozes and the last used time are stored in the plugin's key-value storage on
  the BB server, so every device shows the same ones.
- A background service wakes each snooze at its time and marks the thread
  unread. It checks at least once a minute, so snoozes that came due while the
  computer slept wake within a minute, and those that came due while BB or the
  plugin wasn't running wake when the plugin starts. BB's `thread.idle`,
  `thread.failed`, `interaction.pending`, `thread.archived`, and
  `thread.deleted` events end a snooze early.
- The next thread comes from the sidebar's rows, read from their
  `data-sidebar-*` attributes the way BB's Next thread reads them, so a BB UI
  change may need an update here. Without them, snoozing opens the new-thread
  screen.
- The picker and the list are the registry `command` component in BB's
  `dialog`, with the classes BB's command palette gives it, so they open where
  the palette opens and look like it; a BB update that restyles the palette
  doesn't restyle them. On phones, the dialog becomes BB's bottom drawer.
  Commands have no React tree and the header button exists only on thread
  pages, so an `experimental_appOverlay` renders both dialogs; the moon is an
  `experimental_threadHeaderAction`. Both slots are experimental and may change
  in a BB update.
- The toast is a custom toast in BB's toaster with the markup of BB's own toast
  card, so it looks like BB's toasts, but BB's notification center doesn't list
  it, and a BB update that restyles BB's toasts doesn't restyle it.

While the plugin is disabled or removed, nothing wakes its snoozed threads, and
they stay hidden, so unsnooze them before you remove it. To bring back a thread
that stayed hidden, find it by its title in the list of all threads, then show
it again:

```sh
bb thread list --include-hidden
bb thread update <thread-id> --visibility visible
```

## Install

Needs bb 0.43.4 or later.

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install snooze@sf-plugins
```

Use `bb plugin install .` from this directory instead when working on it
locally.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
bb plugin reload snooze
```

## More San Francisco Plugins

Snooze is one of the
[San Francisco Plugins](https://github.com/rebryk/bb-plugins), a family of BB
plugins. The others:

- [Super Hotkeys](../super-hotkeys): Superhuman-like keyboard navigation, with
  shortcut hints, slash search, and number keys that set up a new thread.
- [Bookmarks](../bookmarks): save any chat message and jump back to it from the
  thread's right panel.
- [Dia Sidebar](../dia-sidebar): the sidebar's navigation as a compact, wrapping
  grid of icons.
- [Terminal Paste](../terminal-paste): a Paste button for the terminal on phones
  and tablets.
- [Pool Usage](../pool-usage): how much of each provider's capacity is in use
  and when it frees up, in the sidebar footer.
- [Server Switcher](../server-switcher): if you run several servers on bb
  connect, one click opens the next online one.
