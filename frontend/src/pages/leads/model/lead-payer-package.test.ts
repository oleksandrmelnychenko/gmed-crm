import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  normalizeLeadPayerPackageState,
  normalizePayerPackageSummary,
  type LeadPayerPackageState,
} from "../data/lead-payer-package-api";
import {
  payerPackageActions,
  payerPackageBlockedReasonText,
  payerPackageChanged,
  payerPackageErrorText,
  payerPackageIdentificationText,
  payerPackageLanguageOf,
  payerPackageOutdatedHeading,
  payerPackageOutdatedReasonText,
  payerPackageRows,
  payerPackageSignerText,
  payerPackageSlotLabel,
  payerPackageStatusLine,
  payerPackageSummaryText,
  standaloneCostAssumptionKept,
} from "./lead-payer-package";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const documents = [
  // Listed out of order: the bundle's order wins.
  { slot: "cost_estimate", document_id: "doc-4", title: "Kostenvoranschlag (Ausfertigung Kostenübernehmer/in)", version: 1, signed_at: null },
  { slot: "self_disclosure", document_id: "doc-1", title: "Selbstauskunft der zahlenden Person", version: 2, signed_at: null },
  { slot: "cost_coverage", document_id: "doc-2", title: "Kostenübernahmeerklärung", version: 3, signed_at: null },
  { slot: "patient_statement", document_id: "doc-3", title: "Erklärung zur Kostenübernahme durch Dritte", version: 1, signed_at: null },
];

function state(patch: Record<string, unknown> = {}, pkg: Record<string, unknown> | null = null): LeadPayerPackageState {
  return normalizeLeadPayerPackageState({
    mode: "link",
    blocked_reason: null,
    missing: [],
    can_prepare: true,
    can_send: false,
    signature_enabled: true,
    languages: ["de", "en", "fr", "it"],
    suggested_language: "en",
    signer: { first_name: "Viktor", last_name: "Zahler", email: "viktor.zahler@example.com", acting_for: null },
    order: { id: "order-1", number: "A-2026-0042" },
    cost_estimate_document_id: "kva-1",
    package: pkg
      ? {
          id: "package-1",
          status: "prepared",
          outdated_reasons: [],
          prepared_at: "2026-10-06T10:00:00Z",
          prepared_by_name: "Intake QA",
          sent_at: null,
          sent_by_name: null,
          language: null,
          request_id: null,
          test_mode: false,
          signed_at: null,
          documents,
          attachments: [],
          ...pkg,
        }
      : null,
    payer_identification: { qes_signed_at: null, qes_test_mode: false, own_account_payment_confirmed_at: null },
    ...patch,
  })!;
}

describe("payer package state", () => {
  it("reads the server's state and keeps the bundle's order", () => {
    const value = state({}, {});
    expect(value.package?.documents.map((item) => item.slot)).toEqual([
      "self_disclosure",
      "cost_coverage",
      "patient_statement",
      "cost_estimate",
    ]);
    expect(value.order).toEqual({ id: "order-1", number: "A-2026-0042" });
    expect(normalizeLeadPayerPackageState({})).toBeNull();
    expect(normalizeLeadPayerPackageState([])).toBeNull();
    // A request status passed through reads as the package's.
    expect(state({}, { status: "completed" }).package?.status).toBe("signed");
    expect(state({}, { status: "submission_unknown" }).package?.status).toBe("sending");
    // Without languages the four of Skribble.
    expect(state({ languages: undefined }).languages).toEqual(["de", "en", "fr", "it"]);
  });

  it("reads the declaration's summary, null for none", () => {
    expect(normalizePayerPackageSummary({ status: "pending", outdated: true, sent_at: "2026-10-06T11:00:00Z" })).toEqual({
      status: "pending",
      outdated: true,
      sent_at: "2026-10-06T11:00:00Z",
      signed_at: null,
    });
    expect(normalizePayerPackageSummary(null)).toBeNull();
    expect(normalizePayerPackageSummary({ status: "unknown" })).toBeNull();
  });

  it("reloads on a package or payer-link change", () => {
    expect(payerPackageChanged("payer_package")).toBe(true);
    expect(payerPackageChanged("payer_link")).toBe(true);
    expect(payerPackageChanged("payer")).toBe(false);
    expect(payerPackageChanged(undefined)).toBe(false);
  });
});

