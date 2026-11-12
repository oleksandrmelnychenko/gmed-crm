import { apiFetch } from "@/lib/api";
import type { SubscriptionKind } from "@/pages/patients/model/list-model";

export type OrderTariffOption = {
  id: string;
  kind: SubscriptionKind;
  package_key: string;
  name: string | null;
  base_price_gross: string | null;
  currency: string | null;
};

export type OrderTariff = {
  patient_service_package_id: string;
  package_id: string;
  kind: SubscriptionKind;
  package_key: string;
  name: string | null;
  status: string | null;
  starts_on: string | null;
  ends_on: string | null;
  /** Consumption is recorded on it: another tariff starts counting at zero. */
  has_consumption?: boolean;
};

/** The order's tariff (the patient's account type) and the tariffs on offer. */
export type OrderSubscription = {
  current: OrderTariff | null;
  options: OrderTariffOption[];
  can_edit: boolean;
};

export function fetchOrderSubscription(orderId: string) {
  return apiFetch<OrderSubscription>(`/orders/${orderId}/subscription`, { forceFresh: true });
}

/** `packageId: null` removes the order's tariff. */
export function setOrderSubscription(
  orderId: string,
  body: { package_id: string | null; starts_on?: string | null; ends_on?: string | null },
) {
  return apiFetch<OrderSubscription>(`/orders/${orderId}/subscription`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * The picker text of each tariff: "kind · name". Tariffs with the same text
 * (QA C-07: thirty "GMED One · Synthetic Portal Subscription") add their
 * price and, if still equal, their catalogue key, so every entry can be told
 * apart.
 */
export function orderTariffOptionLabels(
  options: readonly OrderTariffOption[],
  kindLabel: (option: OrderTariffOption) => string,
  formatPrice: (amount: string, currency: string) => string,
): Map<string, string> {
  const countLabels = (labels: Map<string, string>) => {
    const counts = new Map<string, number>();
    for (const label of labels.values()) counts.set(label, (counts.get(label) ?? 0) + 1);
    return counts;
  };
  const base = new Map(
    options.map((option) => [option.id, `${kindLabel(option)} · ${option.name ?? option.package_key}`]),
  );
  const baseCounts = countLabels(base);
  const priced = new Map(
    options.map((option) => {
      const label = base.get(option.id) ?? "";
      if ((baseCounts.get(label) ?? 0) < 2 || !option.base_price_gross) return [option.id, label];
      return [option.id, `${label} · ${formatPrice(option.base_price_gross, option.currency ?? "EUR")}`];
    }),
  );
  const pricedCounts = countLabels(priced);
  return new Map(
    options.map((option) => {
      const label = priced.get(option.id) ?? "";
      return [option.id, (pricedCounts.get(label) ?? 0) < 2 ? label : `${label} · ${option.package_key}`];
    }),
  );
}
