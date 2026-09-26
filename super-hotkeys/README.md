# Super Hotkeys

Super Hotkeys brings Superhuman-like keyboard navigation to BB: it shows where
BB's keyboard shortcuts go and sets up a new thread without the mouse.
[Superhuman](https://superhuman.com/mail) is the email client where every
action has a key.

## Use

- **Hints**: hold **⌘**, **⌃**, **⌥** or **⇧** to see, right away, the keys
  still needed for the shortcuts of visible controls. Holding ⌘ shows `⇧ M` on
  the model control; add ⇧ to see `M`. The modifier of BB's thread numbers (⌃
  in web BB on a Mac) numbers the first nine sidebar threads.
- **Search**: press **/** outside text fields and menus to open **Search
  threads**.
- **Plugins**: **⌘P** on a Mac and **Ctrl+P** elsewhere open the Plugins
  page. BB's **Quick open file** has the same default key, and BB gives a
  plugin command no key that another command uses, so clear or change Quick
  open file's key in Settings → Keyboard first. The command is also in the
  command palette.
- **New thread setup**: while the prompt is empty, **1** opens the project,
  **2** the model, **3** the machine and **4** the branch. Numbers then choose
  one of the first ten options in BB's menu (**1–9**, **0**); BB's own keys,
  such as arrows or Tab, reach the rest. In the model picker, numbers choose
  the provider and BB keeps its last model and reasoning. After a choice or
  **Escape**, focus returns to the prompt.
- Typing hides the numbers. To start a prompt with a digit, press **Escape**
  first. Once a menu's filter has text, digits type into it.

Hints, search and new thread setup can each be turned off in the plugin's
settings. On phones and tablets, where touch is the main input, they stay off.

## How it works

- `controller.ts` marks the controls that get a pill with `data-super-hotkeys-*`
  attributes, and `app.css` draws the pill with `::after`: in a chevron's slot,
  over a trailing check or icon, or beside a provider icon.
- Hint keys come from `aria-keyshortcuts` and, for sidebar threads, from BB's
  resolved keybindings, so they follow your bindings on web and desktop.
- **/** presses BB's Search threads shortcut or, when that command has none,
  picks **Search threads…** in the command palette. BB requires ⌘, ⌃ or ⌥, or
  a function key, in a plugin command's default key, so the plugin listens for
  **/** itself.
- **Open plugins** is a BB command, so BB matches its key. It opens `/plugins`
  through the browser history, since the SDK has no way to go there.
- A phone or tablet is any device matching the `(pointer: coarse)` media query.
- Controls are found by BB 0.43's labels, roles and `data-*` attributes, so a
  future BB UI change may need an update here.

## Install

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install super-hotkeys@sf-plugins
```

Use `bb plugin install .` from this directory instead when working on it
locally.

## Development

```sh
npm ci
npm run typecheck
npm run build
bb plugin reload super-hotkeys
```

## More San Francisco Plugins

Super Hotkeys is one of the
[San Francisco Plugins](https://github.com/rebryk/bb-plugins), a family of BB
plugins. The others:

- [Bookmarks](../bookmarks): save any chat message and jump back to it from the
  thread's right panel.
- [Dia Sidebar](../dia-sidebar): the sidebar's navigation as a compact, wrapping
  grid of icons.
- [Snooze](../snooze): hide a thread from the sidebar until a time you pick, or
  until its agent needs you.
- [Pool Usage](../pool-usage): how much of each provider's capacity is in use
  and when it frees up, in the sidebar footer.
- [Server Switcher](../server-switcher): if you run several servers on bb
  connect, one click opens the next online one.
