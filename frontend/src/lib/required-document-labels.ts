type L = (key: string) => string;

const DOC_LABEL_MAP: Record<string, string> = {
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
  medical_report: "required_doc_medical_report",
  discharge_summary: "required_doc_discharge_summary",
  prescription: "required_doc_prescription",
  invoice: "required_doc_invoice",
  contract: "required_doc_contract",
  report: "required_doc_report",
  medical: "required_doc_medical",
  financial: "required_doc_financial",
  administrative: "required_doc_administrative",
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
