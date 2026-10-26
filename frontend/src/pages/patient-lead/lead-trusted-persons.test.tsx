import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONSENT_RECIPIENT_SCOPES, cabinetScopeSummary, checkedScopeCodes, normalizeScopeCodes, scopeOptionLabel, staffScopeSummary, toggleScopeCode } from "@/lib/consent-recipient-scope";
import { CONSENT_RECIPIENT_RELATIONS, DISCLOSURE_VERSION, NO_CONSENT_FORM_CHOICES, type ConsentRecipient, type LeadRequest } from "./lead-request-api";
import { consentFormText } from "./lead-request-consent-form-text";
import { TrustedPersonsEditor, TrustedPersonsList } from "./lead-trusted-persons-editor";
import { contactValid, disclosureChanged, disclosureDraft, disclosureProblem, disclosureToSend, mergeDisclosureDraft, personScope, recipientDrafts, recipientProblems, recipientsToSend, requestForLead, samePersons, storedTrustedPersons, trustedPersonsProblem, type DisclosureDraft, type RecipientDraft } from "./lead-trusted-persons-model";
import { disclosureConsentText, disclosureSubject, trustedPersonsText } from "./lead-trusted-persons-text";

const stored = { name: "Eva Muster", relation: "friend", contact: "", scope_codes: ["medical"] } satisfies ConsentRecipient;
const friend = { name: "Eva Muster", relation: "friend", contact: "", scope: "", scopeCodes: ["medical"] } satisfies RecipientDraft;
const legacyStored = { name: "Eva Muster", relation: "friend", contact: "", scope: "medizin" } satisfies ConsentRecipient;
const legacyFriend = { ...friend, scope: "medizin", scopeCodes: [] } satisfies RecipientDraft;

describe("explicit disclosure decision", () => {
  const legacy = { trusted_persons: [stored], consent_form: { version: "v1", chosen_at: null, choices: { ...NO_CONSENT_FORM_CHOICES, named_recipients: true }, recipients: [stored] } };
  it("does not preselect a legacy decision or consent and preserves its draft people", () => {
    const draft = disclosureDraft(legacy);
    expect(draft).toEqual({ allowDisclosure: null, consentGiven: false, persons: [friend] });
    expect(disclosureProblem(draft)).toBe("decision");
    expect(disclosureChanged(draft, legacy)).toBe(false);
  });
  it("requires people, a chosen scope per person and explicit consent for Yes", () => {
    const draft = { allowDisclosure: true, consentGiven: false, persons: [friend] };
    expect(disclosureProblem({ ...draft, persons: [] })).toBe("required");
    expect(disclosureProblem({ ...draft, persons: [{ ...friend, scopeCodes: [] }] })).toBe("invalid");
    expect(disclosureProblem(draft)).toBe("consent");
    expect(() => disclosureToSend(draft, "en")).toThrow();
    expect(disclosureToSend({ ...draft, consentGiven: true }, "uk")).toEqual({
      persons: [{ name: "Eva Muster", relation: "friend", contact: null, scope_codes: ["medical"] }],
      allow_disclosure: true, consent_given: true, version: "2026-10-14", language: "uk",
    });
  });
  it("asks again for a person with only a legacy free-text scope and then sends codes only", () => {
    const request = { trusted_persons: [legacyStored] };
    const draft = { ...disclosureDraft(request), allowDisclosure: true, consentGiven: true };
    expect(draft.persons).toEqual([legacyFriend]);
    expect(disclosureProblem(draft)).toBe("invalid");
    const chosen = { ...draft, persons: [{ ...legacyFriend, scopeCodes: toggleScopeCode([], "medical") }] };
    expect(disclosureProblem(chosen)).toBeNull();
    expect(disclosureToSend(chosen, "de").persons).toEqual([{ name: "Eva Muster", relation: "friend", contact: null, scope_codes: ["medical"] }]);
    expect(disclosureChanged(chosen, request)).toBe(true);
    const html = renderToStaticMarkup(<TrustedPersonsEditor persons={[legacyFriend]} lang="de" onChange={() => undefined} />);
    expect(html).toContain("trusted-person-scope-legacy");
    expect(html).toContain("Bisher angegeben: „medizin“");
    expect(personScope(legacyStored, "de")).toBe("medizin");
  });
  it("sends `all` alone when everything is permitted", () => {
    const all = { ...friend, scopeCodes: toggleScopeCode(["medical"], "all") };
    expect(recipientsToSend([all])[0].scope_codes).toEqual(["all"]);
  });
  it("No sends an explicit negative decision without stale persons or consent", () => {
    expect(disclosureToSend({ allowDisclosure: false, consentGiven: true, persons: [friend] }, "de")).toEqual({ persons: [], allow_disclosure: false, consent_given: false, version: "2026-10-14", language: "de" });
  });
  it("saves an explicit No that equals the default while nothing is stored, and not the default itself (QA 2026-10-25, E-13)", () => {
    const unanswered = { trusted_persons: [], consent_form: undefined, disclosure: null };
    const shown = disclosureDraft(unanswered);
    expect(shown.allowDisclosure).toBe(false);
    expect(disclosureChanged(shown, unanswered)).toBe(false);
    expect(disclosureChanged({ ...shown, answered: true }, unanswered)).toBe(true);
    expect(disclosureProblem({ ...shown, answered: true })).toBeNull();
    // Once the decision is stored, the answered flag changes nothing by itself.
    const decided = { ...unanswered, disclosure: { allow_disclosure: false, consent_given: false, version: "2026-10-14", language: "de", chosen_at: "2026-10-25T08:00:00Z", chosen_by: "lead-1", access_kind: "self" as const, company_name: "GMED" } };
    expect(disclosureChanged({ ...disclosureDraft(decided), answered: true }, decided)).toBe(false);
    // An answer that is still open is no decision to save.
    expect(disclosureProblem({ ...shown, allowDisclosure: null, answered: true })).toBe("decision");
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
    expect(disclosureChanged({ ...disclosureDraft(request), persons: [{ ...friend, scopeCodes: ["financial"] }] }, request)).toBe(true);
  });
});

