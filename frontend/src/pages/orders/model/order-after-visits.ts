import type { OrderPipelineAppointment } from "./order-pipeline";

/** A document of the order as `GET /documents?order_id=` returns it (the fields used here). */
export type AfterVisitDocument = {
  id: string;
  appointment_id: string | null;
  auto_name: string | null;
  original_filename: string | null;
  is_medical: boolean;
  status: string;
  created_at: string;
  /** "outgoing" for GMED's own papers (contracts, the plan PDF). */
  document_direction?: string | null;
  /** "template:<id>" for a document GMED generated. */
  ursprung?: string | null;
};

/** A paper GMED made itself (plan PDF, contract), not one that came back from a visit. */
function isGmedOwnPaper(document: AfterVisitDocument) {
  return document.document_direction === "outgoing" || (document.ursprung ?? "").startsWith("template:");
}

/** A clinic invoice of the order with the visits it covers (`GET /orders/{id}/visit-invoices`). */
export type VisitInvoice = {
  id: string;
  external_invoice_number: string;
  invoice_date: string | null;
  amount_gross: string | number;
  currency: string;
  status: string;
  source_document_id: string | null;
  provider_name: string | null;
  appointment_ids: string[];
};

export type InterpreterState =
  | { kind: "approved" | "pending" | "rejected"; hours: number }
  | { kind: "waiting" }
  | { kind: "unassigned" }
  | { kind: "not_needed" };

/**
 * Visits the patient has been to, or should have been to: «после приёмов»
 * starts on the visit day (Europe/Berlin date key), a cancelled visit has
 * nothing to collect.
 */
export function visitsToCollect(
  appointments: readonly OrderPipelineAppointment[],
  today: string,
): OrderPipelineAppointment[] {
  return appointments
    .filter((appointment) => appointment.status !== "cancelled")
    .filter((appointment) => appointment.status === "completed" || appointment.date <= today)
    .sort((a, b) =>
      `${a.date} ${a.time_start ?? ""}`.localeCompare(`${b.date} ${b.time_start ?? ""}`),
    );
}

/**
 * The interpreter side of a visit. A visit without its own mark follows the
 * order's planning («Переводчик требуется»), as on the server.
 */
export function interpreterState(
  appointment: OrderPipelineAppointment,
  orderRequiresInterpreter = false,
): InterpreterState {
  if (appointment.report_status && appointment.report_hours != null) {
    return { kind: appointment.report_status, hours: appointment.report_hours };
  }
  if (appointment.interpreter_id) return { kind: "waiting" };
  const needed = appointment.interpreter_needed ?? orderRequiresInterpreter;
  return needed ? { kind: "unassigned" } : { kind: "not_needed" };
}

/** The doctor's next visit in the order: same doctor, or the same provider when no doctor is named. */
export function nextVisitAfter(
  appointment: OrderPipelineAppointment,
  appointments: readonly OrderPipelineAppointment[],
): OrderPipelineAppointment | null {
  const key = (item: OrderPipelineAppointment) => `${item.date} ${item.time_start ?? ""}`;
  const sameDoctor = (item: OrderPipelineAppointment) =>
    appointment.doctor_id
      ? item.doctor_id === appointment.doctor_id
      : Boolean(appointment.provider_id) && item.provider_id === appointment.provider_id;
  return (
    appointments
      .filter(
        (item) =>
          item.id !== appointment.id &&
          item.status !== "cancelled" &&
          sameDoctor(item) &&
          key(item) > key(appointment),
      )
      .sort((a, b) => key(a).localeCompare(key(b)))[0] ?? null
  );
}

/**
 * What a visit still misses. The doctor's papers always count; the
 * interpreter's report counts when an interpreter was booked or needed.
 * A clinic invoice is optional (owner 2026-11-13) and never missing.
 */
export function missingAfterVisit(
  documents: readonly AfterVisitDocument[],
  interpreter: InterpreterState,
): Array<"documents" | "report"> {
  const missing: Array<"documents" | "report"> = [];
  if (documents.length === 0) missing.push("documents");
  if (interpreter.kind !== "approved" && interpreter.kind !== "not_needed") missing.push("report");
  return missing;
}

/**
 * Medical papers that came into the order and are not sorted under a visit
 * yet; archived ones and GMED's own papers (the plan PDF) stay out.
 */
export function unsortedDocuments(documents: readonly AfterVisitDocument[]) {
  return documents.filter(
    (document) =>
      !document.appointment_id &&
      document.is_medical &&
      document.status !== "archived" &&
      !isGmedOwnPaper(document),
  );
}

export function documentsOf(documents: readonly AfterVisitDocument[], appointmentId: string) {
  return documents.filter((document) => document.appointment_id === appointmentId);
}

export function invoicesOf(invoices: readonly VisitInvoice[], appointmentId: string) {
  return invoices.filter((invoice) => invoice.appointment_ids.includes(appointmentId));
}

/** Clinic invoices left with the order alone; a cancelled one needs no sorting. */
export function unsortedInvoices(invoices: readonly VisitInvoice[]) {
  return invoices.filter((invoice) => invoice.appointment_ids.length === 0 && invoice.status !== "cancelled");
}

/** «2,5 ч» / «2,5 Std.» with the German decimal comma. */
export function hoursLabel(hours: number, lang: string) {
  const value = hours.toLocaleString("de-DE", { maximumFractionDigits: 2 });
  return lang === "de" ? `${value} Std.` : `${value} ч`;
}
