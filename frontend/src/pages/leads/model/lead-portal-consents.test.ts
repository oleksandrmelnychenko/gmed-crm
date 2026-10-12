import { describe, expect, it } from "vitest";
import type { LeadPortalConsent } from "../data/lead-portal-intake-api";
import { latestPortalConsent, normalizeLeadPortalConsentForm } from "./lead-portal-consents";

function record(id: string, given_at: string, revoked_at: string | null = null): LeadPortalConsent {
  return { id, type: "health_data_processing", given_at, revoked_at, version: "2026-10-03", access_kind: "self" };
}

describe("staff portal consent evidence", () => {
  it("keeps the latest grant visible after revocation and ignores input order", () => {
    const revoked = record("revoked", "2026-10-11T09:00:00Z", "2026-10-12T09:00:00Z");
    const old = record("old", "2026-10-01T09:00:00Z");
    expect(latestPortalConsent([revoked, old], "health_data_processing")).toEqual(revoked);
    expect(latestPortalConsent([old, revoked], "health_data_processing")).toEqual(revoked);
  });

  it("shows a new grant after an older revocation, without confusing the other purpose", () => {
    const active = record("active", "2026-10-12T10:00:00Z");
    const old = record("old", "2026-10-11T09:00:00Z", "2026-10-12T09:00:00Z");
    expect(latestPortalConsent([active, old], "health_data_processing")).toEqual(active);
    expect(latestPortalConsent([active], "lead_inquiry_processing")).toBeNull();
  });

  it("does not convert missing or malformed choices to consent or refusal", () => {
    expect(normalizeLeadPortalConsentForm(undefined)).toBeNull();
    expect(normalizeLeadPortalConsentForm([])).toBeNull();
    expect(normalizeLeadPortalConsentForm({ version: "v1", choices: null })?.choices).toBeNull();
    const normalized = normalizeLeadPortalConsentForm({ choices: { agency_processing: true, channel_email: false, channel_whatsapp: "true" } });
    expect(normalized?.choices?.agency_processing).toBe(true);
    expect(normalized?.choices?.channel_email).toBe(false);
    expect(normalized?.choices?.channel_whatsapp).toBeNull();
    expect(normalized?.choices?.doctors_to_agency).toBeNull();
    expect(normalized?.chosen_by_name).toBeNull();
  });
});