describe("scope selector", () => {
  it("ticks every option with `all` and drops `all` when another option is unticked", () => {
    expect(toggleScopeCode([], "all")).toEqual(["all"]);
    expect(checkedScopeCodes(["all"])).toEqual([...CONSENT_RECIPIENT_SCOPES]);
    expect(toggleScopeCode(["all"], "medical")).toEqual(["organisational", "financial"]);
    expect(toggleScopeCode(["all"], "all")).toEqual([]);
    expect(toggleScopeCode(["medical"], "financial")).toEqual(["medical", "financial"]);
    expect(toggleScopeCode(["medical", "financial"], "medical")).toEqual(["financial"]);
    expect(toggleScopeCode(["medical", "financial"], "all")).toEqual(["all"]);
    expect(checkedScopeCodes(["financial", "medical"])).toEqual(["medical", "financial"]);
  });
  it("keeps known codes only, in offer order", () => {
    expect(normalizeScopeCodes(["financial", "medizin", " medical", "financial"])).toEqual(["medical", "financial"]);
    expect(normalizeScopeCodes(["medical", "all"])).toEqual(["all"]);
    expect(normalizeScopeCodes(null)).toEqual([]);
  });
  it("requires at least one option", () => {
    expect(trustedPersonsProblem([{ ...friend, scopeCodes: [] }])).toBe("invalid");
    expect(trustedPersonsProblem([{ ...friend, scopeCodes: ["all"] }])).toBeNull();
  });
  it.each(["de", "en", "uk", "ru"])("labels every option and summary in %s", (lang) => {
    for (const code of CONSENT_RECIPIENT_SCOPES) expect(scopeOptionLabel(code, lang)).toBeTruthy();
    expect(cabinetScopeSummary(["organisational", "medical"], lang)).toContain(", ");
    const html = renderToStaticMarkup(<TrustedPersonsEditor persons={[friend]} lang={lang} onChange={() => undefined} />);
    expect(html).toContain(trustedPersonsText(lang).scopeHint);
    expect(html).toContain(cabinetScopeSummary(["medical"], lang));
  });
  it("shows the localized labels in the staff app", () => {
    expect(staffScopeSummary(["all"], "ru")).toBe("вся информация");
    expect(staffScopeSummary(["medical", "organisational", "financial"], "ru")).toBe("медицинская, организационная, финансовая");
    expect(staffScopeSummary(["financial"], "de")).toBe("finanzielle");
  });
});

