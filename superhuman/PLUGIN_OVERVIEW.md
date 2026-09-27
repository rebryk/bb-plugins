The speed of [Superhuman](https://superhuman.com/mail), the email client where
every action has a key, in BB: shortcuts with hints, threads that wait until you
need them, a sidebar that stays out of the way, and bars within reach of the
thumb on a phone.

## Instant hints

Hold a modifier to show the remaining keys next to visible controls immediately.
The badges are small grey pills that follow your current bindings. On a Mac,
holding Command turns a Command+Shift+M hint into Shift+M; add Shift to see M.

## Shortcuts

Outside text inputs and open menus, slash opens BB's Search threads. While a new
thread's prompt is empty, 1 opens the project, 2 the model, 3 the machine and 4
the branch, and numbers then choose options in BB's menus; in the model picker
they choose the provider. After each choice, focus returns to the prompt. Press
Escape first to start a prompt with a digit.

Command+P on a Mac and Ctrl+P elsewhere open the Plugins page. BB's Quick open
file has the same default key, so clear or change its key in
Settings → Keyboard first.

## Snooze

Click the moon in the thread header, or run **Snooze thread**, and pick when the
thread comes back: **Later today**, **Tomorrow**, **Next week**, your last pick,
or a time you type, like `in 2 hours` or `fri 3pm`. The thread and its
sub-threads leave the sidebar, and a toast offers **Undo**. The thread returns
at its time, marked unread, or at once when its agent finishes, fails, or needs
an answer. **Show snoozed threads** lists them, soonest first, to open one
without waking it or to unsnooze it. Bind both commands in Settings → Keyboard.

## Dia Sidebar

The sidebar navigation becomes compact icon buttons that wrap as the sidebar
narrows or widens. They follow the active BB theme, show their names on hover,
and keep other plugins' live indicators in each tile's corner. Your order,
hidden items, and BB's menus still apply. To bring back the standard list,
choose bb (built-in) under Settings → Appearance → Navigation.

## Terminal Paste

On phones and tablets, **Paste** in the header of the terminal's pane pastes the
clipboard the way a keyboard paste does. Where the page can't read the
clipboard, as in the BB app on Android, it opens a text field to paste into.

## Server Switcher

**Change Server** in the sidebar footer opens the next online server on your bb
connect account. In the BB mobile app, a tap opens **This device**, where
**Servers** lists the app's servers. BB Desktop changes servers only from
**Window → Server**, so it shows no button.

## Phone layout

On a phone, the page's header, the right panel's tabs, and Dia Sidebar's icons
move to the bottom of the screen, and the right panel slides in beside the page.

## Zoom lock

When you turn it on, the page stays at 100%: pinches and double taps don't zoom.

## Polish

BB's bar icons share one tone, and menus share one row height.

## Settings

**Shortcut hints** and **Thread shortcuts** turn off the keyboard features,
which stay off on phones and tablets. **Phone layout** turns off the phone
layout, and **Zoom lock** turns on the zoom lock.

## On your BB server

Snoozes are stored on your BB server, so every device shows the same ones, and
nothing is sent to an agent or an external service. While the plugin is disabled
or removed, nothing wakes snoozed threads, so unsnooze them before you remove
it. Install it on every server you open, since a BB page loads only its own
server's plugins.

## More San Francisco Plugins

Superhuman is one of the San Francisco Plugins, a family of BB plugins. The
others:

- **Bookmarks**: save any chat message and jump back to it from the thread's
  right panel.
- **Pool Usage**: how much of each provider's capacity is in use and when it
  frees up, in the sidebar footer.

See all of them, with install steps, at
[github.com/rebryk/bb-plugins](https://github.com/rebryk/bb-plugins).
