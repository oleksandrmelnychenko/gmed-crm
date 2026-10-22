import { describe, expect, it } from "vitest";

import {
  PAYER_QUESTIONNAIRE_FIELDS,
  canSubmitPayerQuestionnaire,
  draftFromPayerQuestionnaire,
  fundsDescriptionRequired,
  normalizeLeadPayerQuestionnaire,
  payerAdditionalIdentityNeeded,
  normalizePayerSignaturePackage,
  payerElsewhereTarget,
  payerMissingParts,
  payerNoticeAcknowledged,
  payerQuestionnairePatch,
  payerQuestionnaireSubmitted,
  payerQuestionnaireSummary,
  payerSignaturePackageOf,
  stillRejectedPayerFields,
  withFundsSource,
  withPayerLegalAnswer,
  withRejectedPayerField,
} from "./lead-request-payer-questionnaire-model";
import { leadRequestText, payerQuestionnaireFieldLabel, LEAD_CABINET_LANGS } from "./lead-request-text";

describe("additional payer identity details", () => {
  it("keeps the ordinary form short without clearing saved details", () => {
    const person = normalizeLeadPayerQuestionnaire(raw({}, { salutation: "ms", former_names: "Earlier Name" }))!;
    expect(payerAdditionalIdentityNeeded(person)).toBe(false);
    expect(person.answers.former_names).toBe("Earlier Name");
    expect(payerAdditionalIdentityNeeded({ ...person, funds_proof_required: true })).toBe(true);
    expect(payerAdditionalIdentityNeeded({ ...person, answers: { ...person.answers, sanctions_links: true } })).toBe(true);
  });
  it("shows details for a triggered identity check, while contract preparation alone keeps them hidden", () => {
    const person = normalizeLeadPayerQuestionnaire(raw())!;
    const followUp = { required: true, blocks: ["G"], missing: {}, answered_at: null };
    expect(payerAdditionalIdentityNeeded(person, followUp)).toBe(false);
    expect(payerAdditionalIdentityNeeded(person, { ...followUp, blocks: ["K"] })).toBe(true);
  });
});

/** The questionnaire of a paying parent as the server answers it (contract 3.5, cabinet variant). */
function raw(patch: Record<string, unknown> = {}, answers: Record<string, unknown> = {}) {
  return {
    patient_name: "Mia Muster",
    source: "cabinet",
    payer_type: "person",
    state: "draft",
    email: "anna.muster@example.com",
    email_confirmed_at: null,
    privacy: { acknowledged_at: null, text_version: "payer-privacy-2026-10-06", contact_channels: [] },
    answers: {
      salutation: null,
      first_name: "Anna",
      last_name: "Muster",
      former_names: null,
      habitual_residence_country: null,
      language: "de",
      occupation: null,
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
      ...answers,
    },
    payment_route: { asked: false },
    identity_documents: [],
    funds_proof_documents: [],
    funds_proof_required: false,
    missing_for_submit: ["privacy_ack", "occupation", "funds_sources", "pep_self"],
    declared_correct_at: null,
    submitted_at: null,
    ...patch,
  };
}

