# Changelog

Newest version first. [Releases](../README.md#releases) explains when a change
gets a new version. Each version is tagged `superhuman/v<version>`.

## 0.1.18 (2026-10-01)

- Use title case for all settings toggle labels.

## 0.1.17 (2026-10-01)

- Match settings section spacing and heading alignment to BB's Interface
  section, removing the extra gap before Experimental.

## 0.1.16 (2026-10-01)

- Remove the divider between Configuration and Experimental in settings.

## 0.1.15 (2026-10-01)

- Experimental is a separate settings section beside Configuration, with
  matching headings and its own card for Thread ETA and Preload threads.

## 0.1.14 (2026-10-01)

- Settings include six switches: Shortcuts, Universal Search, Mobile layout,
  Archive button, and an Experimental section for Thread ETA and Preload
  threads. All six default to on. Shortcuts combines thread shortcuts and
  hints; Mobile layout includes haptics and interface zoom locking.
- Fullscreen images support pinch zoom and panning on phones while the
  interface stays at 100%. Desktop zoom is unchanged. Closing an image leaves
  no page zoom behind.
- Code Copy is always on, and thread titles are always hidden on phones.
  Their individual toggles, Haptics, and Zoom lock have been removed.

## 0.1.13 (2026-10-01)

- Thread shortcuts use physical keys in every keyboard layout: H opens Snooze,
  E archives, / searches threads, and numbers choose new-thread options.
  Modified BB shortcuts also accept their physical key when the typed
  character has no binding. Text inputs, composition, and terminal keys keep
  their normal behavior.
- Universal Search combines the typed query with its English/Russian keyboard
  equivalent in commands, thread search, and snoozed threads. Results keep
  their actions and keyboard navigation, duplicates are removed, and the input
  stays unchanged. The setting is on by default. Built-in search integration
  is verified for BB 0.44.0; unsupported versions keep native search.

## 0.1.12 (2026-09-29)

- Thread ETA gives agents a `set_thread_eta` tool: the time left on a
  background process they started, such as a training run or a long test
  suite, with an optional label. The thread's sidebar row counts it down, as
  `M:SS` or `H:MM:SS`, in place of its usual icon, whether the thread is
  working or not, until the time runs out or the agent clears it with 0
  seconds. Agents are told to set it only when the process's progress allows
  an estimate, never for their own coding, and to keep it current. The setting
  is on by default; turned off, it hides the countdown, and agents that start
  or resume afterwards don't get the tool.

## 0.1.11 (2026-09-28)

- Phone Layout opens the right panel with a swipe from the screen's right edge,
  as a swipe from the left edge opens the sidebar. The page follows the finger;
  a third of the way or a quick flick opens the panel, and a shorter swipe
  springs back.

## 0.1.10 (2026-09-28)

- Haptics plays a light tap as the phone's sidebar or right panel opens or
  closes, by a button, the backdrop, or a swipe. A swipe that springs back
  doesn't tap. BB's app plays it natively; a browser that can vibrate vibrates.
  The setting is on by default.

## 0.1.9 (2026-09-28)

- Phone Layout spreads the buttons of a thread's bar without its title so that
  their icons sit as far from the card's sides as from each other.

## 0.1.8 (2026-09-28)

- Phone Layout stops a thread's messages at their first and last line instead
  of letting them stretch past and spring back.
- Phone Layout opens the sidebar with Settings' list of sections on entering
  Settings, instead of leaving the list closed behind a section.
- Phone Layout adds New thread to a thread's bar, first in the row. It opens the
  new-thread screen as the sidebar's New thread does, with the thread's project
  selected and the prompt focused.
- Phone Layout reverses a thread's buttons, up to the one that shows the right
  panel, which stays last. Without the title the bar reads New thread,
  Archive, Snooze, other plugins' buttons, the thread's menu, then the right
  panel's button.

## 0.1.7 (2026-09-27)

- Preload Threads loads up to four recent dialogue segments before navigation
  and refreshes them when a background thread completes. Older history loads
  normally when scrolling back. It uses BB 0.44.0's existing memory cache,
  without marking threads read or changing BB's source. The setting is on by
  default and pauses with a hidden page, offline connection, or Data Saver.
- Speculative history has a bounded size and count. Foreground loading takes
  priority, and obsolete responses cannot overwrite newer cached data. Newer
  threads stay cached under memory pressure without repeatedly fetching evicted
  history. An already-connected subscription preserves the existing cache.

## 0.1.6 (2026-09-27)

- UI Polish hides BB's git action, such as Commit, and the external editor
  picker from the thread bar on every screen size.

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
