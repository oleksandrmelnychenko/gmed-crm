import { describe, expect, it } from "vitest";

import { parentCompletionPath } from "./subtask-flow";

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
