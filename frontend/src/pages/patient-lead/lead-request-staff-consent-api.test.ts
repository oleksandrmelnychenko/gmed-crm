import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api";
import {
  DISCLOSURE_VERSION,
  NO_CONSENT_FORM_CHOICES,
  giveLeadConsent,
  rememberPayerContactConsentRecord,
  saveLeadConsentFormChoices,
  saveLeadPayer,
  saveLeadPayerCostEstimateConsent,
  saveLeadTrustedPersons,
  staffConsentRecordBody,
  submitLeadFollowUp,
  type LeadDisclosureInput,
  type LeadRequestPayerInput,
} from "./lead-request-api";

vi.mock("@/lib/api", async (original) => ({
  ...await original<typeof import("@/lib/api")>(),
  apiFetch: vi.fn(),
}));

// Staff record what the client consented to with how it was given (owner decision 2026-10-29);
// the client's own saves send exactly what they sent before.
const choices = { ...NO_CONSENT_FORM_CHOICES, agency_processing: true, doctors_to_agency: true, data_system: true };
const disclosure: LeadDisclosureInput = {
  persons: [],
  allow_disclosure: false,
  consent_given: false,
  version: DISCLOSURE_VERSION,
  language: "de",
};
const recorded = { how: "phone" as const, note: "  rief am Vormittag an  " };

function lastBody(): Record<string, unknown> {
  const call = vi.mocked(apiFetch).mock.calls.at(-1);
  return JSON.parse(String((call?.[1] as RequestInit | undefined)?.body)) as Record<string, unknown>;
}

describe("consent saves recorded by staff", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockResolvedValue({});
  });

  it("adds nothing without a record and trims the note to null when empty", () => {
    expect(staffConsentRecordBody()).toEqual({});
    expect(staffConsentRecordBody(null)).toEqual({});
    expect(staffConsentRecordBody({ how: "paper", note: "   " })).toEqual({ recorded_how: "paper", recorded_note: null });
    expect(staffConsentRecordBody({ how: "email", note: "x".repeat(600) }).recorded_note).toHaveLength(500);
  });

  it("consent form options: the client's body is unchanged, staff add how and the note", async () => {
    await saveLeadConsentFormChoices("lead-1", choices, "2026-10-12", "de", []);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe("/me/lead-requests/lead-1/consent-choices");
    expect(lastBody()).toEqual({ choices, recipients: [], version: "2026-10-12", language: "de" });
    await saveLeadConsentFormChoices("lead-1", choices, "2026-10-12", "de", [], recorded);
    expect(lastBody()).toEqual({
      choices, recipients: [], version: "2026-10-12", language: "de",
      recorded_how: "phone", recorded_note: "rief am Vormittag an",
    });
  });

  it("trusted persons: the client's body is unchanged, staff add how and the note", async () => {
    await saveLeadTrustedPersons("lead-1", disclosure);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe("/me/lead-requests/lead-1/trusted-persons");
    expect(lastBody()).toEqual(disclosure);
    await saveLeadTrustedPersons("lead-1", disclosure, { how: "in_person", note: "" });
    expect(lastBody()).toEqual({ ...disclosure, recorded_how: "in_person", recorded_note: null });
  });

  it("cost-estimate consent: staff record a given consent; a withdrawal carries no record", async () => {
    await saveLeadPayerCostEstimateConsent("lead-1", true);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe("/me/lead-requests/lead-1/payer/cost-estimate-consent");
    expect(lastBody()).toEqual({ consent: true });
    await saveLeadPayerCostEstimateConsent("lead-1", true, recorded);
    expect(lastBody()).toEqual({ consent: true, recorded_how: "phone", recorded_note: "rief am Vormittag an" });
    await saveLeadPayerCostEstimateConsent("lead-1", false, recorded);
    expect(lastBody()).toEqual({ consent: false });
  });

  it("single consent: the client's body is unchanged, staff add how and the note", async () => {
    await giveLeadConsent("lead-1", "lead_inquiry_processing", "v1", "de");
    expect(lastBody()).toEqual({ purpose: "lead_inquiry_processing", version: "v1", language: "de" });
    await giveLeadConsent("lead-1", "lead_inquiry_processing", "v1", "de", recorded);
    expect(lastBody()).toEqual({
      purpose: "lead_inquiry_processing", version: "v1", language: "de",
      recorded_how: "phone", recorded_note: "rief am Vormittag an",
    });
  });

  // Owner 2026-10-30: the consent that GMED contacts the payer was saved at once in staff mode.
  it("payer contact consent: the answer that gives it carries the record staff took", async () => {
    const payer: LeadRequestPayerInput = { payer_kind: "third_party", first_name: "Viktor", contact_consent: true };
    rememberPayerContactConsentRecord(null);
    await saveLeadPayer("lead-1", payer);
    expect(lastBody()).toEqual(payer);
    rememberPayerContactConsentRecord(recorded);
    await saveLeadPayer("lead-1", payer);
    expect(lastBody()).toEqual({
      ...payer, contact_consent_recorded_how: "phone", contact_consent_recorded_note: "rief am Vormittag an",
    });
    // Without the consent in the answer nothing is recorded.
    await saveLeadPayer("lead-1", { ...payer, contact_consent: false });
    expect(lastBody()).toEqual({ ...payer, contact_consent: false });
    rememberPayerContactConsentRecord(null);
  });

  it("follow-up send: the client's send has no body, staff say how the client confirmed it", async () => {
    await submitLeadFollowUp("lead-1");
    expect(vi.mocked(apiFetch).mock.calls.at(-1)).toEqual(["/me/lead-requests/lead-1/follow-up/submit", { method: "POST" }]);
    await submitLeadFollowUp("lead-1", { how: "in_person", note: "" });
    expect(lastBody()).toEqual({ recorded_how: "in_person", recorded_note: null });
  });
});
