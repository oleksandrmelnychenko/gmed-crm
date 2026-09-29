import { useSyncExternalStore } from "react";

import { ApiRequestError } from "@/lib/api";
import type { BillingReversalPreview } from "@/lib/billing-reversal";
import { APPOINTMENT_CANCEL_BILLED_REPORT_CODE } from "@/pages/appointments/model/completion-rules";
import type { AppointmentRecurringActionScope } from "@/pages/appointments/model/types";

/**
 * Cancelling a visit whose approved interpreter report is billed answers 409
 * `appointment_cancel_billed_report` (decision 2026-09-29). Instead of an
 * error the page opens a confirm dialog that cancels the visit with its
 * billing reversed: the report's order line is cancelled, with a credit note
 * when a released invoice bills it.
 */
export type AppointmentBillingReversalRequest = {
  appointmentId: string;
  recurrenceScope: AppointmentRecurringActionScope;
  interpreterName: string;
  hours: string;
  orderNumber: string | null;
  lineDescription: string | null;
  /** What reversing the report's line does; `null` while no line exists yet. */
  reversal: BillingReversalPreview | null;
  onDone: () => void;
};

let current: AppointmentBillingReversalRequest | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function requestAppointmentBillingReversal(request: AppointmentBillingReversalRequest) {
  current = request;
  emit();
}

export function closeAppointmentBillingReversal() {
  current = null;
  emit();
}

export function useAppointmentBillingReversalRequest() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}

function text(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/**
 * The reversal request of a refused cancellation, or `null` when the error is
 * something else.
 */
export function billingReversalRequestFromError(
  error: unknown,
  appointmentId: string,
  recurrenceScope: AppointmentRecurringActionScope,
  onDone: () => void,
): AppointmentBillingReversalRequest | null {
  if (!(error instanceof ApiRequestError) || !error.body) return null;
  const body = error.body as Record<string, unknown>;
  if (body.code !== APPOINTMENT_CANCEL_BILLED_REPORT_CODE || body.reverse_billing_available !== true) {
    return null;
  }
  const reversal =
    body.reversal && typeof body.reversal === "object"
      ? (body.reversal as BillingReversalPreview)
      : null;
  return {
    appointmentId,
    recurrenceScope,
    interpreterName: text(body, "interpreter_name") || "—",
    hours: text(body, "hours").replace(".", ","),
    orderNumber: text(body, "order_number") || null,
    lineDescription: text(body, "order_leistung_description") || null,
    reversal,
    onDone,
  };
}