describe("trusted persons independent of consent", () => {
  it("accepts an empty list, validates every typed row and matches server normalization", () => {
    expect(trustedPersonsProblem([])).toBeNull();
    expect(trustedPersonsProblem([{ name: "", relation: "", contact: "", scope: "", scopeCodes: [] }])).toBeNull();
    expect(trustedPersonsProblem([friend])).toBeNull();
    expect(trustedPersonsProblem([{ ...friend, relation: "" }])).toBe("invalid");
    expect(trustedPersonsProblem([{ ...friend, name: " " }])).toBe("invalid");
    expect(trustedPersonsProblem([{ ...friend, name: "a".repeat(121) }])).toBe("invalid");
    expect(trustedPersonsProblem([{ ...friend, name: `Eva${" ".repeat(121)}Muster` }])).toBeNull();
    expect(trustedPersonsProblem([{ ...friend, contact: "x".repeat(121) }])).toBe("invalid");
    expect(trustedPersonsProblem(Array.from({ length: 6 }, () => friend))).toBe("invalid");
    expect(recipientsToSend([{ ...friend, name: " Eva   Muster ", contact: " eva@example.com " }])).toEqual([{ name: "Eva Muster", relation: "friend", contact: "eva@example.com", scope_codes: ["medical"] }]);
    expect(recipientDrafts([{ ...stored, contact: null }])).toEqual([friend]);
    expect(samePersons([{ ...stored, contact: null }], [stored])).toBe(true);
    expect(samePersons([stored], [{ ...stored, scope_codes: ["financial"] }])).toBe(false);
  });

  it("does not restore old recipients when the lead explicitly cleared the list", () => {
    const consent_form = { version: "v1", chosen_at: null, choices: NO_CONSENT_FORM_CHOICES, recipients: [stored] };
    expect(storedTrustedPersons({ trusted_persons: [], consent_form })).toEqual([]);
    expect(storedTrustedPersons({ consent_form })).toEqual([stored]);
    expect(storedTrustedPersons({ trusted_persons: [stored] })).toEqual([stored]);
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
    expect(copy.representativeContext("Anna Muster")).toContain("Anna Muster");
    expect(copy.representativeContext("Anna Muster")).toContain("Anna Muster");
    expect(copy.consent("Example Clinic")).toContain("Example Clinic");
    expect(copy.footer).toBeTruthy();
    const html = renderToStaticMarkup(<TrustedPersonsEditor persons={[friend]} lang={lang} onChange={() => undefined} />);
    expect(html).toContain('value="Eva Muster"');
    expect(html).toContain(text.recipientRelations.friend);
    expect(html).toContain("trusted-person-add");
    const list = renderToStaticMarkup(<TrustedPersonsList persons={[{ ...stored, name: "<script>" }, legacyStored]} lang={lang} />);
    expect(list).toContain("&lt;script&gt;");
    expect(list).toContain(cabinetScopeSummary(["medical"], lang));
    expect(list).toContain("medizin");
    expect(list).not.toContain("<input");
  });

  it("limits adding to five and disables editing during a save", () => {
    const html = renderToStaticMarkup(<TrustedPersonsEditor persons={Array.from({ length: 5 }, () => friend)} lang="en" disabled onChange={() => undefined} />);
    expect(html).not.toContain("trusted-person-add");
    // The missing button is explained.
    expect(html).toContain("You can name up to 5 people.");
    expect(html.match(/data-testid="trusted-person-editor"/g)).toHaveLength(5);
    expect(html).toContain('disabled=""');
  });

  it("accepts a phone number or an e-mail address as the contact, nothing else", () => {
    for (const good of ["", "+49 30 1234567", "(030) 123-456", "eva.muster@example.com"]) expect(contactValid(good), good).toBe(true);
    for (const bad of ["abc", "12345", "über Tochter", "eva@", "eva@example", "+49 30 abc 1234"]) expect(contactValid(bad), bad).toBe(false);
    expect(trustedPersonsProblem([{ ...friend, contact: "abc" }])).toBe("invalid");
    expect(recipientProblems({ name: "", relation: "", contact: "abc", scope: "", scopeCodes: [] })).toEqual(["name", "relation", "contact", "scope"]);
    expect(recipientProblems({ ...friend, contact: "+49 151 000000" })).toEqual([]);
  });

  it("marks every missing entry at its field once the step could not be saved", () => {
    const blank = { name: "", relation: "", contact: "", scope: "", scopeCodes: [] } satisfies RecipientDraft;
    const quiet = renderToStaticMarkup(<TrustedPersonsEditor persons={[blank]} lang="de" onChange={() => undefined} />);
    expect(quiet).not.toContain('aria-invalid="true"');
    const html = renderToStaticMarkup(<TrustedPersonsEditor persons={[{ ...blank, contact: "abc" }]} lang="de" showErrors onChange={() => undefined} />);
    const text = trustedPersonsText("de");
    for (const message of [text.nameRequired, text.relationRequired, text.contactInvalid, text.scopeRequired]) expect(html).toContain(message);
    expect(html.match(/aria-invalid="true"/g)?.length).toBeGreaterThanOrEqual(3);
    // An empty extra row beside a complete person is no person: nothing is marked there.
    const extra = renderToStaticMarkup(<TrustedPersonsEditor persons={[friend, blank]} lang="de" showErrors onChange={() => undefined} />);
    expect(extra).not.toContain(text.nameRequired);
  });
});

