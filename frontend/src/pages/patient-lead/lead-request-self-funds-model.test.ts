import { describe, expect, it } from "vitest";

import type { LeadRequest, LeadRequestSelfFunds } from "./lead-request-api";
import { missingForSubmit } from "./lead-request-model";
import { requestSummary } from "./lead-request-summary";
import {
  draftFromSelfFunds,
  selfFundsAsked,
  selfFundsDescriptionRequired,
  selfFundsFieldOf,
  selfFundsPatch,
  selfFundsProofRequired,
  selfFundsSourceOptions,
  withSelfFundsSource,
} from "./lead-request-self-funds-model";
import { LEAD_CABINET_LANGS, leadRequestText, submitFieldLabel } from "./lead-request-text";

const PERSON_SOURCES = ["employment", "business_income", "savings", "asset_sale", "inheritance_gift", "other"];

function selfFunds(overrides: Partial<LeadRequestSelfFunds> = {}): LeadRequestSelfFunds {
  return {
    asked: true,
    sources: [],
    description: null,
    source_options: PERSON_SOURCES,
    proof_required: false,
    proof_documents: [],
    ...overrides,
  };
}

function request(overrides: Partial<LeadRequest> = {}): LeadRequest {
  return {
    lead_id: "lead-1",
    access_kind: "self",
    created_at: "2026-10-07T08:00:00Z",
    personal_data: {
      first_name: "Mia",
      middle_name: null,
      last_name: "Muster",
      date_of_birth: null,
      legal_sex: null,
      citizenships: [],
      street_address: null,
      zip_code: null,
      city: null,
      country: null,
      phone: null,
      primary_language: null,
      has_insurance: null,
      insurance_type: null,
      insurance_provider: null,
      insurance_number: null,
      insurance_covers_germany: null,
    },
    progress: { filled: 2, total: 13, missing_for_submit: [] },
    payer: {
      payer_kind: "self",
      first_name: null,
      last_name: null,
      date_of_birth: null,
      street: null,
      zip: null,
      city: null,
      country: null,
      citizenships: [],
      relationship: null,
      email: null,
      phone: null,
      acts_on_own_account: true,
      beneficial_owner: null,
    },
    minor: false,
    documents: [],
    max_documents: 30,
    consents: {},
    submitted_at: null,
    retention_deadline_at: null,
    self_funds: selfFunds(),
    ...overrides,
  };
}

