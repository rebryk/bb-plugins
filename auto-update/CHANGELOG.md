# Changelog

Newest version first. [Releases](../README.md#releases) explains when a change
gets a new version. Each version is tagged `auto-update/v<version>`.

## 0.1.1 (2026-10-14)

- Install automatic updates only when the plugin's package version changes.
  A new Git commit with the same version shows **Version unchanged** and does
  not reinstall or reload the plugin.
- Skip updates whose candidate version cannot be verified and show the
  reason. Git checks read the exact candidate commit without installing it.
- Recheck installed versions and switches after checking candidates, so a
  concurrent update or a switch turned off during a check prevents an install.

## 0.1.0 (2026-10-12)

- First release: a **Settings → Auto Update** page that lists the installed
  plugins that can take updates, grouped by where they came from, each with a
  switch. BB checks for updates every hour, 6 hours, day, or week, or on
  **Check Now**, and installs those of the plugins turned on.
