import { describe, expect, it } from "vitest";
import { canSignWizardDocument, documentSignedFor, signatureNeedsProof } from "./wizard-document-signing";

const pdf = {
  generated_template_id: null as string | null,
  compliance_kind: null as string | null,
  art: "other", mime_type: "application/pdf", has_stored_file: true, file_deleted_at: null as string | null,
};

describe("electronic signing in the lead wizard", () => {
  it.each([
    "confidentiality_release", "framework_contract", "single_order", "order_cost_estimate", "enhanced_due_diligence",
  ])("keeps the action for %s", generated_template_id => {
    expect(canSignWizardDocument({ ...pdf, generated_template_id })).toBe(true);
  });
  it.each([
    "identity", "privacy_information", "cost_estimate", "medical_report", "medication_plan", "free_document",
  ])("hides the action for %s, even with stale consent metadata", generated_template_id => {
    expect(canSignWizardDocument({ ...pdf, generated_template_id, compliance_kind: "dsgvo" })).toBe(false);
  });
  it.each(["consent_data_release_child", "consent_data_release_single"])("supports the %s data consent variant", generated_template_id => {
    expect(canSignWizardDocument({ ...pdf, generated_template_id })).toBe(true);
  });
  it("signs the order and the release inside the contract package during lead intake", () => {
    const intake = { lead_id: "lead", patient_id: null };
    expect(canSignWizardDocument({ ...pdf, ...intake, generated_template_id: "framework_contract" })).toBe(true);
    expect(canSignWizardDocument({ ...pdf, ...intake, generated_template_id: "single_order" })).toBe(false);
    expect(canSignWizardDocument({ ...pdf, ...intake, generated_template_id: "confidentiality_release" })).toBe(false);
    // The lead's patient form travels in the same invitation.
    expect(canSignWizardDocument({ ...pdf, ...intake, generated_template_id: "lead_self_disclosure" })).toBe(false);
    expect(canSignWizardDocument({ ...pdf, lead_id: "lead", patient_id: "patient", generated_template_id: "lead_self_disclosure" })).toBe(true);
    // An existing patient still signs a new order on its own.
    expect(canSignWizardDocument({ ...pdf, lead_id: "lead", patient_id: "patient", generated_template_id: "single_order" })).toBe(true);
  });
  it("sends the generated adult privacy consent only inside the confidentiality package", () => {
    expect(canSignWizardDocument({ ...pdf, generated_template_id: "privacy_consents" })).toBe(false);
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

// Owner decision 2026-10-11: a generated consent, release or contract is
// signed only with proof (scan of the signed copy or QES), never by one click.
describe("signature proof", () => {
  it.each([
    ["privacy_consents", "dsgvo"],
    ["confidentiality_release", "confidentiality_release"],
    ["framework_contract", "framework_contract"],
  ])("asks for the scan of a generated %s", (generated_template_id, kind) => {
    expect(signatureNeedsProof({ generated_template_id, signed_at: null }, kind)).toBe(true);
  });

  it.each([
    ["enhanced_due_diligence", "enhanced_due_diligence"],
    ["cost_coverage_declaration", "cost_coverage_declaration"],
    // The patient form records no compliance kind; "other" does not open the one click.
    ["lead_self_disclosure", "other"],
    ["enhanced_due_diligence", "other"],
  ])("asks for the scan of a generated %s confirmed as %s", (generated_template_id, kind) => {
    expect(signatureNeedsProof({ generated_template_id, signed_at: null }, kind)).toBe(true);
  });

  it("keeps the one-click confirmation of uploaded scans, signed versions and other kinds", () => {
    expect(signatureNeedsProof({ generated_template_id: null, signed_at: null }, "dsgvo")).toBe(false);
    expect(signatureNeedsProof({ generated_template_id: null, signed_at: null }, "enhanced_due_diligence")).toBe(false);
    expect(signatureNeedsProof({ generated_template_id: "privacy_consents", signed_at: "2026-10-11T10:00:00Z" }, "dsgvo")).toBe(false);
    expect(signatureNeedsProof({ generated_template_id: "lead_self_disclosure", signed_at: "2026-10-11T10:00:00Z" }, "other")).toBe(false);
    expect(signatureNeedsProof({ generated_template_id: "gwg_identification", signed_at: null }, "other")).toBe(false);
    expect(signatureNeedsProof({ generated_template_id: null, signed_at: null }, "identity")).toBe(false);
  });

  it("shows a paper-signed patient form as signed although it records no kind", () => {
    const signed = { signed_at: "2026-10-12T09:00:00Z", compliance_kind: null };
    expect(documentSignedFor(signed, "other")).toBe(true);
    expect(documentSignedFor(signed, "enhanced_due_diligence")).toBe(false);
    expect(documentSignedFor({ ...signed, compliance_kind: "enhanced_due_diligence" }, "enhanced_due_diligence")).toBe(true);
    expect(documentSignedFor({ signed_at: null, compliance_kind: "other" }, "other")).toBe(false);
    expect(documentSignedFor(signed, null)).toBe(false);
  });
});
