import { describe, expect, it } from "vitest";
import { availableConciergeTaskStatuses, canDeleteConciergeTask, conciergeTaskInterval, isConciergeTaskOverdue, type ConciergeTask } from "./model";
import { orderedTaskHierarchy, taskOccursOnDay } from "./task-calendar";

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
