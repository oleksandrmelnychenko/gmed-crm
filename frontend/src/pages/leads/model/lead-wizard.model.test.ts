import { describe, expect, it } from "vitest";

import type { LeadDetail } from "@/lib/api/types";

import {
  blankClinicalIntake,
  blankGuardian,
  blankOrderLine,
  canConvert,
  canFinishOrder,
  clinicalIntakeHasAllergy,
  clinicalIntakeHasCave,
  clinicalIntakeHasMedication,
  clinicalIntakeHasNarrative,
  clinicalMedicationFingerprint,
  clinicalMedicationPayload,
  clinicalNarrativePayload,
  clinicalWarningFingerprint,
  clinicalWarningPayload,
  completedSteps,
  costEstimate,
  guardianIsComplete,
  guardianPayload,
  draftFromLead,
  isMinor,
  nextStep,
  orderLineClientReference,
  orderResumeFromLead,
  orderResumeWizardState,
  orderLineFingerprint,
  orderLineIsValid,
  orderLinesAreReady,
  orderLinePayload,
  orderNeedsDescription,
  prevStep,
  resumeStep,
  stepIsComplete,
  wizardUpdatePayload,
  type GuardianDraft,
  type WizardDraft,
  type WizardOrderLine,
} from "./lead-wizard.model";

function lead(overrides: Partial<LeadDetail> = {}): LeadDetail {
  return {
    id: "l1",
    first_name: "Anna",
    last_name: "Muster",
    date_of_birth: "1990-05-01",
    legal_sex: "female",
    email: "anna@example.com",
    phone: "",
    street_address: "Hauptstr. 1",
    city: "Berlin",
    zip_code: "10115",
    primary_language: "de",
    needs_interpreter: false,
    primary_concern_text: "Knee pain",
    additional_concerns: "",
    selected_program: "",
    services: ["surgery"],
    requested_specialties: ["orthopedics"],
    wizard_state: { step: "eligibility" },
    ...overrides,
  } as unknown as LeadDetail;
}

function emptyDraft(): WizardDraft {
  return {
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    legalSex: "",
    email: "",
    phone: "",
    streetAddress: "",
    city: "",
    zipCode: "",
    primaryLanguage: "",
    needsInterpreter: false,
    primaryConcernText: "",
    additionalConcerns: "",
    selectedProgram: "",
    services: [],
    requestedSpecialties: [],
  };
}

describe("draftFromLead", () => {
  it("maps snake_case lead fields to the camelCase draft", () => {
    const draft = draftFromLead(lead());
    expect(draft.firstName).toBe("Anna");
    expect(draft.dateOfBirth).toBe("1990-05-01");
    expect(draft.legalSex).toBe("female");
    expect(draft.services).toEqual(["surgery"]);
    expect(draft.requestedSpecialties).toEqual(["orthopedics"]);
  });

  it("defaults nullable fields", () => {
    const draft = draftFromLead(
      lead({ date_of_birth: null, legal_sex: null, needs_interpreter: null, requested_specialties: [] }),
    );
    expect(draft.dateOfBirth).toBe("");
    expect(draft.legalSex).toBe("");
    expect(draft.needsInterpreter).toBe(false);
    expect(draft.requestedSpecialties).toEqual([]);
  });
});

describe("isMinor", () => {
  const today = new Date("2026-07-08");
  it("flags an under-18 date of birth", () => {
    expect(isMinor("2010-01-01", today)).toBe(true);
  });
  it("does not flag an adult", () => {
    expect(isMinor("1990-05-01", today)).toBe(false);
  });
  it("treats the 18th birthday as an adult", () => {
    expect(isMinor("2008-07-08", today)).toBe(false);
    expect(isMinor("2008-07-09", today)).toBe(true);
  });
  it("returns false for empty or invalid input", () => {
    expect(isMinor("", today)).toBe(false);
    expect(isMinor("not-a-date", today)).toBe(false);
  });
});

describe("stepIsComplete", () => {
  it("identity needs name, dob, legal sex and a contact", () => {
    const draft = draftFromLead(lead());
    expect(stepIsComplete("identity", draft)).toBe(true);
    expect(stepIsComplete("identity", { ...draft, email: "", phone: "" })).toBe(false);
    expect(stepIsComplete("identity", { ...draft, legalSex: "" })).toBe(false);
  });
  it("eligibility needs a primary concern", () => {
    expect(stepIsComplete("eligibility", { ...emptyDraft(), primaryConcernText: "x" })).toBe(true);
    expect(stepIsComplete("eligibility", emptyDraft())).toBe(false);
  });
  it("specialties needs at least one requested specialty", () => {
    expect(stepIsComplete("specialties", { ...emptyDraft(), requestedSpecialties: ["ortho"] })).toBe(true);
    expect(stepIsComplete("specialties", emptyDraft())).toBe(false);
  });
});

