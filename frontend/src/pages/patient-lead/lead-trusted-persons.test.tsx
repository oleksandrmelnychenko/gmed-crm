import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONSENT_RECIPIENT_RELATIONS, NO_CONSENT_FORM_CHOICES, type LeadRequest } from "./lead-request-api";
import { consentFormText } from "./lead-request-consent-form-text";
import { TrustedPersonsEditor, TrustedPersonsList } from "./lead-trusted-persons-editor";
import { disclosureChanged, disclosureDraft, disclosureProblem, disclosureToSend, recipientDrafts, recipientsToSend, requestForLead, samePersons, storedTrustedPersons, trustedPersonsProblem, type RecipientDraft } from "./lead-trusted-persons-model";
import { trustedPersonsText } from "./lead-trusted-persons-text";

const friend = { name: "Eva Muster", relation: "friend", contact: "", scope: "Medical" } satisfies RecipientDraft;

describe("explicit disclosure decision", () => {
  const legacy = { trusted_persons: [friend], consent_form: { version: "v1", chosen_at: null, choices: { ...NO_CONSENT_FORM_CHOICES, named_recipients: true }, recipients: [friend] } };
  it("does not preselect a legacy decision or consent and preserves its draft people", () => {
    const draft = disclosureDraft(legacy);
    expect(draft).toEqual({ allowDisclosure: null, consentGiven: false, persons: [friend] });
    expect(disclosureProblem(draft)).toBe("decision");
    expect(disclosureChanged(draft, legacy)).toBe(false);
  });
  it("requires people, per-person scope and explicit consent for Yes", () => {
    const draft = { allowDisclosure: true, consentGiven: false, persons: [friend] };
    expect(disclosureProblem({ ...draft, persons: [] })).toBe("required");
    expect(disclosureProblem({ ...draft, persons: [{ ...friend, scope: " " }] })).toBe("invalid");
    expect(disclosureProblem({ ...draft, persons: [{ ...friend, scope: "x".repeat(241) }] })).toBe("invalid");
    expect(disclosureProblem(draft)).toBe("consent");
    expect(() => disclosureToSend(draft, "en")).toThrow();
    expect(disclosureToSend({ ...draft, consentGiven: true }, "uk")).toEqual({ persons: [{ ...friend, contact: null }], allow_disclosure: true, consent_given: true, version: "2026-10-14", language: "uk" });
  });
  it("No sends an explicit negative decision without stale persons or consent", () => {
    expect(disclosureToSend({ allowDisclosure: false, consentGiven: true, persons: [friend] }, "de")).toEqual({ persons: [], allow_disclosure: false, consent_given: false, version: "2026-10-14", language: "de" });
  });
  it("does not preselect another guardian's consent and allows that guardian to confirm", () => {
    const request = { ...legacy, disclosure: { allow_disclosure: true, consent_given: true, version: "2026-10-14", language: "en", chosen_at: "2026-10-14T08:00:00Z", chosen_by: "parent-a", access_kind: "guardian" as const, company_name: "Example Clinic" } };
    const draft = disclosureDraft(request, "parent-b");
    expect(draft.consentGiven).toBe(false);
    expect(disclosureChanged(draft, request, "parent-b")).toBe(false);
    expect(disclosureChanged({ ...draft, consentGiven: true }, request, "parent-b")).toBe(true);
    expect(disclosureDraft(request, "parent-a").consentGiven).toBe(true);
    expect(disclosureDraft({ ...request, disclosure_company_name: "New Clinic" }, "parent-a").consentGiven).toBe(false);
    expect(disclosureDraft({ ...request, disclosure: { ...request.disclosure, version: "old" } }, "parent-a").consentGiven).toBe(false);
    expect(disclosureChanged({ ...disclosureDraft(request), persons: [{ ...friend, scope: "Invoices" }] }, request)).toBe(true);
  });
});

