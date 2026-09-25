# Server Switcher

Switch servers from BB's sidebar footer with a **Change Server** button.

## Browser / Safari / PWA

When BB is open at `https://<handle>.getbb.app`, a click opens the next online
server on your bb connect account at its home page, in the same tab. Servers
follow alphabetical handle order; offline ones are skipped and the cycle wraps
around. A toast explains when no other server is online, the session has
expired, or the page isn't a bb connect address (a direct URL or a self-hosted
connect domain).

Switching doesn't stop threads running on the previous server. Install the
plugin on every server where you want the button to appear.

## Native iPhone / Android app

A tap opens **This device**, where **Servers** lists the app's saved servers.
The mobile bridge (`window.bb.native`) can open This device but has no message
that switches the active server, and a link to another server would leave the
app for the browser. Older builds without the bridge name the settings path in
a toast.

## Native desktop app

The button isn't shown. BB Desktop changes servers only from its native
**Window → Server** menu, and its renderer bridge (`window.bbDesktop`) can't
list or select servers.

## Data and lifecycle

A click reads `/api/connect/servers` with the page's existing same-origin
session. Destinations are built from server handles only, never from URLs in
the response. The plugin copies, stores, and sends no tokens or native
credentials. The backend has no settings, storage, RPC methods, or background
services.

## Development

```sh
cd server-switcher
npm ci --include=dev
npm test
npm run typecheck
npm run build
bb plugin install . --yes
```

Requires BB 0.43+ and Plugin SDK 0.5.9+. A local installation needs to keep this
directory on disk.
