/**
 * The payer's signature package in the staff wizard (contract phase 3b,
 * section 6.1): the four documents, why the package cannot be prepared or
 * sent, why a prepared one is outdated, the status line, the error texts and
 * what may be done now.
 */
import type { StatusTone } from "@/components/ui-shell";
import { ApiRequestError } from "@/lib/api";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { signatureErrorText } from "@/pages/documents/data/document-signature-api";

import {
  PAYER_PACKAGE_BLOCKED_REASONS,
  PAYER_PACKAGE_LANGUAGES,
  PAYER_PACKAGE_SLOTS,
  type LeadPayerPackageState,
  type PayerPackage,
  type PayerPackageDocument,
  type PayerPackageIdentification,
  type PayerPackageSigner,
  type PayerPackageSlot,
  type PayerPackageStatus,
  type PayerPackageSummary,
} from "../data/lead-payer-package-api";
import { payerReasonLabel, type Tx } from "./lead-payer";

export type { Tx };

/**
 * Whether a `lead.portal_updated` change touches the package: prepared or
 * sent (`payer_package`), or the payer's own answers (`payer_link`), which
 * may make it outdated or unblock it.
 */
export function payerPackageChanged(change: unknown): boolean {
  return change === "payer_package" || change === "payer_link";
}

/** The four rows of the panel. */
export function payerPackageSlotLabel(slot: PayerPackageSlot, tx: Tx): string {
  switch (slot) {
    case "self_disclosure":
      return tx("Анкета плательщика", "Selbstauskunft der zahlenden Person");
    case "cost_coverage":
      return tx("Согласие плательщика", "Kostenübernahmeerklärung");
    case "patient_statement":
      return tx("Данные пациента о плательщике", "Erklärung zur Kostenübernahme durch Dritte");
    case "cost_estimate":
      return tx("Смета для плательщика", "Kostenvoranschlag für den Zahler");
  }
}

/** Each slot with its document of the package, in the bundle's order; `null` before preparing. */
export function payerPackageRows(
  pkg: Pick<PayerPackage, "documents"> | null | undefined,
): { slot: PayerPackageSlot; document: PayerPackageDocument | null }[] {
  return PAYER_PACKAGE_SLOTS.map((slot) => ({
    slot,
    document: pkg?.documents.find((item) => item.slot === slot) ?? null,
  }));
}

/** Why the package cannot be prepared now, as a sentence; `missing` names the gaps of the declaration. */
export function payerPackageBlockedReasonText(
  reason: string | null | undefined,
  tx: Tx,
  missing: readonly string[] = [],
): string {
  switch (reason) {
    case "lead_converted":
      return tx(
        "Лид уже переведён в пациенты: документы плательщику больше не готовятся и не отправляются",
        "Der Lead wurde bereits umgewandelt: Unterlagen für den Zahler werden nicht mehr erstellt oder gesendet",
      );
    case "lead_deleted":
      return tx("Лид удалён", "Der Lead wurde gelöscht");
    case "no_third_party":
      return tx(
        "Пакет нужен только для плательщика — третьего лица",
        "Das Paket ist nur für einen dritten Zahler vorgesehen",
      );
    case "payer_not_submitted":
      return tx(
        "Плательщик ещё не отправил свою анкету: документы готовятся после неё",
        "Der Zahler hat seine Angaben noch nicht gesendet: Die Unterlagen werden danach erstellt",
      );
    case "payer_declaration_incomplete": {
      const prefix = tx("Не хватает данных в разделе «Кто платит»", "Angaben „Wer zahlt“ unvollständig");
      const details = missing.map((code) => payerReasonLabel(code, tx));
      return details.length > 0 ? `${prefix}: ${details.join("; ")}` : prefix;
    }
    case "order_missing":
      return tx("Сначала создайте заказ", "Zuerst den Auftrag erstellen");
    case "cost_estimate_missing":
      return tx(
        "Сначала создайте смету к заказу (Kostenvoranschlag)",
        "Zuerst den Kostenvoranschlag zum Auftrag erstellen",
      );
    case "cost_estimate_consent_missing":
      return tx(
        "Пациент ещё не согласился на передачу сметы плательщику",
        "Die Patientin / der Patient hat der Weitergabe des Kostenvoranschlags noch nicht zugestimmt",
      );
    case "payer_signer_incomplete":
      return tx(
        "Не хватает имени или подтверждённого e-mail подписанта",
        "Name oder bestätigte E-Mail-Adresse der unterschreibenden Person fehlt",
      );
    case "payer_documents_pending":
      return tx(
        "Один из документов плательщика уже отправлен на подпись в другом запросе",
        "Eines der Dokumente für den Zahler ist bereits in einer anderen Signaturanfrage",
      );
    default:
      return tx(
        "Документы плательщику сейчас подготовить нельзя",
        "Die Unterlagen für den Zahler können derzeit nicht erstellt werden",
      );
  }
}

