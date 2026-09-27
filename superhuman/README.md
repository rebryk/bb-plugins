# Superhuman

Superhuman makes BB as quick to drive as
[Superhuman](https://superhuman.com/mail), the email client where every action
has a key. It adds eight features:

- **Hotkeys**: hints with the keys still needed for visible shortcuts, **/** to
  search threads, number keys that set up a new thread, and a key for the
  Plugins page.
- **Snooze**: a moon button in the thread header that hides a thread from the
  sidebar until a time you pick, or until its agent needs you.
- **Dia Sidebar**: a navigation option that turns the sidebar's navigation into
  a compact, wrapping grid of icons.
- **Terminal Paste**: a Paste button for the terminal on phones and tablets.
- **Server Switcher**: a **Change Server** button in the sidebar footer that
  opens your next online server on bb connect.
- **Phone Layout**: on a phone, BB's bars at the bottom of the screen, within
  reach of the thumb, and a right panel that slides in beside the page.
- **Zoom Lock**: a page that stays at 100%, off until you turn it on.
- **UI Polish**: one tone for the icons in BB's bars, even menu rows, and a
  Safari layout fix.

The plugin's settings turn off the keyboard features and Phone Layout, and turn
on Zoom Lock. The others are always on, though BB's Navigation setting can bring
back the standard navigation.

## Use

### Hotkeys

- **Hints**: hold **⌘**, **⌃**, **⌥** or **⇧** to see, right away, the keys
  still needed for the shortcuts of visible controls. Holding ⌘ shows `⇧ M` on
  the model control; add ⇧ to see `M`. The modifier of BB's thread numbers (⌃
  in web BB on a Mac) numbers the first nine sidebar threads.
- **Search**: press **/** outside text fields and menus to open
  **Search threads**.
- **New thread setup**: while the prompt is empty, **1** opens the project,
  **2** the model, **3** the machine and **4** the branch. Numbers then choose
  one of the first ten options in BB's menu (**1–9**, **0**); BB's own keys,
  such as arrows or Tab, reach the rest. In the model picker, numbers choose
  the provider and BB keeps its last model and reasoning. After a choice or
  **Escape**, focus returns to the prompt.
- Typing hides the numbers. To start a prompt with a digit, press **Escape**
  first. Once a menu's filter has text, digits type into it.
- **Plugins**: **⌘P** on a Mac and **Ctrl+P** elsewhere open the Plugins
  page. BB's **Quick open file** has the same default key, and BB gives a
  plugin command no key that another command uses, so clear or change Quick
  open file's key in Settings → Keyboard first. The command is also in the
  command palette.

In the plugin's settings, **Shortcut hints** turns off the hints, and
**Thread shortcuts** turns off search and new thread setup. On phones and
tablets, where touch is the main input, all three stay off.

### Snooze

```text
Try: 8 am, 3 days, aug 7
───────────────────────────────────────────────
Last used                   Fri, Oct 2, 3:00 PM
Later today                      Today, 6:00 PM
Tomorrow                   Sun, Sep 27, 9:00 AM
Next week                  Mon, Sep 28, 9:00 AM
```

- **Snooze a thread**: click the moon in the thread header, or run
  **Snooze thread** from the command palette. Pick **Later today**,
  **Tomorrow**, or **Next week**, or type a time such as `8 am`, `in 2 hours`,
  `3 days`, `fri 3pm`, `next mon`, `aug 7`, or `tomorrow evening`. The first
  row shows the moment a typed time means, and **Enter** snoozes until then.
  **Last used** repeats your last pick from now, so after `fri 3pm` it means the
  coming Friday.
- **Keep going**: snoozing the open thread opens the next thread in the sidebar,
  the one above it when it was the last, or the new-thread screen when none is
  left. A toast shows until when and the thread's title, with **Undo**.
- **See what's snoozed**: a snoozed thread's moon is filled, and its tooltip
  says until when. **Show snoozed threads** in the command palette lists every
  snoozed thread, soonest first. Type to filter and press **Enter** to open a
  thread without waking it. To unsnooze the selected one, press **⌘↵** on a Mac
  and **Ctrl+Enter** elsewhere, or click **Unsnooze** at the end of its row.
- **Wake it or move it**: the picker of a snoozed thread starts with
  **Unsnooze**, and picking another time moves the snooze.
- **Keys**: neither command has a default key. Bind them in Settings → Keyboard.

Later today is the first of 9:00 AM, 3:00 PM, and 6:00 PM at least an hour away,
so it isn't offered after 5:00 PM. Tomorrow, Next week (Monday), and a typed day
without a time mean 9:00 AM. Without am or pm, an hour from 1 to 6 means the
afternoon, and 7 to 11 the morning.

A snoozed thread comes back at its time, marked unread. It comes back at once
when its agent finishes a turn or fails, or when it or a thread hidden with it
needs an answer. Archiving or deleting a snoozed thread ends its snooze.

On phones, the picker and the list open in BB's bottom drawer. The list can't
unsnooze there, so open the thread and pick **Unsnooze** from its moon.

### Dia Sidebar

The sidebar's top navigation becomes a wrapping grid of square icon buttons
while **Settings → Appearance → Navigation** is on **Automatic**, the default,
or on **Dia Sidebar**. Automatic uses the first navigation a plugin adds, so
choose Dia Sidebar there when another plugin adds one too, and **bb (built-in)**
to return to the standard list. Hover an icon for its name. BB continues to own
destinations, shortcuts, split opening, hidden items, menus, and customization.

Right-click a tile, long-press it, or focus it and press **Shift+F10** or the
**Context Menu** key for its native menu. Use **More → Customize sidebar** to
change visibility and order. Reordering happens in that native editor; dragging
within the icon grid doesn't rearrange tiles. Dragging a destination out into a
split remains available.

When **Search threads** is visible, it appears as a magnifying-glass button
alongside the other icons and opens BB's thread search. Enable it in
**Customize sidebar** if it's hidden.

Plugin sidebar accessories stay live in a 20 × 12 px area at the lower-right
corner of their tile. Each fits proportionally into that area and resizes when
its content changes. Small indicators keep their natural size; larger ones
shrink. The area's paint boundary prevents overflow during updates. The host
decides whether an accessory is available; BB 0.43 omits them on compact
viewports. Long text accessories can become very small in this layout.

### Terminal Paste

On a touch screen, BB's terminal offers no Paste, and pressing and holding it
does nothing. Tap **Paste**, a clipboard icon in the header of the right-panel
pane that shows the terminal, before BB's own buttons such as Hide right panel,
to paste the clipboard into the terminal. The text arrives the way a keyboard
paste does, so a shell with bracketed paste takes several lines without running
them one by one. The tap leaves the keyboard open or closed, as it was.

The button shows on touch screens only, in each pane whose open tab is a
terminal. With the right panel split, each such pane has its own **Paste**,
which pastes into that pane's terminal.

Where the page can't read the clipboard, as on a plain `http://` address,
**Paste** opens a text field at the top of the screen instead. Paste into the
field with the system's menu, then tap the field's **Paste**. **Cancel**, a tap
elsewhere, or Escape closes the field.

- **iPhone and iPad**: iOS may show its own **Paste** next to the button before
  it lets BB read the clipboard; tap it as well. Dismissing it opens the text
  field.
- **Android**: Chrome may ask for permission to read the clipboard. The BB app
  has no such permission, so there **Paste** always opens the text field.

### Server Switcher

- **Browser, Safari, or an installed web app**: when BB is open at
  `https://<handle>.getbb.app`, a click on **Change Server** in the sidebar
  footer opens the next online server on your bb connect account at its home
  page, in the same tab. Servers follow alphabetical handle order; offline ones
  are skipped and the cycle wraps around. A toast explains when no other server
  is online, the session has expired, or the page isn't a bb connect address (a
  direct URL or a self-hosted connect domain). Switching doesn't stop threads
  running on the previous server.
