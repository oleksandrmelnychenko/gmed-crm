import { describe, expect, it } from "vitest";

import {
  ALL_CAPABILITIES,
  ROLE_CAPABILITIES,
  actorRole,
  capabilitiesFor,
  hasAnyCapability,
  hasCapability,
} from "./permissions";
import { readServerSnapshot } from "./rbac-snapshot.test-fixture";

describe("capability mirror", () => {
  it("matches the server snapshot for every staff role", () => {
    const snapshot = readServerSnapshot();
    expect([...snapshot.keys()]).toEqual([
      "ceo",
      "ceo_assistant",
      "patient_manager",
      "teamlead_interpreter",
      "interpreter",
      "concierge",
      "billing",
      "sales",
      "it_admin",
    ]);
    const registryOrder = (capabilities: readonly string[]) =>
      [...capabilities].sort(
        (a, b) =>
          (ALL_CAPABILITIES as readonly string[]).indexOf(a) -
          (ALL_CAPABILITIES as readonly string[]).indexOf(b),
      );
    for (const [role, expected] of snapshot) {
      expect(registryOrder(ROLE_CAPABILITIES[role] ?? []), role).toEqual(expected);
    }
    expect(ROLE_CAPABILITIES.patient).toEqual([]);
  });

  it("lists every capability of the snapshot exactly once", () => {
    const snapshot = readServerSnapshot();
    expect([...ALL_CAPABILITIES]).toEqual(snapshot.get("ceo"));
    expect(new Set(ALL_CAPABILITIES).size).toBe(ALL_CAPABILITIES.length);
  });

  it("prefers the capabilities reported by /me over the role mirror", () => {
    expect(capabilitiesFor("it_admin")).toEqual(ROLE_CAPABILITIES.it_admin);
    expect(capabilitiesFor("it_admin", ["patients.view"])).toEqual(["patients.view"]);
    expect(capabilitiesFor("unknown")).toEqual([]);

    expect(hasCapability({ role: "sales" }, "leads.edit")).toBe(true);
    expect(hasCapability({ role: "sales" }, "patients.view")).toBe(false);
    expect(hasCapability({ role: "sales", capabilities: ["patients.view"] }, "patients.view")).toBe(true);
    expect(hasCapability({ role: "ceo", capabilities: [] }, "patients.view")).toBe(false);
    expect(hasCapability(null, "patients.view")).toBe(false);
    expect(hasAnyCapability({ role: "billing" }, ["datev.admin", "datev.read"])).toBe(true);
    expect(hasAnyCapability({ role: "it_admin" }, ["patients.view", "chat.use"])).toBe(false);
  });

  it("accepts a bare role code and resolves it through the mirror", () => {
    expect(hasCapability("sales", "leads.edit")).toBe(true);
    expect(hasCapability("sales", "patients.view")).toBe(false);
    expect(hasCapability(undefined, "patients.view")).toBe(false);
    expect(hasAnyCapability("concierge", ["hotels.edit", "invoices.finance"])).toBe(true);
    expect(actorRole("billing")).toBe("billing");
    expect(actorRole({ role: "ceo", capabilities: [] })).toBe("ceo");
    expect(actorRole(null)).toBeUndefined();
  });

  it("limits document share trails to CEO, patient manager and interpreter team lead", () => {
    for (const role of Object.keys(ROLE_CAPABILITIES)) {
      expect(hasCapability({ role }, "documents.shares.view"), role).toBe(
        ["ceo", "patient_manager", "teamlead_interpreter"].includes(role),
      );
    }
  });

  it("keeps the cabinet decisions: CEO-only powers and read-only assistant", () => {
    for (const role of Object.keys(ROLE_CAPABILITIES)) {
      expect(hasCapability({ role }, "users.manage_ceo"), role).toBe(role === "ceo");
    }
    expect(hasCapability({ role: "it_admin" }, "users.manage")).toBe(true);
    for (const capability of ROLE_CAPABILITIES.ceo_assistant) {
      expect(/\.(view|use)$/.test(capability), capability).toBe(true);
    }
  });
});
