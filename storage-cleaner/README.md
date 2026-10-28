# Storage Cleaner

Storage Cleaner shows what fills your Mac's disk and cleans what BB and your
tools leave behind: the storage of archived threads, worktrees no thread uses
anymore, developer caches, and the Trash. It lives on its page in
**Settings → Storage Cleaner**, and the same view can sit in BB's sidebar.

```text
Configuration
Nightly scan                                                        [on]
Clean stale archived threads                                       [off]

Storage
31.5 GB free of 494.4 GB                                        [Rescan]
[■■■■■■■■ BB ■■■■■■ Dev ■ Apps ■■■■ Your files ■■■ System ░░░ free ]
Give BB Full Disk Access to see everything        [Open System Settings]

> ● BB & agents  Clean: archived threads, leftover worktrees  175 GB [Clean]
> ● Dev caches   Clean: DerivedData, caches, builds, logs     128 GB [Clean]
  ● Trash        Clean: everything in the Trash                  —  [Clean]
> ● Apps         14 apps                                       26 GB
> ● Your files   Projects, scratch, documents                  75 GB
> ● System       macOS, swap, unreadable folders               56 GB

↑ … / .bb / thread-storage / thr_tnnpv2qb9b                  25.1 GB
[ treemap of the folder ]
Contents · Largest files · File types · Stale
[ ] Name                                         Modified       Size
[ ] fast-full4-88-batch10k-lr3e4-cos75            today        8.2 GB
```

## Use

Open **Settings → Storage Cleaner**. To keep it in the sidebar, choose
**More → Customize rail** and check **Storage**.

- **Scan.** **Rescan** measures the disk again; it takes a few minutes.
  **Nightly scan** does it every day at 00:00 UTC.
- **See where space goes.** The bar splits the disk into BB & agents, Dev
  caches, Apps, Trash, Your files, System, and free space; hovering a part
  shows its size. Each category row unfolds into its biggest items, five at
  first, and **Show all** lets the list scroll on.
- **See everything.** Without Full Disk Access, macOS keeps Mail, Photos,
  Messages, the Trash, and browser profiles from the scan, and a notice under
  the bar asks for it. **Open System Settings** opens the Full Disk Access list
  on the Mac BB runs on: turn on **bb**, then reopen BB. Storage Cleaner then
  scans again on its own.
- **Clean a category.** Every **Clean** asks first and lists what it deletes:
  - **BB & agents**: the storage of every archived or deleted thread, every
    worktree whose thread is archived or deleted, uncommitted changes
    included, and Claude Code worktrees idle for 3 days with no uncommitted
    changes. Live threads, worktrees a live thread works in, and agent data
    stay.
  - **Dev caches**: what is inside Xcode DerivedData, `~/Library/Logs`, and the
    package caches of uv, npm, pnpm, Yarn, Bun, pip, Cargo, Go, Gradle,
    SwiftPM, CocoaPods, Playwright, Puppeteer, and Homebrew, plus build folders
    such as `build`, `.next`, and `__pycache__` that git ignores. Hugging Face
    models, simulators, `node_modules`, and `.venv` folders stay.
  - **Trash**: everything in the Trash.
- **Explore.** The treemap shows the current folder; hover a tile for its size
  and click a folder to open it. The path above it keeps its end and folds the
  start into "…". Below, **Contents**, **Largest files**, **File types**, and
  **Stale** (folders over 500 MB unchanged for 60 days) list files and folders
  with when they changed and their size.
- **Delete.** Check rows and click **Delete**, or use a row's trash button.
  Deleting is permanent. Top-level and system folders, your home folder's own
  folders, iCloud Drive and other synced folders, keychains, and BB's data other
  than thread storage and worktrees can't be deleted.
