import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  normalizeLeadPayerLinkState,
  normalizeStaffPayerQuestionnaire,
  type LeadPayerLinkState,
  type PayerLinkInfo,
  type StaffPayerQuestionnaire,
} from "../data/lead-payer-link-api";
import {
  beneficialOwnerLine,
  estimatedTotalInput,
  fundsProofMissing,
  fundsProofThresholdHint,
  parseEstimatedTotal,
  payerCheckLevelLine,
  payerCheckReasonLabel,
  payerFundsSourceLabel,
  payerLinkActions,
  payerLinkActive,
  payerLinkBlockedReasonText,
  payerLinkChanged,
  payerLinkErrorText,
  payerLinkResendAsksFirst,
  payerLinkResendQuestion,
  payerLinkRevokeReasonLabel,
  payerLinkStatusLine,
  payerPrivacyLine,
  payerQuestionnaireGroups,
} from "./lead-payer-link";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const TODAY = "2026-10-06";

/** A link sent at 12:00 Berlin time (10:00 UTC) to the payer. */
function link(patch: Partial<PayerLinkInfo> = {}): PayerLinkInfo {
  return {
    status: "sent",
    email: "viktor.zahler@example.com",
    language: "de",
    sent_at: "2026-10-06T10:00:00Z",
    sent_by_name: "Anna Muster",
    expires_at: "2026-11-05T10:00:00Z",
    opened_at: null,
    verified_at: null,
    revoked_at: null,
    revoked_reason: null,
    last_email_status: "sent",
    ...patch,
  };
}

function questionnaire(patch: Record<string, unknown> = {}, answers: Record<string, unknown> = {}): StaffPayerQuestionnaire {
  return normalizeStaffPayerQuestionnaire({
    patient_name: "Mia Muster",
    source: "link",
    payer_type: "person",
    state: "draft",
    email: "viktor.zahler@example.com",
    email_confirmed_at: "2026-10-06T10:02:00Z",
    privacy: {
      acknowledged_at: "2026-10-06T10:05:00Z",
      text_version: "payer-privacy-2026-10-06",
      contact_channels: ["email", "phone"],
      ip: "203.0.113.7",
    },
    answers: {
      salutation: "mr",
      first_name: "Viktor",
      last_name: "Zahler",
      date_of_birth: "1970-03-02",
      birth_place: "Wien",
      birth_country: "AT",
      citizenships: ["AT"],
      street: "Musterweg 1",
      zip: "1010",
      city: "Wien",
      country: "AT",
      language: "de",
      id_document_type: "passport",
      id_document_number: "P1234567",
      id_issuing_authority: "BH Wien",
      id_issuing_country: "AT",
      id_issued_on: "2020-01-15",
      id_valid_until: "2030-01-14",
      relationship_kind: "parent",
      occupation: "Ingenieur",
      funds_sources: ["employment", "savings"],
      funds_description: "Gehalt und Ersparnisse",
      pep_self: true,
      pep_self_details: "Bürgermeister 2019–2024",
      pep_related: false,
      high_risk_country: false,
      sanctions_links: false,
      ...answers,
    },
    payment_route: { payment_method: "bank_transfer", asked: true },
    identity_documents: [{ id: "doc-id", file_name: "pass.pdf", uploaded_at: "2026-10-06T10:10:00Z", reviewed: false }],
    funds_proof_documents: [],
    funds_proof_required: true,
    missing_for_submit: ["funds_proof_upload"],
    declared_correct_at: null,
    submitted_at: null,
    check_level: 2,
    check_reasons: ["pep", "amount_over_threshold"],
    updated_at: "2026-10-06T10:20:00Z",
    adopted_at: null,
    ...patch,
  })!;
}

function state(patch: Partial<LeadPayerLinkState> = {}): LeadPayerLinkState {
  return {
    mode: "link",
    can_send: true,
    blocked_reason: null,
    mail_available: true,
    link: null,
    estimated_total_eur: null,
    funds_proof_threshold_eur: 10000,
    questionnaire: null,
    ...patch,
  };
}

