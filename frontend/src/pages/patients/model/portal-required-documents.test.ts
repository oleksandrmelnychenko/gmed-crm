import { describe, expect, it } from "vitest";

import { isConsentRuleKey, missingDocumentHints } from "./portal-required-documents";

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
});
