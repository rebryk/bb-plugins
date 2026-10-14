- Write everything in English.
- A PR that changes what a plugin ships runs
  `npm version patch --no-git-tag-version` in that plugin and adds a top entry
  to its `CHANGELOG.md` (README → Releases).
- Docs describe only the current state; history goes in `CHANGELOG.md`.
- Wrap Markdown at 80 columns without splitting links or bold names. Never run
  Prettier on Markdown or `marketplace.json`.
- Edit `marketplace.json` with a script that writes
  `json.dumps(data, indent=2, ensure_ascii=False) + "\n"`, then validate it
  against its `$schema`. Keep each entry's `description` equal to
  `bb.description` and its `overview` to `PLUGIN_OVERVIEW.md`.
- Never change a released plugin id (installs, settings, data, and keybindings
  are keyed by it) or the marketplace name `sf-plugins`.
- Default command keys use Cmd, Ctrl, or Alt, or F1–F24; BB silently leaves a
  taken key unbound. Handle bare keys like `/` with a keydown listener.
- Never write `A:has(B) C` or `A:has(B) > C` in CSS: Chrome then restyles the
  page on every DOM change. Mark with `A:has(B) { --m: 1; }` and style with
  `@container style(--m: 1) { A C {} }`.
- Wrap hand-written `:hover` rules in `@media (hover: hover)`, as BB does, or
  they stick after a tap.
- Finish work with subagent reviews (correctness, minimal code, these rules),
  apply their fixes, then open a PR without asking.

## Testing

Run every change in BB before the PR, on each device it touches, phone
included: `npm ci && bb plugin install .` in the plugin, then `bb plugin dev`.
Switching between a local install and `<id>@sf-plugins` takes
`bb plugin remove <id>`, which wipes its settings: save
`bb plugin config <id>` first and restore them after. Switch back to
`<id>@sf-plugins` once merged.

Test on a disposable thread (`bb thread create … --send-at 30d`, deleted
after) and your own `bb terminal`; leave the user's threads, drafts,
terminals, theme, and accent alone. For the phone layout in Aside, load BB in
a same-origin 390×844 iframe and stub `matchMedia` on its `contentWindow`
right after appending it, before BB's scripts run.

## New plugin

- Check that it builds from git alone: `git archive HEAD <id>` into an empty
  directory, then `npm ci`, `npm test`, `npm run typecheck`, `npm run build`.
- Family order: superhuman, bookmarks, canvas, annotate, auto-update,
  storage-cleaner, resource-monitor, san-francisco, pool-usage (setup-specific
  last). Insert it in that order into the root README, the collection's
  `pluginIds`, and every `## More San Francisco Plugins` block.
- Slack and Voice Input are outside the family: they stay under **Other
  plugins** in the root README, out of the collection and the family blocks,
  and their docs name no other plugin.

## Superhuman

- All features share one namespace: give ids specific names (`listSnoozes`,
  not `list`).
- A feature's on/off setting lives in the root `server.ts`, on by default
  unless the feature takes something away.
- Superhuman holds BB behavior, San Francisco only styling. Decide per feature
  whether it joins Superhuman or ships as its own plugin.

## San Francisco

- One palette with an `accent` setting; never split it into separate themes.
- Before removing a rule, diff computed styles under the old and new CSS on
  live BB pages (desktop, phone, Mac app). Keep any rule that still changes
  what users see.