- **iPhone and Android app**: a tap opens **This device**, where **Servers**
  lists the app's saved servers. Older app builds name that settings path in a
  toast instead.
- **Desktop app**: the button isn't shown. BB Desktop changes servers only from
  its native **Window → Server** menu.

### Phone Layout

On a phone, the bars BB puts at the top of the screen move to the bottom:

- **Page header**: the header of a thread, Settings, Plugins, Skills, and
  plugin pages, with the sidebar button. On the home page, the sidebar and right
  panel buttons.
- **Right panel**: the row of tabs and buttons, below the panel's content. A
  new tab stacks its search field, actions, and recent files up from that row.
- **Dia Sidebar**: the grid of icons, level with a page's header. The sidebar
  footer takes the top.

The right panel slides in beside the page at the screen's full width, as the
sidebar does from the left, and the sidebar button moves with the page. The
sidebars drop BB's row with the back and forward buttons. While the on-screen
keyboard is open, the bars hide and leave the room to the page.

A phone is a touch screen narrower than 768 px; tablets and desktops keep BB's
layout. **Phone layout** in the plugin's settings turns the feature off.

### Zoom Lock

Turn on **Zoom lock** in the plugin's settings to keep the page at 100%: a
pinch, a double tap, or a focused text field with small type doesn't zoom it. It
takes pinch zoom away, so it starts off.

