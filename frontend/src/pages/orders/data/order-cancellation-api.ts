import { apiFetch } from "@/lib/api";

import {
  normalizeOrderCancellationSummary,
  type OrderCancellationSummary,
} from "../model/order-cancellation";

/** What cancelling the order would change; nothing is written. */
export async function fetchOrderCancellationPreview(
  orderId: string,
): Promise<OrderCancellationSummary> {
  return normalizeOrderCancellationSummary(
    await apiFetch<unknown>(`/orders/${orderId}/cancellation-preview`),
  );
}

/**
 * Cancel the order with a reason: planned services, upcoming appointments,
 * open quotes and pending amount amendments are cancelled; delivered and
 * invoiced items stay as the basis for final billing or a refund.
 */
export async function cancelOrder(
  orderId: string,
  reason: string,
): Promise<OrderCancellationSummary> {
  const response = await apiFetch<{ cancellation?: unknown }>(`/orders/${orderId}/status`, {
    method: "POST",
    body: JSON.stringify({ status: "cancelled", reason }),
  });
  return normalizeOrderCancellationSummary(response?.cancellation);
}
