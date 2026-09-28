# Changelog

Newest version first. [Releases](../README.md#releases) explains when a change
gets a new version. Each version is tagged `superhuman/v<version>`.

## 0.1.5 (2026-09-27)

- Phone Layout floats a phone's bars as cards in the shape of the thread's
  message box: as far from the screen's sides, as round, as tall as the box
  while it shows one line, and with its border and shadow. Their buttons are
  40px, as the box's own are, and a title starts where the box's text does.
  The right panel's row is a card as well, and the home page's button sits
  where a card's would. With San Francisco 0.1.1 the cards take its corners
  and text inset.
- Phone Layout drops BB's Commit button from a phone's thread bar. With the
  Thread title setting off, the bar's buttons spread evenly across it.
- Fixes for BB 0.44: the Thread title setting hides the title in a phone's
  thread bar again, Phone Layout puts the sidebar's divider above the grid
  again, and UI Polish gives Dia Sidebar's icons the tone of BB's other icons
  again.
- UI Polish leaves the check marks in Customize sidebar in their box's color.

## 0.1.4 (2026-09-27)

- Code Copy copies an agent's code blocks and inline commands with a click or
  tap, with a confirmation after copying. Inline code also supports Enter and
  Space. Selection, scrolling, links, and existing code buttons keep working.
  The Code copy setting is on by default.

## 0.1.3 (2026-09-27)

- Snooze adds a moon button before Archive in the sidebar's thread rows. It
  opens the picker for that row without switching the open thread.

## 0.1.2 (2026-09-27)

- Phone Layout makes the buttons in a phone's bars bigger, for the thumb: 44px
  with 24px icons, in bars 56px tall. Every button there takes that size, BB's
  or a plugin's, and so do the right panel's tabs. Dia Sidebar's icons take the
  same size and narrow, down to BB's size, to stay in one row.
- Phone Layout drops the sidebar button from a phone's bars and home page. The
  sidebar opens with a swipe from the screen's left edge.
- In Phone Layout, Dia Sidebar's **…** button, which opens the rest of the
  navigation, is an arrow.
- In Phone Layout, a swipe down a terminal hides the on-screen keyboard and
  brings the bars back.
- Phone Layout takes less of the browser's work each time a page restyles, as
  when the keyboard opens or a message comes in.
- Snooze's, Archive's, and Paste's buttons take the tone of BB's own icons with
  any theme. Paste's was a shade off.
- UI Polish no longer recolors other plugins' buttons in the thread header.
  Bookmarks 0.1.1 takes BB's tone by itself.

## 0.1.1 (2026-09-26)

- New: Archive Button, an Archive button next to Snooze in the thread header.
- New setting: Thread title, to hide the thread's title in a phone's bar.
- Snooze's button, and other plugins' buttons in the thread header such as
  Bookmarks', take the tone of BB's own icons.

## 0.1.0 (2026-09-26)

- First release. It brings the Super Hotkeys, Snooze, Dia Sidebar, Terminal
  Paste, and Server Switcher plugins together as one plugin, with the same
  features: keyboard hints and shortcuts, snoozed threads, a compact grid of
  navigation icons, a Paste button for the terminal on phones and tablets, and a
  Change Server button in the sidebar footer.
- New: Phone Layout, Zoom Lock (off by default), and UI Polish.
- Settings: Shortcut hints, Thread shortcuts (formerly two settings in Super
  Hotkeys), Phone layout, and Zoom lock.
- Moving from those plugins: unsnooze your threads before you remove Snooze,
  since nothing wakes them after that. Settings and snoozes don't carry over. If
  you picked Dia Sidebar under Settings → Appearance → Navigation, pick it again
  there, and bind again any keys you gave Open plugins, Snooze thread, or Show
  snoozed threads.
