# Changelog

Newest version first. [Releases](../README.md#releases) explains when a change
gets a new version. Each version is tagged `pool-usage/v<version>`.

## 0.2.2 (2026-09-26)

- The sidebar footer shows each provider's logo with the share of its capacity
  in use, at the right end of the footer row. Besides Account Pooler's Claude
  and Codex accounts, it covers every provider that reports usage to BB, such
  as Cursor, and works without Account Pooler.
- Accounts count by the vendors' stated plan multipliers: Claude Pro 1x, Max
  5x or 20x, Team 1.25x (premium 6.25x); Codex Plus 1x, Pro $100 5x, Pro $200
  20x; other plans 1x. An account Account Pooler can't use right now (held,
  out of quota, logged out, failing, or without a reading for 30 minutes)
  counts as used until it frees up.
- Clicking a number opens that provider's card, styled like the footer's `…`
  menu: the total, the number of accounts when there are several, and up to
  four upcoming resets with the total after each. Claude Code is shown as
  Claude. Escape or a click elsewhere closes it.
- A new setting, **Red at, %** (80 by default), sets the percentage at which
  the numbers turn red.
- The per-account rows with usage bars are gone. If the footer summary can't
  find its place in bb's footer, the **Account usage** icon stays and opens the
  same cards.
- Needs bb 0.43.4 or later.

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