describe("payer link: reload and status", () => {
  it("reloads on the payer's writes, the lead's submit and another payer", () => {
    expect(payerLinkChanged("payer_link")).toBe(true);
    expect(payerLinkChanged("submitted")).toBe(true);
    expect(payerLinkChanged("payer")).toBe(true);
    expect(payerLinkChanged("billing")).toBe(false);
    expect(payerLinkChanged(undefined)).toBe(false);
  });

  it("words each status with its times in Berlin time", () => {
    const sent = payerLinkStatusLine(link(), null, de);
    expect(sent).toEqual({
      label: "Gesendet",
      tone: "info",
      text: "Gesendet am 06.10.2026 12:00 an viktor.zahler@example.com (Anna Muster) · gültig bis 05.11.2026",
    });
    expect(payerLinkStatusLine(link(), null, ru).text).toBe(
      "Отправлена 06.10.2026 12:00 на viktor.zahler@example.com (Anna Muster) · действует до 05.11.2026",
    );
    expect(payerLinkStatusLine(link({ status: "opened", opened_at: "2026-10-06T10:05:00Z" }), null, de).text).toMatch(
      /^Geöffnet am 06\.10\.2026 12:05 · gesendet am 06\.10\.2026 12:00/,
    );
    expect(payerLinkStatusLine(link({ status: "verified", verified_at: "2026-10-06T10:07:00Z" }), null, de)).toMatchObject({
      label: "E-Mail bestätigt",
      text: expect.stringMatching(/^Code bestätigt am 06\.10\.2026 12:07/),
    });
    const submitted = payerLinkStatusLine(link({ status: "submitted" }), "2026-10-06T10:30:00Z", de);
    expect(submitted.label).toBe("Angaben eingegangen");
    expect(submitted.tone).toBe("success");
    expect(submitted.text).toMatch(/^Angaben eingegangen am 06\.10\.2026 12:30 · gesendet am/);
    expect(payerLinkStatusLine(link({ status: "expired" }), null, de).text).toMatch(/^Abgelaufen am 05\.11\.2026 11:00/);
    expect(payerLinkStatusLine(link({ status: "locked" }), null, ru)).toMatchObject({
      label: "Заблокирована",
      tone: "error",
      text: expect.stringMatching(/^Заблокирована: слишком много неверных кодов/),
    });
  });

  it("names why a link was revoked, and a failed e-mail", () => {
    const revoked = payerLinkStatusLine(
      link({ status: "revoked", revoked_at: "2026-10-06T11:00:00Z", revoked_reason: "payer_changed" }),
      null,
      de,
    );
    expect(revoked.label).toBe("Widerrufen");
    expect(revoked.text).toMatch(/^Widerrufen am 06\.10\.2026 13:00 — Zahler geändert · gesendet am/);
    for (const reason of ["resent", "staff_revoked", "payer_changed", "email_changed", "lead_converted", "email_failed"]) {
      expect(payerLinkRevokeReasonLabel(reason, ru)).not.toBe(reason);
    }
    // The failed e-mail is the reason of the revocation: said once.
    const failed = payerLinkStatusLine(
      link({ status: "revoked", revoked_reason: "email_failed", last_email_status: "failed" }),
      null,
      de,
    );
    expect(failed.text).toContain("E-Mail konnte nicht gesendet werden");
    expect(failed.text).not.toContain("nicht zugestellt");
    const bounced = payerLinkStatusLine(link({ last_email_status: "failed" }), null, de);
    expect(bounced.tone).toBe("warning");
    expect(bounced.text).toContain("letzte E-Mail nicht zugestellt");
  });

  it("tells active links from ended ones", () => {
    for (const status of ["sent", "opened", "verified", "locked", "submitted"] as const) {
      expect(payerLinkActive(link({ status }))).toBe(true);
    }
    expect(payerLinkActive(link({ status: "expired" }))).toBe(false);
    expect(payerLinkActive(link({ status: "revoked" }))).toBe(false);
    expect(payerLinkActive(null)).toBe(false);
  });
});

