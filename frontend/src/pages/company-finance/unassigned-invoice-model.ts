import type { CompanyProviderLiability } from "./types";

/**
 * A supplier invoice without an order (company cost, or a patient cost not
 * assigned to an order yet) can be corrected or cancelled by CEO and billing
 * while it is unpaid and not cancelled (owner decision 2026-09-28).
 */
export function canCorrectUnassignedInvoice(
  liability: Pick<CompanyProviderLiability, "order_id" | "paid_by" | "company_paid_gross" | "status">,
) {
  return (
    !liability.order_id &&
    liability.paid_by === "unpaid" &&
    Number(liability.company_paid_gross) <= 0 &&
    ["expected", "received", "approved", "overdue"].includes(liability.status)
  );
}
