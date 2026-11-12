import { describe, expect, it } from "vitest";
import { canAddProjectTask, canCreateProject, canManageProject, filterProjectMemberOptions, type Project } from "./model";

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
  it("a concierge team member reads the project but adds tasks only to its own (owner decision 2026-11-12)", () => {
    expect(canAddProjectTask(project, { id: "creator", role: "concierge" })).toBe(true);
    for (const id of ["owner", "manager", "outsider"]) {
      expect(canAddProjectTask(project, { id, role: "concierge" })).toBe(false);
    }
    expect(canAddProjectTask(project, { id: "manager", role: "billing" })).toBe(true);
  });
  it("preserves existing access for CEO and other project owners/managers", () => {
    expect(canManageProject(project, { id: "outsider", role: "ceo" })).toBe(true);
    expect(canManageProject(project, { id: "owner", role: "billing" })).toBe(true);
    expect(canManageProject(project, { id: "manager", role: "billing" })).toBe(true);
    expect(canManageProject(project, { id: "creator", role: "billing" })).toBe(false);
  });
  it("the CEO assistant reads projects and changes none (owner decision 2026-09-20)", () => {
    for (const id of ["creator", "owner", "manager", "outsider"]) {
      expect(canManageProject(project, { id, role: "ceo_assistant" })).toBe(false);
    }
    expect(canCreateProject("ceo_assistant")).toBe(false);
    expect(canCreateProject("patient_manager")).toBe(true);
  });
});

describe("project team picker search", () => {
  const people = [
    { id: "a", name: "Anna Berg", email: "anna@example.test" },
    { id: "b", name: "Boris Koch", email: "boris@example.test" },
    { id: "c", name: "", email: "nameless@example.test" },
  ];
  it("matches name or e-mail and keeps the chosen people visible", () => {
    expect(filterProjectMemberOptions(people, "", []).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(filterProjectMemberOptions(people, "koch", []).map((p) => p.id)).toEqual(["b"]);
    expect(filterProjectMemberOptions(people, "nameless", []).map((p) => p.id)).toEqual(["c"]);
    expect(filterProjectMemberOptions(people, "koch", ["a"]).map((p) => p.id)).toEqual(["a", "b"]);
  });
});
