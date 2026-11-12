/** The fields of a concierge service the order workspace lists. */
export type OrderConciergeService = {
  id: string;
  title: string;
  title_redacted?: boolean;
  status: string;
  order_id: string | null;
  starts_at: string | null;
};

/** Services of this order (linked directly or through one of its appointments), soonest first. */
export function orderConciergeServices<T extends Pick<OrderConciergeService, "order_id" | "starts_at">>(
  services: T[],
  orderId: string,
): T[] {
  const time = (service: T) =>
    service.starts_at ? new Date(service.starts_at).getTime() : Number.POSITIVE_INFINITY;
  return services
    .filter((service) => service.order_id === orderId)
    .toSorted((left, right) => (time(left) === time(right) ? 0 : time(left) < time(right) ? -1 : 1));
}

/** Confirmed, running or completed: a secured or delivered booking. */
export function isSecuredConciergeService(service: Pick<OrderConciergeService, "status">): boolean {
  return ["confirmed", "in_service", "completed"].includes(service.status);
}
