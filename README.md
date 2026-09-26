# bb-plugins

Personal [bb](https://getbb.app) plugins, plus the marketplace catalog that
serves them.

## Use this repository as a marketplace

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install pool-usage@rebryk-bb-plugins
bb plugin install bookmarks@rebryk-bb-plugins
bb plugin install dia-sidebar@rebryk-bb-plugins
bb plugin install server-switcher@rebryk-bb-plugins
```

`bb marketplace refresh rebryk-bb-plugins` re-reads the catalog; it never
installs or updates a plugin on its own. The catalog tracks `main`, so
`bb plugin update pool-usage` follows this repository's latest commit.

## Plugins

### [Pool Usage](./pool-usage)

A compact sidebar footer list with one row per Account Pooler account: the
provider mark, the subscription tier, a usage bar, and the quota window that
actually limits the account together with its reset countdown.

### [Bookmarks](./bookmarks)

A bookmark button on every chat message and a Bookmarks tab in the thread's
right panel that lists the saved messages across threads; clicking one opens
its thread scrolled to the message.

### [Dia Sidebar](./dia-sidebar)

A compact, wrapping grid of navigation icons, with live plugin indicators
in the lower-right corner. Keeps BB's existing menus,
hidden items, and customization.

### [Server Switcher](./server-switcher)

A Change Server button in the sidebar footer that opens the next online bb
connect server in the browser. In the native mobile app it opens This device
for server selection. The desktop app doesn't show it, since only
Window → Server can switch servers there.

## Layout

- `marketplace.json` is the v2 marketplace document bb reads.
- `<plugin-id>/` holds one plugin, with its own `package.json` and tests.
- `screenshots/<plugin-id>/` holds the catalog screenshots.

## Releases

Each plugin is versioned in its own `package.json` and tagged with a plugin
prefix, so tags never collide between plugins:

```sh
cd pool-usage && npm test && npm run typecheck && npm run build
git tag pool-usage/v0.2.0 && git push origin pool-usage/v0.2.0
```

The [BB Community marketplace](https://github.com/get-bb/marketplace) entries
resolve those tags through `subdir` and `tagPrefix`, so a community install
follows released tags while this repository's own catalog follows `main`.
Bump `version` in the plugin's `package.json` before tagging, and never move a
pushed tag. A new tag inside the entry's `range` (`^0.1.0` covers 0.1.x) shows
up as an update for community installs; a version outside it needs a
marketplace pull request that widens the range.
