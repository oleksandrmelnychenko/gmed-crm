import { describe, expect, it } from "vitest";
import { canManageProject, type Project } from "./model";

const project = { created_by: "creator", owner_id: "owner", members: [{ id: "manager", member_role: "manager" }] } as Project;

describe("project management permissions", () => {
  it("concierge retains full project management after transferring ownership", () => {
    expect(canManageProject(project, { id: "creator", role: "concierge" })).toBe(true);
  });
  it("ownership and manager membership do not unlock someone else's project for concierge", () => {
    for (const id of ["owner", "manager", "outsider"]) {
      expect(canManageProject(project, { id, role: "concierge" })).toBe(false);
    }
  });
  it("preserves existing access for CEO and other project owners/managers", () => {
    expect(canManageProject(project, { id: "outsider", role: "ceo" })).toBe(true);
    expect(canManageProject(project, { id: "owner", role: "billing" })).toBe(true);
    expect(canManageProject(project, { id: "manager", role: "billing" })).toBe(true);
    expect(canManageProject(project, { id: "creator", role: "billing" })).toBe(false);
  });
});
