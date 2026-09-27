import { describe, expect, it } from "vitest";

import { appDayStart } from "@/lib/app-time-zone";

import type { ConciergeAssignee, ConciergeService } from "./model";
import { initialTaskWindow, isConciergeServiceSelectableForTask, selectTaskAssigneeId } from "./task-event-dialog";

const assignees: ConciergeAssignee[] = [
  { id: "ceo-1", name: "Oleksandr", email: "ceo@example.com", role: "ceo", is_active: true },
  { id: "concierge-1", name: "Anna", email: "anna@example.com", role: "concierge", is_active: true },
  { id: "concierge-2", name: "Max", email: "max@example.com", role: "concierge", is_active: true },
];

describe("selectTaskAssigneeId", () => {
  it("never preselects the alphabetically first Concierge", () => {
    expect(selectTaskAssigneeId(null, "ceo-1", assignees)).not.toBe("concierge-1");
    expect(selectTaskAssigneeId(null, "someone-else", assignees)).toBe("");
  });

  it("starts with the current user when they may take the task", () => {
    expect(selectTaskAssigneeId(null, "ceo-1", assignees)).toBe("ceo-1");
    expect(selectTaskAssigneeId(null, "concierge-2", assignees)).toBe("concierge-2");
  });

  it("keeps an existing active assignee and the Concierge of the source request", () => {
    expect(selectTaskAssigneeId("concierge-2", "ceo-1", assignees)).toBe("concierge-2");
    expect(selectTaskAssigneeId("concierge-1", "ceo-1", assignees, { serviceLinked: true })).toBe("concierge-1");
  });

  it("does not submit the current CEO as the assignee of a Concierge service task", () => {
    expect(selectTaskAssigneeId(null, "ceo-1", assignees, { serviceLinked: true })).toBe("");
    expect(selectTaskAssigneeId(null, "concierge-2", assignees, { serviceLinked: true })).toBe("concierge-2");
  });

  it("does not keep an assignee that is absent from the active list", () => {
    expect(selectTaskAssigneeId("inactive-concierge", "ceo-1", assignees)).toBe("ceo-1");
  });
});

const service = {
  id: "service-1",
  assigned_concierge_id: "concierge-1",
  task_eligible: true,
} as ConciergeService;

describe("isConciergeServiceSelectableForTask", () => {
  it("accepts only task-eligible services assigned to the selected Concierge", () => {
    expect(isConciergeServiceSelectableForTask(service, "concierge-1")).toBe(true);
    expect(isConciergeServiceSelectableForTask(service, "concierge-2")).toBe(false);
    expect(isConciergeServiceSelectableForTask({ ...service, task_eligible: false }, "concierge-1")).toBe(false);
  });

  it("keeps an existing service link when the task assignee is changed", () => {
    expect(isConciergeServiceSelectableForTask(service, "concierge-2", service.id)).toBe(true);
  });

  it("does not offer a request that has already been converted to another task", () => {
    const converted = { ...service, linked_task_id: "task-1" };
    expect(isConciergeServiceSelectableForTask(converted, "concierge-1")).toBe(false);
    expect(isConciergeServiceSelectableForTask(converted, "concierge-2", service.id)).toBe(true);
  });
});

describe("initialTaskWindow", () => {
  const now = Date.parse("2026-09-27T10:00:00Z");
  const iso = (date: Date) => date.toISOString();

  it("starts a sub-task inside its parent's window", () => {
    const window = initialTaskWindow(null, {
      kind: "task",
      starts_at: "2026-09-29T08:00:00Z",
      due_at: "2026-09-30T16:00:00Z",
      ends_at: null,
    }, now);
    expect(iso(window.start)).toBe("2026-09-29T08:00:00.000Z");
    expect(iso(window.end)).toBe("2026-09-30T16:00:00.000Z");
  });

  it("uses an event parent's end and fills a missing parent start or end", () => {
    expect(iso(initialTaskWindow(null, { kind: "event", starts_at: "2026-09-29T08:00:00Z", due_at: null, ends_at: "2026-09-29T09:30:00Z" }, now).end))
      .toBe("2026-09-29T09:30:00.000Z");
    const onlyDue = initialTaskWindow(null, { kind: "task", starts_at: null, due_at: "2026-09-27T10:30:00Z", ends_at: null }, now);
    expect(iso(onlyDue.start)).toBe("2026-09-27T09:30:00.000Z");
    expect(iso(onlyDue.end)).toBe("2026-09-27T10:30:00.000Z");
    const onlyStart = initialTaskWindow(null, { kind: "task", starts_at: "2026-09-29T08:00:00Z", due_at: null, ends_at: null }, now);
    expect(iso(onlyStart.end)).toBe("2026-09-29T09:00:00.000Z");
  });

  it("keeps the one-hour default without a parent", () => {
    const window = initialTaskWindow(null, null, now);
    expect(iso(window.start)).toBe("2026-09-27T11:00:00.000Z");
    expect(iso(window.end)).toBe("2026-09-27T12:00:00.000Z");
  });

  it("starts a calendar click at 09:00 Berlin time on the clicked Berlin day", () => {
    // The calendar passes Berlin midnight of 28 Sep (27 Sep 22:00 UTC, 01:00 in Kyiv).
    const window = initialTaskWindow(appDayStart("2026-09-28"), null, now);
    expect(iso(window.start)).toBe("2026-09-28T07:00:00.000Z");
    expect(iso(window.end)).toBe("2026-09-28T08:00:00.000Z");
    // Winter time: 09:00 CET is 08:00 UTC.
    expect(iso(initialTaskWindow(appDayStart("2026-11-02"), null, now).start)).toBe("2026-11-02T08:00:00.000Z");
  });
});
