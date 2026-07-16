import { describe, expect, it } from "vitest";

import type { PatientDetail } from "./list-model";
import { createPatientLeadOrigin } from "./patient-lead-origin";

function patient(overrides: Partial<PatientDetail> = {}): PatientDetail {
  return {
    id: "patient-1",
    patient_id: "P-1",
    gender: "female",
    is_active: true,
    created_at: "2026-07-16T10:00:00Z",
    ...overrides,
  };
}

describe("createPatientLeadOrigin", () => {
  it("uses the immutable snapshot as a fallback for legacy converted patients", () => {
    const origin = createPatientLeadOrigin(patient({
      source_lead_id: "lead-1",
      intake_profile: { source: "website_questionnaire" },
      lead_snapshot: {
        primary_concern_text: "Knee pain",
        whatsapp_consent: false,
        requested_specialties: ["orthopedics"],
        trusted_contacts: [{ name: "Olena" }, { name: "Marta" }],
      },
    }));

    expect(origin.sourceLeadId).toBe("lead-1");
    expect(origin.string("source")).toBe("website_questionnaire");
    expect(origin.string("primary_concern_text")).toBe("Knee pain");
    expect(origin.boolean("whatsapp_consent")).toBe(false);
    expect(origin.strings("requested_specialties")).toEqual(["orthopedics"]);
    expect(origin.records("trusted_contacts").map((contact) => contact["name"])).toEqual([
      "Olena",
      "Marta",
    ]);
  });

  it("prefers normalized profile fields and keeps comments for every requested service", () => {
    const origin = createPatientLeadOrigin(patient({
      intake_profile: {
        services: ["concierge_support", "interpreter_support"],
        service_comments: {
          concierge_support: "Hotel and restaurant bookings",
          interpreter_support: "Ukrainian interpreter",
        },
      },
      lead_snapshot: {
        services: ["medical_treatment"],
      },
    }));

    expect(origin.serviceRequests).toEqual([
      { value: "concierge_support", comment: "Hotel and restaurant bookings" },
      { value: "interpreter_support", comment: "Ukrainian interpreter" },
    ]);
  });

  it("reads legacy service comments from wizard_state", () => {
    const origin = createPatientLeadOrigin(patient({
      lead_snapshot: {
        id: "lead-legacy",
        services: ["driver"],
        wizard_state: {
          service_comments: { driver: "Airport pickup" },
        },
      },
    }));

    expect(origin.sourceLeadId).toBe("lead-legacy");
    expect(origin.serviceRequests).toEqual([
      { value: "driver", comment: "Airport pickup" },
    ]);
    expect(origin.hasData).toBe(true);
  });
});
