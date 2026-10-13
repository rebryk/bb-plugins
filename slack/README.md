# Slack

Slack adds a Slack button to the header of every thread in BB. The button
shows how many direct messages and mentions wait for you in Slack. Click it to
open Slack in the thread's right panel.

```text
thread header        right panel
┌────────────────┐   ┌──────────────────┐
│ …  Slack ③  …  │ → │ Slack, signed in │
└────────────────┘   └──────────────────┘
```

## Use

- **See what waits.** The number on the button counts what Slack's own badge
  counts: direct messages, app messages, and mentions in channels and
  threads. A dot without a number means unread messages in channels or
  threads that you did not mute. A faded button means the plugin has no Slack
  session, or Slack rejected it.
- **Open Slack.** In the BB app, a click opens Slack in the thread's right
  panel, in BB's own browser, which keeps you signed in. A second click selects
  the Slack tab that this window already shows instead of opening a copy. On a
  phone or tablet, a click opens the Slack app; without the app, Slack's page in
  the browser. In BB in a web browser, a click opens Slack in a new tab.

## Set up

The plugin reads the counts with your Slack session, the way Slack's web
client does. Give it the session once:

1. Open Slack at [app.slack.com](https://app.slack.com) in a desktop browser
   and sign in.
2. Copy the session token. Open the browser's developer tools, and in the
   **Console** run:

   ```js
   Object.values(JSON.parse(localStorage.localConfig_v2).teams)
     .map((team) => team.token)
     .join(" ");
   ```

   This gives one `xoxc-` token per signed-in workspace, separated by spaces.
3. Copy the session cookie: in the developer tools, open **Application** →
   **Cookies** → `https://app.slack.com`, and copy the **Value** of the cookie
   named `d`.
4. In BB, open **Settings** → **Plugins** → **Slack** and paste them into
   **Session token** and **Session cookie**. Or run:

   ```sh
   bb plugin config slack set token "xoxc-…"
   bb plugin config slack set cookie "xoxd-…"
   ```

The count appears within seconds. The token and the cookie give the same
access to Slack as the signed-in browser. BB keeps them in a file on the BB
server that only your user can read, and never sends them to a browser.

When you sign out of Slack in that browser, Slack ends the session and the
button fades. Repeat the steps with a new session.

## How it works

- The server asks Slack for the counts every 20 seconds with `client.counts`,
  and for muted conversations every 5 minutes with `users.prefs.get`. It sends
  each change to every open BB window over realtime. A window keeps the last
  count in `localStorage`, so the button shows it at once on the next load.
- A workspace whose session Slack rejects drops out of the count. When Slack
  rejects every session, the plugin stops asking until the settings change.
  After 3 failed reads in a row for any other reason, the button shows no
  count rather than an old one.
- On a phone, the button opens `https://slack.com/app/open`, a link that iOS
  and Android hand to the Slack app. BB's phone apps open only web links, so a
  `slack://` link would not leave them.
- To find the Slack tab to select, the plugin notes each Slack tab that a
  window's right panel shows, through a control in the Browser's toolbar that
  draws nothing.
- `client.counts` and `users.prefs.get` are the methods of Slack's web client,
  not of Slack's public API. Slack can change them without notice.
- The button, the always-mounted feed of counts, the toolbar control, and the
  tab lookup use the SDK's `experimental_threadHeaderAction`,
  `experimental_appOverlay`, `experimental_browserToolbarAction`, and
  `experimental_desktopBrowsers`. A BB update may break them.

## Install

Needs BB 0.46.0 or later.

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install slack@sf-plugins
```

Use `bb plugin install .` from this directory instead when working on it
locally.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
bb plugin reload slack
```