describe("paying parent's questionnaire: the server's answer", () => {
  it("reads the questionnaire and nothing that is not one", () => {
    const questionnaire = normalizeLeadPayerQuestionnaire(raw());
    expect(questionnaire?.answers.language).toBe("de");
    expect(questionnaire?.missing_for_submit).toEqual(["privacy_ack", "occupation", "funds_sources", "pep_self"]);
    expect(payerNoticeAcknowledged(questionnaire)).toBe(false);
    expect(payerQuestionnaireSubmitted(questionnaire)).toBe(false);
    expect(normalizeLeadPayerQuestionnaire([])).toBeNull();
    expect(normalizeLeadPayerQuestionnaire({ answers: {} })).toBeNull();
    expect(normalizeLeadPayerQuestionnaire({ request: {} })).toBeNull();
  });

  it("gives the request its short form after a write", () => {
    const questionnaire = normalizeLeadPayerQuestionnaire(raw({ submitted_at: "2026-10-06T10:30:00Z", state: "submitted" }))!;
    expect(payerQuestionnaireSummary(questionnaire)).toEqual({
      available: true,
      submitted_at: "2026-10-06T10:30:00Z",
      missing_count: 4,
    });
    expect(payerQuestionnaireSubmitted(questionnaire)).toBe(true);
  });

  it("reads where the documents for the payer's signature stand, and nothing else", () => {
    const sent = { status: "sent", sent_at: "2026-10-06T12:00:00Z", signed_at: null };
    expect(normalizePayerSignaturePackage(sent)).toEqual(sent);
    expect(normalizePayerSignaturePackage({ status: "signed", sent_at: "2026-10-06T12:00:00Z", signed_at: "2026-10-08T09:00:00Z" })).toEqual({
      status: "signed",
      sent_at: "2026-10-06T12:00:00Z",
      signed_at: "2026-10-08T09:00:00Z",
    });
    // A server that names the step still means "sent"; anything else is no package to show.
    expect(normalizePayerSignaturePackage({ status: "pending", sent_at: null })).toEqual({ status: "sent", sent_at: null, signed_at: null });
    for (const value of [null, undefined, "sent", [], { status: "declined" }, { status: "withdrawn", sent_at: "2026-10-06T12:00:00Z" }]) {
      expect(normalizePayerSignaturePackage(value)).toBeNull();
    }
    // The questionnaire carries it only when the server sends it there.
    expect(normalizeLeadPayerQuestionnaire(raw())).not.toHaveProperty("signature_package");
    expect(normalizeLeadPayerQuestionnaire(raw({ signature_package: null }))?.signature_package).toBeNull();
    expect(normalizeLeadPayerQuestionnaire(raw({ signature_package: sent }))?.signature_package).toEqual(sent);
  });

  it("takes the package from the first source that says anything, and keeps it in the request's short form", () => {
    const sent = { status: "sent", sent_at: "2026-10-06T12:00:00Z", signed_at: null } as const;
    const signed = { status: "signed", sent_at: "2026-10-06T12:00:00Z", signed_at: "2026-10-08T09:00:00Z" } as const;
    // The questionnaire wins, also with "no package"; without the key the request's short form says it.
    expect(payerSignaturePackageOf({ signature_package: signed }, { signature_package: sent })).toEqual(signed);
    expect(payerSignaturePackageOf({ signature_package: null }, { signature_package: sent })).toBeNull();
    expect(payerSignaturePackageOf({ submitted_at: null }, { signature_package: sent })).toEqual(sent);
    // An older server says nothing: nothing is shown.
    expect(payerSignaturePackageOf({ submitted_at: null }, null, undefined)).toBeNull();

    const questionnaire = normalizeLeadPayerQuestionnaire(raw())!;
    const previous = { available: true, submitted_at: null, missing_count: 1, signature_package: sent };
    // A write that does not name the package leaves the request's package as it was.
    expect(payerQuestionnaireSummary(questionnaire, previous)).toEqual({ ...previous, missing_count: 4 });
    expect(payerQuestionnaireSummary(questionnaire, { available: true, submitted_at: null, missing_count: 1 })).not.toHaveProperty(
      "signature_package",
    );
    const withPackage = normalizeLeadPayerQuestionnaire(raw({ signature_package: signed }))!;
    expect(payerQuestionnaireSummary(withPackage, previous).signature_package).toEqual(signed);
  });
});

