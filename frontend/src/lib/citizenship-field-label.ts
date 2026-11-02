/**
 * The label of every citizenship field (client decision 2026-11-02): wherever the CRM records a
 * person with identity data, several citizenships can be entered and the label says so.
 */
export const CITIZENSHIP_FIELD_LABELS = {
  ru: "Гражданство (если несколько — укажите все)",
  de: "Staatsangehörigkeit (bei mehreren alle angeben)",
  uk: "Громадянство (якщо кілька — вкажіть усі)",
  en: "Citizenship (if several, list all)",
} as const;

/** [`CITIZENSHIP_FIELD_LABELS`] in `lang`; German (the client's original) for any other language. */
export function citizenshipFieldLabel(lang: string): string {
  return Object.prototype.hasOwnProperty.call(CITIZENSHIP_FIELD_LABELS, lang)
    ? CITIZENSHIP_FIELD_LABELS[lang as keyof typeof CITIZENSHIP_FIELD_LABELS]
    : CITIZENSHIP_FIELD_LABELS.de;
}
