# Resource Monitor

Resource Monitor shows how busy the BB server is. Its icon in the sidebar's
navigation rail is three live bars, CPU, RAM, and GPU, that move every 2
seconds. Hover the icon for the numbers.

```text
rail      hover card
┌─────┐   ┌───────────────────┐
│ ▂█▁ │ → │  21%   74%   13%  │
└─────┘   │  ━──   ━━─   ───  │
          │  CPU   RAM   GPU  │
          └───────────────────┘
```

## Use

- **See the load.** The bars fill from the bottom: CPU on the left, RAM in
  the middle, GPU on the right. A bar turns amber at 85% and red at 95%.
- **See the numbers.** Hover the icon. In place of BB's tooltip, a card shows
  each percentage over a thin bar. On a touch screen, tap the icon to show or
  hide the card. Clicking the icon opens nothing.
- **See the details.** Right-click the icon and choose **Open in split**. The
  **Resources** page adds the CPU model and core count, the RAM in use, the
  GPU name, the server's name, and how long it has been up.

## How it works

- The server reads the load every 2 seconds and sends each reading to every
  open BB window over realtime. Nothing is stored.
  - **CPU**: the share of time all cores were busy since the last reading,
    from Node's `os.cpus()`.
  - **RAM**: on macOS, app memory, wired, and compressed pages from
    `vm_stat`, the way Activity Monitor counts **Memory Used**; on Linux,
    everything but `MemAvailable` in `/proc/meminfo`; elsewhere, Node's
    `os.totalmem() - os.freemem()`.
  - **GPU**: on macOS, the GPU's **Device Utilization** from `ioreg`;
    elsewhere, the busiest NVIDIA GPU from `nvidia-smi`. Without either, the
    GPU bar stays empty and the card shows a dash.
- A reading takes about 10 ms: on macOS, it runs `vm_stat` and `ioreg` once
  each. After 3 failed GPU reads in a row, it stops reading the GPU until the
  plugin reloads.
- While BB has no connection to the server, the bars and the card are empty
  rather than frozen at the last reading.
- The icon is a component registered with `app.experimental_icons.register()`
  and named as the icon of the plugin's `navPanel`, which puts it in the rail.
  BB draws registered icons outside any plugin context, so an always-mounted
  `experimental_appOverlay` receives the readings and shares them with the
  icon.
- The card is the plugin's own. It mutes BB's tooltip on the icon by stopping
  `pointermove` events on the rail tile before BB's handler sees them, and it
  stops clicks on the tile the same way, so they never open the page.
- A BB update may break `experimental_icons`, `experimental_appOverlay`, the
  rail's `data-nav-rail-item` attribute, or how BB opens the rail's tooltip
  and page.

## Install

Needs BB 0.46.0 or later. Resource Monitor measures the machine that runs the
BB server, so install it on each server you want to watch.

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install resource-monitor@sf-plugins
```

Use `bb plugin install .` from this directory instead when working on it
locally.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
bb plugin reload resource-monitor
```

## More San Francisco Plugins

Resource Monitor is one of the
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
- [Storage Cleaner](../storage-cleaner): what fills your Mac's disk, and cleanup
  of archived threads, worktrees, and caches.
- [San Francisco](../san-francisco): a quiet macOS-style theme after the Aside
  browser, with your pick of the eight macOS accent colors.
- [Pool Usage](../pool-usage): how much of each provider's capacity is in use
  and when it frees up, in the sidebar footer.
