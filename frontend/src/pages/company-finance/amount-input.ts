import { normalizeMoneyInput, parseMoneyInput } from "@/lib/money";

/**
 * Money typed in a company-finance form: German "1.234,56" / "1.500" /
 * "119,00", or "1234.56", in the API's "1234.56" form (QA D3-02: the supplier
 * payout sent "119,00" as typed and got an untranslated 422). What cannot be
 * read stays as typed: the server refuses it.
 */
export function normalizeAmountInput(value: string): string {
  return normalizeMoneyInput(value) ?? value.trim().replace(/\s/g, "");
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
  return parseMoneyInput(value);
}
