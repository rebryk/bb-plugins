# Changelog

## 0.1.4

- Download files and images from Slack messages and list their local paths
  in the coordinator prompt, including relevant thread history.
- Keep files attached to question and approval replies available to the
  coordinator or worker that asked.
- Limit downloads to 25 MB per file and 20 files per prompt. Report skipped
  or failed downloads beside the message.
- Reuse saved files and delete them when their coordinator thread is deleted.
- Request the Slack `files:read` scope.
