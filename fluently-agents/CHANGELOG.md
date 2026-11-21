# Changelog

## 0.1.26

- Use 16px composer and agent-name text on narrow or touch devices to avoid
  mobile browser focus zoom. Keep compact controls and user pinch zoom.

## 0.1.25

- Use the selected VoiceRing for recording and transcription in the mic button.
- Drive it from the existing recorder and pause for hidden or reduced-motion views.

- Keep Agents inside BB's normal central area with native sidebars and menus.
- Remove the focus shell and back arrow; keep clickable Board navigation.
- Open ordinary external HTTP(S) anchor clicks from native chat and task
  artifacts in a separate browser tab. Keep internal BB links and previews.
- Show attachment images at natural proportions without gray letterboxing.
- Tighten native message and processing spacing while keeping action controls.
- Put task titles first in compact rows, followed by the requested action.
- Omit unknown agent totals and label retained counts during refresh.
- Coalesce board refresh signals so census updates cannot starve rendering.

## 0.1.24

- Restore native worker lifecycle counts, including tool waits, with an
  unknown indicator until the event census is complete. Keep archived leads
  with active or unknown native workers refreshing until their work ends.

- Put project names first in compact task rows, followed by muted actions
  and right-aligned timing. Keep full context in the row tooltip.

- Color worker avatars by task title and coordinator avatars by agent name.
- Keep light/dark colors readable and selected rings visible without fading
  unselected portraits. Preserve custom images and Animoji with colored backing.

## 0.1.23

- Group Board cards into Running and Inbox columns; keep the sidebar switch.
- Count unique active BB turns, excluding queued, archived and input-blocked
  threads. Stop adding unresolved native background tasks to running totals.
- Explain that native subagents and instantaneous inference are outside the
  count's scope. Preserve shared Sidebar phase and ETA resolution.


## 0.1.22

- Keep Board aligned with the panels when the native title bar is hidden.
- Combine task lists into one compact Inbox / Running switch, defaulting
  to Inbox without changing the selected task, conversation, or draft.
  Only the active option has a rounded highlight; there is no shared track.

## 0.1.21

- Remove native window-frame padding, inset decoration, and the edge overlay
  while Agents is alone. Keep window controls and a top drag strip available,
  and restore host framing when leaving Agents or opening another split.

## 0.1.20

- Preserve a concurrent avatar or agent edit while remembering its thread.

- Keep Running and Inbox above chat in both views, with fixed Board / Task
  navigation and board cards beside a persistent resizable sidebar.
- Select any coordinator or the task worker without losing task context or
  conversation drafts.

## 0.1.19

- Assign new agents a least-used avatar from a private local pool, preserving
  custom and existing avatars. No image assets ship with the plugin.

## 0.1.18

- Match the approved v73 status-list layout on laptops and phones, with
  Running/Review navigation and a task picker above full-height task chats.
- Separate the persistent composer from BB's native transcript and preserve
  its plugin embeds, queue, attachments and voice controls.

## 0.1.17

- Create ordinary BB coordinator, task and worker threads, retaining durable
  role links and recovering interrupted launches without duplicate work.
- Reuse Thread Sidebar's resolved status and ETA API; connect legacy task
  conversations to its existing outline tools and reminders.
- Hide surrounding BB panels while the board is open alone. Restore them on
  exit without changing saved layout, tabs or sidebar settings.

## 0.1.16 — 2026-11-20

- Use the same board-grid icon as Gen-UI Gallery in navigation and plugin
  branding.

## 0.1.15 — 2026-11-20

- Use BB's native transcript for streaming, history and plugin embeds inside
  the styled conversation panel.
- Keep the existing composer, voice controls, attachments and anchored queue.

## 0.1.14 — 2026-11-20

- Align the first draft attachment with chat text while keeping the strip scrollable.

## 0.1.13 — 2026-11-20

- Keep recording, processing and retry controls inside the voice button.
- Remove the standalone Stop control and dock the queue above the composer.
- Send immediately with Enter; queue with Cmd/Ctrl+Enter during active work.
- Close image previews through the backdrop or Escape without an extra button.

## 0.1.12 — 2026-11-20

- Show full images in a minimal preview with a close icon.
- Match the Inbox heading and attachment icon to the design.
- Follow BB send and queue shortcuts; send queued messages immediately when needed.

## 0.1.11 — 2026-11-20

- Keep Inbox corner radii fixed while expanding and collapsing.
- Align sidebar corners and breadcrumb hover geometry.

## 0.1.10 — 2026-11-20

- Keep avatar selection and focus rings visible in the composer.

## 0.1.9 — 2026-11-20

- Give message text the full composer width above a compact control row.
- Place agent selection beside attachments inside the composer.

## 0.1.8 — 2026-11-20

- Collapse the complete conversation sidebar from the navigation pill.
- Keep Inbox available with collapsible, action-first task rows.
- Show image attachments as a scrollable preview strip with corner removal.

## 0.1.7 — 2026-11-20

- Keep chat open and reserve its space beside the board and task results.
- Toggle Inbox independently without leaving the current task.
- Keep content and conversations visible in a split layout on narrow screens.

## 0.1.6 — 2026-11-20

- Adopt the approved quiet Activity row with compact, expandable details.
- Use a subtle processing indicator and respect reduced motion.

## 0.1.5 — 2026-11-20

- Use compact single-line inbox rows and highlight breadcrumb navigation.
- Reduce spacing around chat activity.
- Attach files by paste or drag and drop, with raster image previews.

## 0.1.4 — 2026-11-20

- Align breadcrumb spacing without moving the Board label on task navigation.
- Collapse consecutive internal chat events into an expandable activity row.

## 0.1.3 — 2026-11-20

- Compact task cards and board columns to match the approved layout.
- Inherit BB light and dark theme colors across the board, chat and menus.

## 0.1.2 — 2026-11-19

- Render a shared custom chat with message bubbles, tool activity and uploads.
- Record, transcribe and send voice through BB with cancellation and retry.
- Show existing BB threads as tasks and group their workers without copying
  history or changing their execution settings.
- Preserve fresh review requests during background work and explicit reopening
  across refreshes and restarts.
- Keep drafts and sends consistent when changing conversations.

## 0.1.1 — 2026-11-19

- Add a Board and Inbox with a shared-width native BB conversation panel.
- Keep standing coordinators and standalone task threads with recursive workers.
- Reuse BB memory and permissions; request bounded parallel execution.
- Choose supported models and reasoning using optional quota headroom estimates.
- Track progress, review requests, snooze and archive without deleting history.
