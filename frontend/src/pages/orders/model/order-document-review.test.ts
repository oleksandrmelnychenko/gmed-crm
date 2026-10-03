import { describe, expect, it } from "vitest";
import { contractUsability, defaultOrderContractId, identityDocumentOnFile, passportReviewStatus } from "./order-document-review";
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

  it("names the identity document already on file instead of asking for it again", () => {
    const document = (patch: Record<string, unknown>) => ({
      art: "passport_scan", compliance_kind: null, signed_at: null, status: "active", file_deleted_at: null,
      is_latest_version: true, original_filename: "pass.pdf", auto_name: "Reisepass", ...patch,
    });
    expect(identityDocumentOnFile([])).toBeNull();
    expect(identityDocumentOnFile([document({ art: "arztbrief" })])).toBeNull();
    // A passport scan from the patient card counts, verified or not.
    expect(identityDocumentOnFile([document({})])).toEqual({ name: "pass.pdf", verifiedAt: null });
    expect(identityDocumentOnFile([
      document({}),
      document({ art: "identity", compliance_kind: "identity", signed_at: "2026-03-01T10:00:00Z", original_filename: "alt.pdf" }),
      document({ art: "identity", compliance_kind: "identity", signed_at: "2026-09-01T10:00:00Z", original_filename: "", auto_name: "Identity document" }),
    ])).toEqual({ name: "Identity document", verifiedAt: "2026-09-01T10:00:00Z" });
    // Replaced, archived and deleted files are not on file any more.
    expect(identityDocumentOnFile([
      document({ is_latest_version: false }), document({ status: "archived" }), document({ file_deleted_at: "2026-09-01T10:00:00Z" }),
    ])).toBeNull();
  });

  it("attaches a new order to the latest signed contract unless staff choose another", () => {
    const contract = (id: string, status: string, signed_at: string | null, created_at: string) => ({ id, status, signed_at, created_at });
    expect(defaultOrderContractId([])).toBeNull();
    expect(defaultOrderContractId([contract("draft", "draft", null, "2026-09-01T00:00:00Z"), contract("ended", "terminated", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")])).toBeNull();
    expect(defaultOrderContractId([
      contract("old", "signed", "2025-03-01T00:00:00Z", "2025-02-01T00:00:00Z"),
      contract("new", "signed", "2026-08-01T00:00:00Z", "2026-07-01T00:00:00Z"),
      contract("ended", "terminated", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
    ])).toBe("new");
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
