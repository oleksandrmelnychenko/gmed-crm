import { describe, expect, it } from "vitest";

import { appointmentTaskStatusOptions, appointmentTaskStatusRequest } from "./task-status";

const task = {
  id: "task-1",
  status: "open",
  assigned_to: "interpreter-1",
  assigned_by: "manager-1",
  assigned_by_role: "patient_manager",
  updated_at: "2026-09-27T10:00:00+00:00",
};

describe("appointment task status options", () => {
  it("lets the assignee move the task only up to review", () => {
    expect(appointmentTaskStatusOptions(task, "interpreter-1", "interpreter")).toEqual([
      "open",
      "in_progress",
      "on_hold",
    ]);
    const inProgress = { ...task, status: "in_progress" };
    const options = appointmentTaskStatusOptions(inProgress, "interpreter-1", "interpreter");
    expect(options).toContain("review");
    expect(options).not.toContain("completed");
  });

  it("lets the creator close a task under review", () => {
    const inReview = { ...task, status: "review" };
    expect(appointmentTaskStatusOptions(inReview, "manager-1", "patient_manager")).toContain("completed");
    expect(appointmentTaskStatusOptions(inReview, "interpreter-1", "interpreter")).not.toContain("completed");
  });

  it("offers nothing to an unrelated user", () => {
    expect(appointmentTaskStatusOptions(task, "someone-else", "concierge")).toEqual(["open"]);
  });

  it("freezes an archived task until it is restored", () => {
    const archived = { ...task, status: "completed", archived_at: "2026-09-27T12:00:00+00:00" };
    expect(appointmentTaskStatusOptions(archived, "manager-1", "patient_manager")).toEqual([
      "completed",
    ]);
  });

  it("posts to the work-center endpoint with the optimistic-lock token", () => {
    expect(appointmentTaskStatusRequest(task, "in_progress")).toEqual({
      path: "/concierge-operational-items/task-1/status",
      body: { expected_updated_at: "2026-09-27T10:00:00+00:00", status: "in_progress" },
    });
  });
});
