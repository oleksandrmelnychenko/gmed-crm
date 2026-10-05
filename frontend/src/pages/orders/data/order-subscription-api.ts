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
