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
  it("displays timestamps on their Berlin date", () => {
    // 23:30 in Berlin, already 28 Sep in Kyiv.
    expect(formatIntakeDate("2026-09-27T21:30:00Z")).toBe("27.09.2026");
    // 00:30 in Berlin, still 27 Sep in UTC.
    expect(formatIntakeDate("2026-09-27T22:30:00+00:00")).toBe("28.09.2026");
  });
  it("rounds VAT on each service before summing", () => {
    const line = { id: "a", description: "Service", quantity: "3", unit_price: "0.33", vat_rate: "19", agency_service_id: null, agency_service_price_version_id: null };
    expect(intakeTotal([line, { ...line, id: "b" }])).toBe(2.36);
    expect(intakeTotal([{ ...line, quantity: "1,5", unit_price: "100" }])).toBe(178.5);
  });
  it("rounds VAT midpoints half up like the server (2.5 h x 95 EUR = 282.63)", () => {
    const line = { id: "a", description: "Dolmetscher", quantity: "2.5", unit_price: "95", vat_rate: "19", agency_service_id: null, agency_service_price_version_id: null };
    expect(intakeTotal([line])).toBe(282.63);
  });
});
