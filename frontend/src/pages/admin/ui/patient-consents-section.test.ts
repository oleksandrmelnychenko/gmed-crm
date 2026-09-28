import { describe, expect, it } from "vitest";

import { consentRowStatus } from "./patient-consents-section";

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
    expect(
      consentRowStatus({ granted: true, revoked_at: past, expires_at: future }, { granted: false }, now),
    ).toBe("revoked");
  });

  it("shows the revoke record itself as revoked", () => {
    expect(consentRowStatus({ granted: false, revoked_at: past, expires_at: null }, null, now)).toBe("revoked");
    expect(
      consentRowStatus({ granted: false, revoked_at: past, expires_at: null }, { granted: true }, now),
    ).toBe("revoked");
  });
});
