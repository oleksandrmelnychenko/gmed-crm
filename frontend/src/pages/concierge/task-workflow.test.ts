import { describe, expect, it } from "vitest";
import type { ConciergeTask } from "./model";
import { openSubtaskCount, subtaskProgress, taskWorkflowCounts, taskWorkflowRows } from "./task-workflow";

function task(id: string, parent: string | null = null, patch: Partial<ConciergeTask> = {}): ConciergeTask {
  return { id, parent_task_id: parent, kind: "task", status: "open", archived_at: null, created_at: "2026-09-10T10:00:00Z", starts_at: null, ends_at: null, due_at: null, ...patch } as ConciergeTask;
}

describe("task workflow branches", () => {
  it("includes nested events and history, excludes other branches, and orders siblings by planned time", () => {
    const tasks = [task("root"), task("late", "root", { starts_at: "2026-09-12T10:00:00Z" }), task("early", "root", { starts_at: "2026-09-11T10:00:00Z" }), task("event", "early", { kind: "event", status: "on_hold" }), task("archived", "root", { archived_at: "2026-09-01T10:00:00Z", status: "completed" }), task("other"), task("other-child", "other")];
    expect(taskWorkflowRows(tasks, "root").map(({ task, depth }) => [task.id, depth])).toEqual([["root", 0], ["early", 1], ["event", 2], ["late", 1], ["archived", 1]]);
    expect(taskWorkflowCounts(tasks).get("root")).toEqual({ total: 4, paused: 1, done: 1, active: 4, open: 3 });
    expect(taskWorkflowCounts(tasks).get("early")).toEqual({ total: 1, paused: 1, done: 0, active: 1, open: 1 });
  });

  it("measures progress against the work that is not cancelled and finds open sub-tasks at any depth", () => {
    const tasks = [
      task("root"),
      task("done", "root", { status: "completed" }),
      task("dropped", "root", { status: "cancelled" }),
      task("mid", "root", { status: "completed" }),
      task("deep", "mid", { status: "in_progress" }),
    ];
    expect(subtaskProgress(tasks.filter(item => item.parent_task_id === "root"))).toEqual({ done: 2, total: 2 });
    expect(taskWorkflowCounts(tasks).get("root")).toMatchObject({ done: 2, active: 3, open: 1 });
    expect(openSubtaskCount(tasks[0], tasks)).toBe(1);
    expect(openSubtaskCount({ id: "elsewhere", child_open_count: 2 }, tasks)).toBe(2);
    expect(openSubtaskCount({ id: "done", child_open_count: 0 }, tasks)).toBe(0);
  });

  it("never pulls in an inaccessible parent or unrelated branch", () => {
    const tasks = [task("root", "hidden"), task("child", "root"), task("orphan", "hidden")];
    expect(taskWorkflowRows(tasks, "root").map(({ task }) => task.id)).toEqual(["root", "child"]);
    expect(taskWorkflowRows(tasks, "hidden")).toEqual([]);
    expect(taskWorkflowCounts(tasks).has("hidden")).toBe(false);
  });

  it("handles malformed cycles without duplicating cards or counting the root itself", () => {
    const tasks = [task("a", "c"), task("b", "a"), task("c", "b"), task("self", "self")];
    expect(taskWorkflowRows(tasks, "a").map(({ task }) => task.id)).toEqual(["a", "b", "c"]);
    expect(taskWorkflowCounts(tasks).get("a")?.total).toBe(2);
    expect(taskWorkflowCounts(tasks).has("self")).toBe(false);
    expect(taskWorkflowRows(tasks, "self")).toHaveLength(1);
  });
});
