import { formatAppDate } from "@/lib/app-time-zone";

function amount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Concierge services of an order with a sale price (owner 2026-11-12,
 * decision 7). Information only: no order line or invoice line is linked to a
 * concierge service, so these amounts never enter the order totals (a billed
 * one is already in the invoice revenue, an unbilled one may also be an
 * order line). The salaried concierge adds no cost.
 */
export type OrderConciergeSaleService = {
  id: string;
  title: string;
  service_kind: string;
  status: string;
  billing_status: string;
  billed: boolean;
  currency: string;
  currency_matches_order: boolean;
  quantity: string;
  unit_price: string;
  sale_price: string;
  starts_at: string | null;
};

export type OrderConciergeSales = {
  counted_in_totals: boolean;
  billed_total: string;
  unbilled_total: string;
  other_currency_count: number;
  services: OrderConciergeSaleService[];
};

export type ConciergeSalesRow = {
  id: string;
  title: string;
  date: string;
  salePrice: string;
  currency: string;
  state: string;
  billed: boolean;
  outsideTotals: boolean;
};

export type ConciergeSalesView = {
  unbilledTotal: number;
  billedTotal: number;
  /** One line under «Ещё не выставлено счётом». */
  summary: string;
  /** Why the amounts stay outside the order totals. */
  note: string;
  rows: ConciergeSalesRow[];
};

type Lang = "ru" | "de" | string;

function stateLabel(service: OrderConciergeSaleService, de: boolean): string {
  if (service.billed) return de ? "Berechnet" : "Выставлено";
  if (service.billing_status === "ready") return de ? "Bereit zur Abrechnung" : "Готово к выставлению счёта";
  return de ? "Noch nicht berechnet" : "Ещё не выставлено";
}

/**
 * The view of the concierge sale prices, or `null` when the order has no
 * concierge service with a sale price (nothing to show).
 */
export function conciergeSalesView(
  sales: OrderConciergeSales | null | undefined,
  formatMoney: (value: unknown, currency: string) => string,
  orderCurrency: string,
  lang: Lang,
): ConciergeSalesView | null {
  if (!sales || sales.services.length === 0) return null;
  const de = lang === "de";
  const unbilledTotal = amount(sales.unbilled_total);
  const billedTotal = amount(sales.billed_total);
  const unbilled = formatMoney(sales.unbilled_total, orderCurrency);
  const billed = formatMoney(sales.billed_total, orderCurrency);
  const summary = de
    ? `Concierge-Leistungen: noch nicht berechnet ${unbilled}, berechnet ${billed} (zur Information).`
    : `Услуги Concierge: ещё не выставлено ${unbilled}, выставлено ${billed} (информативно).`;
  const otherCurrency = sales.other_currency_count > 0
    ? de
      ? ` Leistungen in anderer Währung (${sales.other_currency_count}) sind nicht in diesen Summen.`
      : ` Услуги в другой валюте (${sales.other_currency_count}) в эти суммы не входят.`
    : "";
  const note = (de
    ? "Der Verkaufspreis der Concierge-Leistungen ist nicht in den Auftragssummen: eine Concierge-Leistung ist mit keiner Auftrags- oder Rechnungsposition verknüpft. Berechnete Leistungen sind bereits im Erlös der Rechnungen enthalten. Die Arbeit des Concierge ist Gehalt und zählt nicht als Kosten."
    : "Продажная цена услуг Concierge не входит в суммы заказа: услуга Concierge не связана с позицией заказа или счёта. Выставленные услуги уже учтены в доходе по счетам. Работа консьержа оплачивается зарплатой и не считается затратой.")
    + otherCurrency;
  const rows = sales.services.map((service) => ({
    id: service.id,
    title: service.title,
    date: service.starts_at ? formatAppDate(service.starts_at) : "—",
    salePrice: formatMoney(service.sale_price, service.currency || orderCurrency),
    currency: service.currency,
    state: stateLabel(service, de),
    billed: service.billed,
    outsideTotals: !service.currency_matches_order,
  }));
  return { unbilledTotal, billedTotal, summary, note, rows };
}