describe("disclosure consent wording", () => {
  it("lets a parent consent for the child's data and a representative for the represented person's", () => {
    expect(disclosureSubject({ access_kind: "self", minor: false })).toBe("own");
    expect(disclosureSubject({ access_kind: "guardian", minor: true })).toBe("child");
    expect(disclosureSubject({ access_kind: "guardian", minor: false })).toBe("represented");
    for (const lang of ["de", "en", "uk", "ru"]) {
      const own = disclosureConsentText(lang, "GMED", "own");
      expect(own).toBe(trustedPersonsText(lang).consent("GMED"));
      expect(disclosureConsentText(lang, "GMED", "child")).not.toBe(own);
      expect(disclosureConsentText(lang, "GMED", "represented")).not.toBe(own);
    }
    expect(disclosureConsentText("de", "GMED", "child")).toContain("über die personenbezogenen Daten meines Kindes");
    expect(disclosureConsentText("ru", "GMED", "child")).toContain("о персональных данных моего ребёнка");
  });
});

describe("a save that ends while the person keeps typing", () => {
  const baseline: DisclosureDraft = { allowDisclosure: false, consentGiven: false, persons: [] };
  const sent: DisclosureDraft = { allowDisclosure: true, consentGiven: false, persons: [friend] };
  // What the server stored: the person normalized, the consent of this login.
  const fresh: DisclosureDraft = { allowDisclosure: true, consentGiven: true, persons: [{ ...friend, name: "Eva Muster" }] };

  it("takes the server's state when nothing changed meanwhile", () => {
    expect(mergeDisclosureDraft(sent, sent, fresh, baseline)).toEqual(fresh);
  });

  it("keeps a person added during the save and the consent box as it is now", () => {
    const typed: DisclosureDraft = { ...sent, persons: [friend, { ...friend, name: "Max Muster", relation: "spouse" }] };
    const merged = mergeDisclosureDraft(typed, sent, fresh, baseline);
    expect(merged.persons.map((person) => person.name)).toEqual(["Eva Muster", "Max Muster"]);
    // The decision was not touched: the server's value.
    expect(merged.allowDisclosure).toBe(true);
    expect(merged.consentGiven).toBe(true);
    // And the merged draft still differs from the server: another save follows.
    expect(disclosureChanged(merged, { disclosure: { allow_disclosure: true, consent_given: true, version: DISCLOSURE_VERSION, chosen_by: "u1", chosen_at: "", company_name: "GMED" } as never, trusted_persons: [stored] }, "u1")).toBe(true);
  });

  it("keeps a decision changed during the save", () => {
    const typed: DisclosureDraft = { allowDisclosure: false, consentGiven: false, persons: [friend] };
    const merged = mergeDisclosureDraft(typed, sent, fresh, baseline);
    expect(merged.allowDisclosure).toBe(false);
    expect(merged.persons).toEqual(fresh.persons);
  });
});
