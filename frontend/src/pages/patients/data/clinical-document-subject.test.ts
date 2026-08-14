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
    ).toEqual({ status: "verified", reasons: [], nameMatch: "exact" });
  });

  it("hard-blocks birth date or patient identifier mismatches", () => {
    expect(
      checkClinicalDocumentSubject({ birth_date: "2006-08-08" }, patient),
    ).toEqual({
      status: "hard_mismatch",
      reasons: ["birth_date_mismatch"],
      nameMatch: "unavailable",
    });
    expect(
      checkClinicalDocumentSubject(
        {
          patient_identifier: "P-OTHER",
          patient_identifier_namespace: "gmed_patient_id",
        },
        patient,
      ),
    ).toEqual({
      status: "hard_mismatch",
      reasons: ["identifier_mismatch"],
      nameMatch: "unavailable",
    });
  });

  it("does not compare a source-clinic identifier with the GMED patient id", () => {
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
    ).toEqual({ status: "verified", reasons: [], nameMatch: "exact" });
    expect(
      checkClinicalDocumentSubject({ patient_identifier: "CLINIC-4711" }, patient),
    ).toEqual({ status: "unavailable", reasons: [], nameMatch: "unavailable" });
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
      nameMatch: "unavailable",
    });
  });

  it("requires explicit confirmation for a name-only mismatch", () => {
    expect(
      checkClinicalDocumentSubject(
        { first_name: "Georg", last_name: "Hudiev" },
        patient,
      ),
    ).toEqual({
      status: "confirmation_required",
      reasons: ["name_mismatch"],
      nameMatch: "mismatch",
    });
    expect(
      checkClinicalDocumentSubject({ last_name: "Other" }, patient),
    ).toEqual({
      status: "confirmation_required",
      reasons: ["name_mismatch"],
      nameMatch: "mismatch",
    });
  });

  it("normalizes only harmless name casing and whitespace", () => {
    expect(
      checkClinicalDocumentSubject(
        { first_name: "  JÖRG ", last_name: "Groß-Müller" },
        { firstName: "jörg", lastName: "groß müller" },
      ),
    ).toEqual({ status: "verified", reasons: [], nameMatch: "exact" });
  });

  it("recognizes German umlaut, Eszett, title, punctuation, and MRZ variants", () => {
    for (const [subject, card] of [
      [
        { first_name: "Joerg", last_name: "Mueller" },
        { firstName: "Jörg", lastName: "Müller" },
      ],
      [
        { first_name: "Prof. Dr. Karl-Heinz", last_name: "Gross" },
        { firstName: "Karl Heinz", lastName: "Groß" },
      ],
      [
        { first_name: "Anna", last_name: "Goethe" },
        { firstName: "Anna", lastName: "Göthe" },
      ],
    ] as const) {
      expect(checkClinicalDocumentSubject(subject, card)).toEqual({
        status: "verified_variant",
        reasons: [],
        nameMatch: "german_variant",
      });
    }
  });

  it("accepts an OCR-reversed first and last name only as a visible variant", () => {
    expect(
      checkClinicalDocumentSubject(
        { first_name: "Müller", last_name: "Anna" },
        { firstName: "Anna", lastName: "Mueller" },
      ),
    ).toEqual({
      status: "verified_variant",
      reasons: [],
      nameMatch: "german_variant",
    });
  });

  it("does not silently equate missing umlauts or cross-language transliterations", () => {
    expect(
      checkClinicalDocumentSubject(
        { first_name: "Jorg", last_name: "Muller" },
        { firstName: "Jörg", lastName: "Müller" },
      ),
    ).toEqual({
      status: "confirmation_required",
      reasons: ["name_mismatch"],
      nameMatch: "mismatch",
    });
    expect(
      checkClinicalDocumentSubject(
        { first_name: "Oleksandr", last_name: "Schmidt" },
        { firstName: "Alexander", lastName: "Schmidt" },
      ),
    ).toEqual({
      status: "confirmation_required",
      reasons: ["name_mismatch"],
      nameMatch: "mismatch",
    });
  });

  it("distinguishes an unusable placeholder profile from missing OCR evidence", () => {
    const placeholderPatient = {
      firstName: "789578",
      lastName: "789578",
      birthDate: "2005-07-04",
      patientIdentifier: "P-20260704-0020",
    };
    expect(checkClinicalDocumentSubject(null, placeholderPatient)).toEqual({
      status: "profile_incomplete",
      reasons: ["patient_profile_incomplete"],
      nameMatch: "unavailable",
    });
    expect(
      checkClinicalDocumentSubject(
        { first_name: "Anna", last_name: "Müller", birth_date: "2005-07-04" },
        placeholderPatient,
      ),
    ).toEqual({
      status: "profile_incomplete",
      reasons: ["patient_profile_incomplete"],
      nameMatch: "mismatch",
    });
  });

  it("does not invent a match when subject evidence is missing", () => {
    expect(checkClinicalDocumentSubject(null, patient)).toEqual({
      status: "unavailable",
      reasons: [],
      nameMatch: "unavailable",
    });
    expect(checkClinicalDocumentSubject({}, patient)).toEqual({
      status: "unavailable",
      reasons: [],
      nameMatch: "unavailable",
    });
  });

  it("hard-blocks conflicting identities even if another field matches", () => {
    expect(
      checkClinicalDocumentSubject(
        { conflict: true, birth_date: "2005-08-08" },
        patient,
      ),
    ).toEqual({
      status: "hard_mismatch",
      reasons: ["conflicting_subjects"],
      nameMatch: "unavailable",
    });
    expect(
      checkClinicalDocumentSubject({ status: "conflict" }, patient),
    ).toEqual({
      status: "hard_mismatch",
      reasons: ["conflicting_subjects"],
      nameMatch: "unavailable",
    });
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

  it("requires manual verification when OCR or the patient profile is incomplete", () => {
    const reviewMode = clinicalDocumentIdentityPrepareMode("review_required", null);
    const legacyMode = clinicalDocumentIdentityPrepareMode("applying", 0);
    const frozenMode = clinicalDocumentIdentityPrepareMode("applying", 1);

    expect(clinicalDocumentIdentityNeedsExplicitConfirmation("unavailable")).toBe(true);
    expect(clinicalDocumentIdentityNeedsExplicitConfirmation("profile_incomplete")).toBe(true);
    expect(clinicalDocumentIdentityConfirmationVisible(reviewMode, "unavailable")).toBe(true);
    expect(clinicalDocumentIdentityConfirmationVisible(reviewMode, "profile_incomplete")).toBe(true);
    expect(clinicalDocumentIdentityConfirmationVisible(legacyMode, "unavailable")).toBe(true);
    expect(clinicalDocumentIdentityConfirmationVisible(frozenMode, "unavailable")).toBe(false);
    expect(clinicalDocumentIdentityConfirmationForPrepare({
      mode: legacyMode,
      preparedIdentityConfirmed: false,
      newlyConfirmed: true,
    })).toBe(true);
  });
});
