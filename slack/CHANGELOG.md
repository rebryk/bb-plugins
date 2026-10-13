# Changelog

Newest version first. [Releases](../README.md#releases) explains when a change
gets a new version. Each version is tagged `slack/v<version>`.

## 0.1.0 (2026-10-13)

- First release: a Slack button in every thread's header with the count of
  unread direct messages and mentions, or a dot for unread channels. In the BB
  app it opens Slack in the thread's right panel; on a phone, the Slack app.
  The BB server reads the counts every 20 seconds with a Slack session set in
  the plugin's settings.
