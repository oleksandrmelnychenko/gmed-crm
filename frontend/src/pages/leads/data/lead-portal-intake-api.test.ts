import { describe, expect, it } from "vitest";
import { normalizeLeadPortalIntake } from "./lead-portal-intake-api";

describe("staff cabinet parity payload", () => {
  it("preserves intermediary, organisation, recipient timestamp and relationship evidence", () => {
    const intake = normalizeLeadPortalIntake({
      lead_id: "test-only",
      payer_organisation: { legal_form: "GmbH", register_number: "HRB 123", contact_name: "Test Contact" },
      billing: { via_third_party: true, via_third_party_kind: "psp", recipient_updated_at: "2026-10-12T08:00:00Z" },
      enhanced_details: { relationship_proof_requested: true, relationship_proof_documents: [
        { id: "test-document", file_name: "relationship.pdf", uploaded_at: "2026-10-12T07:00:00Z", reviewed: false },
      ] },
    });
    expect(intake?.billing?.via_third_party_kind).toBe("psp");
    expect(intake?.billing?.recipient_updated_at).toBe("2026-10-12T08:00:00Z");
    expect(intake?.payer_organisation?.register_number).toBe("HRB 123");
    expect(intake?.enhanced_details?.relationship_proof_requested).toBe(true);
    expect(intake?.enhanced_details?.relationship_proof_documents?.[0].file_name).toBe("relationship.pdf");
  });

  it("keeps old backend absence and unknown values distinct from a negative answer", () => {
    const intake = normalizeLeadPortalIntake({ lead_id: "test-only", billing: { via_third_party_kind: "unknown" }, enhanced_details: {} });
    expect(intake?.consent_form).toBeNull();
    expect(intake?.payer_organisation).toBeNull();
    expect(intake?.billing?.via_third_party_kind).toBeNull();
    expect(intake?.enhanced_details?.relationship_proof_requested).toBeNull();
    expect(intake?.enhanced_details?.relationship_proof_documents).toEqual([]);
  });

  it("does not expose added identity and consent details to a restricted role", () => {
    const intake = normalizeLeadPortalIntake({
      lead_id: "test-only", identification_hidden: true,
      payer_organisation: { contact_name: "Restricted" },
      consent_form: { choices: { agency_processing: true }, chosen_by_name: "Restricted" },
    });
    expect(intake?.payer_organisation).toBeNull();
    expect(intake?.consent_form).toBeNull();
  });

  it("preserves explicitly declined channels in the consent snapshot", () => {
    const intake = normalizeLeadPortalIntake({ lead_id: "test-only", consent_form: {
      choices: { channel_whatsapp: false, channel_email: true }, chosen_at: "2026-10-12T08:00:00Z", access_kind: "guardian",
    } });
    expect(intake?.consent_form?.choices?.channel_whatsapp).toBe(false);
    expect(intake?.consent_form?.choices?.channel_email).toBe(true);
    expect(intake?.consent_form?.choices?.channel_telegram).toBeNull();
    expect(intake?.consent_form?.access_kind).toBe("guardian");
  });
});

