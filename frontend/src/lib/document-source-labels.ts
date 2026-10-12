import type { Translations } from "@/lib/i18n";
import { knownDocumentCodeLabel } from "@/lib/required-document-labels";

/**
 * "Generated from a template" as an origin (a past participle), not the
 * button "Generate from template" (QA 2026-10-12 B2-13).
 */
function generatedFromTemplate(tr: Translations): string {
  return tr.uiText.documents_origin_generated_from_template ?? tr.documents_generate_from_template;
}

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
      return generatedFromTemplate(tr);
    case "translation":
    case "translation_request":
      return tr.documents_translation_requests;
    case "manual":
      return tr.orders_billing_source_manual;
    case "manual_intake":
      return `${tr.orders_billing_source_manual} · ${tr.documents_upload}`;
    default:
      break;
  }

  // Other system origins the server writes (documents.ursprung and
  // translation request_source); generated documents carry the template id.
  const origin = value.toLowerCase();
  // "template:confidentiality_release" names the template when the UI knows
  // it (QA 2026-10-11 B-06); other generator origins read generically.
  const template = /^template:([a-z0-9_]+)$/.exec(origin)?.[1];
  const templateName = template
    ? knownDocumentCodeLabel(template, (key) => tr.uiText[key] ?? key)
    : undefined;
  if (templateName) {
    return `${generatedFromTemplate(tr)}: ${templateName}`;
  }
  if (/^(template|provider_template|auto_preparation):/.test(origin)) {
    return generatedFromTemplate(tr);
  }
  return tr.uiText[`documents_origin_${origin}`] ?? value;
}
