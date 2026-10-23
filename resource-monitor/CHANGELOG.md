# Changelog

Newest version first. [Releases](../README.md#releases) explains when a change
gets a new version. Each version is tagged `resource-monitor/v<version>`.

## 0.1.3 (2026-10-23)

- **Guard**, on macOS, keeps BB responsive when the Mac is overloaded. It is
  a small separate process that macOS starts at login, so it keeps working
  when BB is slow. It is on by default; turn it off in the plugin's settings.
- Everything BB starts, agents and what they run, runs at a lower priority
  than BB itself. Under sustained load, the busy ones run only on the
  efficiency cores.
- When BB's server or host daemon piles up three or more copies of the same
  busy command, Guard stops all but the newest.
- **Pause all** on the **Resources** page stops BB's agents, what they run,
  and BB's terminals, from any device, until **Resume all**. The page also
  shows what Guard is doing and its last actions.

## 0.1.2 (2026-10-15)

- Clicking or tapping the icon opens the **Resources** page again, without
  the right-click menu. A tap no longer shows the card; hovering with a mouse
  still does.
- The **Resources** page lists the server's processes, like Activity Monitor,
  with name, PID, CPU, and memory, refreshed every 2 seconds. Click a column
  header to sort, and filter by name, command line, or PID.
- Quit a process from its row, or every process the filter shows with
  **Quit N matching**. A dialog asks first and offers **Force Quit**, and a
  toast tells how many quit. BB's own processes, such as its server, app, and
  host daemon, are never quit; agents still can be.

## 0.1.1 (2026-10-12)

- Clicking the icon no longer opens the Resources page, which only repeated
  the card. On a touch screen, a tap shows or hides the card. The page still
  opens from the icon's right-click menu, with **Open in split**.

## 0.1.0 (2026-10-12)

- First release: three live bars, CPU, RAM, and GPU, as the plugin's icon in
  the sidebar's navigation rail, updated every 2 seconds. Hovering the icon
  shows the numbers; clicking it opens a page with the CPU model, the RAM in
  use, the GPU name, and how long the server has been up.
