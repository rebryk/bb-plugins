# Dia Sidebar

The sidebar's top navigation as a wrapping grid of square icon buttons.
Buttons follow BB's footer controls: normally 32 px with 16 px icons.
They sit edge to edge without gaps, since only the hovered and the current
button show a background. The grid has 8 px horizontal padding and no
vertical padding, so it does not stack extra space onto BB's header and
thread list.
Compact touch viewports use 36 px buttons and 20 px icons.
These sizes use BB's spacing token; corner radii, colors and interaction
states follow the active BB theme. Hover an icon for its name.
BB continues to own destinations, shortcuts, split opening, hidden items,
menus, and customization.

## Use

Install the plugin and choose **Dia Sidebar** under **Settings → Appearance →
Navigation**. Right-click a tile, long-press it, or focus it and press
**Shift+F10** / the **Context Menu** key for its native menu.
Use **More → Customize sidebar** to change visibility and order.
Reordering happens in that native editor; dragging within the icon grid does
not rearrange tiles. Dragging a destination out into a split remains available.

When **Search threads** is visible, it appears as a magnifying-glass button
alongside the other icons and opens BB's thread search. Enable it in
**Customize sidebar** if it was previously hidden.

Plugin sidebar accessories stay live in a 20 × 12 px area at the lower-right
corner of their tile. Each fits proportionally into that area and resizes
when its content changes. Small indicators keep their natural size; larger
ones shrink. The area's paint boundary prevents overflow during updates.
The host decides whether an accessory is available; BB 0.43 omits them on
compact viewports. Long text accessories can become very small in this layout.

## Install

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install dia-sidebar@sf-plugins
```

## Develop

```sh
npm install
npm test
npm run typecheck
npm run build
npm run test:browser
bb plugin install . --yes
```

The browser geometry check requires an installed Google Chrome.

This plugin targets the navigation DOM in BB 0.43.4 / SDK 0.5.9. It delegates
to the public `experimental_Original` component because that SDK's navigation
item descriptors omit saved visibility/order and the actual accessory
components. One effect scoped to the sidebar adds hover titles, fits accessories
with ResizeObserver, and connects keyboard menu keys to the native context menu.
It blocks the host's vertical-list sorting sensors in the grid while leaving
Customize and pointer-based split gestures intact. Cleanup removes listeners,
observers, titles, and scale properties. There are no global content scripts,
private BB imports, or duplicated navigation state. Recheck the selectors when
upgrading BB, since the native DOM is not a versioned layout API.

BB 0.43 loads frontend plugins after the initial app render, so its standard
navigation can appear briefly on a page reload before the grid takes over.

## More San Francisco Plugins

Dia Sidebar is one of the
[San Francisco Plugins](https://github.com/rebryk/bb-plugins), a family of BB
plugins. The others:

- [Super Hotkeys](../super-hotkeys): Superhuman-like keyboard navigation, with
  shortcut hints, slash search, and number keys that set up a new thread.
- [Bookmarks](../bookmarks): save any chat message and jump back to it from the
  thread's right panel.
- [Pool Usage](../pool-usage): if you use Account Pooler, each account's
  limiting quota and its reset time in one sidebar list.
- [Server Switcher](../server-switcher): if you run several servers on bb
  connect, one click opens the next online one.
