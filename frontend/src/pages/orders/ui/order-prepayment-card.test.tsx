import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrderPrepaymentCard } from "./order-prepayment-card";

const order = { id: "order", prepayment_required: true, prepayment_amount: "87.40", prepayment_due_at: "2026-11-20T11:00:00Z" };

function render(status?: string) {
  return renderToStaticMarkup(
    <OrderPrepaymentCard
      order={{ ...order, process_gates: status ? { payment_tracking: { status } } : null }}
      canEdit={false}
      lang="ru"
      onSaved={() => undefined}
    />,
  );
}

describe("OrderPrepaymentCard", () => {
  it("says the prepayment is paid (QA 2026-11-01, U-7)", () => {
    expect(render("paid")).toContain("Оплачено");
    expect(render("partially_paid")).toContain("Частично оплачено");
  });

  it("adds no paid word while it is open", () => {
    expect(render("awaiting_payment")).not.toContain("order-prepayment-paid");
    expect(render()).not.toContain("order-prepayment-paid");
  });
});
