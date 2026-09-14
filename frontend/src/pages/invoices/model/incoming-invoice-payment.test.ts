import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  canMarkInvoicePaidByPatient,
  patientPaymentErrorReason,
} from "./incoming-invoice-payment";

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