describe("payer link: what may be done", () => {
  it("offers the first link, highlighted once the request is in", () => {
    const actions = payerLinkActions(state(), false, de);
    expect(actions).toEqual({
      cabinet: false,
      sendKind: "send",
      sendEnabled: true,
      sendBlockedText: null,
      reopenOffered: false,
      revokeEnabled: false,
      highlight: true,
    });
  });

  it("offers resend and revoke while a link is active", () => {
    const actions = payerLinkActions(state({ link: link({ status: "opened" }) }), false, de);
    expect(actions.sendKind).toBe("resend");
    expect(actions.sendEnabled).toBe(true);
    expect(actions.revokeEnabled).toBe(true);
    expect(actions.highlight).toBe(false);
    // An ended link: send a new one, nothing to revoke.
    const ended = payerLinkActions(state({ link: link({ status: "expired" }) }), false, de);
    expect(ended.sendKind).toBe("send");
    expect(ended.revokeEnabled).toBe(false);
  });

  it("names an organisation's sources of funds as well as a person's", () => {
    expect(payerFundsSourceLabel("employment", de)).toBe("Gehalt / nichtselbständige Arbeit");
    expect(payerFundsSourceLabel("business_revenue", de)).toBe("Geschäftstätigkeit / Umsatz");
    expect(payerFundsSourceLabel("equity", de)).toBe("Eigenkapital");
    expect(payerFundsSourceLabel("loan", ru)).toBe("Заём / кредит");
    expect(payerFundsSourceLabel("insurance_benefit", de)).toBe("Versicherungsleistung");
    expect(payerFundsSourceLabel("donation", de)).toBe("Spende / Zuwendung");
    expect(payerFundsSourceLabel("other", de)).toBe("Sonstiges (bitte beschreiben)");
    expect(payerFundsSourceLabel("lottery", de)).toBe("lottery");
  });

  it("asks before a resend while the payer is filling in the questionnaire", () => {
    expect(payerLinkResendAsksFirst(link({ status: "opened" }))).toBe(true);
    expect(payerLinkResendAsksFirst(link({ status: "verified" }))).toBe(true);
    for (const status of ["sent", "submitted", "locked", "expired", "revoked"] as const) {
      expect(payerLinkResendAsksFirst(link({ status }))).toBe(false);
    }
    expect(payerLinkResendAsksFirst(null)).toBe(false);
    expect(payerLinkResendQuestion(ru)).toBe(
      "Плательщик сейчас заполняет анкету — старая ссылка перестанет работать. Отправить новую?",
    );
    expect(payerLinkResendQuestion(de)).toBe(
      "Der Zahler füllt den Fragebogen gerade aus – der alte Link wird ungültig. Neuen Link senden?",
    );
  });

  it("needs 'reopen for correction' to resend after the payer answered", () => {
    const answered = state({ link: link({ status: "submitted" }), questionnaire: questionnaire({ submitted_at: "2026-10-06T10:30:00Z" }) });
    const closed = payerLinkActions(answered, false, de);
    expect(closed.reopenOffered).toBe(true);
    expect(closed.sendEnabled).toBe(false);
    expect(closed.sendBlockedText).toBe("Die Angaben sind eingegangen: Für einen neuen Link „Zur Korrektur öffnen“ wählen");
    const reopened = payerLinkActions(answered, true, de);
    expect(reopened.sendEnabled).toBe(true);
    expect(reopened.sendBlockedText).toBeNull();
  });

  it("disables sending with the readable reason of the server", () => {
    const blocked = payerLinkActions(state({ can_send: false, blocked_reason: "contact_consent_missing" }), false, ru);
    expect(blocked.sendEnabled).toBe(false);
    expect(blocked.sendBlockedText).toBe("Пациент ещё не дал согласие на контакт с плательщиком");
    expect(blocked.highlight).toBe(false);
    // The server answers `can_send: false` without e-mail sending: the reason is the missing set-up.
    const noMail = payerLinkActions(state({ can_send: false, mail_available: false }), false, de);
    expect(noMail.sendEnabled).toBe(false);
    expect(noMail.sendBlockedText).toBe(
      "Der E-Mail-Versand ist nicht eingerichtet. Mittaro wird unter „API-Verbindungen“ → „E-Mail“ verbunden.",
    );
    // A blocked reason comes first.
    expect(
      payerLinkActions(state({ can_send: false, mail_available: false, blocked_reason: "payer_email_missing" }), false, de).sendBlockedText,
    ).toBe("Bitte eine gültige E-Mail-Adresse des Zahlers eintragen und speichern");
    // Without a reason (a role without leads.edit) only the general sentence.
    expect(payerLinkActions(state({ can_send: false }), false, de).sendBlockedText).toBe(
      "Der Link kann derzeit nicht gesendet werden",
    );
  });

  it("offers nothing for a paying parent with a cabinet login", () => {
    const cabinet = payerLinkActions(state({ mode: "cabinet", can_send: false, blocked_reason: "payer_has_cabinet_login" }), false, de);
    expect(cabinet).toMatchObject({ cabinet: true, sendEnabled: false, sendBlockedText: null, revokeEnabled: false, highlight: false });
    expect(payerLinkBlockedReasonText("payer_has_cabinet_login", de)).toBe(
      "Zahler ist Elternteil mit Portalzugang: Fragebogen im Portal",
    );
  });

  it("has a sentence for every blocked reason", () => {
    const texts = [
      "request_not_submitted",
      "no_third_party",
      "contact_consent_missing",
      "payer_email_missing",
      "payer_has_cabinet_login",
      "lead_converted",
    ].map((reason) => payerLinkBlockedReasonText(reason, de));
    expect(new Set(texts).size).toBe(6);
    expect(texts[0]).toBe("Der Link kann gesendet werden, sobald der Patient die Anfrage im Portal gesendet hat");
    expect(payerLinkBlockedReasonText("unknown", de)).toBe("Der Link kann derzeit nicht gesendet werden");
  });
});

