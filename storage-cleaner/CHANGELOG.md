# Changelog

Newest version first. [Releases](../README.md#releases) explains when a change
gets a new version. Each version is tagged `storage-cleaner/v<version>`.

## 0.1.1 (2026-10-13)

- Without Full Disk Access, a notice asks for it, and **Open System Settings**
  opens the Full Disk Access list in System Settings. Once BB has access,
  Storage Cleaner scans again on its own, so Mail, Photos, Messages, the Trash,
  and browser profiles get their sizes.

## 0.1.0 (2026-10-12)

- First release: **Settings → Storage Cleaner** shows the free space, the disk
  split into categories, and an explorer with a treemap, and cleans the storage
  of archived threads, leftover worktrees, dev caches, and the Trash, by hand
  or every night after a scan at 00:00 UTC.
