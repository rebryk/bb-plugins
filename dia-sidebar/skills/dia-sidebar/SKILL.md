---
name: dia-sidebar
description: Configure or troubleshoot Dia Sidebar's square navigation buttons.
---

# Dia Sidebar

Dia Sidebar replaces only the upper sidebar navigation. Select it under
Settings → Appearance → Navigation. Choose BB to restore the standard list.

This is a layout plugin. Match BB's footer icon controls and use host theme
tokens instead of choosing a separate visual theme. Default geometry is
32 px buttons, 16 px icons, 4 px gaps and 8 px horizontal padding. Keep vertical
padding at zero because BB's adjacent sections already provide spacing. Compact coarse
pointer viewports use 36 px buttons and 20 px icons. Keep BB's native rounded-md
radius and focus ring, and the footer's muted icon tone and hover treatment.

Visibility and order belong to BB. Reorder only in More → Customize sidebar;
the grid disables BB's vertical-list sorting sensors. Native tile menus open
on right-click, long press, Shift+F10, or the Context Menu key. Search threads is a regular
magnifying-glass icon tile that opens BB's search palette. Do not create
plugin-specific copies of these preferences. Existing plugin accessories
fit proportionally into a 20 × 12 px area at the lower right without enlarging
small content. ResizeObserver refits changing content; paint containment
prevents overflow. BB 0.43 does not mount accessories on compact viewports.

The plugin delegates to `experimental_Original` and styles its DOM. Its CSS
is scoped to `data-dia-sidebar`. If an upgrade changes the native navigation
markup, inspect that version's source and update the selectors in `app.css`
and `navigation.ts`. A single effect scoped to the sidebar measures BB's
existing plugin-root nodes without cloning or reparenting them. Keep labels
available to assistive technology and preserve pointerdown for native split
gestures. Release titles, scale properties, observers, and listeners on unload.
