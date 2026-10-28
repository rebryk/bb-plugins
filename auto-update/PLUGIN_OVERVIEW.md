Keep the plugins you pick up to date, without running `bb plugin update`.

## Pick the plugins

**Settings → Auto Update** lists every installed plugin that can take updates,
grouped by where it came from, like the app list in iOS Settings →
Notifications: BB Community, each marketplace you added, such as San Francisco
Plugins, and **Installed Directly** last. Each row shows the plugin's icon,
name, and version, with a switch that starts off. A switch that is on is your
consent: BB then installs that plugin's updates without asking.

## Choose how often

**Check for Updates**, at the top of the page, is every hour by default, or
every 6 hours, every day, or every week. **Check Now** checks every listed
plugin right away and installs the updates of those turned on. The page shows
when the last check ran.

An automatic install requires a change to the plugin's package version.
Commits to other plugins in the same repository do not reinstall an unchanged
version. The page shows **Version unchanged** for those candidates. If the
version cannot be verified, the update is skipped and the page shows why.
Authors must change their package version to ship an automatic update.
BB's own update badges and manual updates still use BB's update rules.

## See what happened

The list opens at once with what BB last knew, then each row checks its plugin
on its own and updates as the answer arrives, so a slow repository holds up
only its own rows. Each row says when an update is available or installing,
and when one failed, with the reason. It also says when an update needs a
newer BB, and when BB can't check the plugin for updates.

## BB's own updates

Auto Update installs updates the way `bb plugin update` does, so BB rolls back
a version that fails to start and shows its usual "Plugin updated" toast. Auto
Update updates itself last. Plugins that ship with BB update with BB, and
plugins pinned to a release tag, a commit, an exact npm version, or a local
folder never update, so the page leaves them out. No external account or
service is required.

## More San Francisco Plugins

Auto Update is one of the San Francisco Plugins, a family of BB plugins. The
others:

- **Superhuman**: Superhuman-style speed for BB, with shortcuts and search in
  any keyboard layout, snoozed threads, and a phone layout.
- **Bookmarks**: save any chat message and jump back to it from the thread's
  right panel.
- **To-do**: a Notes-style to-do list on the New thread screen and in the
  right panel; snooze a to-do or start a thread from it.
- **Canvas**: images, text, and drawing in each thread, with screenshots your
  agent can read.
- **Annotate**: notes on the elements of a page in BB's Browser, sent to your
  agent with a screenshot.
- **Storage Cleaner**: what fills your Mac's disk, and cleanup of archived
  threads, worktrees, and caches.
- **Resource Monitor**: live CPU, RAM, and GPU bars for the BB server in the
  sidebar, with the numbers on hover.
- **San Francisco**: a quiet macOS-style theme after the Aside browser, with
  your pick of the eight macOS accent colors.
- **Pool Usage**: how much of each provider's capacity is in use and when it
  frees up, in the sidebar footer.

See all of them, with install steps, at
[github.com/rebryk/bb-plugins](https://github.com/rebryk/bb-plugins).
