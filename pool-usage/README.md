# Pool Usage

Pool Usage shows how much of each provider's capacity is in use, at the right
end of the BB sidebar footer: Claude and Codex, including every account in
Account Pooler, and any other provider that reports usage to BB, such as
Cursor.

```text
[ ] [ ] [ ]                                   [Claude] 60%  [Codex] 12%
```

## Use

Click a number to open that provider's card, in the same menu surface as the
footer's `…` menu:

```text
[Claude] Claude 2x     60%
1h 25m                  9%
1d 6h                   0%
```

- `2x` is the number of accounts that count, shown when there are several.
- Up to four lines show when the total drops next, as quota windows reset or
  holds end, and what it drops to, assuming no new usage.
- Escape or a click elsewhere closes the card.

**Red at, %** in the plugin's settings (80 by default) turns the numbers red at
or above that value.

The built-in **Provider usage** plugin may be disabled if its footer item is
redundant:

```sh
bb plugin disable provider-usage
```

## How it works

- Each account counts in proportion to its plan, by the vendors' stated
  multipliers. Claude: Pro 1x, Max 5x or 20x, a standard Team seat 1.25x and a
  premium seat 6.25x. Codex: Plus 1x, Pro $100 5x, Pro $200 20x. Other plans
  count as 1x; disabled accounts and API keys don't count.
- An account's free capacity is what its tightest quota window leaves. A window
  past its reset is empty until the next reading replaces it. A weekly window
  limits an account that also has a five-hour window only once it runs low.
- For providers Account Pooler serves, accounts come from its redacted
  `status.get` RPC, and a window at or past its `switchThreshold` (from
  `config.get`) is spent. A held account counts as fully used until its hold
  ends, and so does one with an expired login, an error, or no reading from the
  last 30 minutes. Codex plans missing there come from BB's official Codex
  usage when the account emails match.
- Other providers, or every provider without Account Pooler, are read from BB's
  provider usage sources; a window there is spent at 100%.
- Credentials never enter the plugin. The numbers refresh every 30 seconds.
- The footer summary stands in for the plugin's own **Account usage** footer
  icon. bb's footer markup isn't a versioned plugin API, so if a bb update
  changes it, the summary steps aside and the icon comes back; clicking it
  opens the same cards in bb's footer panel.

## Install

Needs bb 0.43.4 or later. Account Pooler is optional.

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install pool-usage@sf-plugins
```

Use `bb plugin install .` from this directory instead when working on it
locally.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
bb plugin reload pool-usage
```

## More San Francisco Plugins

Pool Usage is one of the
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
- [Server Switcher](../server-switcher): if you run several servers on bb
  connect, one click opens the next online one.
