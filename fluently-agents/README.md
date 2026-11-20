# Fluently Agents

A task board with persistent coordinator agents and native BB conversations.

## Install

```sh
bb plugin install fluently-agents@sf-plugins
```

Open **Agents** in BB's navigation rail. Click General to open its conversation.
Ask it to execute work; it creates a task with its own conversation. Ask it to
create another agent, set its default BB project or change its instructions.
Right-click an avatar to rename it or upload an image.

## Conversations and memory

A coordinator keeps its own BB thread. Every task gets a standalone thread;
its workers are child threads. A task's normal messages go directly to its
lead. BB owns their history, streaming, permissions, drafts and execution.

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
- Mark done archives settled work. Stop running or queued work in its native
  chat before closing the task.
- Snooze hides a card for three hours, until tomorrow at 09:00, or indefinitely.
  It does not stop work. Time-based snoozes expire on the next refresh.
- N opens and focuses the conversation. Right-click the chat button for text
  focus or instructions for BB's microphone. BB transcribes voice into the
  native composer for review before sending.

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