describe("canConvert", () => {
  it("requires every Phase-A step, but not patient compliance", () => {
    const complete = draftFromLead(lead());
    expect(canConvert(complete)).toBe(true);
    expect(canConvert({ ...complete, firstName: "" })).toBe(false);
    expect(canConvert({ ...complete, dateOfBirth: "" })).toBe(false);
    expect(canConvert({ ...complete, email: "", phone: "" })).toBe(false);
    expect(canConvert({ ...complete, legalSex: "" })).toBe(false);
    expect(canConvert({ ...complete, primaryConcernText: "" })).toBe(false);
    expect(canConvert({ ...complete, requestedSpecialties: [] })).toBe(false);
  });
});

describe("wizardUpdatePayload", () => {
  it("always includes requested_specialties and the wizard_state resume marker", () => {
    const payload = wizardUpdatePayload(draftFromLead(lead()), "eligibility");
    expect(payload.requested_specialties).toEqual(["orthopedics"]);
    expect(payload.wizard_state).toEqual({ step: "eligibility", completed: completedSteps(draftFromLead(lead())) });
  });
  it("omits empty legal sex and name so the backend does not reject them", () => {
    const payload = wizardUpdatePayload(emptyDraft(), "identity");
    expect(payload).not.toHaveProperty("legal_sex");
    expect(payload).not.toHaveProperty("first_name");
    expect(payload).not.toHaveProperty("date_of_birth");
    // free-text/array fields are still present so clearing works
    expect(payload).toHaveProperty("primary_concern_text", "");
    expect(payload).toHaveProperty("services");
  });
});

describe("orderNeedsDescription", () => {
  it("folds the concern and requested specialists into the order need", () => {
    const draft = draftFromLead(
      lead({
        primary_concern_text: "Knee pain",
        additional_concerns: "Also back",
        requested_specialties: ["orthopedics", "surgery"],
      }),
    );
    const text = orderNeedsDescription(draft);
    expect(text).toContain("Knee pain");
    expect(text).toContain("Also back");
    expect(text).toContain("Fachrichtungen: orthopedics, surgery");
  });
  it("is empty when nothing was captured", () => {
    expect(orderNeedsDescription(emptyDraft())).toBe("");
  });
});

describe("navigation + resume", () => {
  it("steps forward and back within Phase A", () => {
    expect(nextStep("identity")).toBe("eligibility");
    expect(nextStep("specialties")).toBeNull();
    expect(prevStep("identity")).toBeNull();
    expect(prevStep("specialties")).toBe("eligibility");
  });
  it("resumes from wizard_state.step, defaulting to identity", () => {
    expect(resumeStep(lead())).toBe("eligibility");
    expect(resumeStep(lead({ wizard_state: null }))).toBe("identity");
    expect(resumeStep(lead({ wizard_state: { step: "bogus" } }))).toBe("identity");
  });

  it("resumes Phase B order state from wizard_state", () => {
    const detail = lead({
      converted_patient_id: "patient-1",
      wizard_state: {
        step: "specialties",
        phase: "order",
        patient_id: "patient-1",
        patient_pid: "P-1",
        order_id: "order-1",
        saved_order_line_keys: ["line-1"],
        order_lines: [
          {
            clientKey: "line-1",
            description: "MRT",
            quantity: "1",
            unitPrice: "100",
            vatRate: "19",
          },
        ],
        guardian: { name: "Parent", phone: "123" },
        clinical_intake: { currentComplaint: "Knee pain" },
        start_contract: true,
        contract_id: "contract-1",
        contract_started: true,
      },
    });

    expect(orderResumeFromLead(detail)).toEqual({
      orderId: "order-1",
      patientId: "patient-1",
      patientPid: "P-1",
      savedOrderLineKeys: ["line-1"],
      orderLines: [
        {
          clientKey: "line-1",
          description: "MRT",
          quantity: "1",
          unitPrice: "100",
          vatRate: "19",
        },
      ],
      guardian: { name: "Parent", phone: "123" },
      clinicalIntake: expect.objectContaining({ currentComplaint: "Knee pain" }),
      startContract: true,
      contractId: "contract-1",
    });
  });

  it("rejects stale Phase B resume state for a different converted patient", () => {
    expect(
      orderResumeFromLead(
        lead({
          converted_patient_id: "patient-1",
          wizard_state: {
            phase: "order",
            patient_id: "patient-2",
            order_id: "order-1",
          },
        }),
      ),
    ).toBeNull();
  });

  it("does not resume already completed Phase B state", () => {
    expect(
      orderResumeFromLead(
        lead({
          converted_patient_id: "patient-1",
          wizard_state: {
            phase: "completed",
            patient_id: "patient-1",
            order_id: "order-1",
          },
        }),
      ),
    ).toBeNull();
  });

  it("builds the persisted Phase B resume marker", () => {
    const draft = draftFromLead(lead());
    const orderLines = [blankOrderLine("line-1")];
    expect(
      orderResumeWizardState(draft, "specialties", {
        patientId: "patient-1",
        patientPid: "P-1",
        orderId: "order-1",
        savedOrderLineKeys: ["line-1"],
        orderLines,
        guardian: { name: "Parent", phone: "123" },
        clinicalIntake: blankClinicalIntake(draft),
        startContract: true,
        contractId: "contract-1",
      }),
    ).toMatchObject({
      step: "specialties",
      completed: completedSteps(draft),
      phase: "order",
      patient_id: "patient-1",
      patient_pid: "P-1",
      order_id: "order-1",
      saved_order_line_keys: ["line-1"],
      order_lines: orderLines,
      guardian: { name: "Parent", phone: "123" },
      start_contract: true,
      contract_id: "contract-1",
      contract_started: true,
    });
  });
});

