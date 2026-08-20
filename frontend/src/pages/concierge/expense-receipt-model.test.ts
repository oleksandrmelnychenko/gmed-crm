import { describe, expect, it } from "vitest";

import {
  CONCIERGE_EXPENSE_MAX_FILE_SIZE,
  calculateConciergeExpenseGross,
  conciergeExpenseConsequencePreview,
  moneyStringToMinorUnits,
  validateConciergeExpenseReceiptFile,
} from "./expense-receipt-model";

describe("Concierge expense receipt model", () => {
  it("validates camera images and PDFs without trusting an unsupported MIME type", () => {
    expect(validateConciergeExpenseReceiptFile({
      name: "taxi-receipt.jpg",
      size: 2_400,
      type: "image/jpeg",
    })).toBeNull();
    expect(validateConciergeExpenseReceiptFile({
      name: "hotel.pdf",
      size: 8_000,
      type: "application/octet-stream",
    })).toBeNull();
    expect(validateConciergeExpenseReceiptFile({
      name: "receipt.svg",
      size: 8_000,
      type: "image/svg+xml",
    })).toBe("unsupported_type");
    expect(validateConciergeExpenseReceiptFile({
      name: "huge.pdf",
      size: CONCIERGE_EXPENSE_MAX_FILE_SIZE + 1,
      type: "application/pdf",
    })).toBe("too_large");
    expect(validateConciergeExpenseReceiptFile(null)).toBe("required");
  });

  it("uses exact minor units for net, VAT and gross", () => {
    expect(moneyStringToMinorUnits("12,30")).toBe(1_230);
    expect(moneyStringToMinorUnits("0.07")).toBe(7);
    expect(moneyStringToMinorUnits("12.345")).toBeNull();
    expect(calculateConciergeExpenseGross("100.00", "19.00")).toBe("119.00");
    expect(calculateConciergeExpenseGross("", "19.00")).toBe("");
  });

  it("previews balance effects only for the later financial approval", () => {
    expect(conciergeExpenseConsequencePreview("patient", true, "119.00")).toEqual({
      patientReceivableGross: "0.00",
      providerLiabilityGross: "0.00",
      companyPaidGross: "0.00",
    });
    expect(conciergeExpenseConsequencePreview("agency", true, "119.00")).toEqual({
      patientReceivableGross: "119.00",
      providerLiabilityGross: "0.00",
      companyPaidGross: "119.00",
    });
    expect(conciergeExpenseConsequencePreview("unpaid", false, "119.00")).toEqual({
      patientReceivableGross: "0.00",
      providerLiabilityGross: "119.00",
      companyPaidGross: "0.00",
    });
    expect(conciergeExpenseConsequencePreview("unpaid", true, "119.00")).toEqual({
      patientReceivableGross: "119.00",
      providerLiabilityGross: "119.00",
      companyPaidGross: "0.00",
    });
  });
});
