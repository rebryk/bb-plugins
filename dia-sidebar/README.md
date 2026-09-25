# Dia Sidebar

The sidebar's top navigation as a wrapping grid of square icon buttons.
Buttons follow BB's footer controls: normally 32 px with 16 px icons,
4 px gaps, and 8 px horizontal padding. The grid adds no vertical padding,
so it does not stack extra space onto BB's header and thread list.
Compact touch viewports use 36 px buttons and 20 px icons.
These sizes use BB's spacing token; corner radii, colors and interaction
states follow the active BB theme. Hover an icon for its name.
BB continues to own destinations, shortcuts, split opening, hidden items,
menus, and customization.

## Use

Install the plugin and choose **Dia Sidebar** under **Settings → Appearance →
Navigation**. Right-click a tile for its native menu, or open **More →
Customize sidebar** to change visibility and order. Touch devices retain the
native context-menu gesture and customization screen.

When **Search threads** is visible, it appears as a magnifying-glass button
alongside the other icons and opens BB's thread search. Enable it in
**Customize sidebar** if it was previously hidden.

Plugin sidebar accessories stay live in a 20 × 12 px area at the lower-right
corner of their tile. Each fits proportionally into that area and resizes
when its content changes. Small indicators keep their natural size; larger
ones shrink. The area's paint boundary prevents overflow during updates.
The host decides whether an accessory is available; BB 0.43 omits them on
compact viewports. Long text accessories can become very small in this layout.

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
components. Scoped CSS changes the native layout; cleanup-aware content
scripts add titles and measure accessories with ResizeObserver. They keep the
original component mounted. The plugin does not import private BB modules or
maintain a second navigation state. Recheck the selectors when upgrading BB,
since the native DOM is not a versioned layout API.

BB 0.43 loads frontend plugins after the initial app render, so its standard
navigation can appear briefly on a page reload before the grid takes over.