### UI Polish

UI Polish is always on:

- **Icon tone**: the icons in the page header, the right panel's row, and the
  sidebar's top buttons and footer share one tone, BB's subtle foreground,
  instead of three. Selected ones stay brighter.
- **Menu rows**: the rows of the navigation's **More** menu match BB's other
  menus, 26 px on a desktop and 36 px on a phone. On a phone, a picker's list,
  such as the branches in the thread info panel, takes the same rows.
- **Right panel icons**: on a phone, the right panel's buttons have the page
  header's 20 px icons.
- **Safari**: the thread info panel's **Environment** row lines up with the
  others.

## How it works

Each feature has its own directory, named after its heading below, and registers
its parts from the root `app.tsx`. The root `server.ts` defines the four
settings and starts Snooze's server part.

### Hotkeys

- `hotkeys/controller.ts` marks the controls that get a pill with
  `data-superhuman-*` attributes, and `hotkeys/app.css` draws the pill with
  `::after`: in a chevron's slot, over a trailing check or icon, or beside a
  provider icon.
- Hint keys come from `aria-keyshortcuts` and, for sidebar threads, from BB's
  resolved keybindings, so they follow your bindings on web and desktop. An app
  overlay hands the bindings and the plugin's settings to the page script.
- **/** presses BB's Search threads shortcut or, when that command has none,
  picks **Search threads…** in the command palette. BB requires ⌘, ⌃ or ⌥, or
  a function key, in a plugin command's default key, so the plugin listens for
  **/** itself.
- **Open plugins** is a BB command, so BB matches its key. It opens `/plugins`
  through the browser history, since the SDK has no way to go there.
- A phone or tablet is any device matching the `(pointer: coarse)` media query.
- Controls are found by BB 0.43's labels, roles and `data-*` attributes, so a
  future BB UI change may need an update here.

### Snooze

- Snoozing hides the thread and its visible sub-threads with BB's own thread
  visibility, the setting `bb thread update --visibility` changes. It hides the
  deepest first, since BB moves a visible sub-thread of a hidden thread to the
  top of the sidebar. The threads keep running; only the sidebar stops listing
  them. Waking shows the same threads again, so threads you hid yourself stay
  hidden.
- Snoozes and the last used time are stored in the plugin's key-value storage on
  the BB server, so every device shows the same ones.
