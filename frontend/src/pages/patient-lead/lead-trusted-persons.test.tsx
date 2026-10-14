import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONSENT_RECIPIENT_RELATIONS, NO_CONSENT_FORM_CHOICES, type LeadRequest } from "./lead-request-api";
import { consentFormText } from "./lead-request-consent-form-text";
import { TrustedPersonsEditor, TrustedPersonsList } from "./lead-trusted-persons-editor";
import { recipientDrafts, recipientsToSend, requestForLead, samePersons, storedTrustedPersons, trustedPersonsProblem, type RecipientDraft } from "./lead-trusted-persons-model";
import { trustedPersonsText } from "./lead-trusted-persons-text";

const friend = { name: "Eva Muster", relation: "friend", contact: "" } satisfies RecipientDraft;

describe("trusted persons independent of consent", () => {
  it("accepts an empty list, validates every typed row and matches server normalization", () => {
    expect(trustedPersonsProblem([])).toBeNull();
    expect(trustedPersonsProblem([{ name: "", relation: "", contact: "" }])).toBeNull();
    expect(trustedPersonsProblem([friend])).toBeNull();
    expect(trustedPersonsProblem([{ ...friend, relation: "" }])).toBe("invalid");
    expect(trustedPersonsProblem([{ ...friend, name: " " }])).toBe("invalid");
    expect(trustedPersonsProblem([{ ...friend, name: "a".repeat(121) }])).toBe("invalid");
    expect(trustedPersonsProblem([{ ...friend, name: `Eva${" ".repeat(121)}Muster` }])).toBeNull();
    expect(trustedPersonsProblem([{ ...friend, contact: "x".repeat(121) }])).toBe("invalid");
    expect(trustedPersonsProblem(Array.from({ length: 6 }, () => friend))).toBe("invalid");
    expect(recipientsToSend([{ ...friend, name: " Eva   Muster ", contact: " eva@example.com " }])).toEqual([{ name: "Eva Muster", relation: "friend", contact: "eva@example.com" }]);
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
    expect(copy.childIntroduction).not.toBe(copy.introduction);
    expect(copy.removeAllHint).toBeTruthy();
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
