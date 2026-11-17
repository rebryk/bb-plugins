# Slack Threads

Mention the bot in Slack to start a bb coordinator. It answers in the Slack
thread and delegates longer tasks to workers with live status cards.

## Attachments

The bot downloads images and files from messages it forwards to bb, including
thread history. The Slack app needs `files:read`; see the
[app manifest](slack-app-manifest.yaml).

Files stay under `<bb data>/plugins/slack-threads/slack-files/`, grouped by
Slack thread and message. Prompts list saved paths and reasons for skipped
files. The limits are 25 MB per file and 20 files per prompt, with current
messages first. Files are removed when the coordinator thread is deleted.

These paths belong to the BB server. Coordinators and workers need access to
that machine's filesystem; files are not copied to remote execution hosts.

See the [agent guide](skills/slack-threads/SKILL.md) for commands and settings.

## Releases

See [CHANGELOG.md](CHANGELOG.md).
