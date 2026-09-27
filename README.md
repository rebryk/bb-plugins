# San Francisco Plugins

A family of [bb](https://getbb.app) plugins by
[Yurii Rebryk](https://x.com/rebryk), plus the marketplace catalog that serves
them.

## Use this repository as a marketplace

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install superhuman@sf-plugins
bb plugin install bookmarks@sf-plugins
bb plugin install pool-usage@sf-plugins
```

`bb marketplace refresh sf-plugins` re-reads the catalog; it never installs or
updates a plugin on its own. The catalog tracks `main`, so
`bb plugin update pool-usage` follows this repository's latest commit.

## Plugins

All three suit any BB setup. With Account Pooler, Pool Usage counts every pooled
account, and with more than one server on bb connect, Superhuman's Change Server
button switches between them.

### [Superhuman](./superhuman)

Superhuman-style speed for BB: hints with the remaining keys of visible
shortcuts, slash to search threads, and number keys that set up a new thread's
project, model, machine, and branch; a moon button that snoozes a thread until a
time you pick or until its agent needs you; a compact, wrapping grid of
navigation icons; BB's bars at the bottom of a phone's screen; a Paste button
for the terminal on phones and tablets; a Change Server button in the sidebar
footer; a zoom lock; and one tone for BB's icons. The plugin's settings turn off
the keyboard features and the phone layout, and turn on the zoom lock.

### [Bookmarks](./bookmarks)

A bookmark button on every chat message and a Bookmarks tab in the thread's
right panel that lists the saved messages across threads; clicking one opens
its thread scrolled to the message.

### [Pool Usage](./pool-usage)

One number per provider at the right end of the sidebar footer: how much of
each provider's capacity is in use, across Account Pooler accounts, weighted by
plan. Click it for the next resets.

## Layout

- `marketplace.json` is the v2 marketplace document bb reads.
- `<plugin-id>/` holds one plugin, with its own `package.json`, tests, and
  `CHANGELOG.md`.
- `screenshots/<plugin-id>/` holds the catalog screenshots.

## Releases

Each plugin has its own version, in `<plugin-id>/package.json`, its own
history, in `<plugin-id>/CHANGELOG.md`, and its own release tags,
`<plugin-id>/v<version>`, so tags never collide between plugins.

1. In every pull request that changes what a plugin ships (its code, styles,
   manifest, or runtime dependencies), raise that plugin's patch version by
   one: 0.1.0, then 0.1.1, then 0.1.2. Run
   `npm version patch --no-git-tag-version` in the plugin's directory, which
   updates `package.json` and `package-lock.json` together. A pull request is
   one step however many commits it has, and a pull request that changes two
   plugins raises both. Tests, docs, and dev tooling alone don't need a new
   version; they ship with the next one.
2. In the same pull request, add the new version at the top of the plugin's
   `CHANGELOG.md`, with the date and what changed for the people who use the
   plugin.
3. When the pull request merges, the
   [Release tags](./.github/workflows/release-tags.yml) workflow tags the new
   commit on `main` as `<plugin-id>/v<version>`. The
   [BB Community marketplace](https://github.com/get-bb/marketplace) entries
   resolve those tags through `subdir` and `tagPrefix`, so their installs see
   the update in Settings → Updates. This repository's own catalog follows
   `main` instead.

Keep the minor and major numbers as they are. A BB Community entry accepts
only versions inside its range (`^0.1.0` covers 0.1.x), so a 0.2.0 reaches no
community install until a pull request to get-bb/marketplace widens the
range. That repository also keeps its own copy of each listing's description,
overview, and screenshots, so changing those takes a pull request there too.

Never move or delete a pushed tag. BB records the commit behind each tag and
reports a moved tag as a failed security check. Fix a bad release with the
next version.
