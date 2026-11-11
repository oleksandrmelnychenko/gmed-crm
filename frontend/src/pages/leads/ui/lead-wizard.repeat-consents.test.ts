import { describe, expect, it } from "vitest";

import type { PatientDetail } from "@/pages/patients/model/list-model";

import { draftFromExistingPatient } from "./lead-wizard";

describe("repeat intake prefill (QA 2026-11-11 L3)", () => {
  it("never pre-ticks a consent, also when the card records a signed DSGVO consent", () => {
    const patient = {
      id: "p-1",
      first_name: "Carla",
      last_name: "Testfall",
      legal_status: { dsgvo_signed: true },
    } as unknown as PatientDetail;

    const draft = draftFromExistingPatient(patient);

    expect(draft.firstName).toBe("Carla");
    expect(draft.privacyConsent).toBe(false);
    expect(draft.healthcareConsent).toBe(false);
  });
});
