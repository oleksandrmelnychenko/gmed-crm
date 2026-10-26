import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CONSENT_RECIPIENT_SCOPES, cabinetScopeSummary, checkedScopeCodes, normalizeScopeCodes, scopeOptionLabel, staffScopeSummary, toggleScopeCode } from "@/lib/consent-recipient-scope";
import { CONSENT_RECIPIENT_RELATIONS, DISCLOSURE_VERSION, NO_CONSENT_FORM_CHOICES, type ConsentRecipient, type LeadRequest } from "./lead-request-api";
import { consentFormText } from "./lead-request-consent-form-text";
import { TrustedPersonsEditor, TrustedPersonsList } from "./lead-trusted-persons-editor";
import { birthDateValid, blankRecipient, contactValid, disclosureChanged, disclosureDraft, disclosureProblem, disclosureToSend, draftIndexOfSent, formatBirthDate, mergeDisclosureDraft, onlyWithdraws, personScope, recipientDrafts, recipientFieldOfServer, recipientProblems, recipientsToSend, requestForLead, samePersons, storedTrustedPersons, trustedPersonsProblem, unchangedStored, type DisclosureDraft, type RecipientDraft } from "./lead-trusted-persons-model";
import { DisclosureStep } from "./lead-request-disclosure-step";
import { leadRequestText } from "./lead-request-text";
import type { StepProps } from "./lead-request-step-forms";
import { disclosureConsentText, disclosureSubject, trustedPersonsText } from "./lead-trusted-persons-text";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "lead-1" } }) }));

// Owner 2026-10-26: a person gives the phone they call from and the date of birth.
const stored = { name: "Eva Muster", relation: "friend", contact: "", phone: "+49 30 5550100", birth_date: "1970-05-06", scope_codes: ["medical"] } satisfies ConsentRecipient;
/** A person typed in the editor (not saved yet). */
const friend = { name: "Eva Muster", relation: "friend", phone: "+49 30 5550100", birthDate: "1970-05-06", contact: "", scope: "", scopeCodes: ["medical"] } satisfies RecipientDraft;
/** The same person as the editor shows it once saved. */
const savedFriend = { ...friend, stored } satisfies RecipientDraft;
const friendSent = { name: "Eva Muster", relation: "friend", contact: null, phone: "+49 30 5550100", birth_date: "1970-05-06", scope_codes: ["medical"] };
const legacyStored = { name: "Eva Muster", relation: "friend", contact: "", scope: "medizin" } satisfies ConsentRecipient;
const legacyFriend = { ...friend, phone: "", birthDate: "", scope: "medizin", scopeCodes: [], stored: legacyStored } satisfies RecipientDraft;