/** Why a prepared package is outdated, as a list item. */
export function payerPackageOutdatedReasonText(reason: string, tx: Tx): string {
  switch (reason) {
    case "payer_answers_changed":
      return tx("плательщик изменил ответы анкеты", "der Zahler hat seine Angaben geändert");
    case "payer_changed":
      return tx("изменились данные плательщика", "die Angaben zum Zahler haben sich geändert");
    case "signer_changed":
      return tx("изменился подписант", "die unterschreibende Person hat sich geändert");
    case "cost_estimate_changed":
      return tx("появилась новая версия сметы", "es gibt eine neue Fassung des Kostenvoranschlags");
    case "patient_statement_changed":
      return tx("пациент изменил данные о плательщике", "die Angaben der Patientenseite zum Zahler haben sich geändert");
    case "document_replaced":
      return tx("документ пакета заменён или удалён", "ein Dokument des Pakets wurde ersetzt oder gelöscht");
    default:
      return tx("данные изменились", "die Angaben haben sich geändert");
  }
}

/** The heading of the outdated list: re-create before sending, or withdraw what was sent. */
export function payerPackageOutdatedHeading(status: PayerPackageStatus, tx: Tx): string {
  return status === "sending" || status === "pending" || status === "needs_review"
    ? tx(
        "Отправленные документы устарели — отзовите запрос и подготовьте документы заново:",
        "Die gesendeten Unterlagen sind veraltet – Anfrage zurückziehen und neu erstellen:",
      )
    : tx(
        "Документы устарели — пересоздайте их перед отправкой:",
        "Die Unterlagen sind veraltet – vor dem Senden neu erstellen:",
      );
}

export type PayerPackageStatusLine = { tone: StatusTone; label: string; text: string };

