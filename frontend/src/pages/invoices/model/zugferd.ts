const MISSING_LABELS: Record<string, { de: string; ru: string }> = {
  seller_name: { de: "Name der Agentur", ru: "название агентства" },
  seller_country: { de: "Ländercode der Agentur", ru: "код страны агентства" },
  seller_tax_registration: {
    de: "USt-IdNr. oder Steuernummer der Agentur",
    ru: "USt-IdNr. или налоговый номер агентства",
  },
  buyer_name: { de: "Name des Rechnungsempfängers", ru: "имя плательщика" },
  buyer_country: { de: "Land in der Patientenadresse", ru: "страна в адресе пациента" },
  invoice_lines: { de: "Rechnungspositionen", ru: "позиции счёта" },
  line_name: { de: "Bezeichnung jeder Position", ru: "название каждой позиции" },
};

const MISSING_PREFIX = "E-invoice is missing mandatory data:";

/** Turns the API's list of missing EN 16931 fields into a readable hint. */
export function zugferdErrorMessage(error: unknown, lang: string, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  if (!message.startsWith(MISSING_PREFIX)) return message || fallback;
  const de = lang === "de";
  const fields = message
    .slice(MISSING_PREFIX.length)
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean)
    .map((key) => (MISSING_LABELS[key] ? (de ? MISSING_LABELS[key].de : MISSING_LABELS[key].ru) : key));
  return de
    ? `Für die E-Rechnung (ZUGFeRD) fehlen Pflichtangaben: ${fields.join(", ")}. Agenturdaten stehen in den Systemeinstellungen.`
    : `Для e-счёта (ZUGFeRD) не хватает обязательных данных: ${fields.join(", ")}. Реквизиты агентства задаются в системных настройках.`;
}
