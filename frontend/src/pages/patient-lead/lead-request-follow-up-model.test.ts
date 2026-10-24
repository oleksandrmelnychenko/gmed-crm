import { describe, expect, it } from "vitest";

import type { LeadRequestPayer } from "./lead-request-api";
import { billingExtrasPatch, draftFromBillingExtras, parseEuroAmount } from "./lead-request-billing-model";
import {
  askedExtraFields,
  blockAAsks,
  blockAKey,
  draftFromExtra,
  extraFieldOf,
  extraPatch,
  familyPayer,
  followUpAnswered,
  followUpBeforeSubmit,
  followUpMissing,
  followUpMissingAll,
  followUpRequestedAgainAt,
  followUpShown,
  fundsDescriptionRequired,
  fundsSourceOptions,
  missingOfRefusal,
  openFollowUpBlocks,
  paymentReasonAskedWithPayer,
} from "./lead-request-follow-up-model";

const payer = (payer_kind: LeadRequestPayer["payer_kind"]): LeadRequestPayer => ({
  payer_kind,
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
});

const NO_ASKS = { payer_funds: false, funds: false, occupation: false, sector: false, funds_proof: false, payer_states_funds: false };

describe("follow-up blocks", () => {
  it("shows only live country questions before sending, keeping staff requests and conditional yes details out", () => {
    // A level-2 preview (black-list country, owner 2026-10-24): the server opens A, F, K and L before
    // sending; I and G are staff blocks that wait for the submission. Which blocks open is the
    // server's call — the model only filters what it is given.
    const request = {
      submitted_at: null,
      identification: { pep_self: null, pep_related: false, sanctions_links: false } as import("./lead-request-api").LeadRequest["identification"],
      follow_up: { required: true, before_submit: true, blocks: ["A", "F", "K", "L", "H", "I", "J", "G"], missing: { A: ["sector"], H: ["pep_office"], I: ["id_document_upload"], J: ["sanctions_link_name"] }, answered_at: null },
    };
    expect(followUpBeforeSubmit(request)).toBe(true);
    expect(followUpShown(request)).toBe(true);
    expect(openFollowUpBlocks(request)).toEqual(["K", "L", "A", "F"]);
    // A level-1 preview (list-1 country alone) opens only the residence block F.
    const levelOne = { ...request, follow_up: { ...request.follow_up, blocks: ["F"], missing: { F: ["residence_since"] } } };
    expect(openFollowUpBlocks(levelOne)).toEqual(["F"]);
    expect(followUpMissingAll(levelOne)).toEqual([{ block: "F", key: "residence_since" }]);
    expect(followUpMissingAll(request)).toEqual([{ block: "A", key: "sector" }]);
    expect(openFollowUpBlocks({ ...request, identification: { ...request.identification!, pep_self: true, sanctions_links: true } })).toEqual(["K", "L", "A", "F", "H", "J"]);
    expect(followUpShown({ ...request, follow_up: { ...request.follow_up, before_submit: undefined } })).toBe(false);
    expect(followUpShown({ ...request, follow_up: { ...request.follow_up, required: false, blocks: [] } })).toBe(false);
    const sent = { ...request, submitted_at: "2026-10-14T12:00:00Z" };
    expect(followUpBeforeSubmit(sent)).toBe(false);
    expect(openFollowUpBlocks(sent)).toContain("I");
  });

  it("opens the cabinet's blocks in letter order, nothing while not required", () => {
    const followUp = { required: true, blocks: ["J", "a", "D", "C", "E", "X"], missing: { A: ["sector"], J: [] }, answered_at: null };
    expect(openFollowUpBlocks({ follow_up: followUp })).toEqual(["A", "C", "J"]);
    expect(openFollowUpBlocks({ follow_up: { ...followUp, required: false } })).toEqual([]);
    expect(openFollowUpBlocks({ follow_up: undefined })).toEqual([]);
    expect(followUpMissing({ follow_up: followUp }, "A")).toEqual(["sector"]);
    // A block that is not open misses nothing.
    expect(followUpMissing({ follow_up: followUp }, "B")).toEqual([]);
    expect(followUpAnswered({ follow_up: { ...followUp, answered_at: "2026-10-07T10:00:00Z" } })).toBe(false);
    expect(followUpAnswered({ follow_up: { ...followUp, missing: {}, answered_at: "2026-10-07T10:00:00Z" } })).toBe(true);
  });

  it("keeps corrected legal answers out of the step and permits sending changed follow-up again", () => {
    const follow_up = { required: true, blocks: ["H", "J"], missing: {}, answered_at: "2026-10-07T10:00:00Z" };
    const identification = { pep_self: false, pep_related: false, sanctions_links: false } as import("./lead-request-api").LeadRequest["identification"];
    expect(openFollowUpBlocks({ follow_up, identification })).toEqual([]);
    expect(followUpAnswered({ follow_up: { ...follow_up, changed_since_answer: true } })).toBe(false);
  });

  it("names the date GMED asked again only while the renewed answer is not sent", () => {
    const followUp = { required: true, blocks: ["A"], missing: { A: ["sector"] }, answered_at: null };
    expect(followUpRequestedAgainAt({ follow_up: { ...followUp, requested_at: "2026-10-24T09:00:00Z" } })).toBe("2026-10-24T09:00:00Z");
    expect(followUpRequestedAgainAt({ follow_up: { ...followUp, requested_at: "2026-10-24T09:00:00Z", answered_at: "2026-10-24T10:00:00Z" } })).toBeNull();
    expect(followUpRequestedAgainAt({ follow_up: { ...followUp, requested_at: null } })).toBeNull();
    expect(followUpRequestedAgainAt({ follow_up: followUp })).toBeNull();
    expect(followUpRequestedAgainAt({ follow_up: undefined })).toBeNull();
    // A renewed request leaves the answer unsent until the lead sends again.
    expect(followUpAnswered({ follow_up: { ...followUp, missing: {}, requested_at: "2026-10-24T09:00:00Z" } })).toBe(false);
  });

  it("reads what a refusal names as missing, by block", () => {
    expect(missingOfRefusal({ code: "follow_up_incomplete", missing: { A: ["funds_source", 3], B: "x" } })).toEqual({
      A: ["funds_source"],
    });
    expect(missingOfRefusal({ code: "follow_up_incomplete" })).toBeNull();
    expect(missingOfRefusal(null)).toBeNull();
  });

  it("asks block A by who pays and what the server misses", () => {
    expect(blockAAsks({ payer: payer("self") })).toMatchObject({ funds: true, occupation: true, sector: true, funds_proof: true, payer_funds: false });
    expect(blockAAsks({ payer: null })).toMatchObject({ funds: false, funds_proof: false, occupation: true, sector: true });
    expect([...askedExtraFields(blockAAsks({ payer: null }))]).toEqual(["occupation", "sector"]);
    // Below the enhanced check the server asks no source of funds (owner 2026-10-19).
    const noFunds = { required: true, blocks: ["A"], missing: { A: ["occupation"] }, answered_at: null, funds_asked: false };
    expect(blockAAsks({ payer: payer("self"), follow_up: noFunds })).toMatchObject({ funds: false, funds_proof: false, occupation: true, sector: true });
    expect(blockAAsks({ payer: payer("self"), follow_up: { ...noFunds, funds_asked: true } })).toMatchObject({ funds: true, funds_proof: true });
    // A paying parent states the funds in the payer questionnaire, even with the enhanced check.
    expect(blockAAsks({ payer: payer("representative"), follow_up: { ...noFunds, funds_asked: true } })).toEqual({
      funds: false, funds_proof: false, payer_funds: false, payer_states_funds: false, occupation: false, sector: true,
    });
    // A child states no profession or sector (owner 2026-10-24), whoever pays; the payer notes stay.
    expect(blockAAsks({ payer: null, minor: true })).toEqual({ ...NO_ASKS });
    expect(blockAAsks({ payer: payer("self"), minor: true, follow_up: { ...noFunds, funds_asked: true } })).toEqual({ ...NO_ASKS, funds: true, funds_proof: true });
    expect(blockAAsks({ payer: payer("representative"), minor: true })).toEqual({ ...NO_ASKS });
    expect(blockAAsks({ payer: payer("third_party"), minor: true })).toEqual({ ...NO_ASKS, payer_states_funds: true });
    expect(blockAAsks({ payer: payer("representative"), payer_questionnaire: { available: true } as never, minor: true })).toEqual({ ...NO_ASKS, payer_states_funds: true });
    expect([...askedExtraFields(blockAAsks({ payer: payer("representative"), minor: true }))]).toEqual([]);
    // Even stale server missing keys never ask the lead for a third party's funds.
    const asked = { required: true, blocks: ["A"], missing: { A: ["payer_funds_source", "sector"] }, answered_at: null };
    expect(blockAAsks({ payer: payer("third_party"), follow_up: asked })).toMatchObject({ payer_funds: false, payer_states_funds: true, funds: false, funds_proof: false });
    expect(blockAAsks({ payer: payer("third_party"), follow_up: { ...asked, missing: { A: ["sector"] } } })).toMatchObject({ payer_funds: false, sector: true });
    expect(
      blockAAsks({ payer: payer("third_party"), follow_up: { ...asked, missing: { A: [] }, answers: { payer_funds_source: "savings" } } }),
    ).toMatchObject({ payer_funds: false });
  });

  it("sends one source with the words, trimmed, only what changed", () => {
    const saved = draftFromExtra({ answers: { funds_source: "income", payer_funds_source: null } });
    expect(saved.funds_source).toBe("income");
    const asked = askedExtraFields(blockAAsks({ payer: payer("self") }));
    expect(extraPatch(saved, { ...saved, funds_source: "savings", funds_description: " Gehalt\nund Bonus ", payer_funds_description: "x" }, asked)).toEqual({
      funds_source: "savings",
      funds_description: "Gehalt\nund Bonus",
    });
    expect(extraPatch(saved, { ...saved }, asked)).toEqual({});
    // A value the server refused is not sent again until it changes.
    expect(extraPatch(saved, { ...saved, sector: "IT" }, asked, { sector: "IT" })).toEqual({});
    expect(fundsSourceOptions({ funds_source_options: ["income", "savings", "unknown"] })).toEqual(["income", "savings"]);
    expect(fundsSourceOptions(undefined)).toEqual(["income", "savings", "asset_sale", "inheritance_gift", "other"]);
  });

  it("knows the keys of block A by any of their names", () => {
    expect(blockAKey("self_funds_source")).toBe("funds_source");
    expect(blockAKey("enhanced_funds_proof_upload")).toBe("funds_proof_upload");
    expect(blockAKey("payer_funds_sources")).toBe("payer_funds_source");
    expect(extraFieldOf("funds_sources")).toBe("funds_source");
    expect(extraFieldOf("occupation")).toBe("occupation");
    expect(extraFieldOf("unknown")).toBeNull();
  });

  it("sends block C's kind of third party, never the expected total (owner 2026-10-12)", () => {
    expect(parseEuroAmount("12.500")).toBe(12500);
    expect(parseEuroAmount("12.500,50")).toBe(12500.5);
    expect(parseEuroAmount("12500.5")).toBe(12500.5);
    expect(parseEuroAmount("€ 900")).toBe(900);
    expect(parseEuroAmount("1,5")).toBe(1.5);
    expect(parseEuroAmount("")).toBeNull();
    expect(parseEuroAmount("zwölf")).toBeUndefined();
    const saved = draftFromBillingExtras({ via_third_party_kind: null, expected_total_eur: "12500.00" });
    expect(saved).toEqual({ via_third_party_kind: "", expected_total_eur: "12500.00" });
    // An older answer stays readable; the amount is no longer sent.
    expect(billingExtrasPatch(saved, { ...saved, expected_total_eur: "900" })).toEqual({});
    expect(billingExtrasPatch(saved, { via_third_party_kind: "psp", expected_total_eur: "" })).toEqual({
      via_third_party_kind: "psp",
    });
  });

  it("takes a certificate as the example of a relationship proof for family only", () => {
    const related = (relationship_kind: string | null) => ({ payer: { ...payer("third_party"), relationship_kind } });
    for (const kind of ["spouse", "parent", "child", "sibling", "grandparent", "relative"]) {
      expect(familyPayer(related(kind)), kind).toBe(true);
    }
    for (const kind of ["friend", "employer", "business_partner", "other", null]) {
      expect(familyPayer(related(kind)), String(kind)).toBe(false);
    }
    expect(familyPayer({ payer: null })).toBe(false);
  });

  it("asks why an organisation pays only with the payer, not again in block B", () => {
    for (const payer_type of ["company", "organisation", "insurance"] as const) {
      expect(paymentReasonAskedWithPayer({ payer: { ...payer("third_party"), payer_type } }), payer_type).toBe(true);
    }
    expect(paymentReasonAskedWithPayer({ payer: { ...payer("third_party"), payer_type: "person" } })).toBe(false);
    expect(paymentReasonAskedWithPayer({ payer: payer("third_party") })).toBe(false);
    expect(paymentReasonAskedWithPayer({ payer: { ...payer("self"), payer_type: "company" } })).toBe(false);
    expect(paymentReasonAskedWithPayer({ payer: null })).toBe(false);
  });
});

describe("the words about a source of funds", () => {
  it("are required with the source 'other' only, as on the server (lead_funds::stated)", () => {
    expect(fundsDescriptionRequired("other")).toBe(true);
    expect(fundsDescriptionRequired("income")).toBe(false);
    expect(fundsDescriptionRequired("")).toBe(false);
    expect(fundsDescriptionRequired(["income", "other"])).toBe(true);
    expect(fundsDescriptionRequired(["income", "savings"])).toBe(false);
    expect(fundsDescriptionRequired([])).toBe(false);
  });
});
