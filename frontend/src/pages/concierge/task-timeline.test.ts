import { describe, expect, it } from "vitest";
import { availableConciergeTaskStatuses, canDeleteConciergeTask, conciergeTaskInterval, isConciergeTaskOverdue, type ConciergeTask } from "./model";
import { orderedTaskHierarchy, taskOccursOnDay, taskTimelineColumns, taskTimelineSpan } from "./task-calendar";

const task = (overrides: Partial<ConciergeTask> = {}) => ({
  id: "parent", kind: "task", starts_at: "2026-09-10T09:00:00", due_at: "2026-09-12T00:00:00", ends_at: null,
  status: "open", assigned_by: "manager", assigned_by_role: "ceo", assigned_to: "worker", archived_at: null,
  comment_count: 0, checklist_total: 0, attachment_count: 0, ...overrides,
} as ConciergeTask);

describe("Work Center intervals and hierarchy", () => {
  it("shows tasks throughout their planned interval, excluding an end at midnight", () => {
    expect(taskOccursOnDay(task(), new Date(2026, 8, 9))).toBe(false);
    expect(taskOccursOnDay(task(), new Date(2026, 8, 10))).toBe(true);
    expect(taskOccursOnDay(task(), new Date(2026, 8, 11))).toBe(true);
    expect(taskOccursOnDay(task(), new Date(2026, 8, 12))).toBe(false);
  });
  it("retains deadline-only tasks and handles missing dates without inventing a start", () => {
    const legacy = task({ starts_at: null });
    expect(conciergeTaskInterval(legacy).start).toBeNull();
    expect(taskOccursOnDay(legacy, new Date(2026, 8, 12))).toBe(true);
    expect(taskOccursOnDay(task({ starts_at: null, due_at: null }), new Date(2026, 8, 10))).toBe(false);
  });
  it("uses the event end for overdue detection and keeps hold deadlines visible", () => {
    const event = task({ kind: "event", due_at: null, ends_at: "2026-09-10T11:00:00" });
    expect(isConciergeTaskOverdue(event, new Date("2026-09-10T10:00:00"))).toBe(false);
    expect(isConciergeTaskOverdue(event, new Date("2026-09-10T12:00:00"))).toBe(true);
    expect(isConciergeTaskOverdue(task({ status: "on_hold" }), new Date("2026-09-13T12:00:00"))).toBe(true);
  });
  it("places children below the visible parent, never drops an orphan or loops on malformed data", () => {
    const rows = orderedTaskHierarchy([task({ id: "child", parent_task_id: "parent" }), task(), task({ id: "orphan", parent_task_id: "invisible" })]);
    expect(rows.map(({ task: row, depth }) => [row.id, depth])).toEqual([["parent", 0], ["child", 1], ["orphan", 0]]);
    expect(orderedTaskHierarchy([task({ parent_task_id: "parent" })])).toHaveLength(1);
  });
  it("allows an assignee to pause/resume but not approve, cancel or mutate a peer task", () => {
    expect(availableConciergeTaskStatuses(task({ status: "in_progress" }), "worker", "concierge")).toContain("on_hold");
    expect(availableConciergeTaskStatuses(task({ status: "on_hold" }), "worker", "concierge")).toEqual(["on_hold", "in_progress"]);
    expect(availableConciergeTaskStatuses(task({ status: "on_hold" }), "peer", "concierge")).toEqual(["on_hold"]);
    expect(availableConciergeTaskStatuses(task({ status: "on_hold" }), "manager", "ceo")).toEqual(["on_hold", "in_progress", "open", "cancelled"]);
    expect(availableConciergeTaskStatuses(task({ status: "completed" }), "worker", "concierge")).toEqual(["completed"]);
  });
  it("prevents deletion of an open parent with children", () => {
    expect(canDeleteConciergeTask(task({ child_count: 1 }), "manager", "ceo")).toBe(false);
  });
});

describe("Work Center timeline spans", () => {
  const now = new Date("2026-09-21T12:00:00");
  const days = Array.from({ length: 7 }, (_, index) => new Date(2026, 8, 21 + index));
  it("runs an overdue open task from its creation up to today", () => {
    const span = taskTimelineSpan(task({ starts_at: null, due_at: "2026-09-18T00:38:00", created_at: "2026-09-15T10:00:00" }), now)!;
    expect(span.impliedStart).toBe(true);
    expect(span.running).toBe(true);
    expect(span.start.toISOString()).toBe(new Date("2026-09-15T10:00:00").toISOString());
    expect(span.end).toEqual(now);
    expect(taskTimelineColumns(span, days)).toEqual({ from: 0, to: 0, continuesBefore: true, continuesAfter: false });
  });
  it("stops the bar where the task was completed", () => {
    const span = taskTimelineSpan(task({ status: "completed", completed_at: "2026-09-23T15:00:00", due_at: "2026-09-26T00:00:00" }), now)!;
    expect(span.running).toBe(false);
    expect(taskTimelineColumns(span, days)).toEqual({ from: 0, to: 2, continuesBefore: true, continuesAfter: false });
  });
  it("keeps a future deadline as the end and marks bars that leave the week", () => {
    const span = taskTimelineSpan(task({ starts_at: "2026-09-24T19:00:00", due_at: "2026-09-30T00:50:00" }), now)!;
    expect(taskTimelineColumns(span, days)).toEqual({ from: 3, to: 6, continuesBefore: false, continuesAfter: true });
    expect(taskTimelineColumns(taskTimelineSpan(task({ starts_at: "2026-10-05T09:00:00", due_at: "2026-10-06T09:00:00" }), now)!, days)).toBeNull();
  });
  it("has no bar for a task without any date at all", () => {
    expect(taskTimelineSpan(task({ starts_at: null, due_at: null, created_at: undefined as unknown as string }), now)).toBeNull();
  });
});
