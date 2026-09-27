# bb-plugins

- Write everything in this repository in English: code, comments, docs,
  commit messages, and pull requests.
- A pull request that changes what a plugin ships also raises that plugin's
  patch version and adds an entry to the plugin's own `CHANGELOG.md`. Follow
  Releases in README.md.
- Docs describe the current state only: no former names, renames, or
  migrations in READMEs, overviews, or `marketplace.json`. History belongs in
  `CHANGELOG.md`.
- Wrap Markdown at 80 columns without splitting a link or a bold name. Don't
  run Prettier on the docs or on `marketplace.json`; it formats them
  differently from the rest of the repository.

## Adding a plugin

- Name the plugin in title case and derive the rest from the name: Pool Usage
  has the id and directory `pool-usage`, the package `bb-plugin-pool-usage`, and
  `bb.name` Pool Usage. Choose the id with care. BB keys installs, settings,
  data, and keyboard overrides (`plugin:<id>/<command>`) by it, so after the
  first release a new id means every user removes the plugin and installs it
  again, with empty settings and data. Display names and descriptions can change
  at any time.
- Never change the marketplace `name`, `sf-plugins`. BB rejects a catalog whose
  name changed, so everyone who added the marketplace would have to remove it
  and add it again.
- Copy the `package.json` fields of an existing plugin (`author`, `repository`
  with `directory`, `homepage`, `bugs`, `engines`, `bb`) and the header of its
  `CHANGELOG.md`, then start the changelog at `## 0.1.0 (<date>)`.
- Never commit `dist/` or `node_modules/`. BB builds git installs itself, so
  export the plugin with `git archive HEAD <id>` into an empty directory and
  check that `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`
  pass there.
- In `marketplace.json`, add an entry whose `source.git` is this repository
  with `ref: main` and `subdir: <id>`, whose category is one of `categories`,
  whose `description` is the plugin's `bb.description`, and whose `overview`
  is the text of `PLUGIN_OVERVIEW.md`. Paths in the catalog are relative to the
  repository root (`./<id>/assets/icon.svg`, `./screenshots/<id>/<name>.png`);
  paths in `package.json` are relative to the plugin. Edit the file with a
  script that writes `json.dumps(data, indent=2, ensure_ascii=False) + "\n"`,
  which keeps its format, and validate it against its `$schema`.
- Add the plugin to the family everywhere, in the same order: general plugins
  first, setup-specific ones last, currently superhuman, bookmarks,
  san-francisco, pool-usage.
  The places are the root README's install block, Plugins intro, and Plugins
  list; the collection's `pluginIds`; and the `## More San Francisco Plugins`
  block of every other plugin's README and overview that has one. Copy each
  changed overview into `marketplace.json` as well.
- `<id>@sf-plugins` resolves only after the merge, since the catalog follows
  `main`. To try a pushed branch before that, run
  `bb plugin install 'git:https://github.com/rebryk/bb-plugins.git@<branch>' --subdirectory <id> --yes`.
  Moving an installed plugin to another source takes `bb plugin remove <id>`
  first, which deletes its settings.
- A plugin command's default key must use Command, Control, or Alt, or be one
  of F1–F24. When another command already uses the key, BB leaves the plugin's
  default unbound without an error, and Settings → Keyboard says why. Handle a
  bare key such as `/` with a keydown listener instead.

## README and overview

Every `<id>/README.md` has these sections, in this order:

1. `# <Name>` and an intro: what the plugin adds and where it shows up in BB,
   optionally followed by a text mockup or a screenshot.
2. `## Use`: how to reach and use each feature, with `###` subsections when
   the behavior differs by platform.
3. `## How it works`: storage, the BB UI or API the plugin relies on, and what
   a BB update may break.
4. `## Install`: requirements first; then one block with
   `bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main` and
   `bb plugin install <id>@sf-plugins`; then "Use `bb plugin install .` from
   this directory instead when working on it locally."
5. `## Development`: one block that runs `npm ci`, the tests,
   `npm run typecheck`, `npm run build`, and `bb plugin reload <id>`.
6. `## More San Francisco Plugins`, always last: the family sentence and the
   other plugins in family order, each with its one-line pitch. Copy the block
   from another plugin.

`PLUGIN_OVERVIEW.md` is the long description on the plugin's page in BB. It has
no title: an intro line, a `##` section per feature or topic, and the family
block, with bold names instead of links and a last line that links to the
repository.

Plugins in BB Community, currently Bookmarks and Pool Usage, stand alone: their
README and overview describe only the plugin and have no family block. BB
Community keeps its own copy of each overview, so a change to one needs a pull
request to [get-bb/marketplace](https://github.com/get-bb/marketplace) as well.

## Superhuman

- Each feature has its own directory whose `app.tsx` or `app.ts` default-exports
  `register<Feature>(app: PluginAppBuilder)`, called from the root `app.tsx`. A
  server part default-exports `register<Feature>Server(bb)`, called from the
  root `server.ts`.
- The whole plugin shares one namespace for content scripts, slots, commands,
  footer items, settings, RPC methods, services, storage keys, and realtime
  channels, so give each a specific name: `listSnoozes`, not `list`.
  `app.test.tsx` and `server.test.ts` pin the ids each side registers.
- A setting that turns a feature on or off goes in the root `server.ts`, on by
  default unless the feature takes something away, as Zoom Lock takes pinch
  zoom.
- A feature's tests load it alone with
  `loadPluginApp(asPluginApp(() => import("./app")))`, from `testing.ts`.
- The README and overview stay short: one intro line and a list of features,
  each a bold name, a period, and one line. The README has no `## Use` or
  `## How it works`.