/** The badge and the sentence of the package's state (sent and signed with date and time). */
export function payerPackageStatusLine(pkg: PayerPackage, tx: Tx): PayerPackageStatusLine {
  const at = (value: string | null | undefined) => (value ? formatAppDateTime(value) : "");
  const by = (name: string | null) => (name ? ` (${name})` : "");
  const sent = pkg.sent_at
    ? [
        tx(`отправлено ${at(pkg.sent_at)}`, `gesendet am ${at(pkg.sent_at)}`),
        by(pkg.sent_by_name),
        pkg.language ? tx(` · язык ${pkg.language.toUpperCase()}`, ` · Sprache ${pkg.language.toUpperCase()}`) : "",
      ].join("")
    : "";
  const prepared = pkg.prepared_at
    ? `${tx(`подготовлено ${at(pkg.prepared_at)}`, `erstellt am ${at(pkg.prepared_at)}`)}${by(pkg.prepared_by_name)}`
    : tx("подготовлено", "erstellt");
  let label: string;
  let tone: StatusTone;
  let facts: string[];
  switch (pkg.status) {
    case "prepared":
      label = tx("Подготовлено", "Erstellt");
      tone = "neutral";
      facts = [prepared, tx("ещё не отправлено", "noch nicht gesendet")];
      break;
    case "sending":
      label = tx("Отправляется", "Wird gesendet");
      tone = "info";
      facts = [tx("передаётся в Skribble", "wird an Skribble übergeben"), sent];
      break;
    case "pending":
      label = tx("Ждёт подписи", "Wartet auf Unterschrift");
      tone = "info";
      facts = [sent || tx("отправлено", "gesendet"), tx("ждёт подписи плательщика", "wartet auf die Unterschrift des Zahlers")];
      break;
    case "signed":
      label = tx("Подписано", "Unterschrieben");
      tone = "success";
      facts = [
        pkg.signed_at ? tx(`подписано ${at(pkg.signed_at)}`, `unterschrieben am ${at(pkg.signed_at)}`) : tx("подписано", "unterschrieben"),
        sent,
      ];
      break;
    case "needs_review":
      label = tx("Нужна проверка", "Prüfung nötig");
      tone = "warning";
      facts = [
        tx("результат Skribble нужно проверить в «Подробностях»", "das Ergebnis von Skribble ist unter „Details“ zu prüfen"),
        sent,
      ];
      break;
    case "declined":
      label = tx("Отклонено", "Abgelehnt");
      tone = "error";
      facts = [tx("плательщик отклонил подписание", "der Zahler hat die Unterschrift abgelehnt"), sent];
      break;
    case "withdrawn":
      label = tx("Отозвано", "Zurückgezogen");
      tone = "neutral";
      facts = [tx("запрос отозван", "Anfrage zurückgezogen"), sent];
      break;
    case "expired":
      label = tx("Срок истёк", "Abgelaufen");
      tone = "warning";
      facts = [tx("плательщик не подписал в срок", "der Zahler hat nicht rechtzeitig unterschrieben"), sent];
      break;
    case "error":
      label = tx("Ошибка", "Fehler");
      tone = "error";
      facts = [tx("отправка не удалась", "der Versand ist fehlgeschlagen"), sent];
      break;
  }
  const text = facts.filter(Boolean).join(" · ");
  return { tone, label, text: text.charAt(0).toUpperCase() + text.slice(1) };
}

/**
 * The package as one phrase for the payer link panel ("Пакет на подпись: …"),
 * from the payer declaration's status; `null` (none prepared) reads as such.
 */
export function payerPackageSummaryText(summary: PayerPackageSummary | null, tx: Tx): string {
  if (!summary) return tx("ещё не подготовлен", "noch nicht erstellt");
  let text: string;
  switch (summary.status) {
    case "prepared":
      text = tx("подготовлен, не отправлен", "erstellt, nicht gesendet");
      break;
    case "sending":
      text = tx("отправляется", "wird gesendet");
      break;
    case "pending":
      text = summary.sent_at
        ? tx(`отправлен ${formatAppDate(summary.sent_at)}, ждёт подписи`, `gesendet am ${formatAppDate(summary.sent_at)}, wartet auf Unterschrift`)
        : tx("отправлен, ждёт подписи", "gesendet, wartet auf Unterschrift");
      break;
    case "signed":
      text = summary.signed_at
        ? tx(`подписан ${formatAppDate(summary.signed_at)}`, `unterschrieben am ${formatAppDate(summary.signed_at)}`)
        : tx("подписан", "unterschrieben");
      break;
    case "needs_review":
      text = tx("нужна проверка", "Prüfung nötig");
      break;
    case "declined":
      text = tx("отклонён плательщиком", "vom Zahler abgelehnt");
      break;
    case "withdrawn":
      text = tx("отозван", "zurückgezogen");
      break;
    case "expired":
      text = tx("срок истёк", "abgelaufen");
      break;
    case "error":
      text = tx("ошибка отправки", "Fehler beim Versand");
      break;
  }
  return summary.outdated ? `${text}, ${tx("устарел", "veraltet")}` : text;
}

/** Statuses from which the package can go out (again). */
const SENDABLE_STATUSES: readonly PayerPackageStatus[] = ["prepared", "declined", "withdrawn", "expired", "error"];