describe("payer link: errors of the writes", () => {
  const error = (status: number, code: string) => new ApiRequestError(code, { status, body: { code, message: code } });

  it("words the 409 codes and the mail errors", () => {
    expect(payerLinkErrorText(error(409, "request_not_submitted"), de)).toBe(
      "Der Link kann gesendet werden, sobald der Patient die Anfrage im Portal gesendet hat",
    );
    expect(payerLinkErrorText(error(409, "payer_already_submitted"), de)).toContain("„Zur Korrektur öffnen“");
    expect(payerLinkErrorText(error(503, "mail_not_configured"), ru)).toBe(
      "Отправка e-mail не настроена. Mittaro подключается в разделе «API-подключения» → «E-Mail».",
    );
    expect(payerLinkErrorText(error(503, "mail_unavailable"), de)).toBe(
      "Der E-Mail-Dienst ist vorübergehend nicht erreichbar. Bitte erneut versuchen",
    );
    expect(payerLinkErrorText(error(422, "invalid_field"), de)).toContain("Bitte den Betrag prüfen");
    expect(payerLinkErrorText(error(500, "something_else"), de)).toBeNull();
    expect(payerLinkErrorText(new Error("network"), de)).toBeNull();
  });
});

describe("payer link: expected total", () => {
  it("reads what staff type and sends two decimals", () => {
    expect(parseEstimatedTotal("12000")).toBe("12000.00");
    expect(parseEstimatedTotal(" 12 000,5 ")).toBe("12000.50");
    expect(parseEstimatedTotal("12.000,50")).toBe("12000.50");
    expect(parseEstimatedTotal("12,000.50")).toBe("12000.50");
    expect(parseEstimatedTotal("12000.5")).toBe("12000.50");
    expect(parseEstimatedTotal("12.000")).toBe("12000.00");
    expect(parseEstimatedTotal("1.234.567")).toBe("1234567.00");
    expect(parseEstimatedTotal("9500 €")).toBe("9500.00");
    expect(parseEstimatedTotal("0")).toBe("0.00");
    expect(parseEstimatedTotal("")).toBeNull();
    expect(parseEstimatedTotal("   ")).toBeNull();
    // A dot before three digits groups thousands, as staff write it in German.
    expect(parseEstimatedTotal("10.555")).toBe("10555.00");
    for (const invalid of ["-5", "abc", "12,345", "1.2.3,4,5", "10.5555"]) {
      expect(parseEstimatedTotal(invalid), invalid).toBeUndefined();
    }
  });

  it("shows the stored amount with a decimal comma, and the threshold", () => {
    expect(estimatedTotalInput("12000.00")).toBe("12000,00");
    expect(estimatedTotalInput(null)).toBe("");
    expect(fundsProofThresholdHint(10000, de)).toBe(
      "Ab 10.000 EUR legt der Zahler einen Nachweis der Herkunft der Mittel vor",
    );
    expect(fundsProofThresholdHint(null, de)).toBe("");
  });
});

