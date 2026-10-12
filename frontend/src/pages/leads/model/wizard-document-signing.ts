import type { DocumentItem } from "@/pages/documents/model/types";

const SIGNABLE_DOCUMENT_TYPES = new Set([
  "confidentiality_release",
  "consent_data_release_child",
  "consent_data_release_single",
  "framework_contract",
  "single_order",
  "order_cost_estimate",
  "enhanced_due_diligence",
  // The third-party payer's Kostenübernahmeerklärung (payer and GMED sign it).
  "cost_coverage_declaration",
  // The lead's patient form ("Patientenformular – Angaben und Erklärungen"):
  // only the patient side signs it.
  "lead_self_disclosure",
]);

type SigningDocument = Pick<DocumentItem,
  "generated_template_id" | "compliance_kind" | "art" | "mime_type" | "has_stored_file" | "file_deleted_at"
> & Partial<Pick<DocumentItem, "lead_id" | "patient_id">>;

// During lead intake the framework contract sends the whole onboarding package:
// the order, the patient form and both consents are signed inside it, not one by one.
const LEAD_INTAKE_PACKAGE_MEMBERS = new Set(["single_order", "confidentiality_release", "lead_self_disclosure"]);

// "Signed" only with proof (owner decisions 2026-10-11); shared with the
// documents page.
export { documentSignedFor, signatureNeedsProof } from "@/pages/documents/model/signature-proof";

/** The consent forms the wizard's step 4 creates: the adult's, or the minor's in its two variants. */
export type LeadConsentFormTemplate = "privacy_consents" | "consent_data_release_child" | "consent_data_release_single";

/**
 * Which consent form the wizard creates (QA 2026-10-12, A2-06): for a minor the parents or the
 * guardian declare for the child on the child's form — both parents under joint custody (also while
 * nobody stated the custody), one parent alone or the guardian otherwise. The server refuses the
 * adult form for a minor (`minor_consent_form_required`).
 */
export function leadConsentFormTemplate(
  minor: boolean,
  custody: "joint" | "sole_parent" | "guardian" | null | undefined,
): LeadConsentFormTemplate {
  if (!minor) return "privacy_consents";
  return custody === "sole_parent" || custody === "guardian"
    ? "consent_data_release_single"
    : "consent_data_release_child";
}

// A wizard action policy, not a replacement for the signing API's permissions.
// Use document types, not translated titles or filenames (e.g. privacy notices).
export function canSignWizardDocument(document: SigningDocument): boolean {
  if (!document.has_stored_file || document.file_deleted_at) return false;
  if (document.mime_type?.split(";", 1)[0]?.trim().toLowerCase() !== "application/pdf") return false;

  const templateId = document.generated_template_id?.trim().toLowerCase();
  // A lead's documents belong to no patient until the lead is converted.
  const leadIntake = Boolean(document.lead_id) && !document.patient_id;
  if (templateId && leadIntake && LEAD_INTAKE_PACKAGE_MEMBERS.has(templateId)) return false;
  if (templateId) return SIGNABLE_DOCUMENT_TYPES.has(templateId);

  const art = document.art.trim().toLowerCase();
  if (SIGNABLE_DOCUMENT_TYPES.has(art)) return true;
  if (["identity", "privacy_information", "cost_estimate"].includes(art)) return false;

  // Uploaded consents/contracts may have a verified compliance classification
  // rather than a generated template.
  return ["confidentiality_release", "dsgvo", "framework_contract"].includes(
    document.compliance_kind?.trim().toLowerCase() ?? "",
  );
}
