See how busy your BB server is from any page, without opening Activity Monitor
or `top`.

## Three live bars

The plugin's icon in the sidebar's navigation rail is three bars, CPU, RAM,
and GPU, that fill from the bottom and move every 2 seconds. A bar turns amber
at 85% and red at 95%.

## The numbers on hover

Hover the icon. In place of BB's tooltip, a small card shows each percentage
over a thin bar. Click the icon for a page that adds the CPU model and core
count, the RAM in use, the GPU name, and how long the server has been up.

## Where the numbers come from

The BB server reads its own load every 2 seconds. RAM counts what Activity
Monitor calls Memory Used on macOS, and everything but available memory on
Linux. GPU load comes from macOS itself, or from `nvidia-smi` on machines with
NVIDIA GPUs. Nothing is stored, and no external account or service is
required.

## More San Francisco Plugins

Resource Monitor is one of the San Francisco Plugins, a family of BB plugins.
The others:

- **Superhuman**: Superhuman-style speed for BB, with shortcuts and search in
  any keyboard layout, snoozed threads, and a phone layout.
- **Bookmarks**: save any chat message and jump back to it from the thread's
  right panel.
- **Canvas**: images, text, and drawing in each thread, with screenshots your
  agent can read.
- **Auto Update**: updates for the plugins you pick, installed every hour, day,
  or week.
- **San Francisco**: a quiet macOS-style theme after the Aside browser, with
  your pick of the eight macOS accent colors.
- **Pool Usage**: how much of each provider's capacity is in use and when it
  frees up, in the sidebar footer.

See all of them, with install steps, at
[github.com/rebryk/bb-plugins](https://github.com/rebryk/bb-plugins).