describe("payer link: check level", () => {
  it("names level and reasons", () => {
    expect(payerCheckLevelLine(2, ["pep", "amount_over_threshold"], de, 10000)).toBe(
      "Prüfstufe: 2 — PEP, Betrag ab 10.000 EUR",
    );
    expect(payerCheckLevelLine(2, ["high_risk_country", "cash_payment", "crypto_payment"], ru)).toBe(
      "Уровень проверки: 2 — страна высокого риска, наличные, криптовалюта",
    );
    expect(payerCheckLevelLine(1, [], de)).toBe("Prüfstufe: 1");
    expect(payerCheckLevelLine(null, ["pep"], de)).toBe("");
    expect(payerCheckReasonLabel("amount_over_threshold", de)).toBe("Betrag über dem Schwellenwert");
  });

  it("misses the proof of funds at level 2 only while none is uploaded", () => {
    const level2 = questionnaire();
    expect(fundsProofMissing(level2)).toBe(true);
    expect(
      fundsProofMissing({ ...level2, funds_proof_documents: [{ id: "d", file_name: "konto.pdf", size_bytes: null, mime_type: null, uploaded_at: null, reviewed: false, can_delete: true }] }),
    ).toBe(false);
    expect(fundsProofMissing({ ...level2, check_level: 1, funds_proof_required: false })).toBe(false);
    expect(fundsProofMissing(null)).toBe(false);
  });
});

describe("payer link: the payer's answers as rows", () => {
  it("shows a person with personal data, document, funds and the legal answers", () => {
    const groups = payerQuestionnaireGroups(questionnaire(), de, "de", TODAY);
    expect(groups.map((group) => group.key)).toEqual(["identity", "id_document", "relation", "legal"]);
    const rows = Object.fromEntries(groups.flatMap((group) => group.rows).map((row) => [row.key, row]));
    expect(rows.name.value).toBe("Viktor Zahler");
    expect(rows.salutation.value).toBe("Herr");
    expect(rows.date_of_birth.value).toBe("02.03.1970");
    expect(rows.birth_place.value).toBe("Wien, Österreich");
    expect(rows.address.value).toBe("Musterweg 1, 1010 Wien, Österreich");
    expect(rows.email.value).toBe("viktor.zahler@example.com · bestätigt am 06.10.2026 12:02");
    expect(rows.language.value).toBe("Deutsch");
    expect(rows.id_valid_until).toMatchObject({ value: "14.01.2030", warning: false });
    expect(rows.identity_documents.documents?.map((document) => document.file_name)).toEqual(["pass.pdf"]);
    expect(rows.relationship.value).toBe("Elternteil");
    expect(rows.occupation.value).toBe("Ingenieur");
    expect(rows.funds_sources).toMatchObject({
      value: "Gehalt / nichtselbständige Arbeit, Ersparnisse",
      details: "Gehalt und Ersparnisse",
    });
    // Level 2 without a proof: the row is amber.
    expect(rows.funds_proof_documents).toMatchObject({ warning: true, label: "Nachweis der Herkunft der Mittel (erforderlich)" });
    expect(rows["answer-pep_self"]).toMatchObject({ value: "Ja", details: "Bürgermeister 2019–2024", warning: true });
    expect(rows["answer-pep_related"]).toMatchObject({ value: "Nein", warning: false });
    expect(rows["answer-sanctions_links"].warning).toBe(false);
    // No organisation keys for a person.
    expect(rows.organisation_name).toBeUndefined();
    expect(rows.industry).toBeUndefined();
  });

  it("marks an expired identity document", () => {
    const groups = payerQuestionnaireGroups(questionnaire({}, { id_valid_until: "2026-10-05" }), ru, "ru", TODAY);
    const validUntil = groups[1].rows.find((row) => row.key === "id_valid_until");
    expect(validUntil).toMatchObject({ value: "05.10.2026 · срок истёк", warning: true });
  });

  it("shows a company with seat, register, representative and its beneficial owners", () => {
    const company = questionnaire(
      { payer_type: "company" },
      {
        salutation: null,
        first_name: null,
        last_name: null,
        date_of_birth: null,
        organisation_name: "Beispiel GmbH",
        street: "Beispielstraße 2",
        zip: "10117",
        city: "Berlin",
        country: "DE",
        register_court: "Amtsgericht Charlottenburg",
        register_number: "HRB 12345",
        representative_first_name: "Ben",
        representative_last_name: "Muster",
        representative_role: "Geschäftsführer",
        industry: "Maschinenbau",
        relationship_kind: "employer",
        beneficial_owners: [
          { first_name: "Ben", last_name: "Muster", date_of_birth: "1984-01-15", birth_place: "Berlin", street: "Musterweg 1", zip: "10115", city: "Berlin", country: "DE", share_percent: "60.00" },
          { first_name: "Anna", last_name: "Muster", share_percent: "40.5" },
        ],
      },
    );
    const groups = payerQuestionnaireGroups(company, de, "de", TODAY);
    expect(groups.map((group) => group.key)).toEqual(["identity", "id_document", "owners", "relation", "legal"]);
    expect(groups[0].title).toBe("Organisation");
    expect(groups[1].title).toBe("Ausweis der vertretungsberechtigten Person");
    const rows = Object.fromEntries(groups.flatMap((group) => group.rows).map((row) => [row.key, row]));
    expect(rows.payer_type.value).toBe("Unternehmen");
    expect(rows.organisation_name.value).toBe("Beispiel GmbH");
    expect(rows.seat.value).toBe("Beispielstraße 2, 10117 Berlin, Deutschland");
    expect(rows.register_number.value).toBe("HRB 12345");
    expect(rows.representative).toMatchObject({ value: "Ben Muster", details: "Geschäftsführer" });
    expect(rows.industry.value).toBe("Maschinenbau");
    expect(rows.occupation).toBeUndefined();
    expect(rows.name).toBeUndefined();
    expect(rows["owner-1"].value).toBe("Ben Muster · 15.01.1984, Berlin · Musterweg 1, 10115 Berlin, Deutschland · 60 %");
    expect(rows["owner-2"].value).toBe("Anna Muster · 40,5 %");
  });

  it("states 'no natural person over 25 %' for an organisation without owners", () => {
    const organisation = questionnaire({ payer_type: "organisation" }, { organisation_name: "Beispiel Stiftung", beneficial_owners_none: true });
    const owners = payerQuestionnaireGroups(organisation, de, "de", TODAY).find((group) => group.key === "owners");
    expect(owners?.rows).toEqual([
      expect.objectContaining({ key: "owners-none", value: "keine natürliche Person mit mehr als 25 %" }),
    ]);
    expect(beneficialOwnerLine({ first_name: null, last_name: "Muster", date_of_birth: null, birth_place: null, street: null, zip: null, city: null, country: null, share_percent: null }, de, "de")).toBe("Muster");
  });

  it("states when the payer acknowledged the notice, with version and address", () => {
    expect(payerPrivacyLine(questionnaire(), de)).toBe(
      "Datenschutzhinweis bestätigt am 06.10.2026 12:05 · Version payer-privacy-2026-10-06 · IP 203.0.113.7 · Kontaktwege: E-Mail, Telefon",
    );
    expect(payerPrivacyLine(questionnaire({ privacy: { acknowledged_at: null } }), de)).toBe("");
  });
});

