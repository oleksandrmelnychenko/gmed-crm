import { describe, expect, it } from "vitest";
import { normalizeLeadPortalIntake } from "./lead-portal-intake-api";

describe("staff cabinet parity payload", () => {
  it("preserves intermediary, organisation, recipient timestamp and relationship evidence", () => {
    const intake = normalizeLeadPortalIntake({
      lead_id: "test-only",
      payer_organisation: { legal_form: "GmbH", register_number: "HRB 123", contact_name: "Test Contact" },
      billing: { via_third_party: true, via_third_party_kind: "psp", recipient_updated_at: "2026-10-12T08:00:00Z" },
      enhanced_details: { missing: ["relationship_proof_upload", 42], relationship_proof_requested: true, relationship_proof_documents: [
        { id: "test-document", file_name: "relationship.pdf", uploaded_at: "2026-10-12T07:00:00Z", reviewed: false },
      ] },
    });
    expect(intake?.billing?.via_third_party_kind).toBe("psp");
    expect(intake?.billing?.recipient_updated_at).toBe("2026-10-12T08:00:00Z");
    expect(intake?.payer_organisation?.register_number).toBe("HRB 123");
    expect(intake?.enhanced_details?.missing).toEqual(["relationship_proof_upload"]);
    expect(intake?.enhanced_details?.relationship_proof_requested).toBe(true);
    expect(intake?.enhanced_details?.relationship_proof_documents?.[0].file_name).toBe("relationship.pdf");
  });

  it("keeps old backend absence and unknown values distinct from a negative answer", () => {
    const intake = normalizeLeadPortalIntake({ lead_id: "test-only", billing: { via_third_party_kind: "unknown" }, enhanced_details: {} });
    expect(intake?.consent_form).toBeNull();
    expect(intake?.disclosure).toBeNull();
    expect(intake?.payer_organisation).toBeNull();
    expect(intake?.billing?.via_third_party_kind).toBeNull();
    expect(intake?.enhanced_details?.relationship_proof_requested).toBeNull();
    expect(intake?.enhanced_details?.relationship_proof_documents).toEqual([]);
  });

  it("does not expose added identity and consent details to a restricted role", () => {
    const intake = normalizeLeadPortalIntake({
      lead_id: "test-only", identification_hidden: true,
      payer_organisation: { contact_name: "Restricted" },
      trusted_persons: [{ name: "Restricted", relation: "friend" }],
      consent_form: { choices: { agency_processing: true }, chosen_by_name: "Restricted" },
      disclosure: { allow_disclosure: true, consent_given: true, chosen_by_name: "Restricted", consent_text: "Restricted receipt" },
    });
    expect(intake?.payer_organisation).toBeNull();
    expect(intake?.consent_form).toBeNull();
    expect(intake?.disclosure).toBeNull();
    expect(intake?.trusted_persons).toEqual([]);
  });

  it("preserves trusted persons without a consent choice", () => {
    const intake = normalizeLeadPortalIntake({ lead_id: "test-only", trusted_persons: [
      { name: " Eva Muster ", relation: "friend", contact: " eva@example.com " }, { name: " " }, null,
    ] });
    expect(intake?.consent_form).toBeNull();
    expect(intake?.trusted_persons).toEqual([{ name: "Eva Muster", relation: "friend", contact: "eva@example.com", scope: null }]);
  });

  it("preserves the independent disclosure receipt and each person's scope", () => {
    const receipt = {
      allow_disclosure: true, consent_given: true, version: "2026-10-14", language: "de",
      chosen_at: "2026-10-14T10:00:00Z", chosen_by: "original-parent", chosen_by_name: "Original Parent",
      access_kind: "guardian", company_name: "GMED GmbH", consent_text: "The exact accepted text.\nSecond line.",
    };
    const intake = normalizeLeadPortalIntake({
      lead_id: "test-only", disclosure: receipt,
      trusted_persons: [{ name: " Eva ", relation: "friend", contact: " eva@example.com ", scope: " Appointment dates only " }],
      consent_form: { choices: { channel_email: true }, chosen_by: "other-parent", chosen_by_name: "Other Parent", recipients: [
        { name: "Eva", relation: "friend", scope: "Appointment dates only" },
      ] },
    });
    expect(intake?.disclosure).toEqual({ ...receipt, recorded_how: null, recorded_note: null });
    expect(intake?.trusted_persons?.[0].scope).toBe("Appointment dates only");
    expect(intake?.consent_form?.recipients[0].scope).toBe("Appointment dates only");
    expect(intake?.consent_form?.chosen_by_name).toBe("Other Parent");
  });

  it("does not infer disclosure consent from a historical named-recipient choice", () => {
    const intake = normalizeLeadPortalIntake({ lead_id: "test-only", consent_form: {
      choices: { named_recipients: true }, chosen_by_name: "Historic Chooser",
      recipients: [{ name: "Eva", relation: "friend" }],
    } });
    expect(intake?.disclosure).toBeNull();
    expect(intake?.consent_form?.recipients[0].scope).toBeNull();
  });

  it("distinguishes a declined disclosure from absent or malformed answers", () => {
    const declined = normalizeLeadPortalIntake({ lead_id: "test-only", disclosure: { allow_disclosure: false, consent_given: false } });
    expect(declined?.disclosure?.allow_disclosure).toBe(false);
    expect(declined?.disclosure?.consent_given).toBe(false);
    const unknown = normalizeLeadPortalIntake({ lead_id: "test-only", disclosure: { allow_disclosure: "false", consent_given: 1, chosen_by_name: " " } });
    expect(unknown?.disclosure?.allow_disclosure).toBeNull();
    expect(unknown?.disclosure?.consent_given).toBeNull();
    expect(unknown?.disclosure?.chosen_by_name).toBeNull();
    expect(normalizeLeadPortalIntake({ lead_id: "test-only", disclosure: [] })?.disclosure).toBeNull();
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