- **Clean every night.** At 00:00 UTC,
  **Clean stale archived threads** deletes the storage of threads archived 7
  or more days ago, **Clean leftover worktrees** the worktrees whose thread is
  archived or deleted, **Clean stale dev caches** what nothing touched for 7
  days, and **Clean Trash** the Trash. All start off. Each scans first, even
  with **Nightly scan** off, and none runs when that scan fails.

Sizes count APFS clones and hard links once: a file cloned into three places
counts a third in each. A row's delete says how much it frees for sure, the
part no other file shares.

## How it works

- The server runs a scanner with `python3` at low priority. It lists each
  folder with one `getattrlistbulk(2)` call, which also returns each file's
  private size and clone count, and splits the tree across one process per
  CPU. It skips other volumes and folders macOS doesn't let BB read.
- The latest scan lives gzipped in the plugin's SQLite database. Deleting
  through the page updates it, so sizes change at once without a rescan.
- BB & agents reads BB's threads through `bb.sdk.threads` and BB's data folder
  from `bb.server.experimental_dataDir`. A folder whose thread is missing from
  the list is deleted only after `bb.sdk.threads.get` reports the thread not
  found. A worktree folder stays while any live thread's workspace is inside
  it, and for an hour after its thread is archived, while BB removes it
  itself. Removing a worktree runs `git worktree remove` for it. Claude Code
  worktrees in a project's `.claude/worktrees` count as leftover after 3 idle
  days and go only without uncommitted changes.
- Build folders go only inside a project's git repository, not one at the home
  folder, and only when `git check-ignore` says git ignores them.
- BB has Full Disk Access when it can open macOS's privacy database,
  `/Library/Application Support/com.apple.TCC/TCC.db`. The page checks this
  each time it loads. When BB first has access after a scan made without
  access, Storage Cleaner scans again.
- The Trash is emptied directly when BB has Full Disk Access, and through
  Finder otherwise. System counts what macOS keeps from the scan as not
  readable. With Full Disk Access, only folders macOS keeps to itself, such as
  the Spotlight index, stay unread.
- A schedule wakes every hour and does the nightly work in the hour that starts
  at 00:00 UTC.
- The page is a `settingsSection` slot on the plugin's settings page and a
  `navPanel` page, both the same view. A BB update may move thread storage or
  worktrees within BB's data folder, or change these slots.

## Install

Needs macOS, BB 0.46.0 or later, and `python3`, which the Xcode Command Line
Tools provide. Storage Cleaner scans the Mac its BB server runs on. Give BB
Full Disk Access in System Settings → Privacy & Security so the scan sees
everything; **Open System Settings** on the page opens that list.

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install storage-cleaner@sf-plugins
```

Use `bb plugin install .` from this directory instead when working on it
locally.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
bb plugin reload storage-cleaner
```

## More San Francisco Plugins

Storage Cleaner is one of the
[San Francisco Plugins](https://github.com/rebryk/bb-plugins), a family of BB
plugins. The others:

- [Superhuman](../superhuman): Superhuman-style speed for BB, with shortcuts and
  search in any keyboard layout, snoozed threads, and a phone layout.
- [Bookmarks](../bookmarks): save any chat message and jump back to it from the
  thread's right panel.
- [To-do](../todo): a Notes-style to-do list on the New thread screen and in
  the right panel; snooze a to-do or start a thread from it.
- [Canvas](../canvas): images, text, and drawing in each thread, with
  screenshots your agent can read.
- [Annotate](../annotate): notes on the elements of a page in BB's Browser,
  sent to your agent with a screenshot.
- [Auto Update](../auto-update): updates for the plugins you pick, installed
  every hour, day, or week.
- [Resource Monitor](../resource-monitor): live CPU, RAM, and GPU bars for the
  BB server in the sidebar, with the numbers on hover.
- [San Francisco](../san-francisco): a quiet macOS-style theme after the Aside
  browser, with your pick of the eight macOS accent colors.
- [Pool Usage](../pool-usage): how much of each provider's capacity is in use
  and when it frees up, in the sidebar footer.
