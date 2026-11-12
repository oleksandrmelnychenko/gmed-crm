import { describe, expect, it } from "vitest";

import { needsOpenChecklistConfirmation, parentCompletionPath } from "./subtask-flow";

describe("parentCompletionPath", () => {
  const parent = { assigned_to: "assignee", assigned_by: "creator", assigned_by_role: "patient_manager" };

  it("completes a started parent directly and starts an open one first", () => {
    expect(parentCompletionPath({ ...parent, status: "in_progress" }, "creator", "patient_manager")).toEqual(["completed"]);
    expect(parentCompletionPath({ ...parent, status: "open" }, "creator", "patient_manager")).toEqual(["in_progress", "completed"]);
  });

  it("does not offer completion to an assignee who cannot complete the parent", () => {
    expect(parentCompletionPath({ ...parent, status: "in_progress" }, "assignee", "concierge")).toBeNull();
  });
});

describe("needsOpenChecklistConfirmation (concierge QA A F8 / B S3-3)", () => {
  it("asks only when a task with unticked steps is completed", () => {
    const task = { status: "in_progress" as const, checklist_total: 2, checklist_completed: 1 };
    expect(needsOpenChecklistConfirmation(task, "completed")).toBe(true);
    expect(needsOpenChecklistConfirmation(task, "review")).toBe(false);
    expect(needsOpenChecklistConfirmation({ ...task, checklist_completed: 2 }, "completed")).toBe(false);
    expect(needsOpenChecklistConfirmation({ ...task, checklist_total: 0, checklist_completed: 0 }, "completed")).toBe(false);
  });
});
