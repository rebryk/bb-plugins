# Annotate

Annotate puts notes on the elements of a page in BB's Browser. Click an
element, write a note, and the note goes to your agent as a pill in the
thread's composer, with a screenshot of the element.

```text
Browser tab                           composer
┌─────────────────────────────┐       ┌──────────────────────────────┐
│ ① Buy Pro ← "Make it green" │  →    │ [1 · Buy Pro] [2 · Docs] …   │
└─────────────────────────────┘       └──────────────────────────────┘
```

## Use

1. Open a page in a Browser tab of the BB desktop app.
2. Click **Annotate** in the Browser's toolbar. The page shows a crosshair.
3. Point at an element. A blue box and a label show the element and its size.
   **↑** selects the parent element.
4. Click the element and write the note. **Enter** adds it; **Shift+Enter**
   starts a new line; **Escape** closes the note without adding it.
5. A numbered pin marks the element, and a pill such as `1 · Buy Pro` appears
   in the composer. Add more notes, write your message, and send it.

- **Edit or delete a note.** Click its pin on the page.
- **Stop.** Click **Done** in the toolbar, or press **Escape** while no note
  is open.
- **Remove a note.** Delete its pill in the composer; its pin goes too.

The pins stay on the page until you send the message. They come back after a
reload while the pills are in the composer.

## What the agent gets

For each pill, the agent reads the note and these facts about the element:
its tag, id, and classes; a CSS selector; its text; its main attributes; its
size and position on the page; and 14 of its computed styles. It also gets a
JPEG of the page around the element, with the element outlined and pinned.
The agent reads the page's values as data, not as instructions.

## How it works

- The **Annotate** button is a Browser toolbar control. It puts a script into
  the page's isolated world with `experimental_page.evaluate`. The script
  shares the page's DOM, but not its JavaScript, and it needs no automation
  lease, so the Browser shows no control banner.
- The script draws the picker, the note editor, and the pins in a closed
  shadow root. It stops keys, clicks, and focus changes there from reaching
  the page, so typing a note never triggers the page's own shortcuts.
- The pills in the composer decide what the page shows. Each change of the
  draft sends the list of pins to the page again. While the page shows pins
  or the picker, the control checks every second that the script is still
  there and puts it back after a reload. A pin then finds its element by the
  selector.
- The control takes the screenshot before it adds the pill, so a message sent
  at once has it too. The page shows no picker until the screenshot is done.
- The BB server stores each note in the plugin's SQLite database. The
  screenshot is a crop of `captureTab` around the element, saved in the
  thread's storage. When you send the message, the plugin's mention provider
  gives the agent the note and the screenshot.
- The toolbar control, the page script, and the screenshot use the SDK's
  `experimental_browserToolbarAction`, `experimental_page`, and
  `experimental_desktopBrowsers`. A BB update may break them.
- An element inside a frame is picked as the whole frame.
- A pin that finds no element after a reload stays hidden. Its note still
  goes to the agent.

## Install

Needs the BB desktop app, BB 0.46.0 or later.

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install annotate@sf-plugins
```

Use `bb plugin install .` from this directory instead when working on it
locally.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
bb plugin reload annotate
```

## More San Francisco Plugins

Annotate is one of the
[San Francisco Plugins](https://github.com/rebryk/bb-plugins), a family of BB
plugins. The others:

- [Superhuman](../superhuman): Superhuman-style speed for BB, with shortcuts and
  search in any keyboard layout, snoozed threads, and a phone layout.
- [Bookmarks](../bookmarks): save any chat message and jump back to it from the
  thread's right panel.
- [Canvas](../canvas): images, text, and drawing in each thread, with
  screenshots your agent can read.
- [Auto Update](../auto-update): updates for the plugins you pick, installed
  every hour, day, or week.
- [Storage Cleaner](../storage-cleaner): what fills your Mac's disk, and
  cleanup of archived threads, worktrees, and caches.
- [Resource Monitor](../resource-monitor): live CPU, RAM, and GPU bars for the
  BB server in the sidebar, with the numbers on hover.
- [San Francisco](../san-francisco): a quiet macOS-style theme after the Aside
  browser, with your pick of the eight macOS accent colors.
- [Pool Usage](../pool-usage): how much of each provider's capacity is in use
  and when it frees up, in the sidebar footer.
