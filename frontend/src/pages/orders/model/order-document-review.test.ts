import { describe, expect, it } from "vitest";
import { contractUsability, passportReviewStatus } from "./order-document-review";
import { isContractUsable } from "./order-intake";

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

  it("treats a signed framework contract as usable regardless of its dates", () => {
    const contract = { status: "signed", valid_from: "2020-01-01", valid_to: "2021-08-31" };
    expect(contractUsability(contract)).toBe("usable");
    expect(isContractUsable(contract)).toBe(true);
  });

  it("does not reuse terminated, expired or unsigned contracts", () => {
    expect(contractUsability({ status: "terminated" })).toBe("terminated");
    expect(contractUsability({ status: "expired" })).toBe("expired");
    expect(contractUsability({ status: "sent" })).toBe("sent");
    expect(contractUsability({ status: "draft" })).toBe("draft");
    for (const status of ["terminated", "expired", "sent", "draft"]) {
      expect(isContractUsable({ status })).toBe(false);
    }
  });
});
