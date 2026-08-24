import { describe, expect, it } from "vitest";

import type { ConciergeTask } from "@/pages/concierge/model";

import { isConciergeTaskDueToday, roleDashboardFocusTasks } from "./role-dashboard-focus";

function task(overrides: Partial<ConciergeTask>): ConciergeTask {
  return {
    id: "task-default",
    kind: "task",
    title: "Task",
    note: null,
    assigned_to: "user-1",
    assigned_to_name: "User",
    assigned_by: "user-2",
    assigned_by_name: "Manager",
    assigned_by_role: "ceo",
    concierge_service_id: null,
    due_at: null,
    starts_at: null,
    ends_at: null,
    location: null,
    priority: "normal",
    status: "open",
    reminder_at: null,
    reminder_sent_at: null,
    checklist_total: 0,
    checklist_completed: 0,
    comment_count: 0,
    completed_at: null,
    archived_at: null,
    archived_by: null,
    archived_by_name: null,
    created_at: "2026-08-20T10:00:00.000Z",
    updated_at: "2026-08-20T10:00:00.000Z",
    task_audience: "internal",
    patient_id: null,
    patient_name: null,
    patient_birth_date: null,
    provider_id: null,
    provider_name: null,
    provider_phone: null,
    provider_email: null,
    external_assignee_type: null,
    external_assignee_name: null,
    external_assignee_phone: null,
    external_assignee_email: null,
    ...overrides,
  };
}

describe("role dashboard focus", () => {
  const now = new Date("2026-08-24T10:00:00.000Z");

  it("puts overdue work before today's and future work", () => {
    const result = roleDashboardFocusTasks([
      task({ id: "future", priority: "urgent", due_at: "2026-08-25T09:00:00.000Z" }),
      task({ id: "today", priority: "normal", due_at: "2026-08-24T18:00:00.000Z" }),
      task({ id: "overdue", priority: "low", due_at: "2026-08-23T18:00:00.000Z" }),
    ], now);

    expect(result.map((item) => item.id)).toEqual(["overdue", "today", "future"]);
  });

  it("ignores completed and archived tasks and applies the limit", () => {
    const result = roleDashboardFocusTasks([
      task({ id: "active-high", priority: "high" }),
      task({ id: "active-low", priority: "low" }),
      task({ id: "completed", status: "completed" }),
      task({ id: "archived", archived_at: "2026-08-24T08:00:00.000Z" }),
    ], now, 1);

    expect(result.map((item) => item.id)).toEqual(["active-high"]);
  });

  it("uses event start time when determining whether work is due today", () => {
    expect(isConciergeTaskDueToday(task({
      kind: "event",
      due_at: "2026-08-30T09:00:00.000Z",
      starts_at: "2026-08-24T13:00:00.000Z",
    }), now)).toBe(true);
  });
});
