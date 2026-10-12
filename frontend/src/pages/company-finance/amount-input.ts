/**
 * Money typed in a company-finance form: German "1.234,56" / "119,00", or
 * "1234.56", in the API's "1234.56" form (QA D3-02: the supplier payout sent
 * "119,00" as typed and got an untranslated 422).
 */
export function normalizeAmountInput(value: string): string {
  const compact = value.trim().replace(/\s/g, "");
  return compact.includes(",") ? compact.replace(/\./g, "").replace(",", ".") : compact;
}

/** An API amount ("119", "1234.5") as staff type it: "119,00", "1234,50". */
export function amountInputText(value: string | number | null | undefined): string {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (value === null || value === undefined || String(value).trim() === "" || !Number.isFinite(parsed)) {
    return "";
  }
  return parsed.toFixed(2).replace(".", ",");
}

/** The typed amount as a number, NaN when it is not a number. */
export function amountInputValue(value: string): number {
  const normalized = normalizeAmountInput(value);
  if (!normalized) return Number.NaN;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
