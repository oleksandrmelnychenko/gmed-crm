import { describe, expect, it } from "vitest";
import { contractCoversOrder, formatIntakeDate, intakeTotal } from "./order-intake";

describe("repeat patient order", () => {
  it("requires coverage of the entire period, including future periods", () => {
    const contract = { status: "signed", valid_from: "2026-12-01", valid_to: "2026-12-31" };
    expect(contractCoversOrder(contract, "2026-12-20", "2027-01-01")).toBe(false);
    expect(contractCoversOrder(contract, "2026-12-01", "2026-12-31")).toBe(true);
    expect(contractCoversOrder(contract, null, "2026-12-31")).toBe(false);
    expect(contractCoversOrder({ ...contract, status: "expired" }, "2026-12-01", "2026-12-31")).toBe(false);
    expect(contractCoversOrder({ status: "signed", valid_from: null, valid_to: null }, "2030-01-01", "2030-12-31")).toBe(true);
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
