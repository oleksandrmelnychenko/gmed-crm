import { appDateKey } from "@/lib/app-time-zone";
import type { ContractItem } from "@/pages/contracts/model/types";
import type { DocumentItem } from "@/pages/documents/model/types";

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
