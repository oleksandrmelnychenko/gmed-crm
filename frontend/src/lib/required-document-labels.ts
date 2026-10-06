type L = (key: string) => string;

/**
 * Document categories and types from the server dictionary
 * (`ref_document_categories`) and the generated-document templates that are
 * labelled as `document_category_<key>` in the UI catalogs. The server only
 * sends English and German names, so the UI localises by the stable key and
 * falls back to the server label for keys added later.
 */
const DOCUMENT_CATEGORY_LABEL_KEYS = [
  "official",
  "personal",
  "other",
  "payment",
  "administrative_single_order",
  "administrative_appointment_confirmation",
  "official_authority",
  "official_departmental",
  "visa_invitation_letter",
  "finance_general",
  "finance_cost_coverage",
  "finance_cost_estimate",
  "finance_order_cost_estimate",
  "finance_payer_cost_estimate",
  "finance_payment_proof",
  "compliance_aml",
  "provider_template",
  "medical_gastro",
  "medical_onko",
  "medical_kardio",
  "medical_kardch",
  "medical_derma",
  "medical_dermch",
  "medical_radiology",
  "medical_lab",
  "medical_patho_histo",
  "medical_neuro",
  "medical_neurch",
  "medical_chir",
  "medical_gyn",
  "medical_gynch",
  "medical_auge",
  "medical_augch",
  "medical_hamat",
  "medical_uro",
  "medical_uroch",
  "medical_schlaf",
  "medical_endo",
  "medical_endoch",
  "medical_vask",
  "medical_orthol",
  "medical_unfal",
  "medical_mkg",
  "medical_dent",
  "medical_kfo",
  "medical_plastchir",
  "medical_pad",
  "medical_physio_reha",
  "medical_hno",
  "medical_infekt",
  "medical_ana",
  "medical_nephro",
  "medical_psych",
  "medical_pneumo_resp",
  "medical_prokto",
  "medical_rheum",
  "medical_ger",
  "medical_allmed",
  "medical_arztbrief",
  "medical_befund",
  "medical_bericht",
  "medical_schreiben",
  "medical_ueberweisung",
  "medical_radiology_report",
  "medical_sonography",
  "medical_ct",
  "medical_mrt",
  "medical_roentgen",
  "medical_pet_ct",
  "medical_entlassungsbrief",
  "medical_operationsbericht",
  "treatment_plan",
  "medical_therapy_protocol",
  "medical_prescription",
  "medical_vaccination_record",
  "medical_lab_results",
  "medication_summary",
  "personal_passport",
  "personal_residence_permit",
  "personal_birth_certificate",
] as const;

/** Document type (`art`) codes the server writes, labelled as `document_art_<code>`. */
const DOCUMENT_ART_LABEL_CODES = [
  "document",
  "arztbrief",
  "imaging_report",
  "invoice_document",
  "insurance_document",
  "payment_proof",
  "receipt",
  "contract_document",
  "translated_document",
  "signature_evidence",
  "provider_document",
  "provider_template_instruction",
  "interpreter_profile_document",
  "questionnaire_attachment",
  "patient_upload",
  "patient_general_upload",
  "patient_medical_upload",
  "patient_admin_upload",
  "patient_correspondence_upload",
  "patient_analysis_upload",
  "patient_conclusion_upload",
  "patient_invoice_upload",
  "patient_translation_upload",
  "free_text_document",
  "framework_contract",
  "visa_invitation",
  "patient_sticker",
  "single_order",
  "order_cost_estimate",
  "cost_coverage_declaration",
  "cost_estimate",
  "appointment_confirmation",
  "confidentiality_release",
  "privacy_consents",
  "privacy_information",
  "enhanced_due_diligence",
  "gwg_identification",
  "payer_self_disclosure",
  "patient_payer_statement",
  "payer_cost_estimate",
  "consent_data_release",
] as const;

