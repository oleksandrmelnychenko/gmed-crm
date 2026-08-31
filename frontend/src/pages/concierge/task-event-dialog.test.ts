import { describe, expect, it } from "vitest";

import type { ConciergeAssignee, ConciergeService } from "./model";
import { isConciergeServiceSelectableForTask, selectTaskAssigneeId } from "./task-event-dialog";

const assignees: ConciergeAssignee[] = [
  { id: "ceo-1", name: "Oleksandr", email: "ceo@example.com", role: "ceo", is_active: true },
  { id: "concierge-1", name: "Anna", email: "anna@example.com", role: "concierge", is_active: true },
  { id: "concierge-2", name: "Max", email: "max@example.com", role: "concierge", is_active: true },
];

describe("selectTaskAssigneeId", () => {
  it("does not submit the current CEO as the Concierge assignee", () => {
    expect(selectTaskAssigneeId(null, "ceo-1", assignees)).toBe("concierge-1");
  });

  it("keeps the current Concierge or an existing active assignee", () => {
    expect(selectTaskAssigneeId(null, "concierge-2", assignees)).toBe("concierge-2");
    expect(selectTaskAssigneeId("concierge-2", "ceo-1", assignees)).toBe("concierge-2");
  });

  it("prefills the Concierge assigned to the source request", () => {
    expect(selectTaskAssigneeId("concierge-1", "ceo-1", assignees)).toBe("concierge-1");
  });

  it("does not keep an assignee that is absent from the active Concierge list", () => {
    expect(selectTaskAssigneeId("inactive-concierge", "ceo-1", assignees)).toBe("concierge-1");
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