export type PayerPackageActions = {
  /** "Подготовить документы" (no package yet) or "Пересоздать документы". */
  prepare: "first" | "again" | null;
  /** The send button is offered (enabled only with `sendEnabled`). */
  sendShown: boolean;
  sendEnabled: boolean;
  /** The details of the sent request (withdraw, refresh, review, report). */
  details: boolean;
};

/**
 * What the panel offers now. The server decides by role and state
 * (`can_prepare`, `can_send`: CEO and Patient Manager); the wizard adds
 * `leads.edit`, as for the neighbouring blocks. A package that could go out
 * but is outdated, or while the signature is not connected, keeps a disabled
 * send button (the panel names the reason). The details exist once the
 * package was sent.
 */
export function payerPackageActions(state: LeadPayerPackageState, canEdit: boolean): PayerPackageActions {
  const pkg = state.package;
  const prepare = canEdit && state.can_prepare ? (pkg ? "again" : "first") : null;
  const sendable = Boolean(pkg && SENDABLE_STATUSES.includes(pkg.status));
  const sendShown = canEdit && sendable && (state.can_send || state.can_prepare);
  return {
    prepare,
    sendShown,
    sendEnabled: sendShown && state.can_send,
    details: Boolean(pkg?.request_id && pkg.documents.some((item) => item.slot === "self_disclosure")),
  };
}

/**
 * Whether the wizard keeps its standalone "Kostenübernahmeerklärung
 * erstellen": without a package state (older server, no payer who signs a
 * package), and while the payer has sent no statement — a payer that staff
 * filled in is never asked (contract, open question 7).
 */
export function standaloneCostAssumptionKept(state: Pick<LeadPayerPackageState, "mode" | "blocked_reason"> | null | undefined): boolean {
  if (!state?.mode) return true;
  return state.blocked_reason === "payer_not_submitted" || state.blocked_reason === "no_third_party";
}

/** "Электронная подпись не подключена". */
export function payerPackageSignatureDisabledText(tx: Tx): string {
  return tx("Электронная подпись не подключена", "Elektronische Signatur ist nicht verbunden");
}

/** "TEST (DEMO): ohne Rechtswirkung": a package of Skribble's demo mode. */
export function payerPackageTestModeLabel(tx: Tx): string {
  return tx("ТЕСТ (DEMO): без юридической силы", "TEST (DEMO): ohne Rechtswirkung");
}

/** "Viktor Zahler · viktor.zahler@example.com · für Beispiel GmbH"; "" without a name and an e-mail. */
export function payerPackageSignerText(signer: PayerPackageSigner | null | undefined, tx: Tx): string {
  if (!signer) return "";
  const name = [signer.first_name, signer.last_name].filter(Boolean).join(" ");
  return [
    name,
    signer.email ?? "",
    signer.acting_for ? tx(`от имени ${signer.acting_for}`, `für ${signer.acting_for}`) : "",
  ].filter(Boolean).join(" · ");
}

/** The payer's identification by the qualified signature, from the package state. */
export function payerPackageIdentificationText(
  identification: PayerPackageIdentification | null | undefined,
  tx: Tx,
): { tone: StatusTone; text: string } | null {
  if (!identification) return null;
  const prefix = tx("Идентификация плательщика (QES): ", "Identifizierung des Zahlers (QES): ");
  if (!identification.qes_signed_at) {
    return { tone: "neutral", text: `${prefix}${tx("ещё нет", "noch nicht erfolgt")}` };
  }
  const signed = tx(`подписано ${formatAppDate(identification.qes_signed_at)}`, `signiert am ${formatAppDate(identification.qes_signed_at)}`);
  return identification.qes_test_mode
    ? { tone: "info", text: `${prefix}${signed} · ${tx("тест, без юридической силы", "Test, ohne Rechtswirkung")}` }
    : { tone: "success", text: `${prefix}${signed}` };
}

