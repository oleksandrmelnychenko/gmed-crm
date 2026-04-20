type L = (de: string, ru: string, en: string) => string;

const DOC_LABEL_MAP: Record<string, [string, string, string]> = {
  passport: ["Reisepass", "Паспорт", "Passport"],
  consent_form: ["Einverständniserklärung", "Форма согласия", "Consent form"],
  insurance_card: ["Versichertenkarte", "Страховая карта", "Insurance card"],
  medical_history: ["Krankengeschichte", "Медицинская история", "Medical history"],
  referral: ["Überweisung", "Направление", "Referral"],
  lab_results: ["Laborergebnisse", "Результаты анализов", "Lab results"],
  lab_summary: ["Laborzusammenfassung", "Сводка анализов", "Lab summary"],
  translated_summary: ["Übersetzte Zusammenfassung", "Переведённая сводка", "Translated summary"],
  translated_lab_summary: ["Übersetzte Laborzusammenfassung", "Переведённая сводка анализов", "Translated lab summary"],
  imaging: ["Bildgebung", "Снимки", "Imaging"],
  medication_list: ["Medikamentenliste", "Список медикаментов", "Medication list"],
  power_of_attorney: ["Vollmacht", "Доверенность", "Power of attorney"],
  gdpr_consent: ["DSGVO-Einwilligung", "Согласие на обработку данных", "GDPR consent"],
  identity: ["Identität", "Удостоверение личности", "Identity"],
  passport_scan: ["Passscan", "Скан паспорта", "Passport scan"],
  medical_report: ["Arztbericht", "Медицинский отчёт", "Medical report"],
  discharge_summary: ["Entlassungsbrief", "Выписной эпикриз", "Discharge summary"],
  prescription: ["Rezept", "Рецепт", "Prescription"],
  invoice: ["Rechnung", "Счёт", "Invoice"],
  contract: ["Vertrag", "Договор", "Contract"],
  report: ["Bericht", "Отчёт", "Report"],
  medical: ["Medizinisch", "Медицинское", "Medical"],
  financial: ["Finanziell", "Финансовое", "Financial"],
  administrative: ["Administrativ", "Административное", "Administrative"],
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
  if (direct) return l(direct[0], direct[1], direct[2]);
  // Fallback: normalize key (or the label) to snake_case for lookup, because
  // backend sometimes sends the human form ("Consent form") as both key and label.
  const normalizedKey = key.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const byKey = DOC_LABEL_MAP[normalizedKey];
  if (byKey) return l(byKey[0], byKey[1], byKey[2]);
  if (label && label !== key) {
    const normalizedLabel = label.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const byLabel = DOC_LABEL_MAP[normalizedLabel];
    if (byLabel) return l(byLabel[0], byLabel[1], byLabel[2]);
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
  if (entry) return l(entry[0], entry[1], entry[2]);
  // Unknown snake_case code → humanize. Already human text → leave as-is.
  if (/^[a-z0-9][a-z0-9_-]*$/.test(trimmed)) {
    return humanizeFallback(trimmed);
  }
  return trimmed;
}
