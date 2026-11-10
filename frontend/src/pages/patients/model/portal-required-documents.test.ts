import { describe, expect, it } from "vitest";

import {
  isConsentRuleKey,
  missingDocumentHints,
  portalRequiredDocumentProgress,
} from "./portal-required-documents";

describe("portal missing-document notice", () => {
  it("knows the consents the patient signs instead of uploading", () => {
    for (const key of [
      "consent_form",
      "Einverständniserklärung",
      "dsgvo",
      "privacy_consents",
      "confidentiality_release",
      "schweigepflichtentbindung",
    ]) {
      expect(isConsentRuleKey(key), key).toBe(true);
    }
    for (const key of ["passport", "reisepass", "insurance_card", "medical_report"]) {
      expect(isConsentRuleKey(key), key).toBe(false);
    }
  });

  it("points at the upload form only for what the patient can upload", () => {
    expect(missingDocumentHints(["consent_form"])).toEqual({ upload: false, consent: true });
    expect(missingDocumentHints(["passport"])).toEqual({ upload: true, consent: false });
    expect(missingDocumentHints(["passport", "consent_form"])).toEqual({ upload: true, consent: true });
    expect(missingDocumentHints([])).toEqual({ upload: false, consent: false });
  });

  it("counts only what the patient can provide in the portal (global QA 2026-11-10)", () => {
    // Passport uploaded, consent not signed yet: nothing of the patient's is missing.
    expect(
      portalRequiredDocumentProgress({
        required_documents: [
          { key: "passport", fulfilled: true },
          { key: "consent_form", fulfilled: false },
        ],
        missing_documents: [{ key: "consent_form", label: "Форма согласия" }],
      }),
    ).toEqual({
      ownTotal: 1,
      ownFulfilled: 1,
      ownMissing: [],
      consentsMissing: [{ key: "consent_form", label: "Форма согласия" }],
    });
    // Before the passport upload it is the one missing document.
    expect(
      portalRequiredDocumentProgress({
        required_documents: [
          { key: "passport", fulfilled: false },
          { key: "consent_form", fulfilled: false },
        ],
        missing_documents: [
          { key: "passport", label: "Паспорт" },
          { key: "consent_form", label: "Форма согласия" },
        ],
      }),
    ).toMatchObject({ ownTotal: 1, ownFulfilled: 0, ownMissing: [{ key: "passport" }] });
  });
});
