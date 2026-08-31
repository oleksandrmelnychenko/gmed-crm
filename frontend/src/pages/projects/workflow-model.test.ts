import { describe, expect, it } from "vitest";

import type { ConciergeTask, ConciergeTaskStatus } from "@/pages/concierge/model";

import type { ProjectWorkflowDependency } from "./model";
import {
  availablePrerequisites,
  buildProjectWorkflowGraph,
  dependencyWouldCreateCycle,
  projectWorkflowStats,
} from "./workflow-model";

function task(id: string, status: ConciergeTaskStatus, dueAt: string | null = null): ConciergeTask {
  return {
    id,
    kind: "task",
    title: `Task ${id}`,
    note: null,
    assigned_to: "user-1",
    assigned_to_name: "Owner",
    assigned_by: "user-1",
    assigned_by_name: "Owner",
    concierge_service_id: null,
    due_at: dueAt,
    starts_at: null,
    ends_at: null,
    location: null,
    priority: "normal",
    status,
    reminder_at: null,
    reminder_sent_at: null,
    checklist_total: 0,
    checklist_completed: 0,
    comment_count: 0,
    completed_at: status === "completed" ? "2026-08-30T12:00:00Z" : null,
    archived_at: null,
    archived_by: null,
    archived_by_name: null,
    created_at: "2026-08-30T08:00:00Z",
    updated_at: "2026-08-30T08:00:00Z",
    task_audience: "internal",
    patient_id: null,
    patient_name: null,
    patient_birth_date: null,
    provider_id: null,
    provider_name: null,
    provider_phone: null,
    provider_email: null,
    project_id: "project-1",
    project_name: "Project",
    external_assignee_type: null,
    external_assignee_name: null,
    external_assignee_phone: null,
    external_assignee_email: null,
  };
}

function dependency(
  id: string,
  taskId: string,
  dependsOnTaskId: string,
): ProjectWorkflowDependency {
  return {
    id,
    task_id: taskId,
    depends_on_task_id: dependsOnTaskId,
    created_by: "user-1",
    created_by_name: "Owner",
    created_at: "2026-08-30T09:00:00Z",
  };
}

describe("project workflow model", () => {
  it("builds positioned nodes and explicit dependency edges", () => {
    const tasks = [task("a", "completed"), task("b", "in_progress")];
    const graph = buildProjectWorkflowGraph(tasks, [dependency("edge-1", "b", "a")]);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges.find((edge) => edge.id === "edge-1")).toMatchObject({
      sourceTaskId: "a",
      targetTaskId: "b",
      resolved: true,
    });
    expect(graph.width).toBeGreaterThan(900);
  });

  it("counts unresolved blockers, completion, and overdue tasks", () => {
    const tasks = [
      task("a", "open", "2026-08-29T12:00:00Z"),
      task("b", "in_progress"),
      task("c", "completed"),
    ];
    const stats = projectWorkflowStats(
      tasks,
      [dependency("edge-1", "b", "a")],
      new Date("2026-08-31T12:00:00Z"),
    );

    expect(stats).toEqual({ total: 3, completed: 1, blocked: 1, overdue: 1, progress: 33 });
  });

  it("prevents self-links, duplicate prerequisites, and dependency cycles", () => {
    const dependencies = [
      dependency("edge-1", "b", "a"),
      dependency("edge-2", "c", "b"),
    ];

    expect(dependencyWouldCreateCycle(dependencies, "a", "c")).toBe(true);
    expect(dependencyWouldCreateCycle(dependencies, "c", "a")).toBe(false);
    expect(availablePrerequisites(
      [task("a", "open"), task("b", "open"), task("c", "open")],
      dependencies,
      "b",
    ).map((item) => item.id)).toEqual([]);
  });
});