describe("Phase B order lines (#8)", () => {
  function line(overrides: Partial<WizardOrderLine> = {}): WizardOrderLine {
    return { ...blankOrderLine(), ...overrides };
  }

  it("blank line defaults to quantity 1 / vat 19", () => {
    expect(blankOrderLine("line-1")).toEqual({
      clientKey: "line-1",
      description: "",
      quantity: "1",
      unitPrice: "0",
      vatRate: "19",
    });
  });

  it("a line is billable only with a description and numeric qty + price", () => {
    expect(orderLineIsValid(line({ description: "MRT", unitPrice: "200" }))).toBe(true);
    expect(orderLineIsValid(line({ description: "", unitPrice: "200" }))).toBe(false);
    expect(orderLineIsValid(line({ description: "MRT", quantity: "abc" }))).toBe(false);
    expect(orderLineIsValid(line({ description: "MRT", quantity: "0" }))).toBe(false);
    expect(orderLineIsValid(line({ description: "MRT", quantity: "-1" }))).toBe(false);
    expect(orderLineIsValid(line({ description: "MRT", unitPrice: "-10" }))).toBe(false);
    expect(orderLineIsValid(line({ description: "MRT", vatRate: "-1" }))).toBe(false);
    expect(orderLineIsValid(line({ description: "MRT", vatRate: "101" }))).toBe(false);
  });

  it("allows untouched extra rows but blocks partially invalid rows", () => {
    const valid = line({ description: "MRT", unitPrice: "200" });
    expect(orderLinesAreReady([valid, blankOrderLine("unused")])).toBe(true);
    expect(orderLinesAreReady([valid, line({ description: "Consultation", quantity: "" })])).toBe(
      false,
    );
    expect(orderLinesAreReady([blankOrderLine("unused")])).toBe(false);
  });

  it("cost estimate sums net/vat/gross over valid lines only", () => {
    const estimate = costEstimate([
      line({ description: "MRT", quantity: "2", unitPrice: "100", vatRate: "19" }),
      line({ description: "Beratung", quantity: "1", unitPrice: "50", vatRate: "7" }),
      line({ description: "", quantity: "5", unitPrice: "999", vatRate: "19" }), // invalid -> ignored
    ]);
    // net = 2*100 + 1*50 = 250; vat = 38 + 3.5 = 41.5; gross = 291.5
    expect(estimate.net).toBe(250);
    expect(estimate.vat).toBe(41.5);
    expect(estimate.gross).toBe(291.5);
  });

  it("accepts comma decimals and rounds money to cents", () => {
    const estimate = costEstimate([
      line({ description: "X", quantity: "3", unitPrice: "10,10", vatRate: "19" }),
    ]);
    // net = 30.3; vat = 5.757 -> 5.76; gross = 36.06
    expect(estimate.net).toBe(30.3);
    expect(estimate.vat).toBe(5.76);
    expect(estimate.gross).toBe(36.06);
  });

  it("builds the leistung payload with numeric fields", () => {
    const value = line({
      clientKey: "line-1",
      description: " MRT ",
      quantity: "2",
      unitPrice: "100",
      vatRate: "19",
    });
    expect(orderLinePayload(value, "patient-1", orderLineClientReference("lead-1", value))).toEqual({
      patient_id: "patient-1",
      description: "MRT",
      quantity: 2,
      unit_price: 100,
      vat_rate: 19,
      client_reference: "lead-wizard:lead-1:line-1",
    });
  });

  it("fingerprints a line by normalized billable values for retry skips", () => {
    expect(
      orderLineFingerprint(line({ description: " MRT ", quantity: "2", unitPrice: "100,00", vatRate: "19" })),
    ).toBe(orderLineFingerprint(line({ description: "mrt", quantity: "2", unitPrice: "100", vatRate: "19" })));
  });
});

