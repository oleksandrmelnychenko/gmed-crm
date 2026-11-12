import { roundCents } from "@/lib/money";

/**
 * Ready concierge services billed at their sale price from the patient's
 * billing tab (screens QA 2026-11-12, F-C8). The server lists the patient's
 * services with billing status «ready»; the draft gets one line per service
 * (quantity × unit price net plus the VAT of GMED's default tax profile) and
 * the release moves the service to «billed». A service without a sale price
 * is not offered: its price is set on the service first.
 */
export type BillingConciergeService = {
  id: string;
  title: string;
  service_kind: string;
  /** The service's order (direct, else through its appointment). */
  order_id: string | null;
  order_number: string | null;
  service_date: string | null;
  currency: string;
  quantity: string;
  unit_price: string | null;
  /** quantity × unit price, net; null without a sale price. */
  sale_price_net: string | null;
  /** A live draft that already bills the service. */
  invoice_id: string | null;
  invoice_number: string | null;
  billable: boolean;
};

export type ConciergeServiceState =
  | "selectable"
  | "no_price"
  | "in_draft"
  | "other_order"
  | "other_currency";

function amount(value: string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function hasSalePrice(service: BillingConciergeService): boolean {
  return amount(service.sale_price_net) > 0;
}

/**
 * Whether the service can go on the draft being prepared: it needs a price,
 * no live draft, the draft's currency and — when the service has an order —
 * that order (its sale price lands in that order's economics). Without a
 * chosen order, ticking a service proposes its order.
 */
export function conciergeServiceState(
  service: BillingConciergeService,
  draft: { orderId: string; currency: string },
): ConciergeServiceState {
  if (!hasSalePrice(service)) return "no_price";
  if (service.invoice_id || !service.billable) return "in_draft";
  if (service.currency.toUpperCase() !== draft.currency.toUpperCase()) return "other_currency";
  if (service.order_id && draft.orderId && service.order_id !== draft.orderId) return "other_order";
  return "selectable";
}

/** Net, VAT and gross of the line, rounded like the server (net, then VAT on net). */
export function conciergeLineAmounts(service: BillingConciergeService, vatRate: string | null | undefined) {
  const net = roundCents(amount(service.sale_price_net));
  const vat = roundCents(net * amount(vatRate) / 100);
  return { net, vat, gross: roundCents(net + vat) };
}