describe("payer package labels", () => {
  it("names the four documents", () => {
    expect(payerPackageRows(null).map((row) => [payerPackageSlotLabel(row.slot, ru), row.document])).toEqual([
      ["Анкета плательщика", null],
      ["Согласие плательщика", null],
      ["Данные пациента о плательщике", null],
      ["Смета для плательщика", null],
    ]);
    expect(payerPackageRows(state({}, {}).package).map((row) => payerPackageSlotLabel(row.slot, de))).toEqual([
      "Selbstauskunft der zahlenden Person",
      "Kostenübernahmeerklärung",
      "Erklärung zur Kostenübernahme durch Dritte",
      "Kostenvoranschlag für den Zahler",
    ]);
    expect(payerPackageRows(state({}, {}).package)[0].document?.document_id).toBe("doc-1");
  });

  it("explains every blocked reason, the declaration's gaps included", () => {
    expect(payerPackageBlockedReasonText("cost_estimate_consent_missing", ru)).toBe(
      "Пациент ещё не согласился на передачу сметы плательщику",
    );
    expect(payerPackageBlockedReasonText("cost_estimate_consent_missing", de)).toBe(
      "Die Patientin / der Patient hat der Weitergabe des Kostenvoranschlags noch nicht zugestimmt",
    );
    expect(payerPackageBlockedReasonText("payer_not_submitted", de)).toBe(
      "Der Zahler hat seine Angaben noch nicht gesendet: Die Unterlagen werden danach erstellt",
    );
    expect(payerPackageBlockedReasonText("payer_declaration_incomplete", de, ["payer_source_of_funds_missing"])).toBe(
      "Angaben „Wer zahlt“ unvollständig: Herkunft der Mittel angeben",
    );
    for (const reason of [
      "lead_converted",
      "lead_deleted",
      "no_third_party",
      "order_missing",
      "cost_estimate_missing",
      "payer_signer_incomplete",
      "payer_documents_pending",
    ]) {
      expect(payerPackageBlockedReasonText(reason, ru)).not.toBe(payerPackageBlockedReasonText("something_else", ru));
    }
  });

  it("lists why a package is outdated and what to do", () => {
    expect(payerPackageOutdatedReasonText("cost_estimate_changed", de)).toBe("es gibt eine neue Fassung des Kostenvoranschlags");
    expect(payerPackageOutdatedReasonText("payer_answers_changed", ru)).toBe("плательщик изменил ответы анкеты");
    expect(payerPackageOutdatedHeading("prepared", de)).toBe("Die Unterlagen sind veraltet – vor dem Senden neu erstellen:");
    expect(payerPackageOutdatedHeading("pending", de)).toBe(
      "Die gesendeten Unterlagen sind veraltet – Anfrage zurückziehen und neu erstellen:",
    );
  });

  it("states the package with date and time in Berlin", () => {
    expect(payerPackageStatusLine(state({}, {}).package!, de)).toEqual({
      tone: "neutral",
      label: "Erstellt",
      text: "Erstellt am 06.10.2026 12:00 (Intake QA) · noch nicht gesendet",
    });
    const sent = { status: "pending", sent_at: "2026-10-06T11:00:00Z", sent_by_name: "Intake QA", language: "en", request_id: "request-1" };
    expect(payerPackageStatusLine(state({}, sent).package!, ru)).toEqual({
      tone: "info",
      label: "Ждёт подписи",
      text: "Отправлено 06.10.2026 13:00 (Intake QA) · язык EN · ждёт подписи плательщика",
    });
    expect(payerPackageStatusLine(state({}, { ...sent, status: "signed", signed_at: "2026-10-07T08:15:00Z" }).package!, de).text).toBe(
      "Unterschrieben am 07.10.2026 10:15 · gesendet am 06.10.2026 13:00 (Intake QA) · Sprache EN",
    );
    for (const status of ["sending", "needs_review", "declined", "withdrawn", "expired", "error"]) {
      expect(payerPackageStatusLine(state({}, { ...sent, status }).package!, de).label).not.toBe("");
    }
  });

  it("sums the package up for the payer link panel", () => {
    expect(payerPackageSummaryText(null, ru)).toBe("ещё не подготовлен");
    expect(payerPackageSummaryText({ status: "pending", outdated: false, sent_at: "2026-10-06T11:00:00Z", signed_at: null }, de)).toBe(
      "gesendet am 06.10.2026, wartet auf Unterschrift",
    );
    expect(payerPackageSummaryText({ status: "prepared", outdated: true, sent_at: null, signed_at: null }, ru)).toBe(
      "подготовлен, не отправлен, устарел",
    );
    expect(payerPackageSummaryText({ status: "signed", outdated: false, sent_at: null, signed_at: "2026-10-07T08:15:00Z" }, de)).toBe(
      "unterschrieben am 07.10.2026",
    );
  });

  it("names the signer, an organisation's representative with the organisation", () => {
    expect(payerPackageSignerText(state().signer, de)).toBe("Viktor Zahler · viktor.zahler@example.com");
    expect(
      payerPackageSignerText({ first_name: "Ben", last_name: "Muster", email: "kasse@beispiel.example.com", acting_for: "Beispiel GmbH" }, de),
    ).toBe("Ben Muster · kasse@beispiel.example.com · für Beispiel GmbH");
    expect(payerPackageSignerText(null, de)).toBe("");
  });

  it("states the payer's identification by the QES, a demo one as a test", () => {
    expect(payerPackageIdentificationText(state().payer_identification, de)).toEqual({
      tone: "neutral",
      text: "Identifizierung des Zahlers (QES): noch nicht erfolgt",
    });
    expect(payerPackageIdentificationText({ qes_signed_at: "2026-10-07T08:15:00Z", qes_test_mode: true, own_account_payment_confirmed_at: null }, ru)).toEqual({
      tone: "info",
      text: "Идентификация плательщика (QES): подписано 07.10.2026 · тест, без юридической силы",
    });
    expect(payerPackageIdentificationText(null, ru)).toBeNull();
  });

  it("starts the invitation in the suggested language", () => {
    expect(payerPackageLanguageOf(state(), null)).toBe("en");
    expect(payerPackageLanguageOf(state(), "fr")).toBe("fr");
    // Not a language of Skribble: the suggestion, else German.
    expect(payerPackageLanguageOf(state(), "uk")).toBe("en");
    expect(payerPackageLanguageOf(state({ suggested_language: "ru" }), null)).toBe("de");
    expect(payerPackageLanguageOf(state({ suggested_language: null }, { language: "it" }), null)).toBe("it");
  });
});

