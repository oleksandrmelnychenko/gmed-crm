import { describe, expect, it } from "vitest";

import type { LeadGwgIdentification, LeadPortalEnhancedDetails } from "../data/lead-portal-intake-api";
import { normalizePayerAnswers, type StaffPayerQuestionnaire } from "../data/lead-payer-link-api";
import { amlPrefillFromLeadAnswers, applyAmlLeadPrefill, type AmlPrefillTarget } from "./enhanced-check-prefill";

const countryName = (code: string) => ({ RU: "Russland", DE: "Deutschland" })[code] ?? code;

function identification(patch: Partial<LeadGwgIdentification>): LeadGwgIdentification {
  return { pep_self: null, pep_related: null, sanctions_links: null, ...patch } as LeadGwgIdentification;
}

function details(answers: Partial<LeadPortalEnhancedDetails["answers"]>, proofs: { id: string; file_name: string }[] = []): LeadPortalEnhancedDetails {
  return {
    required: true,
    check_required: true,
    asks: { payment_background: false, payer_funds: false, funds: true, occupation: true, sector: true, funds_proof: true, payer_states_funds: false },
    answers: {
      funds_sources: [],
      funds_description: null,
      payer_funds_source: null,
      payer_funds_description: null,
      occupation: null,
      sector: null,
      ...answers,
    },
    funds_proof_documents: proofs.map((proof) => ({ ...proof, uploaded_at: null, reviewed: false })),
    updated_at: null,
  };
}

function payer(answers: Record<string, unknown>, submitted = true): StaffPayerQuestionnaire {
  return {
    submitted_at: submitted ? "2026-10-10T10:00:00Z" : null,
    state: submitted ? "submitted" : "draft",
    answers: normalizePayerAnswers(answers),
    funds_proof_documents: [
      { id: "payer-proof", file_name: "kontoauszug-zahler.pdf", size_bytes: null, mime_type: null, uploaded_at: null, reviewed: false, can_delete: false },
    ],
  } as unknown as StaffPayerQuestionnaire;
}

const emptyForm: AmlPrefillTarget = {
  assetOriginEvidence: [],
  additionalContractPartnerInfo: "",
  pepContractPartner: false,
  pepStatusChecked: false,
  pepOfficeFunction: "",
  pepAssetOrigin: "",
  sanctionsLinks: "",
};

