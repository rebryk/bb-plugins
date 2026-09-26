# Changelog

Newest version first. [Releases](../README.md#releases) explains when a change
gets a new version. Each version is tagged `pool-usage/v<version>`.

## 0.2.1 (2026-09-22)

- When Account Pooler's switch threshold can't be read, the plugin logs why at
  debug level before it falls back to 98%.

## 0.2.0 (2026-09-22)

- Each row shows the quota window that decides whether the account can take a
  request: the spent window that clears last, or else the window closest to
  its limit. Before, a row showed the shortest window.
- A window counts as spent at Account Pooler's own switch threshold, a window
  past its reset is dropped as stale, and a row the pool won't route to turns
  red whatever its percentage reads.
- The plugin moved to this repository from rebryk/bb-plugin-pool-usage.

## 0.1.0 (2026-09-11)

- First release: a sidebar footer list with one row per Account Pooler
  account, showing the provider, plan, usage, and the shortest active quota
  window with its reset time.
