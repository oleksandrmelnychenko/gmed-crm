/**
 * The final invoice bills what was actually delivered, not the estimate 1:1
 * (owner 2026-11-17): the server proposes the delivered quantity per estimate
 * line (`final_quantity`, «по смете» where the order records no delivery)
 * and the delivered services outside the estimate; staff may set any
 * quantity, 0 leaves the line out.
 */
import { moneyFinalLinePartAmounts, moneyLineAmounts, roundCents, toCents } from "@/lib/money";

import type { CreateForm, DeliveredOrderService, InvoiceLineItem, QuoteOption } from "./types";

/** One VAT category of a planned set-off. */
export type FinalPreviewRow = {
  kind: "taxed" | "zero_rated" | "passthrough";
  vat_rate: string;
  net: string;
  vat: string;
  gross: string;
};

/** `POST /quotes/{id}/final-preview`: the final invoice and the set-off its release makes. */
export type FinalInvoicePreview = {
  total_net: string;
  total_vat: string;
  total_gross: string;
  advances: {
    invoice_id: string;
    invoice_number: string | null;
    total_gross: string;
    paid_gross: string;
    available_gross: string;
    deduction_gross: string;
    deduction_rows: FinalPreviewRow[];
  }[];
  deducted_gross: string;
  due_gross: string;
  interim_invoices: { invoice_id: string; invoice_number: string | null; total_gross: string; status: string }[];
};

type FinalForm =Pick<CreateForm, "selectedLineIndexes" | "lineQuantities" | "orderServiceQuantities">;

