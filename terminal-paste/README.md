# Terminal Paste

A **Paste** button for BB's terminal on phones and tablets. On a touch screen,
BB's terminal offers no Paste, and pressing and holding it does nothing. This
plugin puts **Paste**, a clipboard icon, in the header of the right-panel pane
that shows the terminal, before BB's own buttons such as Hide right panel.

## Use

Tap **Paste** in the terminal's header to paste the clipboard into the
terminal. The text arrives the way a keyboard paste does, so a shell with
bracketed paste takes several lines without running them one by one. The tap
leaves the keyboard open or closed, as it was.

The button shows on touch screens only, in each pane whose open tab is a
terminal. With the right panel split, each such pane has its own **Paste**,
which pastes into that pane's terminal.

Where the page can't read the clipboard, as on a plain `http://` address,
**Paste** opens a text field at the top of the screen instead. Paste into the
field with the system's menu, then tap the field's **Paste**. **Cancel**, a tap
elsewhere, or Escape closes the field.

### iPhone and iPad

iOS may show its own **Paste** next to the button before it lets BB read the
clipboard; tap it as well. Dismissing it opens the text field.

### Android

Chrome may ask for permission to read the clipboard. The BB app has no such
permission, so there **Paste** always opens the text field.

## How it works

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
back into itself from anywhere else. The plugin has no settings and stores
nothing; its server part is empty.

A BB update could hide the button if the header row loses its `data-testid`,
if the header and the tab's content stop sharing a pane element, or if the
terminal loses `data-app-terminal`. It could make **Paste** do nothing if xterm
stops taking `paste` events on `.xterm-helper-textarea`.

## Install

Install the plugin on every server whose terminal you use from a phone or
tablet:

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install terminal-paste@sf-plugins
```

Use `bb plugin install .` from this directory instead when working on it
locally.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
bb plugin reload terminal-paste
```

## More San Francisco Plugins

Terminal Paste is one of the
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
- [Server Switcher](../server-switcher): if you run several servers on bb
  connect, one click opens the next online one.