describe("trusted persons independent of consent", () => {
  it("accepts an empty list, validates every typed row and matches server normalization", () => {
    expect(trustedPersonsProblem([])).toBeNull();
    expect(trustedPersonsProblem([{ name: "", relation: "", contact: "", scope: "" }])).toBeNull();
    expect(trustedPersonsProblem([friend])).toBeNull();
    expect(trustedPersonsProblem([{ ...friend, relation: "" }])).toBe("invalid");
    expect(trustedPersonsProblem([{ ...friend, name: " " }])).toBe("invalid");
    expect(trustedPersonsProblem([{ ...friend, name: "a".repeat(121) }])).toBe("invalid");
    expect(trustedPersonsProblem([{ ...friend, name: `Eva${" ".repeat(121)}Muster` }])).toBeNull();
    expect(trustedPersonsProblem([{ ...friend, contact: "x".repeat(121) }])).toBe("invalid");
    expect(trustedPersonsProblem(Array.from({ length: 6 }, () => friend))).toBe("invalid");
    expect(recipientsToSend([{ ...friend, name: " Eva   Muster ", contact: " eva@example.com " }])).toEqual([{ name: "Eva Muster", relation: "friend", contact: "eva@example.com", scope: "Medical" }]);
    expect(recipientDrafts([{ ...friend, contact: null }])).toEqual([friend]);
    expect(samePersons([{ ...friend, contact: null }], [friend])).toBe(true);
  });

  it("does not restore old recipients when the lead explicitly cleared the list", () => {
    const consent_form = { version: "v1", chosen_at: null, choices: NO_CONSENT_FORM_CHOICES, recipients: [friend] };
    expect(storedTrustedPersons({ trusted_persons: [], consent_form })).toEqual([]);
    expect(storedTrustedPersons({ consent_form })).toEqual([friend]);
    expect(storedTrustedPersons({ trusted_persons: [friend] })).toEqual([friend]);
  });

  it("selects the requested child and falls back only to an accessible request", () => {
    const requests = [{ lead_id: "child-a" }, { lead_id: "child-b" }] as LeadRequest[];
    expect(requestForLead(requests, "child-b")?.lead_id).toBe("child-b");
    expect(requestForLead(requests, "revoked")?.lead_id).toBe("child-a");
    expect(requestForLead([], "revoked")).toBeNull();
  });

  it.each(["de", "en", "uk", "ru"])("provides the editor, relationship labels and child explanation in %s", (lang) => {
    const text = consentFormText(lang);
    for (const relation of CONSENT_RECIPIENT_RELATIONS) expect(text.recipientRelations[relation]).toBeTruthy();
    const copy = trustedPersonsText(lang);
    expect(copy.guardianContext("Anna Muster")).toContain("Anna Muster");
    expect(copy.representativeContext("Anna Muster")).toContain("Anna Muster");
    expect(copy.consent("Example Clinic")).toContain("Example Clinic");
    expect(copy.footer).toBeTruthy();
    const html = renderToStaticMarkup(<TrustedPersonsEditor persons={[friend]} lang={lang} onChange={() => undefined} />);
    expect(html).toContain('value="Eva Muster"');
    expect(html).toContain(text.recipientRelations.friend);
    expect(html).toContain("trusted-person-add");
    const list = renderToStaticMarkup(<TrustedPersonsList persons={[{ ...friend, name: "<script>" }]} lang={lang} />);
    expect(list).toContain("&lt;script&gt;");
    expect(list).not.toContain("<input");
  });

  it("limits adding to five and disables editing during a save", () => {
    const html = renderToStaticMarkup(<TrustedPersonsEditor persons={Array.from({ length: 5 }, () => friend)} lang="en" disabled onChange={() => undefined} />);
    expect(html).not.toContain("trusted-person-add");
    expect(html.match(/data-testid="trusted-person-editor"/g)).toHaveLength(5);
    expect(html).toContain('disabled=""');
  });
});