function numberOf(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

/** Decimal comma, up to two places, as on the invoice. */
export function formatQuantity(value: number) {
  return value.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}

/** What the final invoice proposes: every estimate line with its delivered quantity and the services outside it. */
export function createFinalInvoiceSelection(
  lines: InvoiceLineItem[],
  extras: DeliveredOrderService[] = [],
) {
  return {
    selectedLineIndexes: lines.map((_, index) => index),
    lineQuantities: Object.fromEntries(lines.map((line, index) => [
      String(index),
      String(numberOf(line.final_quantity ?? line.remaining_quantity ?? line.quantity)),
    ])),
    orderServiceQuantities: Object.fromEntries(extras.map((extra) => [
      extra.order_leistung_id,
      String(numberOf(extra.quantity)),
    ])),
  };
}

function quantityOf(values: Record<string, string> | undefined, key: string) {
  const raw = values?.[key];
  if (raw === undefined || raw.trim() === "") return 0;
  const number = Number(raw.replace(",", "."));
  return Number.isFinite(number) ? number : Number.NaN;
}

/** Quantity typed for an estimate line; 0 leaves it out. NaN when not a number. */
export function finalLineQuantity(form: FinalForm, index: number) {
  return quantityOf(form.lineQuantities, String(index));
}

export function finalServiceQuantity(form: FinalForm, serviceId: string) {
  return quantityOf(form.orderServiceQuantities, serviceId);
}

/** Amounts the line bills on the final invoice, as the server prices them. */
export function finalLineAmounts(line: InvoiceLineItem, quantity: number) {
  if (!(quantity > 0)) return { net: 0, vat: 0, gross: 0 };
  const billedKnown = line.invoiced_net !== undefined && line.invoiced_gross !== undefined;
  return moneyFinalLinePartAmounts({
    quantity,
    unitPriceNet: numberOf(line.unit_price),
    vatRatePercent: numberOf(line.vat_rate),
    lineQuantity: numberOf(line.quantity),
    billedQuantity: numberOf(line.invoiced_quantity),
    lineNet: billedKnown ? numberOf(line.line_net) : Number.NaN,
    lineGross: billedKnown ? numberOf(line.line_gross) : Number.NaN,
    billedNet: numberOf(line.invoiced_net),
    billedGross: numberOf(line.invoiced_gross),
  });
}

export function finalServiceAmounts(service: DeliveredOrderService, quantity: number) {
  if (!(quantity > 0)) return { net: 0, vat: 0, gross: 0 };
  return moneyLineAmounts(quantity, numberOf(service.unit_price), numberOf(service.vat_rate));
}

/**
 * One estimate line against what is billed of it now: the estimate, the actual
 * quantity (already invoiced + this invoice + its services outside the
 * estimate) and the difference in quantity and gross.
 */
export function finalLineComparison(
  line: InvoiceLineItem,
  index: number,
  form: FinalForm,
  extras: DeliveredOrderService[] = [],
) {
  const estimate = numberOf(line.quantity);
  const own = finalLineQuantity(form, index);
  const siblings = extras
    .filter((extra) => extra.quote_line_index === index)
    .reduce((sum, extra) => {
      const quantity = finalServiceQuantity(form, extra.order_leistung_id);
      return sum + (Number.isFinite(quantity) ? quantity : 0);
    }, 0);
  const actual = roundCents(numberOf(line.invoiced_quantity) + (Number.isFinite(own) ? own : 0) + siblings);
  const difference = roundCents(actual - estimate);
  const unitGross = moneyLineAmounts(1, numberOf(line.unit_price), numberOf(line.vat_rate)).gross;
  const sign = difference < 0 ? -1 : 1;
  return {
    estimate,
    actual,
    difference,
    differenceGross: sign * roundCents(Math.abs(difference) * unitGross),
    recorded: line.delivery_basis !== "estimate",
    notDelivered: actual <= 0,
    aboveEstimate: toCents(actual) > toCents(estimate),
  };
}

/** Net, VAT and gross of the final invoice: estimate lines and services outside the estimate. */
export function finalInvoiceTotals(
  lines: InvoiceLineItem[],
  form: FinalForm,
  extras: DeliveredOrderService[] = [],
) {
  const totals = { net: 0, vat: 0, gross: 0, lineGrossByIndex: {} as Record<number, number>, serviceGrossById: {} as Record<string, number> };
  const add = (amounts: { net: number; vat: number; gross: number }) => {
    totals.net = roundCents(totals.net + amounts.net);
    totals.vat = roundCents(totals.vat + amounts.vat);
    totals.gross = roundCents(totals.gross + amounts.gross);
  };
  lines.forEach((line, index) => {
    const amounts = finalLineAmounts(line, finalLineQuantity(form, index));
    totals.lineGrossByIndex[index] = amounts.gross;
    add(amounts);
  });
  for (const extra of extras) {
    const amounts = finalServiceAmounts(extra, finalServiceQuantity(form, extra.order_leistung_id));
    totals.serviceGrossById[extra.order_leistung_id] = amounts.gross;
    add(amounts);
  }
  return totals;
}

/**
 * «по смете X € · фактически Y €»: the estimate gross against what the
 * quote's invoices bill of it before plus this final invoice.
 */
export function finalInvoiceSummary(
  quote: Pick<QuoteOption, "line_items"> | null | undefined,
  form: FinalForm,
  extras: DeliveredOrderService[] = [],
) {
  const lines = quote?.line_items ?? [];
  const estimate = roundCents(lines.reduce((sum, line) => sum + numberOf(line.line_gross), 0));
  const billedBefore = roundCents(lines.reduce((sum, line) => sum + numberOf(line.invoiced_gross), 0));
  const actual = roundCents(billedBefore + finalInvoiceTotals(lines, form, extras).gross);
  return { estimate, actual, difference: roundCents(actual - estimate) };
}

/** Every quantity is a number of at least 0, and the invoice bills something. */
export function isFinalSelectionValid(
  lines: InvoiceLineItem[],
  form: FinalForm,
  extras: DeliveredOrderService[] = [],
) {
  const quantities = [
    ...lines.map((_, index) => finalLineQuantity(form, index)),
    ...extras.map((extra) => finalServiceQuantity(form, extra.order_leistung_id)),
  ];
  return quantities.every((quantity) => Number.isFinite(quantity) && quantity >= 0)
    && quantities.some((quantity) => quantity > 0);
}

/** The services outside the estimate as the API takes them (quantity above 0). */
export function finalOrderServicesPayload(form: FinalForm, extras: DeliveredOrderService[] = []) {
  return extras.flatMap((extra) => {
    const quantity = finalServiceQuantity(form, extra.order_leistung_id);
    return quantity > 0 ? [{ order_leistung_id: extra.order_leistung_id, quantity }] : [];
  });
}

/** «+2 ч · +142,80 €», «−1 ч · −71,40 €». */
export function formatFinalDifference(
  difference: number,
  differenceGross: number,
  quantityText: (value: string) => string,
  money: (value: number) => string,
) {
  const sign = difference > 0 ? "+" : "−";
  const amountSign = differenceGross > 0 ? "+" : "−";
  return `${sign}${quantityText(formatQuantity(Math.abs(difference)))} · ${amountSign}${money(Math.abs(differenceGross))}`;
}