describe("paying parent's questionnaire: what is saved", () => {
  it("writes only the payer-only keys of the cabinet", () => {
    expect(PAYER_QUESTIONNAIRE_FIELDS).toEqual([
      "salutation",
      "former_names",
      "habitual_residence_country",
      "language",
      "occupation",
      "funds_sources",
      "funds_description",
      "pep_self",
      "pep_self_details",
      "pep_related",
      "pep_related_details",
      "sanctions_links",
      "sanctions_links_details",
    ]);
    // Name, address and identity document are not part of the draft.
    const draft = draftFromPayerQuestionnaire(normalizeLeadPayerQuestionnaire(raw()));
    expect(Object.keys(draft).sort()).toEqual([...PAYER_QUESTIONNAIRE_FIELDS].sort());
  });

  it("sends only what changed: texts trimmed, cleared as null, answers as booleans, sources as the list", () => {
    const saved = draftFromPayerQuestionnaire(normalizeLeadPayerQuestionnaire(raw({}, { former_names: "Anna Beispiel" })));
    const draft = {
      ...saved,
      salutation: "ms",
      former_names: "",
      occupation: "  Lehrerin   an  einer Schule ",
      funds_sources: ["savings", "employment"],
      funds_description: " Gehalt\nund Ersparnisse ",
      pep_self: "no",
    };
    expect(payerQuestionnairePatch(saved, draft)).toEqual({
      salutation: "ms",
      former_names: null,
      occupation: "Lehrerin an einer Schule",
      funds_sources: ["employment", "savings"],
      funds_description: "Gehalt\nund Ersparnisse",
      pep_self: false,
    });
    expect(payerQuestionnairePatch(saved, saved)).toEqual({});
    // No high-risk country question (owner 2026-10-22): an old stored answer is neither shown nor sent.
    const old = draftFromPayerQuestionnaire(normalizeLeadPayerQuestionnaire(raw({}, { high_risk_country: true, high_risk_country_code: "IR" })));
    expect(old).not.toHaveProperty("high_risk_country");
    expect(old).not.toHaveProperty("high_risk_country_code");
    expect(payerQuestionnairePatch(old, { ...old, pep_self: "no" })).toEqual({ pep_self: false });
    // An answer taken back is null.
    expect(payerQuestionnairePatch({ ...saved, pep_related: "yes" }, { ...saved, pep_related: "" })).toEqual({ pep_related: null });
  });

  it("does not repeat a refused value until it changes", () => {
    const saved = draftFromPayerQuestionnaire(null);
    const draft = { ...saved, occupation: "Arzt", habitual_residence_country: "XX" };
    const rejected = withRejectedPayerField({}, "habitual_residence_country", draft)!;
    expect(payerQuestionnairePatch(saved, draft, rejected)).toEqual({ occupation: "Arzt" });
    expect(withRejectedPayerField({}, "first_name", draft)).toBeNull();
    expect(stillRejectedPayerFields(rejected, draft)).toEqual(rejected);
    expect(stillRejectedPayerFields(rejected, { ...draft, habitual_residence_country: "AT" })).toEqual({});
  });

  it("drops the details with an answer other than yes", () => {
    const draft = { ...draftFromPayerQuestionnaire(null), pep_self: "yes", pep_self_details: "Bürgermeister" };
    expect(withPayerLegalAnswer(draft, "pep_self", "no")).toMatchObject({ pep_self: "no", pep_self_details: "" });
    expect(withPayerLegalAnswer(draft, "pep_self", "yes").pep_self_details).toBe("Bürgermeister");
  });

  it("keeps the sources in the order of the form; 'other' asks for the description", () => {
    let draft = draftFromPayerQuestionnaire(null);
    draft = withFundsSource(draft, "other", true);
    draft = withFundsSource(draft, "employment", true);
    draft = withFundsSource(draft, "employment", true);
    expect(draft.funds_sources).toEqual(["employment", "other"]);
    expect(fundsDescriptionRequired(draft)).toBe(true);
    draft = withFundsSource(draft, "other", false);
    expect(draft.funds_sources).toEqual(["employment"]);
    expect(fundsDescriptionRequired(draft)).toBe(false);
  });
});

