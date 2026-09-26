# Server Switcher

Switch servers from BB's sidebar footer with a **Change Server** button.

## Use

### Browser / Safari / PWA

When BB is open at `https://<handle>.getbb.app`, a click opens the next online
server on your bb connect account at its home page, in the same tab. Servers
follow alphabetical handle order; offline ones are skipped and the cycle wraps
around. A toast explains when no other server is online, the session has
expired, or the page isn't a bb connect address (a direct URL or a self-hosted
connect domain).

Switching doesn't stop threads running on the previous server.

### Native iPhone / Android app

A tap opens **This device**, where **Servers** lists the app's saved servers.
The mobile bridge (`window.bb.native`) can open This device but has no message
that switches the active server, and a link to another server would leave the
app for the browser. Older builds without the bridge name the settings path in
a toast.

### Native desktop app

The button isn't shown. BB Desktop changes servers only from its native
**Window → Server** menu, and its renderer bridge (`window.bbDesktop`) can't
list or select servers.

## How it works

A click reads `/api/connect/servers` with the page's existing same-origin
session. Destinations are built from server handles only, never from URLs in
the response. The plugin copies, stores, and sends no tokens or native
credentials. The backend has no settings, storage, RPC methods, or background
services.

## Install

Install the plugin on every server where you want the button to appear:

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install server-switcher@sf-plugins
```

Use `bb plugin install .` from this directory instead when working on it
locally.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
bb plugin reload server-switcher
```

## More San Francisco Plugins

Server Switcher is one of the
[San Francisco Plugins](https://github.com/rebryk/bb-plugins), a family of BB
plugins. The others:

- [Super Hotkeys](../super-hotkeys): Superhuman-like keyboard navigation, with
  shortcut hints, slash search, and number keys that set up a new thread.
- [Bookmarks](../bookmarks): save any chat message and jump back to it from the
  thread's right panel.
- [Dia Sidebar](../dia-sidebar): the sidebar's navigation as a compact, wrapping
  grid of icons.
- [Pool Usage](../pool-usage): how much of each provider's capacity is in use
  and when it frees up, in the sidebar footer.
