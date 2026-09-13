import type { ContractItem } from "@/pages/contracts/model/types";

export type PassportReviewStatus = "unknown" | "expired" | "expires_during_order" | "expiring" | "valid";

// Calendar dates use the same UTC day and 90-day warning window as patient readiness.
export function passportReviewStatus(expiry: string | null | undefined, orderEnd: string | null, today = new Date().toISOString().slice(0, 10)): PassportReviewStatus {
  if (!expiry) return "unknown";
  if (expiry < today) return "expired";
  if (orderEnd && expiry < orderEnd) return "expires_during_order";
  const days = (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return days <= 90 ? "expiring" : "valid";
}

export function contractValidity(contract: Pick<ContractItem, "status" | "valid_from" | "valid_to">, today = new Date().toISOString().slice(0, 10)) {
  if (contract.status !== "signed") return contract.status;
  if (contract.valid_to && contract.valid_to < today) return "expired";
  if (contract.valid_from && contract.valid_from > today) return "future";
  return "valid";
}

export const PASSPORT_REVIEW_LABELS: Record<PassportReviewStatus, [string, string]> = {
  unknown: ["Срок не указан — уточните", "Gültigkeit fehlt — bitte klären"],
  expired: ["Паспорт просрочен", "Reisepass abgelaufen"],
  expires_during_order: ["Истекает до окончания заказа", "Läuft vor Auftragsende ab"],
  expiring: ["Истекает в ближайшие 90 дней", "Läuft innerhalb von 90 Tagen ab"],
  valid: ["Паспорт действителен", "Reisepass gültig"],
};

export const CONTRACT_VALIDITY_LABELS: Record<string, [string, string]> = {
  draft: ["Черновик", "Entwurf"], sent: ["Ожидает подписи", "Unterschrift ausstehend"],
  signed: ["Подписан", "Unterzeichnet"], expired: ["Срок истёк", "Abgelaufen"],
  terminated: ["Расторгнут", "Gekündigt"], future: ["Ещё не вступил в силу", "Noch nicht gültig"],
  valid: ["Действует", "Gültig"],
};
