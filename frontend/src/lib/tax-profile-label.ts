/**
 * The name of a tax profile in the staff UI (QA3): the system profiles have
 * Russian and German UI names; the stored name (English or German, used on
 * documents) stays for profiles staff created.
 */
export type TaxProfileLabelSource = {
  profile_key?: string | null;
  name: string;
  vat_rate?: unknown;
};

const SYSTEM_PROFILE_LABELS: Record<string, { ru: string; de: string }> = {
  standard_vat: { ru: "Стандартная ставка 19 %", de: "Regelsteuersatz 19 %" },
  termin_fee_0: {
    ru: "Организация лечения 0 % (§ 4 Nr. 14)",
    de: "Organisation der Behandlung 0 % (§ 4 Nr. 14 UStG)",
  },
  vat_exempt_0: { ru: "Без НДС (освобождено) 0 %", de: "Steuerfrei 0 %" },
  pass_through_0: { ru: "Транзитные расходы 0 %", de: "Durchlaufender Posten 0 %" },
};

export function taxProfileLabel(profile: TaxProfileLabelSource, lang: string): string {
  const labels = profile.profile_key ? SYSTEM_PROFILE_LABELS[profile.profile_key] : undefined;
  if (!labels) return profile.name;
  return lang === "de" ? labels.de : labels.ru;
}
