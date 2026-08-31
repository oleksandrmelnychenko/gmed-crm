import { describe, expect, it } from "vitest";

import {
  canManageStaffAccess,
  canRoleUseMedicalDocuments,
  toggleDirectAllowRule,
} from "./staff-access-model";

describe("staff access model", () => {
  it("allows only the CEO to manage employee access", () => {
    expect(canManageStaffAccess("ceo")).toBe(true);
    expect(canManageStaffAccess("concierge")).toBe(false);
    expect(canManageStaffAccess(null)).toBe(false);
  });

  it("keeps medical documents unavailable for non-medical roles", () => {
    expect(canRoleUseMedicalDocuments("patient_manager")).toBe(true);
    expect(canRoleUseMedicalDocuments("interpreter")).toBe(true);
    expect(canRoleUseMedicalDocuments("concierge")).toBe(false);
    expect(canRoleUseMedicalDocuments("billing")).toBe(false);
  });

  it("adds and removes one exact direct allow rule without touching global rules", () => {
    const globalRule = {
      resource_type: "provider" as const,
      scope_type: "all" as const,
      resource_id: null,
      capability: "view" as const,
      effect: "deny" as const,
    };
    const added = toggleDirectAllowRule(
      [globalRule],
      "provider",
      "provider-1",
      "view",
    );
    expect(added).toHaveLength(2);
    expect(added[1]).toMatchObject({
      resource_id: "provider-1",
      capability: "view",
      effect: "allow",
    });

    expect(toggleDirectAllowRule(added, "provider", "provider-1", "view")).toEqual([
      globalRule,
    ]);
  });
});
