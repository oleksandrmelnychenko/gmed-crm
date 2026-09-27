import { describe, expect, it } from "vitest";

import {
  creditTransferDefaultAmount,
  creditTransferProblem,
  paymentOverpayment,
} from "./overpayment";

describe("overpayments", () => {
  it("reports the part of a receipt above the open balance", () => {
    expect(paymentOverpayment("1152.20", "452.20")).toBe(700);
    expect(paymentOverpayment("452.20", "452.20")).toBe(0);
    expect(paymentOverpayment("100", "0")).toBe(100);
    expect(paymentOverpayment("", "10")).toBe(0);
  });
});

describe("credit transfers", () => {
  it("proposes the credit up to the target balance", () => {
    expect(creditTransferDefaultAmount("700", "452.2")).toBe("452.20");
    expect(creditTransferDefaultAmount("100", "452.2")).toBe("100.00");
    expect(creditTransferDefaultAmount("100", undefined)).toBe("");
  });

  it("keeps a transfer within the credit and the target balance", () => {
    expect(creditTransferProblem("100", "700", "452.2")).toBeNull();
    expect(creditTransferProblem("0", "700", "452.2")).toBe("invalid_amount");
    expect(creditTransferProblem("700.01", "700", "800")).toBe("exceeds_credit");
    expect(creditTransferProblem("500", "700", "452.2")).toBe("exceeds_target");
    expect(creditTransferProblem("100", "700", undefined)).toBe("no_target");
  });
});
