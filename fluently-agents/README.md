# Fluently Agents

A task board with persistent coordinator agents and a shared conversation panel.

## Install

```sh
bb plugin install fluently-agents@sf-plugins
```

Open **Agents** in BB's navigation rail. The selected agent's chat opens
automatically. Choose an avatar below it to switch agents.
Ask it to execute work; it creates a task with its own conversation. Ask it to
create another agent, set its default BB project or change its instructions.
Right-click an avatar to rename it or upload an image.

## Layout

Chat opens on the left. The board and task results use the remaining space
on the right. Resize the shared column to adjust both. On narrow screens,
content sits above the conversation instead.

The sidebar button in the navigation pill smoothly hides or restores Inbox,
chat and the agent controls together. Inbox stays at the top of the sidebar;
click its header to collapse or expand the task list. Each row shows the
requested action, task name and waiting time. Select a row to switch tasks
directly; click Board to return to the board.

## Existing BB threads

The board also shows existing open BB conversations. Each visible root becomes
one task card. Its descendants stay grouped under that card, including hidden
workers. A visible thread whose parent is missing or hidden remains reachable.
Standing coordinators and their managed workers are not imported again.

Opening a card opens the original thread and history. Importing does not change
its model, instructions, permissions, metadata or messages. The plugin stores
only a board projection and your board snooze state. Renames and parent changes
in BB appear on refresh; deleted threads lose only their board projection.

Runtime work, errors and pending interactions determine the live state. When
Thread Sidebar is installed, its public progress-card state supplies the review
request and ETA. A stale card from an earlier turn is ignored. An idle thread
without a known request remains queued; idleness alone does not mean review or
completion. Mark done archives the original conversation, and reopen restores
that same conversation. Snooze hides its card without stopping its work.

## Conversations and memory

A coordinator keeps its own BB thread. Every task gets a standalone thread;
its workers are child threads. A task's normal messages go directly to its
lead. The plugin draws the messages, tool activity and composer; BB owns the
history, permissions and execution. Drafts stay in this browser per thread.
Queued messages, file uploads and stop controls use BB APIs. Complex permission
and question requests open BB's own controls from the conversation.

Paste screenshots or drop files into the chat to attach them. Raster images
appear in a scrollable preview strip; remove a draft image with its corner
button. Other files keep their download link. Uploads finish before
sending. Internal activity stays collapsed until you expand it.

The custom chat uses BB Markdown. Message-specific plugin embeds require
BB's native chat renderer and are not rendered inline here.

[UI reference and chat variants](https://an.dev/a/d783ae026b2314ef678e)
keep the visual direction alongside the implementation. The design study uses sample processing text;
HTML result previews remain illustrative.

All threads retain global BB memory and the memory of their selected project.
Memory does not copy another thread's live context: agents must pass a brief
with decisions, acceptance criteria and relevant memory references.

Role instructions request substantial independent work in parallel at every
level. One shared recursive worker budget prevents a task from multiplying
without a bound. Change **Concurrent workers per task** in the plugin's BB
settings; the default is eight, clamped to 1–32. BB's global concurrency limits
still apply. Workspace sharing requires non-overlapping edit ownership.

## Models

An agent can have an explicit coordinator provider, model and reasoning level.
Otherwise the launch policy reads BB's live provider/model catalogs.
Coordinators prefer medium reasoning; task leads and workers prefer xhigh,
falling back to a supported effort. Default model ranking prefers advertised
Astra and Opus families, then the provider's default model.

With Pool Usage installed, reported provider-wide quota headroom ranks eligible
providers. It is an estimate across accounts, not a speed measurement or a
host-specific guarantee. Missing or stale readings remain unknown. Providers
with known exhausted capacity are excluded; if none remain, launch fails
visibly. The policy never resets quotas, changes accounts or raises permissions.
Model choice happens at launch; an existing conversation keeps its model.

## Board controls

- Running includes queued work. A card has a title, BB project tag, progress,
  active-agent count and an ETA when reported by its lead.
- Needs you shows the requested decision or review. Finishing an assistant
  turn does not mark a task done.
- Inbox lists tasks needing attention above the conversation. Resize either
  panel to change their shared width; this browser remembers it.
- Mark done archives settled work. Stop running or queued work in its
  conversation before closing the task.
- Snooze hides a card for three hours, until tomorrow at 09:00, or indefinitely.
  It does not stop work. Time-based snoozes expire on the next refresh.
- Right-click the chat button to choose text or voice mode. N focuses the
  composer in text mode. In voice mode, N starts recording; press it again to
  finish. The microphone button also records in either mode.
- Voice uses BB's configured transcription service. An empty composer sends the
  transcript automatically; an existing draft keeps it for review. Failed
  transcription keeps the recording for retry. Leaving the conversation
  cancels its recording and prevents delivery into another thread.

## Commands and automation

```sh
bb agents list
bb agents reopen <task-id>
bb agents reopen <task-id> Check for new mail and summarize anything actionable
```

List includes archived and snoozed tasks. Reopen restores the same conversation
and optionally sends a message. Use BB Automations to schedule that command;
the plugin does not introduce another scheduler.

If a launch fails before its thread is confirmed, list shows its unresolved
launch ID. After checking BB, run `bb agents abandon-launch <launch-id>` to
release it and retry. The command refuses in-flight or confirmed launches and
recovers a thread found by its metadata instead of duplicating it.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
bb plugin install . --yes
bb plugin dev
```

The implementation uses the public Plugin SDK, including its experimental
thread descendant and model catalog APIs. Data lives in namespaced BB key-value
storage. The board uses real thread state and additive plugin instructions.

## Releases

See [CHANGELOG.md](./CHANGELOG.md).