describe("payer link: the server's answer", () => {
  it("is nothing for an older backend or a proxy reply", () => {
    expect(normalizeLeadPayerLinkState([])).toBeNull();
    expect(normalizeLeadPayerLinkState(null)).toBeNull();
    expect(normalizeLeadPayerLinkState({ mode: "link" })).toBeNull();
  });

  it("fills every key and keeps unknown values out", () => {
    const value = normalizeLeadPayerLinkState({
      mode: "link",
      can_send: false,
      blocked_reason: "request_not_submitted",
      link: { status: "unknown" },
      estimated_total_eur: 12000,
      funds_proof_threshold_eur: "10000",
    });
    expect(value).toEqual({
      mode: "link",
      can_send: false,
      blocked_reason: "request_not_submitted",
      mail_available: true,
      link: null,
      estimated_total_eur: "12000.00",
      funds_proof_threshold_eur: 10000,
      questionnaire: null,
    });
    const q = normalizeStaffPayerQuestionnaire({ answers: { pep_self: "yes", citizenships: ["AT", 3] }, check_level: 3 });
    expect(q?.answers.pep_self).toBeNull();
    expect(q?.answers.citizenships).toEqual(["AT"]);
    expect(q?.check_level).toBeNull();
    expect(q?.payer_type).toBe("person");
  });
});
