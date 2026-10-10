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
  assetOrigin: "",
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
    expect(prefill.assetOrigin).toBe("Angabe der Patientin/des Patienten: Einkommen – Gehalt als Ingenieur");
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
    expect(sent.assetOrigin.split("\n")).toEqual([
      "Angabe des Kostenübernehmers (Viktor Zahler): Gehalt / nichtselbständige Arbeit – Lehrer; Beruf: Lehrer; Branche: Bildung",
      "Angabe der Patientin/des Patienten zur zahlenden Person: Ersparnisse – Ersparnisse der Mutter",
    ]);
    expect(sent.evidence).toEqual([{ documentId: "payer-proof", filename: "kontoauszug-zahler.pdf" }]);
    expect(sent.sanctionsLinks).toBe("Angabe des Kostenübernehmers (Viktor Zahler): Geschäftspartner Beispiel GmbH");

    const draft = amlPrefillFromLeadAnswers({
      identification: null,
      enhancedDetails: null,
      payer: payer({ funds_sources: ["employment"] }, false),
      countryName,
    });
    expect(draft.assetOrigin).toBe("");
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

  it("fills the empty fields and ticks the PEP box", () => {
    const filled = applyAmlLeadPrefill(emptyForm, prefill);
    expect(filled).toEqual({
      assetOrigin: "Angabe der Patientin/des Patienten: Ersparnisse",
      assetOriginEvidence: [{ documentId: "self-proof", filename: "auszug.pdf" }],
      additionalContractPartnerInfo: "Beruf: Ärztin",
      pepContractPartner: true,
      pepStatusChecked: false,
      pepOfficeFunction: "Bürgermeister",
      pepAssetOrigin: "Gehalt",
      sanctionsLinks: "Angabe der Patientin/des Patienten: Onkel",
    });
  });

  it("never changes what staff typed or decided", () => {
    const typed: AmlPrefillTarget = {
      assetOrigin: "Laut Kontoauszug: Gehalt",
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
