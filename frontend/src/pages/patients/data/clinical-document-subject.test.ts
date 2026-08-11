import { describe, expect, it } from "vitest";

import {
  checkClinicalDocumentSubject,
  clinicalDocumentIdentityConfirmationVisible,
  clinicalDocumentIdentityConfirmationForPrepare,
  clinicalDocumentIdentityNeedsExplicitConfirmation,
  clinicalDocumentIdentityPrepareMode,
} from "./clinical-document-subject";

const patient = {
  firstName: "Heorhii",
  lastName: "Hudiiev",
  birthDate: "2005-08-08",
  patientIdentifier: "P-20260808-0034",
};

describe("checkClinicalDocumentSubject", () => {
  it("verifies normalized names and exact strong identifiers", () => {
    expect(
      checkClinicalDocumentSubject(
        {
          first_name: "  HEORHII ",
          last_name: "Hudiiev",
          birth_date: "2005-08-08",
          patient_identifier: "P 20260808 0034",
          patient_identifier_namespace: "gmed_patient_id",
        },
        patient,
      ),
    ).toEqual({ status: "verified", reasons: [] });
  });

  it("hard-blocks birth date or patient identifier mismatches", () => {
    expect(
      checkClinicalDocumentSubject({ birth_date: "2006-08-08" }, patient),
    ).toEqual({ status: "hard_mismatch", reasons: ["birth_date_mismatch"] });
    expect(
      checkClinicalDocumentSubject(
        {
          patient_identifier: "P-OTHER",
          patient_identifier_namespace: "gmed_patient_id",
        },
        patient,
      ),
    ).toEqual({ status: "hard_mismatch", reasons: ["identifier_mismatch"] });
  });

  it("requires confirmation instead of hard-blocking a source-clinic identifier", () => {
    expect(
      checkClinicalDocumentSubject(
        {
          first_name: "Heorhii",
          last_name: "Hudiiev",
          birth_date: "2005-08-08",
          patient_identifier: "CLINIC-4711",
          patient_identifier_namespace: "source_document",
        },
        patient,
      ),
    ).toEqual({
      status: "confirmation_required",
      reasons: ["external_identifier_mismatch"],
    });
    expect(
      checkClinicalDocumentSubject({ patient_identifier: "CLINIC-4711" }, patient),
    ).toEqual({
      status: "confirmation_required",
      reasons: ["external_identifier_mismatch"],
    });
  });

  it("fails closed for an unknown identifier namespace at runtime", () => {
    expect(
      checkClinicalDocumentSubject(
        {
          patient_identifier: "P-OTHER",
          patient_identifier_namespace: "unknown" as never,
        },
        patient,
      ),
    ).toEqual({
      status: "hard_mismatch",
      reasons: ["identifier_namespace_invalid"],
    });
  });

  it("requires explicit confirmation for a name-only mismatch", () => {
    expect(
      checkClinicalDocumentSubject(
        { first_name: "Georg", last_name: "Hudiev" },
        patient,
      ),
    ).toEqual({ status: "confirmation_required", reasons: ["name_mismatch"] });
    expect(
      checkClinicalDocumentSubject({ last_name: "Other" }, patient),
    ).toEqual({ status: "confirmation_required", reasons: ["name_mismatch"] });
  });

  it("normalizes only harmless name casing and whitespace", () => {
    expect(
      checkClinicalDocumentSubject(
        { first_name: "  JÖRG ", last_name: "Groß-Müller" },
        { firstName: "jörg", lastName: "groß-müller" },
      ),
    ).toEqual({ status: "verified", reasons: [] });
  });

  it("does not invent a match when subject evidence is missing", () => {
    expect(checkClinicalDocumentSubject(null, patient)).toEqual({
      status: "unavailable",
      reasons: [],
    });
    expect(checkClinicalDocumentSubject({}, patient)).toEqual({
      status: "unavailable",
      reasons: [],
    });
  });

  it("hard-blocks conflicting identities even if another field matches", () => {
    expect(
      checkClinicalDocumentSubject(
        { conflict: true, birth_date: "2005-08-08" },
        patient,
      ),
    ).toEqual({ status: "hard_mismatch", reasons: ["conflicting_subjects"] });
    expect(
      checkClinicalDocumentSubject({ status: "conflict" }, patient),
    ).toEqual({ status: "hard_mismatch", reasons: ["conflicting_subjects"] });
  });
});

describe("clinical document prepared identity state", () => {
  it("keeps a modern applying decision frozen after the patient profile changes", () => {
    const mode = clinicalDocumentIdentityPrepareMode("applying", 1);

    expect(mode).toBe("frozen_applying");
    expect(clinicalDocumentIdentityConfirmationForPrepare({
      mode,
      preparedIdentityConfirmed: false,
      newlyConfirmed: true,
    })).toBe(false);
    expect(clinicalDocumentIdentityConfirmationVisible(mode, "confirmation_required")).toBe(false);
  });

  it("lets a reviewer explicitly upgrade a legacy applying name mismatch", () => {
    const mode = clinicalDocumentIdentityPrepareMode("applying", 0);

    expect(mode).toBe("legacy_applying");
    expect(clinicalDocumentIdentityConfirmationForPrepare({
      mode,
      preparedIdentityConfirmed: false,
      newlyConfirmed: true,
    })).toBe(true);
    expect(clinicalDocumentIdentityConfirmationVisible(mode, "confirmation_required")).toBe(true);
  });

  it("requires manual original-document verification when OCR identity is unavailable", () => {
    const reviewMode = clinicalDocumentIdentityPrepareMode("review_required", null);
    const legacyMode = clinicalDocumentIdentityPrepareMode("applying", 0);
    const frozenMode = clinicalDocumentIdentityPrepareMode("applying", 1);

    expect(clinicalDocumentIdentityNeedsExplicitConfirmation("unavailable")).toBe(true);
    expect(clinicalDocumentIdentityConfirmationVisible(reviewMode, "unavailable")).toBe(true);
    expect(clinicalDocumentIdentityConfirmationVisible(legacyMode, "unavailable")).toBe(true);
    expect(clinicalDocumentIdentityConfirmationVisible(frozenMode, "unavailable")).toBe(false);
    expect(clinicalDocumentIdentityConfirmationForPrepare({
      mode: legacyMode,
      preparedIdentityConfirmed: false,
      newlyConfirmed: true,
    })).toBe(true);
  });
});