describe("payer package actions", () => {
  it("offers prepare first, then prepare again and send", () => {
    expect(payerPackageActions(state(), true)).toEqual({ prepare: "first", sendShown: false, sendEnabled: false, details: false });
    expect(payerPackageActions(state({ can_send: true }, {}), true)).toEqual({
      prepare: "again",
      sendShown: true,
      sendEnabled: true,
      details: false,
    });
  });

  it("keeps a disabled send for an outdated package or without the signature", () => {
    const outdated = state({ can_send: false }, { outdated_reasons: ["cost_estimate_changed"] });
    expect(payerPackageActions(outdated, true)).toMatchObject({ prepare: "again", sendShown: true, sendEnabled: false });
    expect(payerPackageActions(state({ can_send: false, signature_enabled: false }, {}), true)).toMatchObject({
      sendShown: true,
      sendEnabled: false,
    });
  });

  it("offers nothing without leads.edit or the role, and no send while pending", () => {
    expect(payerPackageActions(state({ can_send: true }, {}), false)).toEqual({
      prepare: null,
      sendShown: false,
      sendEnabled: false,
      details: false,
    });
    // Sales: the server allows neither.
    expect(payerPackageActions(state({ can_prepare: false, can_send: false }, {}), true)).toMatchObject({ prepare: null, sendShown: false });
    const pending = state({ can_prepare: false, can_send: false }, { status: "pending", request_id: "request-1", sent_at: "2026-10-06T11:00:00Z" });
    expect(payerPackageActions(pending, true)).toEqual({ prepare: null, sendShown: false, sendEnabled: false, details: true });
    // A declined package can go out again.
    expect(payerPackageActions(state({ can_send: true }, { status: "declined", request_id: "request-1" }), true)).toMatchObject({
      sendShown: true,
      sendEnabled: true,
      details: true,
    });
  });

  it("keeps the standalone Kostenübernahmeerklärung only without a payer statement", () => {
    expect(standaloneCostAssumptionKept(null)).toBe(true);
    expect(standaloneCostAssumptionKept(state({ mode: null, blocked_reason: "no_third_party" }))).toBe(true);
    expect(standaloneCostAssumptionKept(state({ blocked_reason: "payer_not_submitted" }))).toBe(true);
    expect(standaloneCostAssumptionKept(state())).toBe(false);
    expect(standaloneCostAssumptionKept(state({ blocked_reason: "cost_estimate_consent_missing" }))).toBe(false);
  });
});

describe("payer package errors", () => {
  const error = (code: string, body: Record<string, unknown> = {}) =>
    new ApiRequestError(code, { status: 409, code, body: { error: code, code, message: code, ...body } });

  it("words the refusals of prepare and send", () => {
    expect(payerPackageErrorText(error("payer_package_outdated", { reasons: ["payer_changed", "document_replaced"] }), de)).toBe(
      "Die Unterlagen sind veraltet – bitte neu erstellen: die Angaben zum Zahler haben sich geändert; ein Dokument des Pakets wurde ersetzt oder gelöscht",
    );
    expect(payerPackageErrorText(error("cost_estimate_consent_missing"), ru)).toBe(
      "Пациент ещё не согласился на передачу сметы плательщику",
    );
    expect(payerPackageErrorText(error("payer_package_pending"), de)).toBe("Das Paket ist bereits gesendet und wartet auf Unterschrift");
    expect(payerPackageErrorText(error("signature_not_configured"), ru)).toBe("Электронная подпись не подключена");
    expect(payerPackageErrorText(error("payer_package_signers_required"), de)).toBe(
      "Die Unterlagen des Zahlers unterschreiben nur der Zahler und die GMED-Vertretung – ohne Patientenseite.",
    );
    expect(payerPackageErrorText(error("signature_already_pending"), de)).toBe(
      "Eines der Dokumente ist bereits in einer anderen Anfrage zur Unterschrift versendet.",
    );
    expect(payerPackageErrorText(error("agency_signer_missing"), de)).toContain("Keine GMED-Unterschrift hinterlegt");
  });

  it("leaves anything else to the caller", () => {
    expect(payerPackageErrorText(error("forbidden"), de)).toBeNull();
    expect(payerPackageErrorText(new Error("network"), de)).toBeNull();
  });
});
