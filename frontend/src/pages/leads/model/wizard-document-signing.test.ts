import { describe, expect, it } from "vitest";
import { canSignWizardDocument } from "./wizard-document-signing";

const pdf = {
  generated_template_id: null as string | null,
  compliance_kind: null as string | null,
  art: "other", mime_type: "application/pdf", has_stored_file: true, file_deleted_at: null as string | null,
};

describe("electronic signing in the lead wizard", () => {
  it.each([
    "confidentiality_release", "privacy_consents", "framework_contract", "single_order", "order_cost_estimate",
  ])("keeps the action for %s", generated_template_id => {
    expect(canSignWizardDocument({ ...pdf, generated_template_id })).toBe(true);
  });
  it.each([
    "identity", "privacy_information", "enhanced_due_diligence", "cost_estimate", "medical_report", "medication_plan", "free_document",
  ])("hides the action for %s, even with stale consent metadata", generated_template_id => {
    expect(canSignWizardDocument({ ...pdf, generated_template_id, compliance_kind: "dsgvo" })).toBe(false);
  });
  it.each(["consent_data_release_child", "consent_data_release_single"])("supports the %s data consent variant", generated_template_id => {
    expect(canSignWizardDocument({ ...pdf, generated_template_id })).toBe(true);
  });
  it("recognizes explicitly classified uploads, but not an arbitrary PDF", () => {
    expect(canSignWizardDocument({ ...pdf, art: "order_cost_estimate" })).toBe(true);
    expect(canSignWizardDocument({ ...pdf, compliance_kind: "dsgvo" })).toBe(true);
    expect(canSignWizardDocument({ ...pdf, art: "privacy_information", compliance_kind: "dsgvo" })).toBe(false);
    expect(canSignWizardDocument(pdf)).toBe(false);
  });
  it("does not offer signing for images, missing files, or deleted files", () => {
    const contract = { ...pdf, generated_template_id: "framework_contract" };
    expect(canSignWizardDocument({ ...contract, mime_type: "image/png" })).toBe(false);
    expect(canSignWizardDocument({ ...contract, has_stored_file: false })).toBe(false);
    expect(canSignWizardDocument({ ...contract, file_deleted_at: "2026-09-07T12:00:00Z" })).toBe(false);
    expect(canSignWizardDocument({ ...contract, mime_type: "application/pdf; charset=binary" })).toBe(true);
  });
});
