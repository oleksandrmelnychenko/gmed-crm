/**
 * The tax profiles the migration seeds carry English names and descriptions.
 * As long as nobody renamed them, they are shown in the UI language — in the
 * finance catalogue and on the invoice card ("Источник НДС", QA D-12/D-44).
 */
const SEED_TAX_PROFILE_TEXTS: Record<
  string,
  { name: string; description: string; ru: [string, string]; de: [string, string] }
> = {
  standard_vat: {
    name: "Standard VAT",
    description: "Default VAT profile for taxable services such as interpreter support.",
    ru: ["Стандартная ставка НДС", "Профиль по умолчанию для облагаемых услуг, например услуг переводчика."],
    de: ["Regelsteuersatz", "Standardprofil für steuerpflichtige Leistungen, z. B. Dolmetschen."],
  },
  termin_fee_0: {
    name: "Termin fee 0% VAT",
    description: "Default zero VAT profile for appointment/termin organization fees.",
    ru: ["Организация лечения, НДС 0 %", "Профиль 0 % для организации лечения и приёмов (§ 4 Nr. 14 UStG)."],
    de: ["Behandlungsorganisation, 0 % USt.", "0-%-Profil für die Organisation von Behandlung und Terminen (§ 4 Nr. 14 UStG)."],
  },
  vat_exempt_0: {
    name: "VAT exempt 0%",
    description: "Generic VAT exempt profile for manually reviewed services.",
    ru: ["Без НДС (освобождено), 0 %", "Общий профиль освобождения от НДС для вручную проверенных услуг."],
    de: ["Steuerfrei, 0 %", "Allgemeines steuerfreies Profil für manuell geprüfte Leistungen."],
  },
};

export function seedTaxProfileText(
  key: string | null | undefined,
  value: string | null | undefined,
  field: "name" | "description",
  lang: string,
): string | null {
  const seed = key ? SEED_TAX_PROFILE_TEXTS[key.trim()] : undefined;
  if (!seed || (value ?? "").trim() !== seed[field]) return null;
  const texts = lang === "de" ? seed.de : seed.ru;
  return field === "name" ? texts[0] : texts[1];
}

/**
 * The name of a seeded profile when only its stored English name is known
 * (an invoice line's snapshot may lack the profile key).
 */
export function seedTaxProfileNameByText(value: string | null | undefined, lang: string): string | null {
  const trimmed = (value ?? "").trim();
  for (const [key, seed] of Object.entries(SEED_TAX_PROFILE_TEXTS)) {
    if (seed.name === trimmed) return seedTaxProfileText(key, trimmed, "name", lang);
  }
  return null;
}