describe("the self-payer's source of funds", () => {
  it("is asked once the stored answer is 'I pay myself' on a server that knows it", () => {
    expect(selfFundsAsked(request())).toBe(true);
    expect(selfFundsAsked(request({ self_funds: undefined }))).toBe(false);
    expect(selfFundsAsked(request({ self_funds: selfFunds({ asked: false }) }))).toBe(false);
    expect(selfFundsAsked(request({ payer: null }))).toBe(false);
    const thirdParty = request();
    thirdParty.payer = { ...thirdParty.payer!, payer_kind: "third_party" };
    expect(selfFundsAsked(thirdParty)).toBe(false);
  });

  it("offers the person list in form order", () => {
    expect(selfFundsSourceOptions(selfFunds())).toEqual(PERSON_SOURCES);
    // A source the cabinet has no words for is not offered; nothing known → the person list.
    expect(selfFundsSourceOptions(selfFunds({ source_options: ["other", "loan", "savings"] }))).toEqual(["savings", "other"]);
    expect(selfFundsSourceOptions(null)).toEqual(PERSON_SOURCES);
  });

  it("keeps the sources a set in form order and asks for the words with 'other'", () => {
    let draft = draftFromSelfFunds(selfFunds({ sources: ["other", "employment"], description: "Stipendium" }));
    expect(draft).toEqual({ sources: ["employment", "other"], description: "Stipendium" });
    draft = withSelfFundsSource(draft, "savings", true);
    expect(draft.sources).toEqual(["employment", "savings", "other"]);
    draft = withSelfFundsSource(draft, "savings", true);
    expect(draft.sources).toEqual(["employment", "savings", "other"]);
    expect(selfFundsDescriptionRequired(draft)).toBe(true);
    draft = withSelfFundsSource(draft, "other", false);
    expect(selfFundsDescriptionRequired(draft)).toBe(false);
    expect(draftFromSelfFunds(undefined)).toEqual({ sources: [], description: "" });
  });

  it("sends only what changed, the description trimmed, and not a value the server refused", () => {
    const saved = draftFromSelfFunds(selfFunds({ sources: ["savings"], description: "Sparbuch" }));
    expect(selfFundsPatch(saved, saved)).toEqual({});
    expect(selfFundsPatch(saved, { ...saved, description: " Sparbuch " })).toEqual({});
    expect(selfFundsPatch(saved, { sources: ["savings", "employment"], description: "Sparbuch" })).toEqual({
      self_funds_sources: ["employment", "savings"],
    });
    expect(selfFundsPatch(saved, { sources: [], description: "" })).toEqual({
      self_funds_sources: [],
      self_funds_description: "",
    });
    expect(selfFundsPatch(saved, { ...saved, description: " Gehalt " }, { description: "Gehalt" })).toEqual({});
    expect(selfFundsFieldOf("self_funds_sources")).toBe("sources");
    expect(selfFundsFieldOf("self_funds_description")).toBe("description");
    expect(selfFundsFieldOf("payer_kind")).toBeNull();
  });

  it("says whether the proof is required, without the reasons", () => {
    expect(selfFundsProofRequired(request())).toBe(false);
    expect(selfFundsProofRequired(request({ self_funds: selfFunds({ proof_required: true }) }))).toBe(true);
    expect(selfFundsProofRequired(request({ self_funds: undefined }))).toBe(false);
  });

  it("lists what is missing after the own economic interest, before the invoice", () => {
    const missing = request({
      progress: {
        filled: 2,
        total: 13,
        missing_for_submit: ["invoice_to", "self_funds_proof_upload", "self_funds_sources", "payer_own_account"],
      },
    });
    expect(missingForSubmit(missing)).toEqual([
      "payer_own_account",
      "self_funds_sources",
      "self_funds_proof_upload",
      "invoice_to",
    ]);
  });

  it("names the keys in all four languages", () => {
    const de = leadRequestText("de");
    expect(submitFieldLabel(de, "self_funds_sources")).toBe("Herkunft der Mittel");
    expect(submitFieldLabel(de, "self_funds_description")).toBe("Beschreibung der Herkunft der Mittel");
    expect(submitFieldLabel(de, "self_funds_proof_upload")).toBe(
      "Nachweis der Mittelherkunft (z. B. Kontoauszug, Gehaltsnachweis)",
    );
    for (const { value } of LEAD_CABINET_LANGS) {
      const text = leadRequestText(value);
      for (const key of ["self_funds_sources", "self_funds_description", "self_funds_proof_upload"] as const) {
        expect(submitFieldLabel(text, key).trim(), `${value} ${key}`).not.toBe("");
        expect(submitFieldLabel(text, key), `${value} ${key}`).not.toContain("self_funds");
      }
      expect(text.selfFundsIntro.trim(), value).not.toBe("");
      expect(text.selfFundsProofHint.trim(), value).not.toBe("");
    }
    expect(submitFieldLabel(leadRequestText("uk"), "self_funds_sources")).toBe("Походження коштів");
    expect(submitFieldLabel(leadRequestText("en"), "self_funds_proof_upload")).toBe(
      "Proof of the source of funds (e.g. bank statement, payslip)",
    );
  });

  it("shows the sources, the description and the files in the summary of 'who pays'", () => {
    const de = leadRequestText("de");
    const stated = request({
      self_funds: selfFunds({
        sources: ["employment", "other"],
        description: "Stipendium",
        proof_documents: [
          {
            id: "doc-1",
            file_name: "kontoauszug.pdf",
            size_bytes: 2048,
            mime_type: "application/pdf",
            uploaded_at: "2026-10-07T09:00:00Z",
            uploaded_by_me: true,
            reviewed: false,
            can_delete: true,
          },
        ],
      }),
    });
    const payer = requestSummary(stated, de, "de").find((group) => group.id === "payer");
    expect(payer?.rows).toEqual(
      expect.arrayContaining([
        { label: "Herkunft der Mittel", value: "Gehalt / nichtselbständige Arbeit, Sonstiges" },
        { label: "Beschreibung der Herkunft der Mittel", value: "Stipendium" },
        { label: "Nachweis der Mittelherkunft (z. B. Kontoauszug, Gehaltsnachweis)", value: "kontoauszug.pdf" },
      ]),
    );
    // Nothing of it when a third party pays.
    const thirdParty = request({ self_funds: selfFunds({ asked: false, sources: ["employment"] }) });
    const rows = requestSummary(thirdParty, de, "de").find((group) => group.id === "payer")?.rows ?? [];
    expect(rows.some((row) => row.label === "Herkunft der Mittel")).toBe(false);
  });
});
