# Pool Usage

Pool Usage is a compact BB sidebar companion for the experimental Account
Pooler. It renders one row per pooled Claude or Codex account:

```text
[provider icon]  Max (20x)  [usage bar]  84%
                            5 hours       reset 2h 14m
```

The bar stays neutral below 75%, turns warning yellow at 75%, and critical red
at 90%. The row uses the shortest observed shared quota window (for example,
5 hours before Weekly) and shows the matching reset countdown.

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
