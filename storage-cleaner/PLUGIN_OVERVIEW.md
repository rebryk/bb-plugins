See what fills your Mac's disk and clean what BB and your tools leave behind.

## See where space goes

**Settings → Storage Cleaner** shows the free space and a bar that splits the
disk into BB & agents, Dev caches, Apps, Trash, Your files, System, and free
space. Each category unfolds into its biggest items: archived threads by
title, leftover worktrees, caches, apps, and folders. Below, an explorer shows
the current folder as a treemap, with Contents, Largest files, File types, and
Stale tabs. **Customize rail** can put the same view in the sidebar.

## Clean a category

Every **Clean** asks first and lists what it deletes. BB & agents deletes the
storage of archived threads and the worktrees no live thread uses. Dev caches
empties Xcode DerivedData, package caches, git-ignored build folders, and
logs. Trash empties the Trash. Any file or folder can also be deleted from the
explorer.

## Every night

A scan runs every day at 00:00 UTC, and switches turn on cleaning threads
archived 7+ days ago, leftover worktrees, dev caches untouched for 7 days, and
the Trash. Sizes count APFS clones once, and a scan takes a few minutes.
Needs macOS and `python3`.

## More San Francisco Plugins

Storage Cleaner is one of the San Francisco Plugins, a family of BB plugins.
The others:

- **Superhuman**: Superhuman-style speed for BB, with shortcuts and search in
  any keyboard layout, snoozed threads, and a phone layout.
- **Bookmarks**: save any chat message and jump back to it from the thread's
  right panel.
- **Canvas**: images, text, and drawing in each thread, with screenshots your
  agent can read.
- **Annotate**: notes on the elements of a page in BB's Browser, sent to your
  agent with a screenshot.
- **Auto Update**: updates for the plugins you pick, installed every hour, day,
  or week.
- **Resource Monitor**: live CPU, RAM, and GPU bars for the BB server in the
  sidebar, with the numbers on hover.
- **San Francisco**: a quiet macOS-style theme after the Aside browser, with
  your pick of the eight macOS accent colors.
- **Pool Usage**: how much of each provider's capacity is in use and when it
  frees up, in the sidebar footer.

See all of them, with install steps, at
[github.com/rebryk/bb-plugins](https://github.com/rebryk/bb-plugins).
