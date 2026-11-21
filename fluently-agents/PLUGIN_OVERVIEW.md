Talk to a standing agent, then review its tasks on one board.

## Board and tasks

Running cards show progress, active agents and an estimated finish time when
available from Thread Sidebar. Needs you cards show the decision or review
requested. One compact task panel switches between Inbox and Running
above chat in both views. Inbox opens by default; switching lists preserves
the selected task, conversation and draft. The board and task
results use the remaining space beside the conversation.

## Persistent conversations

Agent avatars open persistent coordinator conversations. New coordinators and
tasks are ordinary BB threads; Thread Sidebar supplies their status and ETA.
The board hides BB's surrounding panels while open alone, and restores them
when you return to BB. A task opens its own
BB conversation. Each task can delegate independent work to several workers;
workers can delegate again within the same budget. The shared chat shows your
messages, agent replies and tool activity, with attachments and a message
queue. BB retains the history and permission decisions.

Existing open BB threads also appear as tasks, with their workers grouped under
them. Opening a task shows its original conversation without copying history
or changing its model and instructions.

Right-click the microphone button to choose text or voice. N focuses the text
composer
or starts and stops recording. BB transcribes voice and sends it when the
composer is empty; existing drafts keep the transcript for review.

## Shared memory and execution

All conversations retain BB's memory, skills and permissions. Role instructions
ask agents to parallelize substantial independent work and pass explicit briefs
between conversations. Model selection reads the live model catalog and uses
Pool Usage's provider-wide quota estimates when installed. Missing capacity
readings remain unknown; exhausted providers are skipped. Coordinators prefer
medium reasoning; task leads and workers prefer xhigh when supported.

## Lifecycle

Mark done archives the task after its work stops. Snooze hides a card until a
chosen time or until it is reopened. An automation can run
`bb agents reopen <task-id> <message>` to resume the same conversation.
