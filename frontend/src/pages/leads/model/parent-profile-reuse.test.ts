import { describe, expect, it } from "vitest";
import { existingParentPatientFromError, fillMissingParentProfile } from "./parent-profile-reuse";

const blank = { birthDate: "", phone: "", street: "", zip: "", city: "", country: "", citizenships: [] as string[], healthcareConsent: false, concern: "" };
const profile = { date_of_birth: "1985-02-03", phone: "+49123456789", street_address: "Parent Street 2", zip_code: "10115", city: "Berlin", country: "DE", citizenships: ["DE"], consent_healthcare: true, primary_concern_text: "A child's condition" };

describe("reusing parent basic profile during wizard bootstrap", () => {
  it("fills missing basics without importing medical data or consent", () => {
    const result = fillMissingParentProfile(blank, profile);
    expect(result).toMatchObject({ birthDate: "1985-02-03", street: "Parent Street 2", city: "Berlin", country: "DE", citizenships: ["DE"] });
    expect(result.healthcareConsent).toBe(false);
    expect(result.concern).toBe("");
  });
  it("keeps explicit values and typing that happened while account creation was pending", () => {
    const typed = { ...blank, phone: "+33123456789", city: "Paris", country: "FR", citizenships: ["UA"] };
    expect(fillMissingParentProfile(typed, profile)).toMatchObject({ city: "Paris", country: "FR", phone: "+33123456789", citizenships: ["UA"] });
    expect(typed.street).toBe("");
  });
});

describe("existing parent patient creation guidance", () => {
  it("exposes only the record id explicitly authorized by the server", () => {
    expect(existingParentPatientFromError({ body: { code: "existing_parent_patient_use_repeat_intake", patient_id: "parent-patient" } })).toEqual({ patientId: "parent-patient" });
    expect(existingParentPatientFromError({ body: { code: "existing_parent_patient_use_repeat_intake", patient_id: null } })).toEqual({ patientId: null });
  });
  it("reads the id of a source person's own patient record", () => {
    expect(existingParentPatientFromError({ body: { code: "existing_parent_patient_use_repeat_intake", existing_patient_id: "own-record" } })).toEqual({ patientId: "own-record" });
  });
  it("does not treat unrelated creation failures as an existing parent record", () => {
    expect(existingParentPatientFromError(new Error("Phone already used"))).toBeNull();
    expect(existingParentPatientFromError({ body: { code: "portal_email_taken", patient_id: "other-patient" } })).toBeNull();
  });
});
