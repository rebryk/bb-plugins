# Pool Usage

Pool Usage is a compact BB sidebar companion for the experimental Account
Pooler. It renders one row per pooled Claude or Codex account:

```text
[provider icon]  Max (20x)  [usage bar]  95%
                            Weekly        reset 2d 23h
```

Each row shows the window that decides whether the account can serve a request:
the spent window that clears last, or else the window closest to its limit. An
account whose 5-hour window is empty but whose weekly window is spent therefore
reads `Weekly 95%` with the weekly reset, instead of an empty 5-hour bar.

The bar stays neutral below 75%, turns warning yellow at 75%, and critical red
at 90%. A row Account Pooler will not route to — a spent window, or a hold after
a rate-limit response — turns red with a red window/reset line, whatever the
percentage reads. Spent is measured with Account Pooler's own
`switchThreshold`, read from its `config.get` RPC, and a window past its reset
is ignored until the next observation replaces it.

The tier label comes from Account Pooler's redacted subscription metadata
(`Max (5x)`, `Max (20x)`, `Pro`, and so on). Because Account Pooler currently
omits Codex's `plan_type`, Pool Usage supplements it from BB's official Codex
usage result when the account emails match. A dash is shown only when neither
source exposes the tier.

## Install

Enable and configure Account Pooler first, then install this directory:

```sh
bb plugin enable account-pool
bb plugin install .
```

Click **Account usage** in the sidebar footer. The disclosure refreshes on open
and every 30 seconds while it remains visible. Account Pooler owns credentials
and upstream quota refreshes; this plugin only reads its redacted `status.get`
RPC response.

The built-in **Provider usage** plugin may be disabled if its footer item is
redundant:

```sh
bb plugin disable provider-usage
```

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
bb plugin reload pool-usage
```
