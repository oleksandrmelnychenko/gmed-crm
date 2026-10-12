import { describe, expect, it } from "vitest";

import { consentRowStatus, revocationNote } from "./patient-consents-section";

const now = Date.parse("2026-09-28T12:00:00Z");
const future = "2027-09-28T12:00:00Z";
const past = "2026-09-01T12:00:00Z";

describe("consentRowStatus", () => {
  it("keeps the newest grant active until it expires", () => {
    expect(consentRowStatus({ granted: true, revoked_at: null, expires_at: future }, null, now)).toBe("active");
    expect(consentRowStatus({ granted: true, revoked_at: null, expires_at: null }, null, now)).toBe("active");
    expect(consentRowStatus({ granted: true, revoked_at: null, expires_at: past }, null, now)).toBe("expired");
  });

  it("tells a renewed grant from a withdrawn one", () => {
    // A renewal closes the previous grant (revoked_at is set) without withdrawing consent.
    expect(
      consentRowStatus({ granted: true, revoked_at: past, expires_at: future }, { granted: true }, now),
    ).toBe("superseded");
    // The grant a revocation closed reads "valid until revoked": the
    // revocation is listed once, as its own row (QA 2026-10-12 B2-13).
    expect(
      consentRowStatus({ granted: true, revoked_at: past, expires_at: future }, { granted: false }, now),
    ).toBe("ended");
  });

  it("records a revocation with its channel and reason, at most 500 characters", () => {
    expect(revocationNote("E-Mail", "  Widerruf per E-Mail vom 12.10.2026  ")).toBe(
      "E-Mail: Widerruf per E-Mail vom 12.10.2026",
    );
    expect(revocationNote("Brief", "x".repeat(600))).toHaveLength(500);
  });

  it("shows the revoke record itself as revoked", () => {
    expect(consentRowStatus({ granted: false, revoked_at: past, expires_at: null }, null, now)).toBe("revoked");
    expect(
      consentRowStatus({ granted: false, revoked_at: past, expires_at: null }, { granted: true }, now),
    ).toBe("revoked");
  });
});
