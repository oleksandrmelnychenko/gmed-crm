import { describe, expect, it } from "vitest";

import {
  hoursLabel,
  interpreterState,
  missingAfterVisit,
  nextVisitAfter,
  unsortedDocuments,
  unsortedInvoices,
  visitsToCollect,
  type AfterVisitDocument,
  type VisitInvoice,
} from "./order-after-visits";
import type { OrderPipelineAppointment } from "./order-pipeline";

function visit(id: string, date: string, overrides: Partial<OrderPipelineAppointment> = {}): OrderPipelineAppointment {
  return {
    id,
    title: id,
    appointment_type: "medical",
    date,
    time_start: "09:00",
    time_end: "10:00",
    status: "confirmed",
    location: null,
    provider_name: "Charité",
    doctor_name: "Dr. Müller",
    provider_id: "p1",
    doctor_id: "d1",
    interpreter_id: null,
    interpreter_name: null,
    interpreter_response: null,
    ...overrides,
  };
}

function paper(id: string, overrides: Partial<AfterVisitDocument> = {}): AfterVisitDocument {
  return {
    id,
    appointment_id: null,
    auto_name: id,
    original_filename: `${id}.pdf`,
    is_medical: true,
    status: "active",
    created_at: "2026-11-13T10:00:00Z",
    ...overrides,
  };
}

describe("order after visits", () => {
  it("collects from the visit day on and leaves cancelled and future visits out", () => {
    const rows = visitsToCollect(
      [
        visit("later", "2026-11-14"),
        visit("today", "2026-11-13", { time_start: "15:00" }),
        visit("early", "2026-11-13", { time_start: "08:00" }),
        visit("cancelled", "2026-11-10", { status: "cancelled" }),
        visit("done-early", "2026-11-20", { status: "completed" }),
      ],
      "2026-11-13",
    );
    expect(rows.map((row) => row.id)).toEqual(["early", "today", "done-early"]);
  });

  it("reads the interpreter's state from the report, the booking and the mark", () => {
    expect(interpreterState(visit("a", "2026-11-13", { report_hours: 2.5, report_status: "approved", interpreter_id: "i" })))
      .toEqual({ kind: "approved", hours: 2.5 });
    expect(interpreterState(visit("b", "2026-11-13", { interpreter_id: "i" }))).toEqual({ kind: "waiting" });
    expect(interpreterState(visit("c", "2026-11-13", { interpreter_needed: true }))).toEqual({ kind: "unassigned" });
    expect(interpreterState(visit("d", "2026-11-13"))).toEqual({ kind: "not_needed" });
    // No mark of its own: the order's «Переводчик требуется» decides; an explicit «no» wins.
    expect(interpreterState(visit("e", "2026-11-13"), true)).toEqual({ kind: "unassigned" });
    expect(interpreterState(visit("f", "2026-11-13", { interpreter_needed: false }), true)).toEqual({ kind: "not_needed" });
    expect(hoursLabel(2.5, "ru")).toBe("2,5 ч");
    expect(hoursLabel(1, "de")).toBe("1 Std.");
  });

  it("an invoice is never missing; papers and a pending report are", () => {
    expect(missingAfterVisit([], { kind: "not_needed" })).toEqual(["documents"]);
    expect(missingAfterVisit([paper("x")], { kind: "pending", hours: 1 })).toEqual(["report"]);
    expect(missingAfterVisit([paper("x")], { kind: "approved", hours: 1 })).toEqual([]);
  });

  it("the next visit is the same doctor's, or the same provider's without a doctor", () => {
    const all = [
      visit("first", "2026-11-10"),
      visit("other-doctor", "2026-11-11", { doctor_id: "d2" }),
      visit("second", "2026-11-12"),
      visit("third", "2026-11-15"),
      visit("lab", "2026-11-10", { doctor_id: null, provider_id: "lab" }),
      visit("lab-again", "2026-11-16", { doctor_id: null, provider_id: "lab" }),
    ];
    expect(nextVisitAfter(all[0], all)?.id).toBe("second");
    expect(nextVisitAfter(all[3], all)).toBeNull();
    expect(nextVisitAfter(all[4], all)?.id).toBe("lab-again");
  });

  it("unsorted lists keep medical papers and open invoices without a visit", () => {
    expect(
      unsortedDocuments([
        paper("loose"),
        paper("sorted", { appointment_id: "a" }),
        paper("contract", { is_medical: false }),
        paper("old", { status: "archived" }),
        paper("plan-pdf", { document_direction: "outgoing", ursprung: "template:treatment_plan" }),
        paper("generated", { ursprung: "template:treatment_plan" }),
      ]).map((item) => item.id),
    ).toEqual(["loose"]);
    const invoice = (id: string, appointment_ids: string[], status = "received"): VisitInvoice => ({
      id, external_invoice_number: id, invoice_date: null, amount_gross: "10.00", currency: "EUR",
      status, source_document_id: null, provider_name: null, appointment_ids,
    });
    expect(
      unsortedInvoices([invoice("free", []), invoice("linked", ["a"]), invoice("void", [], "cancelled")]).map(
        (item) => item.id,
      ),
    ).toEqual(["free"]);
  });
});
