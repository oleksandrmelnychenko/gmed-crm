import { describe, expect, it } from "vitest";

import {
  canManageStaffAccess,
  canRoleUseMedicalDocuments,
  effectiveProfileAllRule,
  effectiveProfileRule,
  setDirectAllRuleEnabled,
  setDirectRuleEnabled,
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
    const added = setDirectRuleEnabled(
      [globalRule],
      "provider",
      "provider-1",
      "view",
      true,
    );
    expect(added).toHaveLength(2);
    expect(added[1]).toMatchObject({
      resource_id: "provider-1",
      capability: "view",
      effect: "allow",
    });

    expect(
      setDirectRuleEnabled(added, "provider", "provider-1", "view", false),
    ).toEqual([globalRule]);
  });

  it("creates a direct deny when an inherited allow is unchecked", () => {
    const denied = setDirectRuleEnabled([], "patient", "patient-1", "view", false, "allow");
    expect(denied).toMatchObject([{ effect: "deny", resource_id: "patient-1" }]);
    expect(
      setDirectRuleEnabled(denied, "patient", "patient-1", "view", true, "allow"),
    ).toEqual([]);
  });

  it("uses record profile rules before global rules", () => {
    const rule = effectiveProfileRule(
      [
        { resource_type: "document", scope_type: "all", resource_id: null, capability: "view", effect: "deny" },
        { resource_type: "document", scope_type: "record", resource_id: "doc-1", capability: "view", effect: "allow" },
      ],
      "document",
      "doc-1",
      "view",
    );
    expect(rule?.effect).toBe("allow");
  });

  it("adds and removes a global document upload rule without touching record rules", () => {
    const recordRule = {
      resource_type: "document" as const,
      scope_type: "record" as const,
      resource_id: "doc-1",
      capability: "view" as const,
      effect: "allow" as const,
    };
    const added = setDirectAllRuleEnabled(
      [recordRule],
      "document",
      "upload",
      true,
    );

    expect(added).toHaveLength(2);
    expect(added[1]).toMatchObject({
      resource_type: "document",
      scope_type: "all",
      resource_id: null,
      capability: "upload",
      effect: "allow",
    });
    expect(effectiveProfileAllRule(added, "document", "upload")?.effect).toBe("allow");
    expect(setDirectAllRuleEnabled(added, "document", "upload", false)).toEqual([recordRule]);

    const inheritedDeny = setDirectAllRuleEnabled(
      [],
      "document",
      "upload",
      false,
      "allow",
    );
    expect(inheritedDeny).toMatchObject([
      { scope_type: "all", resource_id: null, capability: "upload", effect: "deny" },
    ]);
    expect(
      setDirectAllRuleEnabled(inheritedDeny, "document", "upload", true, "allow"),
    ).toEqual([]);
  });
});
