import { describe, expect, it } from "vitest";

import type { PatientDetail } from "./list-model";
import { createPatientLeadOrigin, leadConsentWay, leadConsentWayLabel } from "./patient-lead-origin";

// Owner 2026-10-30: the card said «Согласие на обработку запроса (на бумаге)» for a consent staff
// recorded «лично» in the client's form.
describe("leadConsentWay", () => {
  const ru = (text: string) => text;

  it("names how the consent came", () => {
    const origin = createPatientLeadOrigin(patient({
      intake_profile: { consent_privacy_practices_way: { via: "staff", how: "in_person", note: null } },
    }));
    const way = leadConsentWay(origin.value("consent_privacy_practices_way"));
    expect(way).toEqual({ via: "staff", how: "in_person", note: null });
    expect(leadConsentWayLabel(way, ru)).toBe("Записал сотрудник · лично");
    expect(leadConsentWayLabel(leadConsentWay({ via: "cabinet" }), ru)).toBe("в кабинете");
    expect(leadConsentWayLabel(leadConsentWay({ via: "paper" }), ru)).toBe("на бумаге");
    expect(leadConsentWay(null)).toBeNull();
    expect(leadConsentWay({ via: "fax" })).toBeNull();
  });
});

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
  it("shows a consent given in either copy: the profile's paper record or the lead row's cabinet consent", () => {
    // The conversion wrote the wizard toggle (false) into the profile while the
    // lead row carries the cabinet's consent (QA 2026-10-25).
    const origin = createPatientLeadOrigin(patient({
      intake_profile: { consent_privacy_practices: false, consent_healthcare: false },
      lead_snapshot: { consent_privacy_practices: true, consent_healthcare: false, consent_opt_out: false },
    }));
    expect(origin.boolean("consent_privacy_practices")).toBe(true);
    expect(origin.boolean("consent_healthcare")).toBe(false);
    expect(origin.boolean("consent_opt_out")).toBe(false);
    expect(origin.boolean("consent_automated_contact")).toBeNull();
    // The profile alone (the backfilled cabinet consent) is enough.
    expect(createPatientLeadOrigin(patient({ intake_profile: { consent_healthcare: true } })).boolean("consent_healthcare")).toBe(true);
  });

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

  it("names the source lead by person and request date instead of its id (QA B-17)", () => {
    const origin = createPatientLeadOrigin(patient({
      source_lead_id: "c605453f-8212-4af8-98ef-380348b18d21",
      lead_snapshot: { first_name: "Anna", last_name: "Muster", created_at: "2026-10-01T08:00:00Z", submitted_at: null },
    }));
    expect(origin.sourceLeadName).toBe("Anna Muster");
    expect(origin.sourceLeadDate).toBe("2026-10-01T08:00:00Z");
    expect(createPatientLeadOrigin(patient({ source_lead_id: "lead-1" })).sourceLeadName).toBe("");
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

  it("normalizes selected work types stored during lead conversion", () => {
    const origin = createPatientLeadOrigin(patient({
      intake_profile: {
        cost_estimate_additional_language: "ru",
        selected_work_types: [{
          id: "work-type-1",
          code: "CARDIO_CHECK",
          name_de: "Kardiologische Untersuchung",
          name_ru: "Кардиологическое обследование",
          name_en: "Cardiology examination",
          name_es: "Examen cardiologico",
          duration_hours: 3,
          min_price_eur: "100",
          max_price_eur: 1000,
          specialization_ids: ["specialization-1", "", null],
        }],
      },
    }));

    expect(origin.string("cost_estimate_additional_language")).toBe("ru");
    expect(origin.selectedWorkTypes).toEqual([{
      id: "work-type-1",
      code: "CARDIO_CHECK",
      nameDe: "Kardiologische Untersuchung",
      nameRu: "Кардиологическое обследование",
      nameEn: "Cardiology examination",
      nameEs: "Examen cardiologico",
      durationHours: 3,
      minPriceEur: 100,
      maxPriceEur: 1000,
      specializationIds: ["specialization-1"],
    }]);
  });
});
