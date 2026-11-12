import { describe, expect, it } from "vitest";

import { isSecuredConciergeService, orderConciergeServices } from "./order-concierge-services";

describe("order concierge services (concierge QA 2026-11-12 D-13)", () => {
  it("keeps the services of this order, soonest first", () => {
    const rows = [
      { id: "hotel", order_id: "order-1", starts_at: "2026-11-20T14:00:00Z", status: "confirmed" },
      { id: "other-order", order_id: "order-2", starts_at: "2026-11-13T08:00:00Z", status: "planned" },
      { id: "transfer", order_id: "order-1", starts_at: "2026-11-13T08:00:00Z", status: "planned" },
      { id: "no-order", order_id: null, starts_at: null, status: "planned" },
    ];
    expect(orderConciergeServices(rows, "order-1").map((row) => row.id)).toEqual(["transfer", "hotel"]);
  });

  it("counts confirmed, running and completed bookings as secured", () => {
    expect(isSecuredConciergeService({ status: "confirmed" })).toBe(true);
    expect(isSecuredConciergeService({ status: "completed" })).toBe(true);
    expect(isSecuredConciergeService({ status: "booked" })).toBe(false);
    expect(isSecuredConciergeService({ status: "planned" })).toBe(false);
  });
});
