import { describe, expect, it } from "vitest";
import { roleInstructions } from "./instructions";

const options = { role: "coordinator" as const, agentName: "Ads", agentId: "ads", maxWorkers: 6 };

describe("role instructions", () => {
  it.each(["coordinator", "task", "worker"] as const)("preserves shared BB memory and bounded parallelism for %s", role => {
    const text = roleInstructions({ ...options, role });
    expect(text).toContain("BB's existing instructions, shared memory, skills and permission rules");
    expect(text).toContain("global and relevant project memories");
    expect(text).toContain("proper scope");
    expect(text).toContain("self-contained brief");
    expect(text).toContain("substantial independent work in parallel");
    expect(text).toContain("Do not split trivial work");
    expect(text).toContain("agents_spawn_worker");
    expect(text).toContain("worker limit is 6");
    expect(text).toContain("BB's global concurrency limit");
    expect(text).toContain("silently widen permissions");
  });
  it("keeps the standing coordinator conversational and execution delegated", () => {
    const text = roleInstructions(options);
    expect(text).toContain("Delegate substantial execution with agents_create_task");
    expect(text).toContain("do not edit, build, test, install");
    expect(text).toContain("A conversation is not automatically a task");
    expect(text).toContain("agents_list_tasks");
    expect(text).toContain("agents_reopen_task");
    expect(text).toContain("agents_manage_agent only for agent configuration changes the user requests");
    expect(text).toContain("Do not create polling, acknowledgement or progress-message loops");
  });
  it("assigns task state ownership to the leader, not each parallel worker", () => {
    const text = roleInstructions({ ...options, role: "worker", taskId: "task" });
    expect(text).toContain('"taskId":"task"');
    expect(text).toContain("task's shared worker budget");
    expect(text).toContain("Workers report their own progress to the leader instead of overwriting the task state");
    expect(text).toContain("A finished model turn is not a finished task");
  });
  it("lets a task speak directly with its user and retains configured instructions", () => {
    const text = roleInstructions({ ...options, role: "task", instructions: "Use project conventions." });
    expect(text).toContain("Respond directly in this task's conversation");
    expect(text).toContain("review when the result is ready with a short review request and evidence");
    expect(text).toContain("Only the user marks a task done");
    expect(text).toContain("Additional agent instructions:\nUse project conventions.");
  });
});
