# Auto Update

Auto Update keeps the plugins you pick up to date. Its page,
**Settings → Auto Update**, lists every installed plugin that can take updates,
each with a switch, and BB installs the updates of the plugins turned on every
hour, every 6 hours, every day, or every week.

```text
Check for Updates                                          [Every hour]

Plugins
Turn on the plugins BB should keep up to date.

Last checked Oct 12, 2:05 PM.                               [Check Now]

BB Community
[C] Chime                                                         [off]
    0.1.0

San Francisco Plugins
[B] Bookmarks                                                      [on]
    0.1.1 · Checking…
[C] Canvas                                                         [on]
    0.1.13 · Updating…
[S] Superhuman                                                    [off]
    0.1.20 · Update available
```

## Use

Open **Settings → Auto Update**, listed under **Plugins** in Settings.

- **Turn a plugin on.** Flip its switch. Every switch starts off, Auto Update's
  own included. A switch that is on is your consent: from then on, BB installs
  that plugin's updates without asking.
- **Choose how often.** **Check for Updates**, at the top of the page, is
  **Every hour** by default; the others are **Every 6 hours**, **Every day**,
  and **Every week**. From a terminal, run
  `bb plugin config auto-update set frequency daily`, with `hourly`,
  `every-6-hours`, `daily`, or `weekly`.
- **Check now.** **Check Now** checks every listed plugin right away and
  installs the updates of those turned on. Beside it, the page says when the
  last check ran.

The **Plugins** section groups plugins by where they came from, like the app
list in iOS Settings → Notifications: BB's own marketplaces first, such as BB
Community, then the marketplaces you added by name, such as San Francisco
Plugins, and **Installed Directly** last. Each row shows the plugin's icon,
name, version, and switch, and a status when there is one:

- **Checking…**: BB is looking up the plugin's latest version. Opening the page
  shows the list at once with what BB last knew, then checks each plugin BB
  hasn't checked in the last 2 minutes, and each row updates as its own answer
  arrives.
- **Update available**: a newer version is out. With the switch on, the next
  check installs it.
- **Updating…**: BB is installing it now.
- **Update failed**, with the reason: the newer version didn't start, and BB
  kept the one you had. The next check tries again.
- **Update needs a newer BB**: the newer version needs a BB release you don't
  have yet.
- **Can't check for updates**: BB couldn't look up the plugin's latest version.

The list leaves out plugins that ship with BB, which update with BB, and
plugins pinned to a release tag, a commit, an exact npm version, or a local
folder, which never update.

## How it works

- A background schedule wakes every 5 minutes. When at least one switch is on
  and the chosen interval has passed since the last check, it checks the
  plugins that are on and installs their updates. **Check Now** does the same
  for every listed plugin. Opening the page only checks; it never installs.
- A check uses BB's own update check and update, the same as
  `bb plugin outdated` and `bb plugin update`, so BB rolls back a version that
  fails to start, records why, and shows its usual **Plugin updated** toast.
  Auto Update asks `bb.sdk.plugins.checkUpdates` about each plugin on its own,
  all side by side: BB's check of every plugin at once goes through them one by
  one, built-in plugins included, and takes minutes. A plugin is never checked
  twice at once. `bb.sdk.plugins.applyUpdate` then installs the updates of the
  plugins turned on, one at a time, and one such run goes at a time.
- Auto Update updates itself last, through
  `bb.sdk.plugins.experimental_startUpdate`, since installing its own update
  reloads it.
- The switches and the time of the last check live in the plugin's key-value
  storage in BB's database, `bb.db`.
  **Check for Updates** is one of BB's declarative plugin settings.
- The **Plugins** section is a `settingsSection` slot on the plugin's settings
  page. It refreshes when a check starts or ends, a switch changes, or a plugin
  is installed, removed, or updated anywhere in BB.
- A BB update may break the plugin list fields Auto Update reads
  (`provenance`, `catalogMarketplaceName`, `publisherLabel`, and
  `updateState`, whose `lastFailure` gives the reason a row shows), the update
  APIs, or the `settingsSection` slot.
  `experimental_startUpdate` in particular may change in any BB release.

## Install

Needs BB 0.46.0 or later. Auto Update updates the plugins of the BB server it
is installed on, so install it on each server whose plugins it should keep up
to date.

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install auto-update@sf-plugins
```

Use `bb plugin install .` from this directory instead when working on it
locally.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
bb plugin reload auto-update
```

## More San Francisco Plugins

Auto Update is one of the
[San Francisco Plugins](https://github.com/rebryk/bb-plugins), a family of BB
plugins. The others:

- [Superhuman](../superhuman): Superhuman-style speed for BB, with shortcuts and
  search in any keyboard layout, snoozed threads, and a phone layout.
- [Bookmarks](../bookmarks): save any chat message and jump back to it from the
  thread's right panel.
- [Canvas](../canvas): images, text, and drawing in each thread, with
  screenshots your agent can read.
- [Annotate](../annotate): notes on the elements of a page in BB's Browser,
  sent to your agent with a screenshot.
- [Storage Cleaner](../storage-cleaner): what fills your Mac's disk, and
  cleanup of archived threads, worktrees, and caches.
- [Resource Monitor](../resource-monitor): live CPU, RAM, and GPU bars for the
  BB server in the sidebar, with the numbers on hover.
- [San Francisco](../san-francisco): a quiet macOS-style theme after the Aside
  browser, with your pick of the eight macOS accent colors.
- [Pool Usage](../pool-usage): how much of each provider's capacity is in use
  and when it frees up, in the sidebar footer.
