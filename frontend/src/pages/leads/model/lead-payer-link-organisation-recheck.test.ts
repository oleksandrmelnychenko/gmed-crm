import { describe, expect, it } from "vitest";

import { normalizeStaffPayerQuestionnaire } from "../data/lead-payer-link-api";
import { payerQuestionnaireGroups } from "./lead-payer-link";

describe("payer organisation questionnaire reaches the wizard", () => {
  it("preserves and displays the payer's legal form, VAT number and payment reason", () => {
    const questionnaire = normalizeStaffPayerQuestionnaire({
      payer_type: "company",
      state: "submitted",
      answers: {
        organisation_name: "Synthetic Stiftung",
        legal_form: "GmbH",
        vat_id: "DE123456789",
        payment_reason: "Arbeitgeber übernimmt die Behandlungskosten",
      },
    });
    expect(questionnaire).not.toBeNull();
    const rows = payerQuestionnaireGroups(questionnaire!, (_ru, de) => de, "de", "2026-10-13").flatMap((group) => group.rows);
    for (const [key, value] of Object.entries({
      legal_form: "GmbH", vat_id: "DE123456789", payment_reason: "Arbeitgeber übernimmt die Behandlungskosten",
    })) {
      expect(rows.find((row) => row.key === key)?.value).toBe(value);
    }
  });
});
