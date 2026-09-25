import { ApiRequestError } from "@/lib/api";

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

/** Only a still-planned line can be cancelled, and only with `orders.edit`. */
export function canCancelLeistung(
  leistung: Pick<Leistung, "status">,
  canEditOrders: boolean,
) {
  return canEditOrders && leistung.status === "planned";
}

export function leistungCancelReasonHint(tx: Bilingual) {
  return tx(
    `Укажите причину отмены (${LEISTUNG_CANCEL_REASON_MIN}–${LEISTUNG_CANCEL_REASON_MAX} символов).`,
    `Bitte einen Stornogrund angeben (${LEISTUNG_CANCEL_REASON_MIN}–${LEISTUNG_CANCEL_REASON_MAX} Zeichen).`,
  );
}

/**
 * A 409 (line no longer planned) or 404 (line gone) means the page shows a
 * stale line; the caller reloads the order so the real status appears.
 */
export function isStaleLeistungCancelError(error: unknown) {
  return error instanceof ApiRequestError && (error.status === 409 || error.status === 404);
}

export function leistungCancelErrorMessage(error: unknown, tx: Bilingual) {
  if (error instanceof ApiRequestError) {
    switch (error.status) {
      case 409:
        return tx(
          "Услугу уже нельзя отменить: отменить можно только запланированную услугу. Данные заказа обновлены.",
          "Die Leistung kann nicht mehr storniert werden: Nur geplante Leistungen lassen sich stornieren. Die Auftragsdaten wurden aktualisiert.",
        );
      case 422:
        return leistungCancelReasonHint(tx);
      case 403:
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
