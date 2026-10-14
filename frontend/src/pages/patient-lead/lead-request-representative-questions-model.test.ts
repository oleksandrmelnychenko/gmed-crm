import { describe, expect, it } from "vitest";
import { mergeSavedDraft, queuedDraftFields, scopedDraftPatch } from "./lead-request-autosave";
import { openFollowUpBlocks } from "./lead-request-follow-up-model";
import { leadRequestText, followUpFieldLabel } from "./lead-request-text";
import { representativeCountryDraft, representativeCountryPatch, updateRepresentativeCountryDraft } from "./lead-request-representative-questions-model";

describe("parent country answers", () => {
  it("retains known No answers and residence without inventing answers for the child", () => {
    const known = { residence_since: "2018", stay_reason: "family", pep_self: false, pep_related: false, sanctions_links: false };
    const draft = representativeCountryDraft(known);
    expect(draft.pep_self).toBe("no");
    expect(representativeCountryPatch(draft, { ...draft, residence_since: "2019" })).toEqual({ residence_since: "2019" });
    expect(openFollowUpBlocks({ follow_up: { required: true, before_submit: true, blocks: ["R"], missing: {}, answered_at: null }, submitted_at: null })).toEqual(["R"]);
  });

  it("clears obsolete PEP and sanctions details when answers become No", () => {
    const before = representativeCountryDraft({ pep_self: true, pep_related: false, pep_office: "Minister", pep_country: "DE", pep_period: "2020", pep_wealth_origin: "Income", sanctions_links: true, sanctions_link_name: "Sample", sanctions_link_kind: "family" });
    const after = updateRepresentativeCountryDraft(updateRepresentativeCountryDraft(before, "pep_self", "no"), "sanctions_links", "no");
    expect(representativeCountryPatch(before, after)).toMatchObject({ pep_self: false, pep_office: null, pep_country: null, sanctions_links: false, sanctions_link_name: null, sanctions_link_kind: null });
  });

  it("preserves PEP details while a close person's Yes remains", () => {
    const before = representativeCountryDraft({ pep_self: true, pep_related: true, pep_office: "Minister", pep_relationship: "Parent" });
    const after = updateRepresentativeCountryDraft(before, "pep_self", "no");
    expect(after.pep_office).toBe("Minister");
    expect(after.pep_relationship).toBe("Parent");
  });

  it("preserves typing after a queued save and adopts only server corrections for saved fields", () => {
    const baseline = representativeCountryDraft({ residence_since: "2018", pep_self: false });
    const submitted = { ...baseline, residence_since: "2019 " };
    const edited = { ...submitted, residence_since: "2020", stay_reason: "work" };
    const fresh = { ...baseline, residence_since: "2019" };
    const fields = queuedDraftFields(representativeCountryPatch(baseline, submitted), {});
    expect(scopedDraftPatch(representativeCountryPatch(baseline, edited), fields)).toEqual({ residence_since: "2020" });
    expect(mergeSavedDraft(edited, submitted, fresh, baseline, ["residence_since"], fields)).toMatchObject({ residence_since: "2020", stay_reason: "work", pep_self: "no" });
  });

  it("missing labels name the parent rather than displaying an internal UUID", () => {
    const person = { id: "parent-id", name: "Anna Example", fields: {}, country_questions: true, missing: ["pep_self"] };
    for (const lang of ["de", "ru", "ua", "en"] as const) {
      const text = leadRequestText(lang);
      const label = followUpFieldLabel(text, "representative:parent-id:pep_self", true, [person]);
      expect(label).toContain("Anna Example:");
      expect(label).not.toContain("parent-id");
      expect(label).not.toContain("ребён");
    }
  });
});