describe("paying parent's questionnaire: what is missing, and where", () => {
  it("splits the server's list by the section that answers it", () => {
    expect(
      payerMissingParts([
        "privacy_ack",
        "birth_place",
        "citizenships",
        "id_document_number",
        "id_document_upload",
        "relationship_kind",
        "occupation",
        "funds_sources",
        "funds_proof_upload",
        "payment_method",
        "via_third_party",
        "pep_self",
      ]),
    ).toEqual({
      own: ["privacy_ack", "occupation", "funds_sources", "funds_proof_upload", "pep_self"],
      representative: ["birth_place", "citizenships", "id_document_number", "id_document_upload"],
      payer: ["relationship_kind"],
      paymentRoute: ["payment_method", "via_third_party"],
    });
  });

  it("leads each box that names another section to that step and section", () => {
    const plain = { follow_up: undefined, submitted_at: null } as unknown as Parameters<typeof payerElsewhereTarget>[1];
    expect(payerElsewhereTarget("representative", plain)).toEqual({ step: "person", anchor: "lead-request-section-representatives" });
    expect(payerElsewhereTarget("payer", plain)).toEqual({ step: "billing", anchor: "lead-request-section-payer" });
    expect(payerElsewhereTarget("paymentRoute", plain)).toEqual({ step: "billing", anchor: "lead-request-section-payment-route" });
    // Block C open: the payment route is asked in the follow-up step.
    const withBlockC = {
      submitted_at: "2026-10-20T10:00:00Z",
      follow_up: { required: true, before_submit: false, blocks: ["C"], missing: { C: ["payment_method"] }, answered_at: null },
    } as unknown as Parameters<typeof payerElsewhereTarget>[1];
    expect(payerElsewhereTarget("paymentRoute", withBlockC)).toEqual({ step: "follow_up", anchor: "lead-request-section-payment-route" });
  });

  it("names every key in every language", () => {
    const de = leadRequestText("de");
    expect(payerQuestionnaireFieldLabel(de, "privacy_ack")).toBe("Datenschutzhinweis bestätigen");
    expect(payerQuestionnaireFieldLabel(de, "funds_proof_upload")).toBe("Nachweis der Herkunft der Mittel");
    expect(payerQuestionnaireFieldLabel(de, "occupation")).toBe("Beruf / Tätigkeit");
    expect(payerQuestionnaireFieldLabel(de, "street")).toBe("Straße und Hausnummer");
    // The paying parent's own copy, not the child's (owner report 2026-10-21).
    expect(payerQuestionnaireFieldLabel(de, "id_document_upload")).toBe("Ihr Ausweisdokument (Elternteil / gesetzlicher Vertreter)");
    expect(payerQuestionnaireFieldLabel(leadRequestText("ru"), "id_document_upload")).toBe("Ваш документ (родитель / законный представитель)");
    // The paying parent's own legal questions keep their details (the lead's are yes/no since the trigger flow).
    expect(payerQuestionnaireFieldLabel(de, "pep_self")).toBe("Weitere Fragen: Öffentliches Amt");
    expect(payerQuestionnaireFieldLabel(de, "pep_self_details")).toBe("Weitere Fragen: Amt, Land und Zeitraum");
    expect(payerQuestionnaireFieldLabel(de, "sanctions_links_details")).toBe(
      "Weitere Fragen: Zu wem besteht die Verbindung und welcher Art ist sie?",
    );
    expect(payerQuestionnaireFieldLabel(de, "payment_method")).toBe("Welche Zahlungsart für Rechnungen bevorzugen Sie?");
    expect(payerQuestionnaireFieldLabel(de, "relationship")).toBe("Beziehung zur Patientin / zum Patienten – In welcher Beziehung genau?");
    expect(de.payerElsewhere(de.sectionLegalRepresentatives)).toBe("Bitte im Abschnitt „Gesetzliche Vertreter“ ergänzen:");
    for (const option of LEAD_CABINET_LANGS) {
      const text = leadRequestText(option.value);
      for (const key of ["privacy_ack", "funds_proof_upload", "language", "occupation", "funds_sources", "funds_description", "first_name", "zip"]) {
        expect(payerQuestionnaireFieldLabel(text, key), `${option.value} ${key}`).not.toBe(key);
      }
      expect(Object.keys(text.fundsSourceOptions)).toEqual([
        "employment",
        "business_income",
        "savings",
        "asset_sale",
        "inheritance_gift",
        "other",
      ]);
    }
  });

  it("may be sent once nothing is missing and the parent confirmed", () => {
    const complete = normalizeLeadPayerQuestionnaire(raw({ missing_for_submit: [] }))!;
    expect(canSubmitPayerQuestionnaire(complete, true)).toBe(true);
    expect(canSubmitPayerQuestionnaire(complete, false)).toBe(false);
    expect(canSubmitPayerQuestionnaire({ ...complete, missing_for_submit: ["occupation"] }, true)).toBe(false);
    expect(canSubmitPayerQuestionnaire({ ...complete, submitted_at: "2026-10-06T10:30:00Z" }, true)).toBe(false);
  });
});
