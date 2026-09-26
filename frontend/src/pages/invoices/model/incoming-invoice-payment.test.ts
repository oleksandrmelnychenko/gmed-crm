import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  canMarkInvoicePaidByPatient,
  patientBillingState,
  patientPaymentErrorReason,
} from "./incoming-invoice-payment";

describe("incoming invoice patient billing state", () => {
  const hotel = {
    invoice_scope: "patient_order",
    patient_id: "patient-1",
    status: "received",
    paid_by: "unpaid",
    remaining_gross: "481.50",
    patient_receivable_gross: "0",
    allocated_receivable_gross: "0",
    remaining_receivable_gross: "0",
  };

  it("shows a patient cost GMed has not paid yet as billable after payment", () => {
    expect(patientBillingState(hotel)).toBe("after_payment");
    expect(patientBillingState({ ...hotel, status: "approved" })).toBe("after_payment");
  });

  it("follows the patient receivable once GMed paid the supplier", () => {
    const paid = { ...hotel, status: "paid", paid_by: "agency", remaining_gross: "0", patient_receivable_gross: "481.50", remaining_receivable_gross: "481.50" };
    expect(patientBillingState(paid)).toBe("not_billed");
    expect(patientBillingState({ ...paid, allocated_receivable_gross: "100", remaining_receivable_gross: "381.50" })).toBe("partially_billed");
    expect(patientBillingState({ ...paid, allocated_receivable_gross: "481.50", remaining_receivable_gross: "0" })).toBe("billed");
  });

  it("needs no patient invoice for company costs, patient-paid or cancelled invoices", () => {
    expect(patientBillingState({ ...hotel, patient_id: null, invoice_scope: "company" })).toBe("not_required");
    expect(patientBillingState({ ...hotel, status: "paid", paid_by: "patient" })).toBe("not_required");
    expect(patientBillingState({ ...hotel, status: "cancelled" })).toBe("not_required");
  });
});

describe("incoming invoice patient payment", () => {
  it("allows the patient-paid state only for an invoice linked to a patient", () => {
    expect(canMarkInvoicePaidByPatient({ invoice_scope: "patient_order", patient_id: "patient-1" })).toBe(true);
    expect(canMarkInvoicePaidByPatient({ invoice_scope: "patient_order", patient_id: null })).toBe(false);
    expect(canMarkInvoicePaidByPatient({ invoice_scope: "company", patient_id: null })).toBe(false);
  });

  it("classifies known accounting conflicts without exposing backend copy", () => {
    expect(patientPaymentErrorReason(new ApiRequestError(
      "Company invoices cannot be paid by a patient",
      { status: 422 },
    ))).toBe("company_invoice");
    expect(patientPaymentErrorReason(new ApiRequestError(
      "Reverse company payments before changing the payer",
      { status: 409 },
    ))).toBe("company_payment_exists");
    expect(patientPaymentErrorReason(new Error("unknown"))).toBeNull();
  });
});
