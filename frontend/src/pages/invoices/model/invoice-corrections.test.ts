import { describe, expect, it } from "vitest";

import { dunningBlockReason } from "./invoice-dunning";
import {
  INVOICE_FILTER_STATUSES,
  activeDunningBlock,
  invoiceDisplayStatus,
  invoiceStatusFormProblem,
  statusChangeReasonKind,
} from "./invoice-model";

describe("credited display status", () => {
  it("shows a fully credited invoice as credited, others by their stored status", () => {
    expect(invoiceDisplayStatus({ status: "paid", display_status: "credited" })).toBe("credited");
    expect(invoiceDisplayStatus({ status: "partially_paid" })).toBe("partially_paid");
    expect(INVOICE_FILTER_STATUSES).toContain("credited");
  });
});

describe("status change reasons", () => {
  const released = "2026-09-01T10:00:00Z";

  it("cancelling a released invoice issues a cancellation document", () => {
    expect(statusChangeReasonKind({ status: "sent", released_at: released }, "cancelled")).toBe("storno");
    expect(statusChangeReasonKind({ status: "draft", released_at: null }, "cancelled")).toBeNull();
  });

  it("an overdue invoice goes back to sent only with a dunning block reason", () => {
    const invoice = { status: "overdue", released_at: released, due_date: "2026-09-10" };
    expect(statusChangeReasonKind(invoice, "sent")).toBe("dunning_block");
    const today = new Date("2026-09-28T10:00:00Z");
    expect(
      invoiceStatusFormProblem(invoice, { status: "sent", dueDate: "2026-09-10", reason: "ok" }, today),
    ).toBe("reason_required");
    expect(
      invoiceStatusFormProblem(
        invoice,
        { status: "sent", dueDate: "2026-09-10", reason: "Ratenzahlung vereinbart" },
        today,
      ),
    ).toBeNull();
  });
});

describe("dunning block", () => {
  const overdue = { status: "overdue", balance_due: "100.00", due_date: "2026-09-01" };

  it("reads the active block from list and detail payloads", () => {
    expect(activeDunningBlock({ dunning_block: { reason: "Streitfall", blocked_at: null } })?.reason).toBe(
      "Streitfall",
    );
    expect(activeDunningBlock({ dunning_block: { active: null, history: [] } })).toBeNull();
  });

  it("blocks manual dunning while the block is active", () => {
    expect(dunningBlockReason({ ...overdue, dunning_block: null }, "2026-09-28")).toBeNull();
    expect(
      dunningBlockReason(
        { ...overdue, dunning_block: { reason: "Ratenzahlung", blocked_at: null } },
        "2026-09-28",
      ),
    ).toBe("revenue_invoices_dunning_blocked");
  });
});
