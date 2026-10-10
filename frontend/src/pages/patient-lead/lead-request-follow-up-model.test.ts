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
  followUpMissing,
  fundsSourceOptions,
  missingOfRefusal,
  openFollowUpBlocks,
} from "./lead-request-follow-up-model";

const payer = (payer_kind: "self" | "third_party"): LeadRequestPayer => ({
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

describe("follow-up blocks", () => {
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

  it("reads what a refusal names as missing, by block", () => {
    expect(missingOfRefusal({ code: "follow_up_incomplete", missing: { A: ["funds_source", 3], B: "x" } })).toEqual({
      A: ["funds_source"],
    });
    expect(missingOfRefusal({ code: "follow_up_incomplete" })).toBeNull();
    expect(missingOfRefusal(null)).toBeNull();
  });

  it("asks block A by who pays and what the server misses", () => {
    expect(blockAAsks({ payer: payer("self") })).toMatchObject({ funds: true, occupation: true, sector: true, funds_proof: true, payer_funds: false });
    expect(blockAAsks({ payer: null })).toMatchObject({ funds: true });
    // The payer's funds only while the server asks them (not after the payer stated them on the own link).
    const asked = { required: true, blocks: ["A"], missing: { A: ["payer_funds_source", "sector"] }, answered_at: null };
    expect(blockAAsks({ payer: payer("third_party"), follow_up: asked })).toMatchObject({ payer_funds: true, payer_states_funds: true, funds: false, funds_proof: false });
    expect(blockAAsks({ payer: payer("third_party"), follow_up: { ...asked, missing: { A: ["sector"] } } })).toMatchObject({ payer_funds: false, sector: true });
    expect(
      blockAAsks({ payer: payer("third_party"), follow_up: { ...asked, missing: { A: [] }, answers: { payer_funds_source: "savings" } } }),
    ).toMatchObject({ payer_funds: true });
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

  it("sends block C's expected total as a number and the kind of third party", () => {
    expect(parseEuroAmount("12.500")).toBe(12500);
    expect(parseEuroAmount("12.500,50")).toBe(12500.5);
    expect(parseEuroAmount("12500.5")).toBe(12500.5);
    expect(parseEuroAmount("€ 900")).toBe(900);
    expect(parseEuroAmount("1,5")).toBe(1.5);
    expect(parseEuroAmount("")).toBeNull();
    expect(parseEuroAmount("zwölf")).toBeUndefined();
    const saved = draftFromBillingExtras({ via_third_party_kind: null, expected_total_eur: "12500.00" });
    expect(saved).toEqual({ via_third_party_kind: "", expected_total_eur: "12500.00" });
    // The same amount written otherwise is no change.
    expect(billingExtrasPatch(saved, { ...saved, expected_total_eur: "12.500" })).toEqual({});
    expect(billingExtrasPatch(saved, { via_third_party_kind: "psp", expected_total_eur: "" })).toEqual({
      via_third_party_kind: "psp",
      expected_total_eur: null,
    });
    // No amount: not sent, the field says so.
    expect(billingExtrasPatch(saved, { ...saved, expected_total_eur: "viel" })).toEqual({});
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
});
