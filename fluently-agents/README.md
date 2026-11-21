# Fluently Agents

A task board with persistent coordinator agents and a shared conversation panel.

## Install

```sh
bb plugin install fluently-agents@sf-plugins
```

Open **Agents** in BB's navigation rail. The selected agent's chat opens
automatically. Choose an avatar in the composer to switch agents.
Ask it to execute work; it creates a task with its own conversation. Ask it to
create another agent, set its default BB project or change its instructions.
Right-click an avatar to rename it or upload an image.
New agents without an uploaded avatar use the least-used image from the local
`avatar-pool` key in this plugin's persistent key-value storage. Existing
agents keep their avatars; editing an agent without an avatar field preserves
its image, and an explicit empty string clears it. Without a valid pool, new
agents use initials.

The optional pool is a JSON array of at most 16 PNG, JPEG, or WebP base64 data
URLs, each at most 150,000 characters and together at most 240,000 characters
as JSON. Provision it privately in local plugin storage, then reload the
plugin. No image pack is included or downloaded. Keep licensed assets out of
source control and distribution bundles.


## Layout

The board hides BB's surrounding panels while open alone. Back to BB restores
the ordinary view; saved panel widths, tabs and sidebar state stay unchanged.
Split views retain BB's navigation.

The sidebar shows one task panel above chat on the board and inside a task.
Its Inbox / Running switch defaults to Inbox and only filters the list;
it keeps the selected task, conversation and draft. A separate icon collapses
the list. Running rows show the task, project, active agents and ETA;
Inbox rows lead with the requested action.

Board returns to the task cards without moving the navigation. A selected task
adds the Task breadcrumb and shows its results to the right. Resize the sidebar
by dragging its right edge or using the focused separator's arrow keys. Its
width persists and stays within the available desktop space.

Choose any coordinator from the composer avatars in either view. Inside a task,
the separate task worker target returns to that task's conversation. Each target
keeps its own draft and attachments. Phones use a single column, with results
available through the native transcript's links and embeds.

## Existing BB threads

The board also shows existing open BB conversations. Each visible root becomes
one task card. Its descendants stay grouped under that card, including hidden
workers. A visible thread whose parent is missing or hidden remains reachable.
Standing coordinators and their managed workers are not imported again.

Opening a card opens the original thread and history. Importing does not change
its model, instructions, permissions, metadata or messages. The plugin stores
only a board projection and your board snooze state. Renames and parent changes
in BB appear on refresh; deleted threads lose only their board projection.

Thread Sidebar resolves card state, reviews, CI, background work and ETA for
both the standard BB list and this board. The board reads its public
`resolved_phases` API and groups resolved worker phases under their task.
Worker questions remain actionable from the task. Sidebar 0.94.0 or later is
required; a missing API reports an error instead of inventing a status.

Legacy plugin-owned task threads explicitly opt into Sidebar's outline tools,
reminders and closing-card inference. Their ownership and history stay intact.
New threads use the ordinary BB path automatically. No second status model or
ETA estimator runs in this plugin. Optional result links and measured step
counts use `agents_update_task_details`; status comes from the standard
`progress_card_update` tool.

Mark done archives the original conversation. A settled managed task stays
available for review until you mark it done; Sidebar's done phase alone does
not archive a thread. Reopen restores the same conversation. Snooze hides its
card without stopping work.

## Conversations and memory

New coordinators and tasks are ordinary, visible BB threads, created through
the public SDK. Each coordinator keeps its thread; each task is standalone;
workers are ordinary child threads. The plugin stores agent profiles and
agent/task/thread links in its persistent storage. It attaches its own metadata
after creation without changing thread ownership. The first prompt stays held
until those links exist, so role instructions apply from the first turn.
Retries recover the same conversation and never recreate the initial prompt.
A task's normal messages go directly to its lead. BB renders the conversation,
tool activity and plugin blocks inside the
plugin’s styled chat panel. The plugin supplies its composer and queue; BB
owns history, permissions and execution. Drafts stay in this browser per thread.
The text field spans the composer width. Attachments and agent selection sit
below it, with voice and send controls on the right. Task conversations omit
the agent selector. Recording animates the microphone button; press it again
to finish. Processing and retry states use that same button.

Queued messages and file uploads use BB APIs. While work runs,
Enter sends immediately; Cmd+Enter on Mac or Ctrl+Enter elsewhere queues the
message. Queued messages stay directly above the composer and have Send now
and Remove actions. Complex permission
and question requests open BB's own controls from the conversation.

Paste screenshots or drop files into the chat to attach them. Raster images
appear in a scrollable preview strip; remove a draft image with its corner
button. Open an image to see it whole; click outside or press Escape to close.
Other files
keep their download link. Uploads finish before
sending. Internal activity stays collapsed until you expand it.

The native BB transcript renders installed message directives, Generative UI
and code-fence renderers with the original message and thread context.
Transcript styling stays scoped to the Agents panel; embedded plugin content
keeps its own controls and behavior.

[UI reference and chat variants](https://an.dev/a/d783ae026b2314ef678e)
keep the visual direction alongside the implementation. The design study uses
sample processing text;
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

- Running includes queued work and shows the active-agent count and ETA.
- Inbox shows the requested decision. Finishing an assistant turn does not
  mark a task done.
- The selected list remains above chat in both views. Select a row to switch
  tasks; select Board to return to the cards.
- Mark done archives settled work. Let active work finish and resolve queued
  messages before closing the task.
- Snooze hides a card for three hours, until tomorrow at 09:00, or indefinitely.
  It does not stop work. Time-based snoozes expire on the next refresh.
- Right-click the microphone button to choose text or voice mode. N focuses the
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
