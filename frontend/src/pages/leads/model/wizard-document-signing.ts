import type { DocumentItem } from "@/pages/documents/model/types";

const SIGNABLE_DOCUMENT_TYPES = new Set([
  "confidentiality_release",
  "privacy_consents",
  "consent_data_release_child",
  "consent_data_release_single",
  "framework_contract",
  "single_order",
  "order_cost_estimate",
]);

type SigningDocument = Pick<DocumentItem,
  "generated_template_id" | "compliance_kind" | "art" | "mime_type" | "has_stored_file" | "file_deleted_at"
>;

// A wizard action policy, not a replacement for the signing API's permissions.
// Use document types, not translated titles or filenames (e.g. privacy notices).
export function canSignWizardDocument(document: SigningDocument): boolean {
  if (!document.has_stored_file || document.file_deleted_at) return false;
  if (document.mime_type?.split(";", 1)[0]?.trim().toLowerCase() !== "application/pdf") return false;

  const templateId = document.generated_template_id?.trim().toLowerCase();
  if (templateId) return SIGNABLE_DOCUMENT_TYPES.has(templateId);

  const art = document.art.trim().toLowerCase();
  if (SIGNABLE_DOCUMENT_TYPES.has(art)) return true;
  if (["identity", "privacy_information", "enhanced_due_diligence", "cost_estimate"].includes(art)) return false;

  // Uploaded consents/contracts may have a verified compliance classification
  // rather than a generated template.
  return ["confidentiality_release", "dsgvo", "framework_contract"].includes(
    document.compliance_kind?.trim().toLowerCase() ?? "",
  );
}