describe("amlPrefillFromLeadAnswers", () => {
  it("takes the self-payer's funds, profession and proofs (block A)", () => {
    const prefill = amlPrefillFromLeadAnswers({
      identification: identification({}),
      enhancedDetails: details(
        { funds_sources: ["income"], funds_description: "Gehalt als Ingenieur", occupation: "Ingenieur", sector: "Maschinenbau" },
        [{ id: "self-proof", file_name: "kontoauszug.pdf" }],
      ),
      payer: null,
      countryName,
    });
    // The source of funds is the one record the form edits (2026-10-23), no prefill.
    expect(prefill).not.toHaveProperty("assetOrigin");
    expect(prefill.contractPartnerInfo).toBe("Beruf: Ingenieur; Branche: Maschinenbau");
    expect(prefill.evidence).toEqual([{ documentId: "self-proof", filename: "kontoauszug.pdf" }]);
    expect(prefill.pepSelf).toBe(false);
    expect(prefill.sanctionsLinks).toBe("");
  });

  it("takes the payer's own statement and proof once the payer sent it", () => {
    const sent = amlPrefillFromLeadAnswers({
      identification: null,
      enhancedDetails: details({ payer_funds_source: "savings", payer_funds_description: "Ersparnisse der Mutter" }),
      payer: payer({
        first_name: "Viktor",
        last_name: "Zahler",
        funds_sources: ["employment"],
        funds_description: "Lehrer",
        occupation: "Lehrer",
        industry: "Bildung",
        sanctions_links: true,
        sanctions_links_details: "Geschäftspartner Beispiel GmbH",
      }),
      countryName,
    });
    // The payer's funds are the payer's statement on the server, not a copy in the form.
    expect(sent).not.toHaveProperty("assetOrigin");
    expect(sent.evidence).toEqual([{ documentId: "payer-proof", filename: "kontoauszug-zahler.pdf" }]);
    expect(sent.sanctionsLinks).toBe("Angabe des Kostenübernehmers (Viktor Zahler): Geschäftspartner Beispiel GmbH");

    const draft = amlPrefillFromLeadAnswers({
      identification: null,
      enhancedDetails: null,
      payer: payer({ funds_sources: ["employment"] }, false),
      countryName,
    });
    expect(draft).not.toHaveProperty("assetOrigin");
    expect(draft.evidence).toEqual([]);
  });

  it("takes the PEP details (block H) and the sanctions link (block J)", () => {
    const own = amlPrefillFromLeadAnswers({
      identification: identification({
        pep_self: true,
        pep_office: "Bürgermeister",
        pep_country: "RU",
        pep_period: "2015–2020",
        pep_wealth_origin: "Gehalt und Immobilien",
        sanctions_links: true,
        sanctions_link_name: "Ben Muster",
        sanctions_link_kind: "business",
        sanctions_link_since_extent: "seit 2019, gemeinsame Firma",
      }),
      enhancedDetails: null,
      payer: null,
      countryName,
    });
    expect(own.pepSelf).toBe(true);
    expect(own.pepOfficeFunction).toBe("Bürgermeister, Russland, 2015–2020");
    expect(own.pepAssetOrigin).toBe("Gehalt und Immobilien");
    expect(own.sanctionsLinks).toBe("Angabe der Patientin/des Patienten: Ben Muster (geschäftlich) – seit 2019, gemeinsame Firma");

    const related = amlPrefillFromLeadAnswers({
      identification: identification({ pep_self: false, pep_related: true, pep_relationship: "Vater", pep_office: "Minister" }),
      enhancedDetails: null,
      payer: null,
      countryName,
    });
    expect(related.pepSelf).toBe(false);
    expect(related.pepOfficeFunction).toBe("Familienmitglied / nahestehende Person einer PeP (Vater): Minister");
  });
});

describe("applyAmlLeadPrefill", () => {
  const prefill = amlPrefillFromLeadAnswers({
    identification: identification({ pep_self: true, pep_office: "Bürgermeister", pep_wealth_origin: "Gehalt", sanctions_links: true, sanctions_links_details: "Onkel" }),
    enhancedDetails: details({ funds_sources: ["savings"], occupation: "Ärztin" }, [{ id: "self-proof", file_name: "auszug.pdf" }]),
    payer: null,
    countryName,
  });

  it("fills the empty fields and leaves staff's PEP review to staff", () => {
    // Owner decision 2026-10-23: the lead's "yes" is the lead's answer, not
    // staff's conclusion; it never ticks the review box.
    const filled = applyAmlLeadPrefill(emptyForm, prefill);
    expect(filled).toEqual({
      assetOriginEvidence: [{ documentId: "self-proof", filename: "auszug.pdf" }],
      additionalContractPartnerInfo: "Beruf: Ärztin",
      pepContractPartner: false,
      pepStatusChecked: false,
      pepOfficeFunction: "Bürgermeister",
      pepAssetOrigin: "Gehalt",
      sanctionsLinks: "Angabe der Patientin/des Patienten: Onkel",
    });
  });

  it("never changes what staff typed or decided", () => {
    const typed: AmlPrefillTarget = {
      assetOriginEvidence: [{ documentId: "staff-proof", filename: "beleg.pdf" }],
      additionalContractPartnerInfo: "geprüft",
      pepContractPartner: false,
      pepStatusChecked: true,
      pepOfficeFunction: "ehemaliger Bürgermeister",
      pepAssetOrigin: "Pension",
      sanctionsLinks: "keine",
    };
    expect(applyAmlLeadPrefill(typed, prefill)).toEqual(typed);
  });
});