- A background service wakes each snooze at its time and marks the thread
  unread. It checks at least once a minute, so snoozes that came due while the
  computer slept wake within a minute, and those that came due while BB or the
  plugin wasn't running wake when the plugin starts. BB's `thread.idle`,
  `thread.failed`, `interaction.pending`, `thread.archived`, and
  `thread.deleted` events end a snooze early.
- The next thread comes from the sidebar's rows, read from their
  `data-sidebar-*` attributes the way BB's Next thread reads them, so a BB UI
  change may need an update here. Without them, snoozing opens the new-thread
  screen.
- The picker and the list are the registry `command` component in BB's
  `dialog`, with the classes BB's command palette gives it, so they open where
  the palette opens and look like it; a BB update that restyles the palette
  doesn't restyle them. On phones, the dialog becomes BB's bottom drawer.
  Commands have no React tree and the header button exists only on thread
  pages, so an `experimental_appOverlay` renders both dialogs; the moon is an
  `experimental_threadHeaderAction`. Both slots are experimental and may change
  in a BB update.
- The toast is a custom toast in BB's toaster with the markup of BB's own toast
  card, so it looks like BB's toasts, but BB's notification center doesn't list
  it, and a BB update that restyles BB's toasts doesn't restyle it.

While the plugin is disabled or removed, nothing wakes its snoozed threads, and
they stay hidden, so unsnooze them before you remove it. To bring back a thread
that stayed hidden, find it by its title in the list of all threads, then show
it again:

```sh
bb thread list --include-hidden
bb thread update <thread-id> --visibility visible
```

### Dia Sidebar

Buttons follow BB's footer controls: normally 32 px with 16 px icons, 4 px
apart, the footer's gap, so the grid's tiles line up with the footer's. The grid
has 8 px horizontal padding and no vertical padding, so it doesn't stack extra
space onto BB's header and thread list. Compact touch viewports use 36 px
buttons and 20 px icons. These sizes use BB's spacing token;
corner radii, colors and interaction states follow the active BB theme.

The grid targets the navigation DOM in BB 0.43.4 / SDK 0.5.9. It delegates to
the public `experimental_Original` component because that SDK's navigation item
descriptors omit saved visibility/order and the actual accessory components. One
effect scoped to the sidebar adds hover titles, fits accessories with
ResizeObserver, and connects keyboard menu keys to the native context menu. It
blocks the host's vertical-list sorting sensors in the grid while leaving
Customize and pointer-based split gestures intact. Cleanup removes listeners,
observers, titles, and scale properties. Dia Sidebar uses no content script,
private BB imports, or duplicated navigation state. Recheck the selectors in
`dia-sidebar/app.css` and `dia-sidebar/navigation.ts` when upgrading BB, since
the native DOM is not a versioned layout API.

BB 0.43 loads frontend plugins after the initial app render, so its standard
navigation can appear briefly on a page reload before the grid takes over.

### Terminal Paste

A content script looks for the header rows of BB's right panel,
`[data-testid="thread-secondary-panel-top-chrome"]`, whose pane also holds a
terminal: the `.xterm` element inside `[data-app-terminal]`. While the page
matches `(pointer: coarse)`, as touch screens do, it adds the button to each
such header, and it watches the page to add and remove buttons as tabs switch
and panes split. It ignores changes inside the terminal, which redraws all the
time.

**Paste** calls `navigator.clipboard.readText()` during the tap, as browsers
require, and hands the text to xterm as a `paste` event on
`.xterm-helper-textarea`, the hidden input that keyboard pastes go through.
xterm turns line breaks into Return and adds bracketed-paste markers when the
program asks for them. The text field carries `data-bb-portaled-overlay`, like
BB's own overlays, because on phones the right panel is a drawer that pulls Tab
back into itself from anywhere else. Terminal Paste has no settings and stores
nothing.

