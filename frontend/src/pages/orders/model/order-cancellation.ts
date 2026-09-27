import { ApiRequestError } from "@/lib/api";
import { roundCents } from "@/lib/money";

type Bilingual = (ru: string, de: string) => string;

/** Server bounds for the reason of `POST /orders/{id}/status {status: "cancelled"}`. */
export const ORDER_CANCEL_REASON_MIN = 3;
export const ORDER_CANCEL_REASON_MAX = 1000;

/** What stays on a cancelled order as the basis for final billing or a refund. */
export type OrderCancellationSettlement = {
  currency: string;
  /** Delivered, approved and invoiced services plus third-party costs. */
  accrued_gross: number;
  /** Released non-advance invoices minus credit notes. */
  invoiced_gross: number;
  /** Cash received from the patient minus refunds. */
  paid_gross: number;
  /** accrued − paid: positive is still owed by the patient, negative is a refund. */
  balance_gross: number;
  /** accrued − invoiced: what still needs a (final) invoice. */
  uninvoiced_gross: number;
  lines: Array<{ description: string; status: string; gross: number }>;
};

export type OrderCancellationSummary = {
  reason: string | null;
  cancelled_services: Array<{ id: string; description: string; quantity: string; gross: number }>;
  cancelled_appointment_ids: string[];
  closed_quotes: Array<{ id: string; quote_number: string; previous_status: string }>;
  rejected_amendment_ids: string[];
  settlement: OrderCancellationSettlement | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback;
}

function amount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeOrderCancellationSettlement(
  value: unknown,
): OrderCancellationSettlement | null {
  if (!value || typeof value !== "object") return null;
  const source = record(value);
  return {
    currency: text(source.currency, "EUR") || "EUR",
    accrued_gross: amount(source.accrued_gross),
    invoiced_gross: amount(source.invoiced_gross),
    paid_gross: amount(source.paid_gross),
    balance_gross: amount(source.balance_gross),
    uninvoiced_gross: amount(source.uninvoiced_gross),
    lines: list(source.lines).map((entry) => {
      const line = record(entry);
      return {
        description: text(line.description),
        status: text(line.status),
        gross: amount(line.gross),
      };
    }),
  };
}

export function normalizeOrderCancellationSummary(value: unknown): OrderCancellationSummary {
  const source = record(value);
  return {
    reason: typeof source.reason === "string" ? source.reason : null,
    cancelled_services: list(source.cancelled_services).map((entry) => {
      const service = record(entry);
      return {
        id: text(service.id),
        description: text(service.description),
        quantity: text(service.quantity, "1"),
        gross: amount(service.gross),
      };
    }),
    cancelled_appointment_ids: list(source.cancelled_appointment_ids).map((id) => text(id)),
    closed_quotes: list(source.closed_quotes).map((entry) => {
      const quote = record(entry);
      return {
        id: text(quote.id),
        quote_number: text(quote.quote_number),
        previous_status: text(quote.previous_status),
      };
    }),
    rejected_amendment_ids: list(source.rejected_amendment_ids).map((id) => text(id)),
    settlement: normalizeOrderCancellationSettlement(source.settlement),
  };
}

/** Counts characters like the server does: Unicode scalars of the trimmed text. */
export function isValidOrderCancelReason(reason: string) {
  const length = Array.from(reason.trim()).length;
  return length >= ORDER_CANCEL_REASON_MIN && length <= ORDER_CANCEL_REASON_MAX;
}

export type OrderCancellationBalance =
  | { kind: "to_bill"; amount: number }
  | { kind: "to_refund"; amount: number }
  | { kind: "settled"; amount: 0 };

/**
 * The final step after a cancellation: the patient still owes (bill it),
 * paid more than accrued (refund) or nothing is open.
 */
export function orderCancellationBalance(
  settlement: Pick<OrderCancellationSettlement, "balance_gross"> | null,
): OrderCancellationBalance {
  const balance = roundCents(settlement?.balance_gross ?? 0);
  if (balance >= 0.01) return { kind: "to_bill", amount: balance };
  if (balance <= -0.01) return { kind: "to_refund", amount: -balance };
  return { kind: "settled", amount: 0 };
}

/** The server's cancellation errors in the staff language. */
export function orderCancellationErrorMessage(error: unknown, tx: Bilingual): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "A cancellation reason of 3 to 1000 characters is required") {
    return tx(
      `Укажите причину отмены (${ORDER_CANCEL_REASON_MIN}–${ORDER_CANCEL_REASON_MAX} символов).`,
      `Bitte einen Stornogrund angeben (${ORDER_CANCEL_REASON_MIN}–${ORDER_CANCEL_REASON_MAX} Zeichen).`,
    );
  }
  if (/^Order status cannot change from \w+ to cancelled$/.test(message)) {
    return tx(
      "Заказ уже завершён или отменён — отменить его нельзя.",
      "Der Auftrag ist bereits abgeschlossen oder storniert und kann nicht storniert werden.",
    );
  }
  if (error instanceof ApiRequestError && error.status === 403) {
    return tx(
      "Недостаточно прав, чтобы отменить заказ.",
      "Für das Stornieren des Auftrags fehlen die Berechtigungen.",
    );
  }
  return message || tx("Не удалось отменить заказ.", "Der Auftrag konnte nicht storniert werden.");
}
