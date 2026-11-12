import { formatAppDate } from "@/lib/app-time-zone";

function amount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Concierge services of an order with a sale price (owner 2026-11-12,
 * decision 7). A service billed by an issued invoice line of the order
 * (`invoiced`, screens QA 2026-11-12 F-C8) is counted exactly in the order
 * revenue. Every other one is information only: billed by hand without an
 * invoice line, or not billed yet (it may also be an order line). The
 * salaried concierge adds no cost.
 */
export type OrderConciergeSaleService = {
  id: string;
  title: string;
  service_kind: string;
  status: string;
  billing_status: string;
  billed: boolean;
  /** Billed by an issued invoice line of the order: counted in the revenue. */
  invoiced?: boolean;
  /** Net revenue of that invoice line after credit notes. */
  invoiced_net?: string | null;
  currency: string;
  currency_matches_order: boolean;
  quantity: string;
  unit_price: string;
  sale_price: string;
  starts_at: string | null;
};

export type OrderConciergeSales = {
  /** Whether `billed_total`/`unbilled_total` are in the totals: never. */
  counted_in_totals: boolean;
  /** Net revenue of the invoice lines that bill a service: in the totals. */
  invoiced_total?: string;
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
  /** Counted in the order revenue through its invoice line. */
  invoiced: boolean;
  outsideTotals: boolean;
  /** The service on the Services page. */
  href: string;
};

export type ConciergeSalesView = {
  invoicedTotal: number;
  unbilledTotal: number;
  billedTotal: number;
  /** One line under «Ещё не выставлено счётом». */
  summary: string;
  /** Which amounts are in the order totals and which are not. */
  note: string;
  rows: ConciergeSalesRow[];
};

type Lang = "ru" | "de" | string;

function stateLabel(service: OrderConciergeSaleService, de: boolean): string {
  if (service.invoiced) return de ? "In Rechnung (im Erlös)" : "В счёте (учтено в доходе)";
  if (service.billed) return de ? "Berechnet ohne Rechnungsposition" : "Выставлено без позиции счёта";
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
  const invoicedTotal = amount(sales.invoiced_total);
  const unbilledTotal = amount(sales.unbilled_total);
  const billedTotal = amount(sales.billed_total);
  const invoiced = formatMoney(sales.invoiced_total ?? 0, orderCurrency);
  const unbilled = formatMoney(sales.unbilled_total, orderCurrency);
  const billed = formatMoney(sales.billed_total, orderCurrency);
  const invoicedPart = invoicedTotal > 0
    ? de ? `in Rechnungen ${invoiced} (im Erlös), ` : `в счетах ${invoiced} (учтено в доходе), `
    : "";
  const summary = de
    ? `Concierge-Leistungen: ${invoicedPart}noch nicht berechnet ${unbilled}, berechnet ${billed} (zur Information).`
    : `Услуги Concierge: ${invoicedPart}ещё не выставлено ${unbilled}, выставлено ${billed} (информативно).`;
  const otherCurrency = sales.other_currency_count > 0
    ? de
      ? ` Leistungen in anderer Währung (${sales.other_currency_count}) sind nicht in diesen Summen.`
      : ` Услуги в другой валюте (${sales.other_currency_count}) в эти суммы не входят.`
    : "";
  const note = (de
    ? "Eine Concierge-Leistung, die eine ausgestellte Rechnungsposition berechnet, ist mit diesem Betrag im Erlös des Auftrags enthalten. Die übrigen Verkaufspreise sind nur zur Information und nicht in den Auftragssummen: ohne Rechnungsposition ist die Leistung mit keiner Auftrags- oder Rechnungsposition verknüpft. Die Arbeit des Concierge ist Gehalt und zählt nicht als Kosten."
    : "Услуга Concierge, выставленная позицией выпущенного счёта, учтена в доходе заказа на эту сумму. Остальные продажные цены — только для информации и не входят в суммы заказа: без позиции счёта услуга не связана с позицией заказа или счёта. Работа консьержа оплачивается зарплатой и не считается затратой.")
    + otherCurrency;
  const rows = sales.services.map((service) => ({
    id: service.id,
    title: service.title,
    date: service.starts_at ? formatAppDate(service.starts_at) : "—",
    salePrice: formatMoney(
      service.invoiced && service.invoiced_net != null ? service.invoiced_net : service.sale_price,
      service.currency || orderCurrency,
    ),
    currency: service.currency,
    state: stateLabel(service, de),
    billed: service.billed,
    invoiced: Boolean(service.invoiced),
    outsideTotals: !service.invoiced && !service.currency_matches_order,
    href: `/services?service=${encodeURIComponent(service.id)}`,
  }));
  return { invoicedTotal, unbilledTotal, billedTotal, summary, note, rows };
}
