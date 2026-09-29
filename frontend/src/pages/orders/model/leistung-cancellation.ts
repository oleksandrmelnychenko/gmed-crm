import { ApiRequestError } from "@/lib/api";
import {
  billingReversalBlockedMessage,
  billingReversalFinanceHint,
  type BillingReversalBlockedReason,
} from "@/lib/billing-reversal";

import type { Leistung } from "./types";

type Bilingual = (ru: string, de: string) => string;

/** Server bounds for `POST /orders/{id}/leistungen/{id}/cancel` (trimmed reason). */
export const LEISTUNG_CANCEL_REASON_MIN = 3;
export const LEISTUNG_CANCEL_REASON_MAX = 1000;

// Transport failures already carry a localized message from the API client.
const LOCALIZED_TRANSPORT_CODES = new Set(["aborted", "network", "timeout", "rate_limited"]);

/** Counts characters like the server does: Unicode scalars of the trimmed text. */
export function leistungCancelReasonLength(reason: string) {
  return Array.from(reason.trim()).length;
}

export function isValidLeistungCancelReason(reason: string) {
  const length = leistungCancelReasonLength(reason);
  return length >= LEISTUNG_CANCEL_REASON_MIN && length <= LEISTUNG_CANCEL_REASON_MAX;
}

/**
 * Any line that is not cancelled yet can be cancelled by `orders.edit` or
 * `invoices.finance` (decision 2026-09-29). The dialog asks the server what
 * that does: an invoiced line gets a credit note (CEO / billing only), a line
 * on a draft invoice waits until the draft is cancelled.
 */
export function canCancelLeistung(
  leistung: Pick<Leistung, "status">,
  canCancelOrderServices: boolean,
) {
  return (
    canCancelOrderServices &&
    ["planned", "delivered", "approved", "invoiced"].includes(leistung.status)
  );
}

export function leistungCancelReasonHint(tx: Bilingual) {
  return tx(
    `Укажите причину отмены (${LEISTUNG_CANCEL_REASON_MIN}–${LEISTUNG_CANCEL_REASON_MAX} символов).`,
    `Bitte einen Stornogrund angeben (${LEISTUNG_CANCEL_REASON_MIN}–${LEISTUNG_CANCEL_REASON_MAX} Zeichen).`,
  );
}

/** A refusal the billing-reversal texts explain (draft invoice, …). */
function billingReversalErrorMessageIfKnown(error: ApiRequestError, tx: Bilingual) {
  const code = typeof error.body?.code === "string" ? error.body.code : "";
  if (code === "order_service_cancel_requires_credit_note") {
    return tx(
      "Услуга уже в выпущенном счёте: подтвердите выставление кредит-ноты.",
      "Die Leistung ist bereits abgerechnet: Bitte die Gutschrift bestätigen.",
    );
  }
  return billingReversalBlockedMessage({ blocked_reason: code as BillingReversalBlockedReason }, tx);
}

/**
 * A 409 (line changed, e.g. already cancelled) or 404 (line gone) means the page shows a
 * stale line; the caller reloads the order so the real status appears.
 */
export function isStaleLeistungCancelError(error: unknown) {
  return error instanceof ApiRequestError && (error.status === 409 || error.status === 404);
}

export function leistungCancelErrorMessage(error: unknown, tx: Bilingual) {
  if (error instanceof ApiRequestError) {
    switch (error.status) {
      case 409: {
        const specific = billingReversalErrorMessageIfKnown(error, tx);
        if (specific) return specific;
        return tx(
          "Услугу уже нельзя отменить в этом виде. Данные заказа обновлены.",
          "Die Leistung kann so nicht mehr storniert werden. Die Auftragsdaten wurden aktualisiert.",
        );
      }
      case 422:
        return leistungCancelReasonHint(tx);
      case 403:
        if (error.body?.code === "order_service_reversal_requires_finance") {
          return billingReversalFinanceHint(tx);
        }
        return tx(
          "Недостаточно прав для отмены услуги в этом заказе.",
          "Keine Berechtigung, Leistungen in diesem Auftrag zu stornieren.",
        );
      case 404:
        return tx(
          "Услуга не найдена. Данные заказа обновлены.",
          "Die Leistung wurde nicht gefunden. Die Auftragsdaten wurden aktualisiert.",
        );
      default:
        break;
    }
    if (error.code && LOCALIZED_TRANSPORT_CODES.has(error.code) && error.message.trim()) {
      return error.message;
    }
  }
  return tx("Не удалось отменить услугу.", "Die Leistung konnte nicht storniert werden.");
}

export type LeistungCancellationNote = {
  cancelledAt: string | null;
  reason: string | null;
};

/** When and why a cancelled line was cancelled; `null` for any other status. */
export function leistungCancellationNote(
  leistung: Pick<Leistung, "status" | "cancelled_at" | "cancellation_reason">,
): LeistungCancellationNote | null {
  if (leistung.status !== "cancelled") return null;
  return {
    cancelledAt: leistung.cancelled_at?.trim() || null,
    reason: leistung.cancellation_reason?.trim() || null,
  };
}
