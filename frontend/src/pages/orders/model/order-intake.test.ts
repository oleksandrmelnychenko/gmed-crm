import { describe, expect, it } from "vitest";
import { isContractUsable, formatIntakeDate, intakeTotal } from "./order-intake";

describe("repeat patient order", () => {
  it("reuses any signed framework contract, whatever the order period", () => {
    expect(isContractUsable({ status: "signed" })).toBe(true);
    expect(isContractUsable({ status: "terminated" })).toBe(false);
    expect(isContractUsable({ status: "expired" })).toBe(false);
    expect(isContractUsable({ status: "sent" })).toBe(false);
  });
  it("displays calendar dates without a timezone shift", () => {
    expect(formatIntakeDate("2026-12-05")).toBe("05.12.2026");
    expect(formatIntakeDate(null)).toBe("—");
  });
  it("rounds VAT on each service before summing", () => {
    const line = { id: "a", description: "Service", quantity: "3", unit_price: "0.33", vat_rate: "19", agency_service_id: null, agency_service_price_version_id: null };
    expect(intakeTotal([line, { ...line, id: "b" }])).toBe(2.36);
    expect(intakeTotal([{ ...line, quantity: "1,5", unit_price: "100" }])).toBe(178.5);
  });
});