describe("explicit disclosure decision", () => {
  const legacy = { trusted_persons: [stored], consent_form: { version: "v1", chosen_at: null, choices: { ...NO_CONSENT_FORM_CHOICES, named_recipients: true }, recipients: [stored] } };
  it("does not preselect a legacy decision or consent and preserves its draft people", () => {
    const draft = disclosureDraft(legacy);
    expect(draft).toEqual({ allowDisclosure: null, consentGiven: false, persons: [savedFriend] });
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
      persons: [friendSent],
      allow_disclosure: true, consent_given: true, version: "2026-10-14", language: "uk",
    });
  });
  it("asks again for a person with only a legacy free-text scope and then sends codes only", () => {
    const request = { trusted_persons: [legacyStored] };
    const draft = { ...disclosureDraft(request), allowDisclosure: true, consentGiven: true };
    expect(draft.persons).toEqual([legacyFriend]);
    expect(disclosureProblem(draft)).toBe("invalid");
    // Choosing the scope edits the person: the phone and the date of birth are asked too.
    const scoped = { ...draft, persons: [{ ...legacyFriend, scopeCodes: toggleScopeCode([], "medical") }] };
    expect(disclosureProblem(scoped)).toBe("invalid");
    const chosen = { ...draft, persons: [{ ...scoped.persons[0], phone: "+49 30 5550100", birthDate: "1970-05-06" }] };
    expect(disclosureProblem(chosen)).toBeNull();
    expect(disclosureToSend(chosen, "de").persons).toEqual([friendSent]);
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
    expect(trustedPersonsProblem([blankRecipient()])).toBeNull();
    expect(trustedPersonsProblem([friend])).toBeNull();
    expect(trustedPersonsProblem([{ ...friend, relation: "" }])).toBe("invalid");
    expect(trustedPersonsProblem([{ ...friend, name: " " }])).toBe("invalid");
    expect(trustedPersonsProblem([{ ...friend, name: "a".repeat(121) }])).toBe("invalid");
    expect(trustedPersonsProblem([{ ...friend, name: `Eva${" ".repeat(121)}Muster` }])).toBeNull();
    expect(trustedPersonsProblem([{ ...friend, phone: "1".repeat(41) }])).toBe("invalid");
    expect(trustedPersonsProblem(Array.from({ length: 6 }, () => friend))).toBe("invalid");
    expect(recipientsToSend([{ ...friend, name: " Eva   Muster ", phone: " +49  30 5550100 " }])).toEqual([friendSent]);
    expect(recipientDrafts([{ ...stored, contact: null }])).toEqual([{ ...friend, stored: { ...stored, contact: null } }]);
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
    // Staff and the person read the date of birth and the phone the person calls from.
    expect(list).toContain("06.05.1970");
    expect(list).toContain("+49 30 5550100");
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

  it("accepts a legacy contact only as a phone number or an e-mail address", () => {
    for (const good of ["", "+49 30 1234567", "(030) 123-456", "eva.muster@example.com"]) expect(contactValid(good), good).toBe(true);
    for (const bad of ["abc", "12345", "über Tochter", "eva@", "eva@example", "+49 30 abc 1234"]) expect(contactValid(bad), bad).toBe(false);
    expect(recipientProblems({ ...blankRecipient(), contact: "abc" })).toEqual(["name", "relation", "phone", "birth_date", "scope"]);
    expect(recipientProblems(friend)).toEqual([]);
  });

  it("requires the phone the person calls from and the date of birth, not of an institution (owner 2026-10-26)", () => {
    const today = "2026-10-26";
    expect(recipientProblems({ ...friend, phone: "" }, today)).toEqual(["phone"]);
    expect(recipientProblems({ ...friend, phone: "12-34" }, today)).toEqual(["phone"]);
    expect(recipientProblems({ ...friend, phone: "+49 30 abc 1234" }, today)).toEqual(["phone"]);
    expect(recipientProblems({ ...friend, birthDate: "" }, today)).toEqual(["birth_date"]);
    expect(recipientProblems({ ...friend, birthDate: "2026-10-27" }, today)).toEqual(["birth_date"]);
    expect(recipientProblems({ ...friend, birthDate: "1899-12-31" }, today)).toEqual(["birth_date"]);
    expect(recipientProblems({ ...friend, birthDate: "2026-02-30" }, today)).toEqual(["birth_date"]);
    expect(birthDateValid("2026-10-26", today)).toBe(true);
    expect(formatBirthDate("1970-05-06")).toBe("06.05.1970");
    expect(formatBirthDate("06.05.1970")).toBe("");
    for (const relation of ["family_doctor", "clinic"] as const) {
      const institution = { ...friend, name: "Praxis Dr. Beispiel", relation, birthDate: "1990-01-01" };
      expect(recipientProblems({ ...institution, birthDate: "" }, today)).toEqual([]);
      // The institution's date of birth is never sent.
      expect(recipientsToSend([institution])[0].birth_date).toBeNull();
      expect(recipientProblems({ ...institution, phone: "" }, today)).toEqual(["phone"]);
    }
  });

  it("keeps a saved person's old contact until the person is edited", () => {
    const oma = { name: "Oma Lena", relation: "relative", contact: "oma@example.test", scope_codes: ["medical"] } satisfies ConsentRecipient;
    const [shown] = recipientDrafts([oma]);
    expect(unchangedStored(shown)).toBe(oma);
    expect(recipientProblems(shown)).toEqual([]);
    // Unchanged: sent back exactly as stored, the old contact included.
    expect(recipientsToSend([shown])).toEqual([{ name: "Oma Lena", relation: "relative", contact: "oma@example.test", phone: null, birth_date: null, scope_codes: ["medical"] }]);
    const html = renderToStaticMarkup(<TrustedPersonsEditor persons={[shown]} lang="de" onChange={() => undefined} />);
    expect(html).toContain("trusted-person-legacy-contact");
    expect(html).toContain("oma@example.test");
    // Edited: the phone and the date of birth are asked, the old contact goes.
    const edited = { ...shown, scopeCodes: ["all"] } satisfies RecipientDraft;
    expect(unchangedStored(edited)).toBeNull();
    expect(recipientProblems(edited)).toEqual(["phone", "birth_date"]);
    const completed = { ...edited, phone: "+49 30 5550101", birthDate: "1950-01-02" };
    expect(recipientsToSend([completed])).toEqual([{ name: "Oma Lena", relation: "relative", contact: null, phone: "+49 30 5550101", birth_date: "1950-01-02", scope_codes: ["all"] }]);
    expect(renderToStaticMarkup(<TrustedPersonsEditor persons={[edited]} lang="de" onChange={() => undefined} />)).not.toContain("trusted-person-legacy-contact");
    // An old contact the server no longer accepts is not sent back: the person is asked again.
    const [invalid] = recipientDrafts([{ ...oma, contact: "über Tochter" }]);
    expect(recipientProblems(invalid)).toEqual(["phone", "birth_date"]);
  });

  it("maps the server's refused field and person to the editor row", () => {
    const drafts = [friend, blankRecipient(), { ...friend, name: "Max" }];
    expect(draftIndexOfSent(drafts, 0)).toBe(0);
    expect(draftIndexOfSent(drafts, 1)).toBe(2);
    expect(draftIndexOfSent(drafts, 2)).toBeNull();
    expect(draftIndexOfSent(drafts, undefined)).toBeNull();
    expect(recipientFieldOfServer("phone")).toBe("phone");
    expect(recipientFieldOfServer("contact")).toBe("phone");
    expect(recipientFieldOfServer("birth_date")).toBe("birth_date");
    expect(recipientFieldOfServer("scope_codes")).toBe("scope");
    expect(recipientFieldOfServer("persons")).toBeNull();
    const html = renderToStaticMarkup(<TrustedPersonsEditor persons={drafts} lang="de" serverProblem={{ index: 2, field: "birth_date" }} onChange={() => undefined} />);
    expect(html).toContain('id="trusted-person-birth_date-2-error"');
    expect(html).toContain(trustedPersonsText("de").birthDateRequired);
  });

  it.each(["de", "en", "uk", "ru"])("renders the phone with its (i) explanation, the date of birth and the scope checkboxes in %s", (lang) => {
    const copy = trustedPersonsText(lang);
    for (const key of ["phone", "phoneInfo", "phoneInfoLabel", "phoneRequired", "birthDate", "birthDateRequired", "withdraw", "removePerson", "lockedDecision"] as const) expect(copy[key]).toBeTruthy();
    const html = renderToStaticMarkup(<TrustedPersonsEditor persons={[{ ...friend, scopeCodes: ["all"] }]} lang={lang} onChange={() => undefined} />);
    expect(html).toContain(copy.phone);
    expect(html).toContain('data-testid="trusted-person-phone-info"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="' + copy.phoneInfoLabel + '"');
    expect(html).toContain('data-testid="trusted-person-birth-date"');
    expect(html).toContain('type="tel"');
    for (const code of CONSENT_RECIPIENT_SCOPES) {
      expect(html).toContain('data-testid="trusted-person-scope-' + code + '"');
      expect(html).toContain(scopeOptionLabel(code, lang));
    }
    // "All" ticks every option.
    expect(html.match(/type="checkbox"[^>]*checked=""/g)).toHaveLength(CONSENT_RECIPIENT_SCOPES.length);
    // An institution has no date of birth.
    const clinic = renderToStaticMarkup(<TrustedPersonsEditor persons={[{ ...friend, relation: "clinic" }]} lang={lang} onChange={() => undefined} />);
    expect(clinic).not.toContain('data-testid="trusted-person-birth-date"');
    expect(clinic.match(/type="checkbox"[^>]*checked=""/g)).toHaveLength(1);
  });

  it("after the send only withdraws: no for everybody, or fewer saved persons", () => {
    const request = { trusted_persons: [stored, { ...stored, name: "Max Muster" }] };
    const saved = disclosureDraft(request);
    expect(onlyWithdraws({ ...saved, allowDisclosure: true }, request)).toBe(true);
    expect(onlyWithdraws({ ...saved, allowDisclosure: false, persons: [] }, request)).toBe(true);
    expect(onlyWithdraws({ ...saved, allowDisclosure: true, persons: [saved.persons[1]] }, request)).toBe(true);
    expect(onlyWithdraws({ ...saved, allowDisclosure: true, persons: [...saved.persons, { ...friend, name: "Neu" }] }, request)).toBe(false);
    expect(onlyWithdraws({ ...saved, allowDisclosure: true, persons: [{ ...saved.persons[0], phone: "+49 30 999999" }] }, request)).toBe(false);
  });

  it("marks every missing entry at its field once the step could not be saved", () => {
    const blank = blankRecipient();
    const quiet = renderToStaticMarkup(<TrustedPersonsEditor persons={[blank]} lang="de" onChange={() => undefined} />);
    expect(quiet).not.toContain('aria-invalid="true"');
    const html = renderToStaticMarkup(<TrustedPersonsEditor persons={[{ ...blank, phone: "abc" }]} lang="de" showErrors onChange={() => undefined} />);
    const text = trustedPersonsText("de");
    for (const message of [text.nameRequired, text.relationRequired, text.phoneRequired, text.birthDateRequired, text.scopeRequired]) expect(html).toContain(message);
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

describe("the disclosure step after the request is sent (owner 2026-10-26)", () => {
  const step = (request: Partial<LeadRequest>) => {
    const common = { ...leadRequestText("de"), sentLockedHint: "Ihre Anfrage ist bei GMED." } as StepProps["text"];
    const props: StepProps = {
      request: { lead_id: "lead-a", access_kind: "self", minor: false, personal_data: { first_name: "Anna", last_name: "Muster" }, ...request } as LeadRequest,
      text: common, lang: "de", enqueue: (task) => task(), onChange: () => undefined, missing: [],
      nav: { index: 5, total: 7, onBack: () => undefined, onNext: () => undefined, missingShown: false, onShowMissing: () => undefined },
    };
    return renderToStaticMarkup(<DisclosureStep {...props} />);
  };
  const disclosure = { allow_disclosure: true, consent_given: true, version: DISCLOSURE_VERSION, language: "de", chosen_at: "2026-10-20T08:00:00Z", chosen_by: "lead-1", access_kind: "self" as const, company_name: "GMED" };

  it("shows the decision read-only; changes and withdrawals only via GMED (owner 2026-10-26)", () => {
    const html = step({ submitted_at: "2026-10-21T08:00:00Z", disclosure, trusted_persons: [stored, { ...stored, name: "Max Muster" }] });
    expect(html).toContain('data-testid="disclosure-locked-hint"');
    expect(html).toContain("Ihre Anfrage ist bei GMED.");
    expect(html).not.toContain('data-testid="disclosure-withdraw"');
    expect(html).not.toContain('data-testid="trusted-person-remove"');
    expect(html).toContain("über Ihren Kontakt bei GMED");
    expect(html).toContain("06.05.1970");
    expect(html).not.toContain('data-testid="trusted-persons-editor"');
    expect(html).not.toContain('data-testid="trusted-person-add"');
    expect(html).not.toContain('data-testid="disclosure-yes"');
  });

  it("offers nothing to withdraw after a No, and edits as before until the send", () => {
    const no = step({ submitted_at: "2026-10-21T08:00:00Z", disclosure: { ...disclosure, allow_disclosure: false, consent_given: false }, trusted_persons: [] });
    expect(no).toContain('data-testid="disclosure-locked-decision"');
    expect(no).not.toContain('data-testid="disclosure-withdraw"');
    const open = step({ submitted_at: null, disclosure, trusted_persons: [stored] });
    expect(open).not.toContain('data-testid="disclosure-locked-hint"');
    expect(open).toContain('data-testid="trusted-persons-editor"');
  });
});
