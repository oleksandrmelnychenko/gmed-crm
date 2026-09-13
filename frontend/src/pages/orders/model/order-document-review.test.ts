import { describe, expect, it } from "vitest";
import { contractValidity, passportReviewStatus } from "./order-document-review";
import { contractCoversOrder } from "./order-intake";

describe("existing patient document validity", () => {
  it.each([
    [null, null, "unknown"], ["2026-09-11", null, "expired"],
    ["2026-09-12", null, "expiring"], ["2026-12-11", null, "expiring"],
    ["2026-12-12", null, "valid"],
    ["2027-05-01", "2027-05-02", "expires_during_order"],
    ["2027-05-01", "2027-05-01", "valid"],
  ])("checks passport %s through %s", (expiry, end, expected) => {
    expect(passportReviewStatus(expiry, end, "2026-09-12")).toBe(expected);
  });

  it("checks actual contract dates even if its saved status is still signed", () => {
    const contract = { status: "signed", valid_from: "2025-01-01", valid_to: "2026-08-31" };
    expect(contractValidity(contract, "2026-09-12")).toBe("expired");
    expect(contractCoversOrder(contract, "2026-09-12", "2026-09-30")).toBe(false);
  });

  it("reuses a signed contract inherited from a lead without requiring a new signature", () => {
    const contract = { status: "signed", valid_from: "2026-01-01", valid_to: null };
    expect(contractValidity(contract, "2026-09-12")).toBe("valid");
    expect(contractCoversOrder(contract, "2027-01-01", "2027-12-31")).toBe(true);
    expect(contractCoversOrder({ ...contract, status: "terminated" }, "2027-01-01", "2027-12-31")).toBe(false);
  });

  it("distinguishes validity today from coverage of a future order", () => {
    const contract = { status: "signed", valid_from: "2027-01-01", valid_to: "2027-12-31" };
    expect(contractValidity(contract, "2026-09-12")).toBe("future");
    expect(contractCoversOrder(contract, "2027-01-01", "2027-01-31")).toBe(true);
  });
});