describe("Phase B guardian branch (#2/#11)", () => {
  function g(overrides: Partial<GuardianDraft> = {}): GuardianDraft {
    return { ...blankGuardian(), ...overrides };
  }

  it("a guardian is complete once a name is given", () => {
    expect(guardianIsComplete(g({ name: "Herr Muster" }))).toBe(true);
    expect(guardianIsComplete(g())).toBe(false);
    expect(guardianIsComplete(g({ name: "   " }))).toBe(false);
  });

  it("an adult can always finish; a minor needs a named guardian", () => {
    expect(canFinishOrder(false, g())).toBe(true);
    expect(canFinishOrder(true, g())).toBe(false);
    expect(canFinishOrder(true, g({ name: "Herr Muster" }))).toBe(true);
  });

  it("builds a guardian relation payload", () => {
    expect(guardianPayload(g({ name: " Herr Muster ", phone: " 030-1 " }))).toEqual({
      related_name: "Herr Muster",
      relation_type: "guardian",
      phone: "030-1",
      is_emergency_contact: true,
    });
    expect(guardianPayload(g({ name: "X" })).phone).toBeNull();
  });
});

describe("Phase B clinical intake (#8)", () => {
  it("starts narrative fields from the lead concern text", () => {
    const intake = blankClinicalIntake(
      draftFromLead(
        lead({
          primary_concern_text: "Knee pain",
          additional_concerns: "Previous ACL repair",
        }),
      ),
    );

    expect(intake.currentComplaint).toBe("Knee pain");
    expect(intake.anamneseHistory).toBe("Previous ACL repair");
    expect(clinicalIntakeHasNarrative(intake)).toBe(true);
  });

  it("builds a narrative payload while preserving untouched existing fields", () => {
    const payload = clinicalNarrativePayload(
      {
        ...blankClinicalIntake(),
        currentComplaint: " Acute pain ",
      },
      {
        id: "narrative-1",
        anamnese_vorgeschichte: "Old history",
        beurteilung: "Existing assessment",
      },
    );

    expect(payload).toMatchObject({
      id: "narrative-1",
      anamnese_aktuelle: "Acute pain",
      anamnese_vorgeschichte: "Old history",
      beurteilung: "Existing assessment",
      is_active: true,
    });
  });

  it("builds a valid compact medication payload and retry fingerprint", () => {
    const intake = {
      ...blankClinicalIntake(),
      medicationName: " Ibuprofen ",
      medicationStrength: "400 mg",
      medicationDose: "1-0-1",
      medicationReason: "Pain",
      medicationNotes: "After meals",
    };
    const payload = clinicalMedicationPayload(intake);

    expect(clinicalIntakeHasMedication(intake)).toBe(true);
    expect(payload).toMatchObject({
      handelsname: "Ibuprofen",
      staerke: "400 mg",
      form: "TABL",
      einnahmeform: "Oral",
      dose_morgens: "1-0-1",
      grund: "Pain",
      hinweis: "After meals",
      status: "aktiv",
    });
    expect(
      clinicalMedicationFingerprint({
        handelsname: " ibuprofen ",
        staerke: "400 mg",
        form: "TABL",
        einnahmeform: "Oral",
        dose_morgens: "1-0-1",
        grund: "pain",
        hinweis: "after meals",
      }),
    ).toBe(clinicalMedicationFingerprint(payload ?? {}));
  });

  it("builds allergy and CAVE warning payloads with duplicate fingerprints", () => {
    const intake = {
      ...blankClinicalIntake(),
      allergyLabel: "Penicillin",
      allergyReaction: "Rash",
      allergySeverity: "mittel",
      caveLabel: "Anticoagulation",
      caveNotes: "Check before procedure",
    };
    const allergy = clinicalWarningPayload(intake, "allergie");
    const cave = clinicalWarningPayload(intake, "cave");

    expect(clinicalIntakeHasAllergy(intake)).toBe(true);
    expect(clinicalIntakeHasCave(intake)).toBe(true);
    expect(allergy).toMatchObject({
      kind: "allergie",
      label: "Penicillin",
      reaction: "Rash",
      severity: "mittel",
    });
    expect(cave).toMatchObject({
      kind: "cave",
      label: "Anticoagulation",
      reaction: null,
      note: "Check before procedure",
    });
    expect(clinicalWarningFingerprint(allergy ?? {})).toBe(
      clinicalWarningFingerprint({
        kind: "allergie",
        label: " penicillin ",
        reaction: "rash",
        severity: "mittel",
        note: null,
      }),
    );
  });
});