/** The languages Skribble invites in, as offered by the server, else the four. */
export function payerPackageLanguages(state: Pick<LeadPayerPackageState, "languages">): string[] {
  const offered = state.languages.filter((code) => (PAYER_PACKAGE_LANGUAGES as readonly string[]).includes(code));
  return offered.length > 0 ? offered : [...PAYER_PACKAGE_LANGUAGES];
}

/** The language the invitation starts in: the staff's choice, the package's, the suggestion, German. */
export function payerPackageLanguageOf(
  state: Pick<LeadPayerPackageState, "languages" | "suggested_language" | "package">,
  chosen: string | null,
): string {
  const languages = payerPackageLanguages(state);
  for (const candidate of [chosen, state.package?.language, state.suggested_language]) {
    if (candidate && languages.includes(candidate)) return candidate;
  }
  return languages.includes("de") ? "de" : languages[0];
}

function errorCode(error: unknown): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  const body = error.body;
  if (body && typeof body.code === "string") return body.code;
  if (body && typeof body.error === "string") return body.error;
  return typeof error.code === "string" ? error.code : null;
}

/** Errors of the signing module that pass through "send" (contract 4.3). */
const SIGNATURE_ERROR_CODES = new Set([
  "signature_already_pending",
  "document_already_signed",
  "document_superseded",
  "document_unavailable",
  "document_changed",
  "signature_bundle_too_large",
  "signature_pdf_already_signed",
  "signature_bundle_invalid_pdf",
  "signature_level_too_low",
  "signature_policy_conflict",
  "payer_package_signers_required",
  "payer_and_agency_required",
  "signature_package_scope_mismatch",
  "signature_package_size",
  "electronic_form_excluded",
]);

/**
 * The localized reason "prepare" or "send" failed; `null` for anything else
 * (the caller's fallback).
 */
export function payerPackageErrorText(error: unknown, tx: Tx): string | null {
  const code = errorCode(error);
  if (!code) return null;
  if ((PAYER_PACKAGE_BLOCKED_REASONS as readonly string[]).includes(code)) {
    const body = error instanceof ApiRequestError ? error.body : null;
    const missing = Array.isArray(body?.missing)
      ? body.missing.filter((item): item is string => typeof item === "string")
      : [];
    return payerPackageBlockedReasonText(code, tx, missing);
  }
  if (SIGNATURE_ERROR_CODES.has(code)) return signatureErrorText(code, tx);
  switch (code) {
    case "payer_package_pending":
      return tx("Пакет уже отправлен и ждёт подписи", "Das Paket ist bereits gesendet und wartet auf Unterschrift");
    case "payer_package_signed":
      return tx("Пакет уже подписан", "Das Paket ist bereits unterschrieben");
    case "payer_package_not_prepared":
      return tx("Сначала подготовьте документы", "Zuerst die Unterlagen erstellen");
    case "payer_package_stale":
      return tx(
        "Документы тем временем пересоздали — проверьте новую версию",
        "Die Unterlagen wurden inzwischen neu erstellt – bitte die neue Fassung prüfen",
      );
    case "payer_package_outdated": {
      const body = error instanceof ApiRequestError ? error.body : null;
      const reasons = Array.isArray(body?.reasons)
        ? body.reasons.filter((item): item is string => typeof item === "string")
        : [];
      const prefix = tx("Документы устарели — пересоздайте их", "Die Unterlagen sind veraltet – bitte neu erstellen");
      return reasons.length > 0
        ? `${prefix}: ${reasons.map((reason) => payerPackageOutdatedReasonText(reason, tx)).join("; ")}`
        : prefix;
    }
    case "signature_not_configured":
      return payerPackageSignatureDisabledText(tx);
    case "agency_signer_missing":
      return tx(
        "Не задан подписант GMED: укажите его в настройках электронной подписи",
        "Keine GMED-Unterschrift hinterlegt: bitte in den Einstellungen der elektronischen Signatur festlegen",
      );
    default:
      return null;
  }
}
