import { importMoneyCents, type InvoiceImportFields } from "./import-model";

export type InvoiceAmountBase = "amount_net" | "amount_gross";
export type InvoiceAmounts = Pick<InvoiceImportFields, "amount_net" | "amount_vat" | "amount_gross">;
export type InvoiceVatCalculation = {
  selection: "manual" | "0" | "7" | "19" | "custom";
  customRate: string;
  base: InvoiceAmountBase;
};

export const defaultInvoiceVatCalculation = (): InvoiceVatCalculation => ({ selection: "manual", customRate: "", base: "amount_net" });
export const invoiceVatRate = (calculation: InvoiceVatCalculation) => calculation.selection === "custom" ? calculation.customRate : calculation.selection;

// Four decimal places in a percentage, with all amount arithmetic in cents.
function scaledVatRate(value: string): bigint | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,3}(?:\.\d{1,4})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const rate = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, "0"));
  return rate <= 1_000_000n ? rate : null;
}

export const validInvoiceVatRate = (value: string) => scaledVatRate(value) !== null;
const formatCents = (cents: bigint) => `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
const roundDivide = (value: bigint, divisor: bigint) => (value + divisor / 2n) / divisor;

export function calculateInvoiceAmounts(value: string, rateValue: string, base: InvoiceAmountBase): InvoiceAmounts | null {
  const cents = importMoneyCents(value);
  const rate = scaledVatRate(rateValue);
  if (cents === null || rate === null) return null;
  const amount = BigInt(cents);
  const percent = 1_000_000n;
  const net = base === "amount_net" ? amount : roundDivide(amount * percent, percent + rate);
  const vat = base === "amount_net" ? roundDivide(net * rate, percent) : amount - net;
  const result = { amount_net: formatCents(net), amount_vat: formatCents(vat), amount_gross: formatCents(net + vat) };
  return Object.values(result).every(value => importMoneyCents(value) !== null) ? result : null;
}

export function applyInvoiceVatCalculation(fields: InvoiceImportFields, calculation: InvoiceVatCalculation): InvoiceImportFields {
  if (calculation.selection === "manual") return fields;
  const amounts = calculateInvoiceAmounts(fields[calculation.base], invoiceVatRate(calculation), calculation.base)
    ?? { amount_net: "", amount_vat: "", amount_gross: "" };
  // Preserve the user's active input, including a decimal comma or an unfinished value.
  return { ...fields, ...amounts, [calculation.base]: fields[calculation.base] };
}
