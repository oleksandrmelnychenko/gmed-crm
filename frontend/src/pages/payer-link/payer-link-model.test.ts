import { describe, expect, it } from "vitest";

import type { PayerAnswers, PayerQuestionnaire, PayerType } from "./payer-link-api";
import {
  FUNDS_SOURCES,
  ORGANISATION_MISSING_ORDER,
  PERSON_MISSING_ORDER,
  answersPatch,
  draftFromQuestionnaire,
  emptyOwner,
  fieldOfPayerType,
  fundsSourceOptions,
  missingByStep,
  ownerProblems,
  ownersPayload,
  parseShare,
  payerSteps,
  reconcileDraft,
  refusedField,
  requiredFields,
  sortMissing,
  stepOfMissing,
  stillRejected,
  withFundsSource,
  withLegalAnswer,
  withOwnersNone,
  withRejectedField,
  withRelationshipKind,
  type PayerDraft,
} from "./payer-link-model";
import {
  LINK_STORAGE_KEY,
  PayerSecrets,
  SESSION_STORAGE_KEY,
  captureLinkToken,
  codeDigits,
  codeErrorMessage,
  codeProblemMessage,
  isFatalKind,
  linkTokenFromHash,
  payerErrorKind,
  payerErrorMessage,
  resendAllowedAt,
  secondsLeft,
  type CodeProblem,
  type StorageLike,
} from "./payer-link-session";
import { missingLabels, payerLinkText } from "./payer-link-text";

const TOKEN = "a".repeat(64);
const OTHER_TOKEN = "b".repeat(64);

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

/** Session storage of a private window or blocked site data: every call throws. */
const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

function emptyAnswers(): PayerAnswers {
  return {
    salutation: null,
    first_name: null,
    last_name: null,
    former_names: null,
    date_of_birth: null,
    birth_place: null,
    birth_country: null,
    citizenships: [],
    street: null,
    zip: null,
    city: null,
    country: null,
    habitual_residence_country: null,
    phone: null,
    language: null,
    id_document_type: null,
    id_document_number: null,
    id_issuing_authority: null,
    id_issuing_country: null,
    id_issued_on: null,
    id_valid_until: null,
    organisation_name: null,
    register_court: null,
    register_number: null,
    representative_first_name: null,
    representative_last_name: null,
    representative_role: null,
    beneficial_owners: [],
    beneficial_owners_none: null,
    relationship_kind: null,
    relationship: null,
    occupation: null,
    industry: null,
    funds_sources: [],
    funds_description: null,
    pep_self: null,
    pep_self_details: null,
    pep_related: null,
    pep_related_details: null,
    high_risk_country: null,
    high_risk_country_code: null,
    sanctions_links: null,
    sanctions_links_details: null,
  };
}

function questionnaire(payerType: PayerType = "person", answers: Partial<PayerAnswers> = {}, asked = true): PayerQuestionnaire {
  return {
    patient_name: "Mia Muster",
    source: "link",
    payer_type: payerType,
    state: "draft",
    email: "viktor.zahler@example.com",
    email_confirmed_at: "2026-10-06T10:02:00Z",
    privacy: { acknowledged_at: "2026-10-06T10:03:00Z", text_version: "payer-privacy-2026-10-06", contact_channels: ["email"] },
    answers: { ...emptyAnswers(), ...answers },
    payment_route: {
      payment_method: null,
      payment_method_details: null,
      account_country: null,
      account_holder: null,
      bank_name: null,
      via_third_party: null,
      via_third_party_details: null,
      account_holder_suggestion: "Viktor Zahler",
      asked,
    },
    identity_documents: [],
    funds_proof_documents: [],
    funds_proof_required: false,
    missing_for_submit: [],
    declared_correct_at: null,
    submitted_at: null,
  };
}

const person = { payerType: "person" as const, routeAsked: true };
const company = { payerType: "company" as const, routeAsked: true };