A BB update could hide the button if the header row loses its `data-testid`,
if the header and the tab's content stop sharing a pane element, or if the
terminal loses `data-app-terminal`. It could make **Paste** do nothing if xterm
stops taking `paste` events on `.xterm-helper-textarea`.

### Server Switcher

A click reads `/api/connect/servers` with the page's existing same-origin
session. Destinations are built from server handles only, never from URLs in the
response. The plugin copies, stores, and sends no tokens or native credentials,
and Server Switcher has no settings or server part.

The mobile app's bridge (`window.bb.native`) can open This device but has no
message that switches the active server, and a link to another server would
leave the app for the browser. BB Desktop's renderer bridge (`window.bbDesktop`)
can't list or select servers, so the desktop app gets no button.

### Phone Layout

- An app overlay reads the setting and, while it's on, sets `data-phone-layout`
  on `<html>`. `phone-layout/app.css` and `phone-layout/slide.css` apply only
  under that attribute and `@media (width < 48rem) and (pointer: coarse)`.
- The bars move with `order` and `flex-direction: column-reverse`, so focus
  order and screen readers keep BB's.
- The sidebar button is a fixed overlay. CSS anchor positioning puts it on the
  page header's row; without anchor positioning, it sits on the bottom inset.
  BB moves the page with inline styles and classes as the sidebar or the right
  panel opens, so `phone-layout/layout.ts` copies the page's left edge into the
  button's `translate` on each frame while the page moves.
- `slide.css` gives the right panel the screen's width and slides it in with
  `translate`. BB's swipe closes the panel by moving the page with an inline
  `translate`, which `phone-layout/slide.ts` copies onto the panel.
- BB sets `--bb-safe-area-bottom` on `<body>` only while the on-screen keyboard
  is open, and the bars hide while it's set.
- Selectors are BB 0.43.4's `data-testid`, `data-sidebar`, and ARIA labels.
  When a BB update changes them, a bar stays where BB puts it.

### Zoom Lock

`zoom-lock/lock.ts` appends `maximum-scale=1, user-scalable=no` to BB's viewport
meta tag. BB's mobile app and an installed web app honor it, which also stops
the zoom into a text field with small type. A Safari tab ignores those limits,
so the lock also cancels `gesturestart` and `gesturechange` for a pinch, and
sets `touch-action: manipulation` on the page for a double tap. Turning the
setting off restores all three.

### UI Polish

UI Polish is `ui-polish/app.css` alone and registers nothing.

- The icon tone applies to BB's icons, `svg[data-icon-root]`, in buttons and
  links that aren't pressed, current, or active, so other plugins' images keep
  their colors. It also clears the fade BB puts on the footer's icons.
- The menu rows target `[aria-label="More sidebar navigation"]` and, in BB's
  bottom sheet, `data-persistent-drawer-content`. A picker's rows are found by
  BB's utility classes, so a BB update that changes them brings back BB's rows.
- BB wraps some icons, such as the Environment row's, in a box at least as big
  as its content. Safari takes the icon's own 24 px for that size, and the box
  pushes the label aside. The fix drops the box's least size, so it keeps the
  size BB gives it.

## Install

Needs bb 0.43.4 or later. Install the plugin on every server you open, since a
BB page loads only its own server's plugins.

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install superhuman@sf-plugins
```

Use `bb plugin install .` from this directory instead when working on it
locally.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run test:browser
bb plugin reload superhuman
```

`npm run test:browser` checks Dia Sidebar's layout in Google Chrome, which must
be installed.

## More San Francisco Plugins

Superhuman is one of the
[San Francisco Plugins](https://github.com/rebryk/bb-plugins), a family of BB
plugins. The others:

- [Bookmarks](../bookmarks): save any chat message and jump back to it from the
  thread's right panel.
- [Pool Usage](../pool-usage): how much of each provider's capacity is in use
  and when it frees up, in the sidebar footer.
