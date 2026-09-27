import { describe, expect, it } from "vitest";
import { addDaysToDateKey, appDayStart } from "@/lib/app-time-zone";
import { availableConciergeTaskStatuses, canDeleteConciergeTask, conciergeTaskInterval, isConciergeTaskOverdue, type ConciergeTask } from "./model";
import { orderedTaskHierarchy, taskOccursOnDay, taskTimelineColumns, taskTimelineSpan } from "./task-calendar";

// Instants are UTC strings (Berlin is UTC+2 in September) and calendar days are
// Berlin midnights, so the tests behave the same in any machine time zone.
const berlinDay = (key: string) => appDayStart(key);

const task = (overrides: Partial<ConciergeTask> = {}) => ({
  // 10 Sep 09:00 until 12 Sep 00:00 in Berlin.
  id: "parent", kind: "task", starts_at: "2026-09-10T07:00:00Z", due_at: "2026-09-11T22:00:00Z", ends_at: null,
  status: "open", assigned_by: "manager", assigned_by_role: "ceo", assigned_to: "worker", archived_at: null,
  comment_count: 0, checklist_total: 0, attachment_count: 0, ...overrides,
} as ConciergeTask);

describe("Work Center intervals and hierarchy", () => {
  it("shows tasks throughout their planned interval, excluding an end at midnight", () => {
    expect(taskOccursOnDay(task(), berlinDay("2026-09-09"))).toBe(false);
    expect(taskOccursOnDay(task(), berlinDay("2026-09-10"))).toBe(true);
    expect(taskOccursOnDay(task(), berlinDay("2026-09-11"))).toBe(true);
    expect(taskOccursOnDay(task(), berlinDay("2026-09-12"))).toBe(false);
  });
  it("places a task on its Berlin day, whatever the browser zone", () => {
    // 27 Sep 23:30 in Berlin (28 Sep in Kyiv) and 28 Sep 00:30 in Berlin (27 Sep in UTC).
    const lateSunday = task({ starts_at: null, due_at: "2026-09-27T21:30:00Z" });
    const earlyMonday = task({ starts_at: null, due_at: "2026-09-27T22:30:00Z" });
    expect(taskOccursOnDay(lateSunday, berlinDay("2026-09-27"))).toBe(true);
    expect(taskOccursOnDay(lateSunday, berlinDay("2026-09-28"))).toBe(false);
    expect(taskOccursOnDay(earlyMonday, berlinDay("2026-09-27"))).toBe(false);
    expect(taskOccursOnDay(earlyMonday, berlinDay("2026-09-28"))).toBe(true);
  });
  it("retains deadline-only tasks and handles missing dates without inventing a start", () => {
    const legacy = task({ starts_at: null });
    expect(conciergeTaskInterval(legacy).start).toBeNull();
    expect(taskOccursOnDay(legacy, berlinDay("2026-09-12"))).toBe(true);
    expect(taskOccursOnDay(task({ starts_at: null, due_at: null }), berlinDay("2026-09-10"))).toBe(false);
  });
  it("uses the event end for overdue detection and keeps hold deadlines visible", () => {
    const event = task({ kind: "event", due_at: null, ends_at: "2026-09-10T09:00:00Z" });
    expect(isConciergeTaskOverdue(event, new Date("2026-09-10T08:00:00Z"))).toBe(false);
    expect(isConciergeTaskOverdue(event, new Date("2026-09-10T10:00:00Z"))).toBe(true);
    expect(isConciergeTaskOverdue(task({ status: "on_hold" }), new Date("2026-09-13T10:00:00Z"))).toBe(true);
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
  // Monday 21 Sep 12:00 in Berlin; the visible week runs Monday 21 to Sunday 27 Sep.
  const now = new Date("2026-09-21T10:00:00Z");
  const days = Array.from({ length: 7 }, (_, index) => berlinDay(addDaysToDateKey("2026-09-21", index)));
  it("runs an overdue open task from its creation up to today", () => {
    const span = taskTimelineSpan(task({ starts_at: null, due_at: "2026-09-17T22:38:00Z", created_at: "2026-09-15T08:00:00Z" }), now)!;
    expect(span.impliedStart).toBe(true);
    expect(span.running).toBe(true);
    expect(span.start.toISOString()).toBe("2026-09-15T08:00:00.000Z");
    expect(span.end).toEqual(now);
    expect(taskTimelineColumns(span, days)).toEqual({ from: 0, to: 0, continuesBefore: true, continuesAfter: false });
  });
  it("stops the bar where the task was completed", () => {
    const span = taskTimelineSpan(task({ status: "completed", completed_at: "2026-09-23T13:00:00Z", due_at: "2026-09-25T22:00:00Z" }), now)!;
    expect(span.running).toBe(false);
    expect(taskTimelineColumns(span, days)).toEqual({ from: 0, to: 2, continuesBefore: true, continuesAfter: false });
  });
  it("keeps a future deadline as the end and marks bars that leave the week", () => {
    const span = taskTimelineSpan(task({ starts_at: "2026-09-24T17:00:00Z", due_at: "2026-09-29T22:50:00Z" }), now)!;
    expect(taskTimelineColumns(span, days)).toEqual({ from: 3, to: 6, continuesBefore: false, continuesAfter: true });
    expect(taskTimelineColumns(taskTimelineSpan(task({ starts_at: "2026-10-05T07:00:00Z", due_at: "2026-10-06T07:00:00Z" }), now)!, days)).toBeNull();
  });
  it("draws a bar on the Berlin day it belongs to near midnight", () => {
    // Completed 27 Sep 23:30 in Berlin (28 Sep in Kyiv): the bar ends on Sunday, inside the week.
    const lateSunday = taskTimelineSpan(task({ status: "completed", starts_at: "2026-09-26T08:00:00Z", completed_at: "2026-09-27T21:30:00Z", due_at: null }), now)!;
    expect(taskTimelineColumns(lateSunday, days)).toEqual({ from: 5, to: 6, continuesBefore: false, continuesAfter: false });
    // Starts 28 Sep 00:30 in Berlin (27 Sep in UTC): outside the week.
    expect(taskTimelineColumns(taskTimelineSpan(task({ starts_at: "2026-09-27T22:30:00Z", due_at: "2026-09-28T08:00:00Z" }), now)!, days)).toBeNull();
  });
  it("has no bar for a task without any date at all", () => {
    expect(taskTimelineSpan(task({ starts_at: null, due_at: null, created_at: undefined as unknown as string }), now)).toBeNull();
  });
});