describe("link token and session in the tab", () => {
  it("keeps the token of the fragment and drops the session of another link", () => {
    const storage = memoryStorage();
    const secrets = new PayerSecrets(storage);
    secrets.set(LINK_STORAGE_KEY, OTHER_TOKEN);
    secrets.set(SESSION_STORAGE_KEY, "session-of-the-old-link");

    expect(captureLinkToken(`#${TOKEN}`, secrets)).toBe(TOKEN);
    expect(storage.data.get(LINK_STORAGE_KEY)).toBe(TOKEN);
    expect(storage.data.has(SESSION_STORAGE_KEY)).toBe(false);
    expect(secrets.get(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("keeps the session when the same link is opened again, and uses the stored token without a fragment", () => {
    const storage = memoryStorage();
    storage.data.set(LINK_STORAGE_KEY, TOKEN);
    storage.data.set(SESSION_STORAGE_KEY, "s".repeat(64));
    const secrets = new PayerSecrets(storage);

    expect(captureLinkToken(`#${TOKEN}`, secrets)).toBe(TOKEN);
    expect(secrets.get(SESSION_STORAGE_KEY)).toBe("s".repeat(64));
    // After the address was replaced by /payer (a reload, strict mode's second render).
    expect(captureLinkToken("", secrets)).toBe(TOKEN);
  });

  it("treats a cut-off or foreign fragment as an incomplete link", () => {
    const secrets = new PayerSecrets(memoryStorage());
    expect(captureLinkToken("#abc", secrets)).toBeNull();
    expect(captureLinkToken("#privacy", secrets)).toBeNull();
    expect(secrets.get(LINK_STORAGE_KEY)).toBeNull();
    expect(captureLinkToken("", secrets)).toBeNull();
    expect(linkTokenFromHash(`#${TOKEN.toUpperCase()}`)).toBe(TOKEN.toUpperCase());
    expect(linkTokenFromHash(`#${TOKEN}x`)).toBeNull();
  });

  it("works from memory when the session storage throws", () => {
    const secrets = new PayerSecrets(throwingStorage);
    expect(() => captureLinkToken(`#${TOKEN}`, secrets)).not.toThrow();
    expect(captureLinkToken("", secrets)).toBe(TOKEN);
    secrets.set(SESSION_STORAGE_KEY, "session");
    expect(secrets.get(SESSION_STORAGE_KEY)).toBe("session");
    secrets.set(SESSION_STORAGE_KEY, null);
    expect(secrets.get(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("works without any storage at all", () => {
    const secrets = new PayerSecrets(null);
    secrets.set(LINK_STORAGE_KEY, TOKEN);
    expect(secrets.get(LINK_STORAGE_KEY)).toBe(TOKEN);
  });

  it("prefers what this page set over an older stored value", () => {
    const storage = memoryStorage();
    storage.data.set(SESSION_STORAGE_KEY, "old");
    const secrets = new PayerSecrets({ ...storage, removeItem: () => { throw new Error("blocked"); } });
    secrets.set(SESSION_STORAGE_KEY, null);
    expect(secrets.get(SESSION_STORAGE_KEY)).toBeNull();
  });
});

describe("error codes", () => {
  const de = payerLinkText("de");

  it("maps every code of the contract to what the page does", () => {
    expect(payerErrorKind(401, "link_invalid")).toBe("link_invalid");
    expect(payerErrorKind(410, "link_revoked")).toBe("link_revoked");
    expect(payerErrorKind(410, "link_expired")).toBe("link_expired");
    expect(payerErrorKind(423, "link_locked")).toBe("link_locked");
    expect(payerErrorKind(401, "session_required")).toBe("session");
    expect(payerErrorKind(401, "session_expired")).toBe("session");
    expect(payerErrorKind(403, "payer_consent_required")).toBe("consent_required");
    expect(payerErrorKind(409, "payer_submitted")).toBe("submitted");
    expect(payerErrorKind(429, "code_rate_limited")).toBe("rate_limited");
    expect(payerErrorKind(503, "mail_unavailable")).toBe("mail_failed");
    expect(payerErrorKind(502, "mail_rejected")).toBe("mail_failed");
    expect(payerErrorKind(0, "network")).toBe("network");
    // Without a code the status decides.
    expect(payerErrorKind(410, "")).toBe("link_revoked");
    expect(payerErrorKind(423, "")).toBe("link_locked");
    expect(payerErrorKind(401, "")).toBe("link_invalid");
    expect(payerErrorKind(429, "")).toBe("rate_limited");
    expect(payerErrorKind(500, "")).toBe("other");
  });

  it("treats only the dead link as final", () => {
    for (const kind of ["link_incomplete", "link_invalid", "link_revoked", "link_expired", "link_locked"] as const) {
      expect(isFatalKind(kind)).toBe(true);
    }
    for (const kind of ["session", "consent_required", "submitted", "rate_limited", "mail_failed", "network", "other"] as const) {
      expect(isFatalKind(kind)).toBe(false);
    }
  });

  it("gives one clear message per case", () => {
    expect(payerErrorMessage(payerErrorKind(410, "link_revoked"), de)).toBe(
      "Dieser Link ist nicht mehr gültig. Bitte wenden Sie sich an GMED.",
    );
    expect(payerErrorMessage(payerErrorKind(410, "link_expired"), de)).toBe(de.linkExpired);
    expect(payerErrorMessage(payerErrorKind(423, "link_locked"), de)).toBe(de.linkLocked);
    expect(payerErrorMessage(payerErrorKind(401, "link_invalid"), de)).toBe(de.linkInvalid);
    expect(payerErrorMessage("link_incomplete", de)).toMatch(/^Dieser Link ist unvollständig/);
    expect(payerErrorMessage(payerErrorKind(401, "session_expired"), de)).toBe(de.sessionExpired);
    expect(payerErrorMessage(payerErrorKind(403, "payer_consent_required"), de)).toBe(de.privacyFirst);
    expect(payerErrorMessage(payerErrorKind(0, "network"), de)).toBe(de.networkError);
    expect(payerErrorMessage(payerErrorKind(500, ""), de)).toBe(de.unexpectedError);
    const messages = new Set(
      (["link_incomplete", "link_invalid", "link_revoked", "link_expired", "link_locked"] as const).map((kind) => payerErrorMessage(kind, de)),
    );
    expect(messages.size).toBe(5);
  });

  it("words the refusals of the code with their numbers", () => {
    expect(codeErrorMessage(422, "code_invalid", { attempts_left: 3 }, de)).toBe("Der Code ist nicht richtig. Sie haben noch 3 Versuche.");
    expect(codeErrorMessage(422, "code_invalid", { attempts_left: 1 }, de)).toBe("Der Code ist nicht richtig. Sie haben noch einen Versuch.");
    expect(codeErrorMessage(422, "code_invalid", {}, de)).toBe("Der Code ist nicht richtig.");
    expect(codeErrorMessage(422, "code_expired", {}, de)).toBe(de.codeExpired);
    expect(codeErrorMessage(429, "code_rate_limited", { retry_after_seconds: 42 }, de)).toBe(
      "Bitte warten Sie 42 s, bevor Sie einen neuen Code anfordern.",
    );
    expect(codeErrorMessage(503, "mail_not_configured", {}, de)).toBe(de.mailFailed);
    expect(codeErrorMessage(423, "link_locked", {}, de)).toBe(de.linkLocked);
  });

  it("tells a code used up by wrong entries from one that expired", () => {
    expect(codeErrorMessage(422, "code_expired", { reason: "too_many_attempts" }, de)).toBe(
      "Zu viele Fehlversuche. Bitte fordern Sie einen neuen Code an.",
    );
    expect(codeErrorMessage(422, "code_expired", { reason: "expired" }, de)).toBe(
      "Der Code ist abgelaufen. Bitte fordern Sie einen neuen Code an.",
    );
    // An older server says no reason: the code reads as expired.
    expect(codeErrorMessage(422, "code_expired", {}, de)).toBe(de.codeExpired);
    for (const lang of ["en", "uk", "ru"]) {
      const text = payerLinkText(lang);
      expect(codeErrorMessage(422, "code_expired", { reason: "too_many_attempts" }, text)).toBe(text.codeTooManyAttempts);
      expect(text.codeTooManyAttempts).not.toBe(text.codeExpired);
    }
  });

  it("writes a problem of the code step in the language shown when it is read", () => {
    const wrong: CodeProblem = { kind: "refused", status: 422, code: "code_invalid", body: { attempts_left: 4 } };
    expect(codeProblemMessage(wrong, de)).toBe("Der Code ist nicht richtig. Sie haben noch 4 Versuche.");
    expect(codeProblemMessage(wrong, payerLinkText("en"))).toBe(payerLinkText("en").codeInvalid(4));
    expect(codeProblemMessage(wrong, payerLinkText("ru"))).toBe("Код неверный. Осталось попыток: 4.");
    expect(codeProblemMessage({ kind: "format" }, payerLinkText("uk"))).toBe(payerLinkText("uk").codeFormat);
  });

  it("never puts the token or the code into a message", () => {
    const body = { attempts_left: 2, code: "123456", token: TOKEN };
    for (const lang of ["de", "en", "uk", "ru"]) {
      const message = codeErrorMessage(422, "code_invalid", body, payerLinkText(lang));
      expect(message).not.toContain("123456");
      expect(message).not.toContain(TOKEN);
    }
  });
});

describe("what is missing", () => {
  it("orders the keys of a private person as the form asks them", () => {
    const shuffled = ["pep_self", "funds_proof_upload", "privacy_ack", "citizenships", "payment_method", "id_document_upload", "first_name"];
    expect(sortMissing(shuffled, "person")).toEqual([
      "privacy_ack",
      "first_name",
      "citizenships",
      "id_document_upload",
      "funds_proof_upload",
      "payment_method",
      "pep_self",
    ]);
  });

  it("names the keys in the language of the page, in order, for a person", () => {
    const de = payerLinkText("de");
    const missing = ["sanctions_links", "birth_place", "privacy_ack", "id_document_upload", "relationship", "funds_proof_upload", "via_third_party"];
    expect(missingLabels(de, missing, "person")).toEqual([
      "Bestätigung der Datenschutzhinweise",
      "Geburtsort",
      "Foto oder Scan des Ausweises",
      "Beziehung: nähere Angabe",
      "Nachweis der Herkunft der Mittel",
      "Zahlung über Dritte",
      "Sanktionen",
    ]);
    expect(missingLabels(payerLinkText("en"), ["birth_place", "privacy_ack"], "person")).toEqual([
      "Confirmation of the privacy information",
      "Place of birth",
    ]);
  });

  it("names the keys of a company: the seat, the register, the representative, the owners", () => {
    const de = payerLinkText("de");
    const missing = ["industry", "beneficial_owners", "representative_last_name", "street", "organisation_name", "register_number", "privacy_ack"];
    expect(sortMissing(missing, "company")).toEqual([
      "privacy_ack",
      "organisation_name",
      "street",
      "register_number",
      "representative_last_name",
      "beneficial_owners",
      "industry",
    ]);
    expect(missingLabels(de, missing, "company")).toEqual([
      "Bestätigung der Datenschutzhinweise",
      "Firma",
      "Sitz: Straße und Hausnummer",
      "Registernummer",
      "Gesetzliche/r Vertreter/in: Nachname",
      "Wirtschaftlich Berechtigte",
      "Branche",
    ]);
    expect(missingLabels(de, ["organisation_name"], "insurance")).toEqual(["Name der Versicherung"]);
  });

  it("puts unknown keys last under a general label, each once", () => {
    const de = payerLinkText("de");
    expect(sortMissing(["something_new", "first_name", "first_name"], "person")).toEqual(["first_name", "something_new"]);
    expect(missingLabels(de, ["something_new", "other_new"], "person")).toEqual(["Weitere Angaben"]);
  });

  it("follows the contract's order for both payer types", () => {
    expect(PERSON_MISSING_ORDER.slice(0, 3)).toEqual(["privacy_ack", "first_name", "last_name"]);
    expect(PERSON_MISSING_ORDER.indexOf("occupation")).toBeLessThan(PERSON_MISSING_ORDER.indexOf("funds_sources"));
    expect(PERSON_MISSING_ORDER.indexOf("funds_proof_upload")).toBeLessThan(PERSON_MISSING_ORDER.indexOf("payment_method"));
    expect(PERSON_MISSING_ORDER.indexOf("via_third_party_details")).toBeLessThan(PERSON_MISSING_ORDER.indexOf("pep_self"));
    expect(PERSON_MISSING_ORDER.at(-1)).toBe("sanctions_links_details");
    expect(ORGANISATION_MISSING_ORDER.indexOf("id_document_upload")).toBeLessThan(ORGANISATION_MISSING_ORDER.indexOf("beneficial_owners"));
    expect(ORGANISATION_MISSING_ORDER.indexOf("beneficial_owners")).toBeLessThan(ORGANISATION_MISSING_ORDER.indexOf("relationship_kind"));
    expect(ORGANISATION_MISSING_ORDER.indexOf("relationship")).toBeLessThan(ORGANISATION_MISSING_ORDER.indexOf("industry"));
    expect(ORGANISATION_MISSING_ORDER).not.toContain("first_name");
    expect(PERSON_MISSING_ORDER).not.toContain("organisation_name");
  });

  it("groups the missing keys by the step that asks them", () => {
    const steps = payerSteps("company", true);
    expect(missingByStep(["pep_self", "beneficial_owners", "street", "privacy_ack", "bank_name", "odd_key"], "company", steps)).toEqual([
      { step: "privacy", keys: ["privacy_ack"] },
      { step: "details", keys: ["street"] },
      { step: "owners", keys: ["beneficial_owners"] },
      { step: "payment", keys: ["bank_name"] },
      { step: "declarations", keys: ["pep_self"] },
      { step: "summary", keys: ["odd_key"] },
    ]);
    expect(stepOfMissing("funds_proof_upload")).toBe("funds");
    expect(stepOfMissing("id_valid_until")).toBe("identity");
    expect(stepOfMissing("habitual_residence_country")).toBe("details");
  });

  it("marks as required what can be missing, the register and the owners for a company only", () => {
    expect(requiredFields("person").has("birth_place")).toBe(true);
    expect(requiredFields("person").has("phone")).toBe(false);
    expect(requiredFields("person").has("id_issued_on")).toBe(false);
    expect(requiredFields("company").has("register_number")).toBe(true);
    expect(requiredFields("company").has("beneficial_owners")).toBe(true);
    expect(requiredFields("organisation").has("register_number")).toBe(false);
    expect(requiredFields("insurance").has("beneficial_owners")).toBe(false);
  });
});

describe("steps", () => {
  it("asks the beneficial owners of organisations only, and the payment route only when the payer answers it", () => {
    expect(payerSteps("person", true)).toEqual(["privacy", "details", "identity", "funds", "payment", "declarations", "summary"]);
    expect(payerSteps("company", true)).toEqual(["privacy", "details", "identity", "owners", "funds", "payment", "declarations", "summary"]);
    expect(payerSteps("insurance", false)).toEqual(["privacy", "details", "identity", "owners", "funds", "declarations", "summary"]);
  });
});

describe("autosave body", () => {
  it("sends only the changed keys, a cleared text as an empty string and answers as booleans", () => {
    const saved = draftFromQuestionnaire(questionnaire("person", { first_name: "Viktor", last_name: "Zahler", birth_place: "Wien" }));
    const draft: PayerDraft = {
      ...saved,
      birth_place: "",
      date_of_birth: "1970-02-03",
      citizenships: ["AT", "DE"],
      pep_self: "no",
      sanctions_links: "yes",
      sanctions_links_details: "  Beispiel GmbH  ",
      funds_sources: ["savings"],
      first_name: "  Viktor  ",
    };
    expect(answersPatch(saved, draft, person)).toEqual({
      date_of_birth: "1970-02-03",
      birth_place: "",
      citizenships: ["AT", "DE"],
      funds_sources: ["savings"],
      pep_self: false,
      sanctions_links: true,
      sanctions_links_details: "Beispiel GmbH",
    });
  });

  it("sends nothing of the other payer type and section 8 only when it is asked", () => {
    const saved = draftFromQuestionnaire(questionnaire("person"));
    const draft: PayerDraft = { ...saved, organisation_name: "Beispiel GmbH", industry: "Handel", occupation: "Ingenieur", payment_method: "bank_transfer" };
    expect(answersPatch(saved, draft, person)).toEqual({ occupation: "Ingenieur", payment_method: "bank_transfer" });
    expect(answersPatch(saved, draft, { payerType: "person", routeAsked: false })).toEqual({ occupation: "Ingenieur" });
    expect(answersPatch(saved, draft, company)).toEqual({ organisation_name: "Beispiel GmbH", industry: "Handel", payment_method: "bank_transfer" });
    expect(fieldOfPayerType("citizenships", "company")).toBe(false);
    expect(fieldOfPayerType("register_court", "person")).toBe(false);
    expect(fieldOfPayerType("street", "insurance")).toBe(true);
  });

  it("sends block E of an organisation: legal form, VAT id and why it pays", () => {
    const saved = draftFromQuestionnaire(questionnaire("company", { legal_form: null, vat_id: null, payment_reason: null }));
    const draft: PayerDraft = {
      ...saved,
      legal_form: " GmbH ",
      vat_id: "DE123456789",
      payment_reason: " Betriebliche\nGesundheitsvorsorge ",
    };
    expect(answersPatch(saved, draft, company)).toEqual({
      legal_form: "GmbH",
      vat_id: "DE123456789",
      payment_reason: "Betriebliche\nGesundheitsvorsorge",
    });
    // A person has no block E; a server without it never gets the keys unless typed.
    expect(fieldOfPayerType("legal_form", "person")).toBe(false);
    expect(fieldOfPayerType("payment_reason", "insurance")).toBe(true);
    expect(answersPatch(draftFromQuestionnaire(questionnaire("company")), draftFromQuestionnaire(questionnaire("company")), company)).toEqual({});
    // Legal form and reason are needed, the VAT id is not; the reason is asked with the relationship.
    expect(requiredFields("company").has("legal_form")).toBe(true);
    expect(requiredFields("company").has("payment_reason")).toBe(true);
    expect(requiredFields("company").has("vat_id")).toBe(false);
    expect(stepOfMissing("payment_reason")).toBe("funds");
    expect(stepOfMissing("legal_form")).toBe("details");
    expect(sortMissing(["payment_reason", "vat_id", "legal_form", "organisation_name"], "company")).toEqual([
      "organisation_name",
      "legal_form",
      "vat_id",
      "payment_reason",
    ]);
  });

  it("sends the payment through a third party as a boolean, cleared as null", () => {
    const saved = draftFromQuestionnaire(questionnaire("person"));
    expect(answersPatch(saved, { ...saved, via_third_party: "no" }, person)).toEqual({ via_third_party: false });
    const answered = { ...saved, via_third_party: "yes" };
    expect(answersPatch(answered, { ...answered, via_third_party: "" }, person)).toEqual({ via_third_party: null });
  });

  it("does not repeat a refused value until it is changed", () => {
    const saved = draftFromQuestionnaire(questionnaire("person"));
    const draft = { ...saved, id_valid_until: "2020-01-01", id_document_number: "X1" };
    const rejected = withRejectedField({}, "id_valid_until", draft);
    expect(rejected).toEqual({ id_valid_until: "2020-01-01" });
    expect(answersPatch(saved, draft, person, rejected ?? {})).toEqual({ id_document_number: "X1" });
    const changed = { ...draft, id_valid_until: "2031-03-04" };
    expect(stillRejected(rejected ?? {}, changed)).toEqual({});
    expect(answersPatch(saved, changed, person, stillRejected(rejected ?? {}, changed))).toEqual({
      id_document_number: "X1",
      id_valid_until: "2031-03-04",
    });
    expect(withRejectedField({}, "unknown_key", draft)).toBeNull();
  });

  it("finds the refused field of an expired document without a field", () => {
    expect(refusedField("invalid_field", { field: "zip" })).toBe("zip");
    expect(refusedField("id_document_expired", {})).toBe("id_valid_until");
    expect(refusedField("invalid_field", {})).toBe("");
  });

  it("sends the beneficial owners only as a complete list, with the share as a number", () => {
    const saved = draftFromQuestionnaire(questionnaire("company"));
    const typing: PayerDraft = { ...saved, beneficial_owners: [{ ...emptyOwner(), first_name: "Anna" }] };
    expect(answersPatch(saved, typing, company)).toEqual({});
    const complete: PayerDraft = {
      ...saved,
      beneficial_owners: [
        { ...emptyOwner(), first_name: "Anna", last_name: "Muster", share_percent: "60", country: "DE", date_of_birth: "1980-01-15" },
        { ...emptyOwner(), first_name: "Ben", last_name: "Muster", share_percent: "25,5" },
      ],
    };
    expect(answersPatch(saved, complete, company)).toEqual({
      beneficial_owners: [
        { first_name: "Anna", last_name: "Muster", date_of_birth: "1980-01-15", birth_place: null, street: null, zip: null, city: null, country: "DE", share_percent: 60 },
        { first_name: "Ben", last_name: "Muster", date_of_birth: null, birth_place: null, street: null, zip: null, city: null, country: null, share_percent: 25.5 },
      ],
    });
    const tooMuch: PayerDraft = {
      ...complete,
      beneficial_owners: complete.beneficial_owners.map((owner) => ({ ...owner, share_percent: "60" })),
    };
    expect(ownerProblems(tooMuch.beneficial_owners).total).toBe(true);
    expect(answersPatch(saved, tooMuch, company)).toEqual({});
  });

  it("sends 'nobody above 25 %' with an empty list", () => {
    const withOwner = draftFromQuestionnaire(
      questionnaire("company", {
        beneficial_owners: [{ first_name: "Anna", last_name: "Muster", date_of_birth: null, birth_place: null, street: null, zip: null, city: null, country: null, share_percent: "60.00" }],
      }),
    );
    expect(withOwner.beneficial_owners[0].share_percent).toBe("60");
    expect(answersPatch(withOwner, withOwnersNone(withOwner, true), company)).toEqual({ beneficial_owners: [], beneficial_owners_none: true });
    const none = withOwnersNone(withOwner, true);
    expect(answersPatch(none, withOwnersNone(none, false), company)).toEqual({ beneficial_owners_none: false });
  });

  it("checks a share: above 0, at most 100, two decimals", () => {
    expect(parseShare("25")).toBe(25);
    expect(parseShare("25,25")).toBe(25.25);
    expect(parseShare("100")).toBe(100);
    expect(parseShare("0")).toBeNull();
    expect(parseShare("100.01")).toBeNull();
    expect(parseShare("12.345")).toBeNull();
    expect(parseShare("abc")).toBeNull();
    expect(ownerProblems([{ ...emptyOwner(), first_name: "Anna" }]).rows).toEqual(["incomplete"]);
    expect(ownerProblems([{ ...emptyOwner(), first_name: "Anna", last_name: "Muster", share_percent: "0" }]).rows).toEqual(["share"]);
    expect(ownersPayload([{ ...emptyOwner(), first_name: " Anna ", last_name: "Muster", share_percent: "30" }])[0]).toMatchObject({
      first_name: "Anna",
      share_percent: 30,
    });
  });

  it("clears what belongs to another answer, as the server does", () => {
    const draft = draftFromQuestionnaire(questionnaire("person", { relationship_kind: "other", relationship: "Patenonkel", pep_self: true, pep_self_details: "Minister" }));
    expect(withRelationshipKind(draft, "friend").relationship).toBe("");
    expect(withRelationshipKind(draft, "other").relationship).toBe("Patenonkel");
    expect(withLegalAnswer(draft, "pep_self", "no").pep_self_details).toBe("");
    expect(withLegalAnswer(draft, "pep_self", "yes").pep_self_details).toBe("Minister");
    expect(withFundsSource(withFundsSource(draft, "other", true), "employment", true).funds_sources).toEqual(["employment", "other"]);
  });

  it("offers the sources of funds the server lists for the payer type", () => {
    // An older server sends no list: the persons' list as before.
    expect(fundsSourceOptions(questionnaire("person"))).toEqual(["employment", "business_income", "savings", "asset_sale", "inheritance_gift", "other"]);
    const company = { ...questionnaire("company"), funds_source_options: ["business_revenue", "equity", "loan", "insurance_benefit", "donation", "other"] };
    const options = fundsSourceOptions(company);
    expect(options).toEqual(["business_revenue", "equity", "loan", "insurance_benefit", "donation", "other"]);
    // Unknown values are left out; a list of nothing known falls back.
    expect(fundsSourceOptions({ funds_source_options: ["loan", "lottery", "loan"] })).toEqual(["loan"]);
    expect(fundsSourceOptions({ funds_source_options: ["lottery"] })).toEqual(FUNDS_SOURCES);
    // Checked in the order of the offered list; a person's value is dropped for a company.
    const draft = { ...draftFromQuestionnaire(company), funds_sources: ["employment"] };
    const chosen = withFundsSource(withFundsSource(draft, "other", true, options), "equity", true, options);
    expect(chosen.funds_sources).toEqual(["equity", "other"]);
    // Every source has a label in four languages.
    for (const lang of ["de", "en", "uk", "ru"]) {
      for (const source of [...FUNDS_SOURCES, ...options]) {
        expect(payerLinkText(lang).fundsSources[source]).toBeTruthy();
      }
    }
    expect(payerLinkText("de").fundsSources.business_revenue).toBe("Geschäftstätigkeit / Umsatz");
    expect(payerLinkText("de").fundsSources.donation).toBe("Spende / Zuwendung");
  });
});

describe("after a save", () => {
  it("takes over what the server changed and keeps what was typed since", () => {
    const previous = draftFromQuestionnaire(questionnaire("person", { country: "AT", habitual_residence_country: "DE" }));
    const snapshot = { ...previous, country: "DE", first_name: "Viktor " };
    // The server stored the trimmed name and cleared the residence equal to the country.
    const stored = draftFromQuestionnaire(questionnaire("person", { country: "DE", habitual_residence_country: null, first_name: "Viktor" }));
    const current = { ...snapshot, last_name: "Zahl" };
    const next = reconcileDraft(current, snapshot, previous, stored, ["country", "first_name"]);
    expect(next.habitual_residence_country).toBe("");
    expect(next.last_name).toBe("Zahl");
    expect(next.country).toBe("DE");
    // The name differs only by a space: nothing to take over.
    expect(next.first_name).toBe("Viktor ");

    // Typed again meanwhile: the typing wins.
    const typedAgain = { ...current, habitual_residence_country: "CH" };
    expect(reconcileDraft(typedAgain, snapshot, previous, stored, ["country"]).habitual_residence_country).toBe("CH");
  });

  it("keeps a refused value and an unfinished list of owners", () => {
    const previous = draftFromQuestionnaire(questionnaire("company"));
    const snapshot: PayerDraft = {
      ...previous,
      zip: "1",
      beneficial_owners: [{ ...emptyOwner(), first_name: "Anna" }],
    };
    const stored = draftFromQuestionnaire(questionnaire("company"));
    const next = reconcileDraft(snapshot, snapshot, previous, stored, [], { zip: "1" });
    expect(next.zip).toBe("1");
    expect(next.beneficial_owners).toHaveLength(1);
  });
});

describe("code step helpers", () => {
  it("counts the cooldown down from the answer of 'send code'", () => {
    const now = Date.parse("2026-10-06T10:00:00Z");
    expect(resendAllowedAt(null, 60, now)).toBe(now + 60_000);
    expect(resendAllowedAt("2026-10-06T09:59:30Z", null, now)).toBe(now + 30_000);
    expect(secondsLeft(now + 59_100, now)).toBe(60);
    expect(secondsLeft(now - 1, now)).toBe(0);
    expect(secondsLeft(null, now)).toBe(0);
  });

  it("keeps six digits of a typed or pasted code", () => {
    expect(codeDigits("12 34-56")).toBe("123456");
    expect(codeDigits("1234567")).toBe("123456");
    expect(codeDigits("abc")).toBe("");
  });
});