const DOC_LABEL_MAP: Record<string, string> = {
  ...Object.fromEntries(
    DOCUMENT_CATEGORY_LABEL_KEYS.map((key) => [key, `document_category_${key}`]),
  ),
  ...Object.fromEntries(
    DOCUMENT_ART_LABEL_CODES.map((code) => [code, `document_art_${code}`]),
  ),
  passport: "required_doc_passport",
  consent_form: "required_doc_consent_form",
  insurance_card: "required_doc_insurance_card",
  medical_history: "required_doc_medical_history",
  referral: "required_doc_referral",
  lab_results: "required_doc_lab_results",
  lab_summary: "required_doc_lab_summary",
  translated_summary: "required_doc_translated_summary",
  translated_lab_summary: "required_doc_translated_lab_summary",
  imaging: "required_doc_imaging",
  medication_list: "required_doc_medication_list",
  power_of_attorney: "required_doc_power_of_attorney",
  gdpr_consent: "required_doc_gdpr_consent",
  identity: "required_doc_identity",
  passport_scan: "required_doc_passport_scan",
  uploaded_document: "required_doc_uploaded_document",
  medical_report: "required_doc_medical_report",
  discharge_summary: "required_doc_discharge_summary",
  prescription: "required_doc_prescription",
  invoice: "required_doc_invoice",
  contract: "required_doc_contract",
  report: "required_doc_report",
  medical: "required_doc_medical",
  financial: "required_doc_financial",
  administrative: "required_doc_administrative",
  finance: "document_category_finance",
  consent: "document_category_consent",
  insurance: "document_category_insurance",
  portal_upload: "document_category_portal_upload",
  generated: "document_category_generated",
  clinic_correspondence: "document_category_clinic_correspondence",
  lab_analysis: "document_category_lab_analysis",
  translation: "document_category_translation",
  clinic_form: "document_category_clinic_form",
  conclusion: "document_category_conclusion",
};

function humanizeFallback(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function localizeRequiredDocumentLabel(
  key: string,
  label: string,
  l: L,
): string {
  const direct = DOC_LABEL_MAP[key];
  if (direct) return l(direct);
  // Fallback: normalize key (or the label) to snake_case for lookup, because
  // backend sometimes sends the human form ("Consent form") as both key and label.
  const normalizedKey = key.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const byKey = DOC_LABEL_MAP[normalizedKey];
  if (byKey) return l(byKey);
  if (label && label !== key) {
    const normalizedLabel = label.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const byLabel = DOC_LABEL_MAP[normalizedLabel];
    if (byLabel) return l(byLabel);
  }
  return label;
}

// Translate a free-form art / category / auto-name code. Maps known codes to
// localized strings; unknown values fall back to a humanized form
// (underscores → spaces + title case).
// Accepts both snake_case ("consent_form") and human forms ("Consent form")
// — normalizes to the canonical key before lookup.
export function localizeDocumentCode(
  value: string | null | undefined,
  l: L,
): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  const entry = DOC_LABEL_MAP[normalized];
  if (entry) return l(entry);
  // Unknown snake_case code → humanize. Already human text → leave as-is.
  if (/^[a-z0-9][a-z0-9_-]*$/.test(trimmed)) {
    return humanizeFallback(trimmed);
  }
  return trimmed;
}

/** The UI label of a known document code, or undefined when the UI has none. */
export function knownDocumentCodeLabel(
  value: string | null | undefined,
  l: L,
): string | undefined {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const entry = normalized ? DOC_LABEL_MAP[normalized] : undefined;
  return entry ? l(entry) : undefined;
}

/** A category entry as `/documents/meta/categories` returns it. */
export type DocumentCategoryLabelSource = {
  key: string;
  label?: string;
  label_de?: string;
  label_en?: string;
  parent_key?: string | null;
  breadcrumb_label?: string;
  breadcrumb_label_de?: string;
};

/**
 * Label of a category from the server's document dictionary: the UI label for
 * its key, else the server name (German for DE; the server has no Russian
 * names). `withPath` prefixes the parent category ("Medizinisch / Arztbrief").
 */
export function localizeDocumentCategory(
  category: DocumentCategoryLabelSource,
  lang: "de" | "ru",
  l: L,
  withPath = false,
): string {
  const serverLabel =
    lang === "de"
      ? category.label_de || category.label || category.label_en || category.key
      : category.label || category.label_en || category.key;
  const known = knownDocumentCodeLabel(category.key, l);
  const label = known ?? serverLabel;
  if (!withPath || !category.parent_key) return label;
  const parentLabel = knownDocumentCodeLabel(category.parent_key, l);
  if (parentLabel) return `${parentLabel} / ${label}`;
  const serverPath =
    lang === "de"
      ? category.breadcrumb_label_de || category.breadcrumb_label
      : category.breadcrumb_label;
  return !known && serverPath ? serverPath : label;
}
