import { appDateKey } from "@/lib/app-time-zone";
import type { ContractItem } from "@/pages/contracts/model/types";
import type { DocumentItem } from "@/pages/documents/model/types";
import type { PatientOrderRecheck } from "./types";

export type PassportReviewStatus = "unknown" | "expired" | "expires_during_order" | "expiring" | "valid";

// Calendar dates use the same Berlin day and 90-day warning window as patient readiness.
export function passportReviewStatus(expiry: string | null | undefined, orderEnd: string | null, today = appDateKey()): PassportReviewStatus {
  if (!expiry) return "unknown";
  if (expiry < today) return "expired";
  if (orderEnd && expiry < orderEnd) return "expires_during_order";
  const days = (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return days <= 90 ? "expiring" : "valid";
}

/** Document types that are an identity document: uploaded as one, or a passport scan from the patient card or portal. */
export const IDENTITY_DOCUMENT_ARTS = ["identity", "passport", "passport_scan", "reisepass"];

type IdentityDocument = Pick<DocumentItem,
  "art" | "compliance_kind" | "signed_at" | "status" | "file_deleted_at" | "is_latest_version" | "original_filename" | "auto_name">;

/**
 * The identity document already in the patient's file: the last one staff
 * verified, else a current passport file that still waits for verification.
 */
export function identityDocumentOnFile(documents: IdentityDocument[]): { name: string; verifiedAt: string | null } | null {
  const current = documents.filter(document =>
    document.is_latest_version && document.status !== "archived" && !document.file_deleted_at
    && (document.compliance_kind === "identity" || IDENTITY_DOCUMENT_ARTS.includes(document.art)));
  const name = (document: IdentityDocument) => document.original_filename || document.auto_name || "";
  const verified = current.filter(document => document.signed_at).sort((a, b) => a.signed_at!.localeCompare(b.signed_at!)).at(-1);
  if (verified) return { name: name(verified), verifiedAt: verified.signed_at ?? null };
  const waiting = current[0];
  return waiting ? { name: name(waiting), verifiedAt: null } : null;
}

type ReviewDocument = IdentityDocument & Pick<DocumentItem, "generated_template_id">;

/** The current (latest, not archived, file present) documents of a list. */
function currentDocuments<T extends IdentityDocument>(documents: T[]): T[] {
  return documents.filter(document => document.is_latest_version && document.status !== "archived" && !document.file_deleted_at);
}

/** When the latest current document signed as one of `kinds` (compliance kind or generated template) was signed. */
export function latestSignedOn(documents: ReviewDocument[], ...kinds: string[]): string | null {
  return currentDocuments(documents)
    .filter(document => document.signed_at && kinds.some(kind => document.compliance_kind === kind || document.generated_template_id === kind))
    .map(document => document.signed_at!).sort().at(-1) ?? null;
}

/** The DSGVO consent family (mirrors the server's `DSGVO_CONSENT_DOCUMENT_CODES`). */
const DSGVO_CONSENT_DOCUMENT_CODES = ["dsgvo", "privacy_consents", "consent_data_release", "consent_data_release_child", "consent_data_release_single", "consent_form", "einverstaendniserklaerung", "gdpr_consent", "consent"];

/** When the latest current DSGVO consent of any template or type was signed. */
export function dsgvoConsentSignedOn(documents: ReviewDocument[]): string | null {
  return currentDocuments(documents)
    .filter(document => document.signed_at && (document.compliance_kind === "dsgvo" || DSGVO_CONSENT_DOCUMENT_CODES.includes(document.art) || DSGVO_CONSENT_DOCUMENT_CODES.includes(document.generated_template_id ?? "")))
    .map(document => document.signed_at!).sort().at(-1) ?? null;
}

export type MissingRequiredDocument = { key: string; label: string };

/**
 * The required documents the patient card still lacks once the documents in
 * hand are counted. The card's alerts see only the patient's own files; the
 * two shipped rules (`passport`, `consent_form`) are matched here against the
 * documents of the current request too, so the count agrees with the rows
 * above it. Rules an administrator added stay as the server reports them.
 */
export function stillMissingRequiredDocuments(missing: MissingRequiredDocument[], documents: ReviewDocument[]): MissingRequiredDocument[] {
  const identity = identityDocumentOnFile(documents);
  const consentSignedOn = dsgvoConsentSignedOn(documents);
  return missing.filter(rule => !(rule.key === "passport" && identity) && !(rule.key === "consent_form" && consentSignedOn));
}

export type DocumentCheckKey = "compliance_ready" | "confidentiality_release_ready" | "identity_ready" | "document_pack_ready";
export type DocumentCheckStatus = "not_checked" | "confirmed" | "signed" | "verified" | "on_file" | "out_of_sync" | "missing";
export type DocumentCheckReadiness = Pick<PatientOrderRecheck, "requires_recheck" | DocumentCheckKey>
  & { document_alerts: Pick<PatientOrderRecheck["document_alerts"], "missing_count" | "out_of_sync" | "missing_documents"> };

/** What the documents in hand say about the checks, for when the patient card's flags do not yet. */
export type DocumentCheckEvidence = {
  consentDate: string | null;
  releaseDate: string | null;
  identity: ReturnType<typeof identityDocumentOnFile>;
  missingDocuments: MissingRequiredDocument[];
};

export function documentCheckEvidence(readiness: Pick<DocumentCheckReadiness, "document_alerts">, documents: ReviewDocument[]): DocumentCheckEvidence {
  return {
    consentDate: latestSignedOn(documents, "dsgvo", "privacy_consents") ?? dsgvoConsentSignedOn(documents),
    releaseDate: latestSignedOn(documents, "confidentiality_release"),
    identity: identityDocumentOnFile(documents),
    missingDocuments: stillMissingRequiredDocuments(readiness.document_alerts.missing_documents, documents),
  };
}

/**
 * The status of one patient document check. The card's flags (`legal_status`)
 * are written when a lead is converted or staff confirm the card, so before
 * that a consent signed or an identity scan verified in the request itself is
 * read from the document — the same source as the row's details — instead of
 * being reported as missing (QA 2026-10-25, map item 96). Without a re-check
 * the flags are not evidence either way (a false one is a revoked consent).
 */
export function documentCheckStatus(key: DocumentCheckKey, readiness: DocumentCheckReadiness, evidence: DocumentCheckEvidence): DocumentCheckStatus {
  const alerts = readiness.document_alerts;
  if (!readiness.requires_recheck) return "not_checked";
  if (readiness[key]) {
    return key === "document_pack_ready" && (alerts.missing_count > 0 || alerts.out_of_sync) ? "out_of_sync" : "confirmed";
  }
  switch (key) {
    case "compliance_ready": return evidence.consentDate ? "signed" : "missing";
    case "confidentiality_release_ready": return evidence.releaseDate ? "signed" : "missing";
    case "identity_ready": return evidence.identity?.verifiedAt ? "verified" : "missing";
    case "document_pack_ready":
      return alerts.missing_count > 0 && !alerts.out_of_sync && evidence.missingDocuments.length === 0 ? "on_file" : "missing";
  }
}

export function isDocumentCheckReady(status: DocumentCheckStatus): boolean {
  return status === "confirmed" || status === "signed" || status === "verified" || status === "on_file";
}

export const DOCUMENT_CHECK_STATUS_LABELS: Record<DocumentCheckStatus, [string, string]> = {
  not_checked: ["Проверка ещё не выполнена", "Noch nicht geprüft"],
  confirmed: ["Подтверждено в карточке", "In der Akte bestätigt"],
  signed: ["Подписано", "Unterzeichnet"],
  verified: ["Проверен", "Geprüft"],
  on_file: ["Документы есть", "Dokumente vorhanden"],
  out_of_sync: ["Есть расхождения — проверьте документы", "Abweichungen — Dokumente prüfen"],
  missing: ["Нужно проверить / дополнить", "Prüfen / ergänzen"],
};

export type ContractUsability = "usable" | "terminated" | "expired" | "draft" | "sent";

// Framework contracts are open-ended: only the status decides whether a contract can back an order.
export function contractUsability(contract: Pick<ContractItem, "status">): ContractUsability {
  switch (contract.status) {
    case "signed": return "usable";
    case "terminated": return "terminated";
    case "expired": return "expired";
    case "sent": return "sent";
    default: return "draft";
  }
}

/**
 * The contract a new order of this patient is attached to when staff choose
 * none: the latest signed one, as the server picks it.
 */
export function defaultOrderContractId(contracts: Pick<ContractItem, "id" | "status" | "signed_at" | "created_at">[]): string | null {
  const usable = contracts.filter(contract => contractUsability(contract) === "usable");
  const moment = (contract: (typeof usable)[number]) => contract.signed_at ?? contract.created_at;
  return [...usable].sort((a, b) => moment(b).localeCompare(moment(a)) || b.created_at.localeCompare(a.created_at))[0]?.id ?? null;
}

export const PASSPORT_REVIEW_LABELS: Record<PassportReviewStatus, [string, string]> = {
  unknown: ["Срок не указан — уточните", "Gültigkeit fehlt — bitte klären"],
  expired: ["Паспорт просрочен", "Reisepass abgelaufen"],
  expires_during_order: ["Истекает до окончания заказа", "Läuft vor Auftragsende ab"],
  expiring: ["Истекает в ближайшие 90 дней", "Läuft innerhalb von 90 Tagen ab"],
  valid: ["Паспорт действителен", "Reisepass gültig"],
};

export const CONTRACT_USABILITY_LABELS: Record<ContractUsability, [string, string]> = {
  usable: ["Подписан, действует", "Unterzeichnet, gültig"],
  draft: ["Черновик", "Entwurf"], sent: ["Ожидает подписи", "Unterschrift ausstehend"],
  terminated: ["Расторгнут", "Gekündigt"], expired: ["Истёк", "Abgelaufen"],
};
