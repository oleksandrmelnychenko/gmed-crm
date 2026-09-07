import type { Translations } from "@/lib/i18n";

/** Localize system origins while preserving names entered by staff. */
export function formatDocumentSourceLabel(source: string | null | undefined, tr: Translations) {
  const value = source?.trim();
  if (!value) return tr.common_not_set;

  switch (value.toLowerCase()) {
    case "clinical_document_import":
      return tr.documents_source_clinical_import;
    case "patient_portal":
      return tr.documents_patient_portal;
    case "interpreter_upload":
      return `${tr.role_interpreter} - ${tr.documents_upload}`;
    case "patient_upload":
      return `${tr.role_patient} - ${tr.documents_upload}`;
    case "staff_upload":
      return `${tr.activity_user} - ${tr.documents_upload}`;
    case "upload":
      return tr.documents_upload;
    case "generated":
    case "document_generation":
    case "template":
      return tr.documents_generate_from_template;
    case "translation":
    case "translation_request":
      return tr.documents_translation_requests;
    case "manual":
      return tr.orders_billing_source_manual;
    case "manual_intake":
      return `${tr.orders_billing_source_manual} · ${tr.documents_upload}`;
    default:
      return value;
  }
}
