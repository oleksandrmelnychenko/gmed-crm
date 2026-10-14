import { afterEach, describe, expect, it } from "vitest";
import { getPortalPatientId, reconcilePortalPatientSelection, selectPortalPatient } from "./portal-patient-context";

const first = { id: "first", name: "Mia Muster", patient_number: "P-1" };
const second = { id: "second", name: "Ben Muster", patient_number: "P-2" };
const user = { id: "guardian", role: "patient", patients: [first, second] };
afterEach(() => selectPortalPatient("", null));

describe("family portal context", () => {
  it("defaults to the parent's unique own record while preserving an explicit child selection", () => {
    const family = { ...user, patients: [
      { ...first, access_kind: "guardian" as const },
      { ...second, access_kind: "self" as const },
    ] };
    reconcilePortalPatientSelection(family);
    expect(getPortalPatientId(user.id)).toBe(second.id);
    selectPortalPatient(user.id, first.id);
    reconcilePortalPatientSelection(family);
    expect(getPortalPatientId(user.id)).toBe(first.id);
  });

  it("never guesses between multiple own records", () => {
    reconcilePortalPatientSelection({ ...user, patients: [
      { ...first, access_kind: "self" }, { ...second, access_kind: "self" },
    ] });
    expect(getPortalPatientId(user.id)).toBeNull();
  });
  it("requires an explicit selection for two patients and remembers a valid selection", () => {
    reconcilePortalPatientSelection(user);
    expect(getPortalPatientId(user.id)).toBeNull();
    selectPortalPatient(user.id, second.id);
    reconcilePortalPatientSelection(user);
    expect(getPortalPatientId(user.id)).toBe(second.id);
    expect(getPortalPatientId("another-user")).toBeNull();
  });

  it("drops revoked access and automatically selects the remaining single patient", () => {
    selectPortalPatient(user.id, first.id);
    reconcilePortalPatientSelection({ ...user, patients: [second] });
    expect(getPortalPatientId(user.id)).toBe(second.id);
    reconcilePortalPatientSelection({ ...user, patients: [] });
    expect(getPortalPatientId(user.id)).toBeNull();
  });

  it("clears the context when the signed-in account changes", () => {
    selectPortalPatient(user.id, first.id);
    reconcilePortalPatientSelection({ id: "staff", role: "billing" });
    expect(getPortalPatientId(user.id)).toBeNull();
  });
});
