import { describe, expect, it } from "vitest";
import { dunningBlockReason, dunningErrorKey } from "./invoice-dunning";

const sent = { status: "sent", balance_due: "2963.10", due_date: "2026-09-06" };
const today = "2026-09-07";

describe("invoice dunning preflight", () => {
  it("allows an overdue sent invoice with a positive remaining balance", () => {
    expect(dunningBlockReason(sent, today)).toBeNull();
    expect(dunningBlockReason({ ...sent, status: "partially_paid" }, today)).toBeNull();
  });
  it("blocks drafts even if their due date has passed", () => {
    expect(dunningBlockReason({ ...sent, status: "draft" }, today)).toBe("invoices_workspace_dunning_not_sent");
  });
  it.each(["paid", "cancelled"])("blocks %s invoices with inconsistent positive balances", status => {
    expect(dunningBlockReason({ ...sent, status }, today)).toBe("invoices_workspace_dunning_ineligible");
  });
  it.each(["0.00", -12, "-0.01"])("blocks a settled balance %s", balance_due => {
    expect(dunningBlockReason({ ...sent, balance_due }, today)).toBe("invoices_workspace_dunning_ineligible");
  });
  it("requires a due date", () => {
    expect(dunningBlockReason({ ...sent, due_date: null }, today)).toBe("invoices_workspace_dunning_missing_due_date");
  });
  it.each([today, "2026-09-08"])("does not treat %s as overdue today", due_date => {
    expect(dunningBlockReason({ ...sent, due_date }, today)).toBe("invoices_workspace_dunning_not_overdue");
  });
  it("fails closed for missing or invalid data", () => {
    expect(dunningBlockReason(null, today)).toBe("invoices_workspace_dunning_unavailable");
    expect(dunningBlockReason({ ...sent, balance_due: "invalid" }, today)).toBe("invoices_workspace_dunning_unavailable");
  });
  it("maps server rejections without exposing raw English or implementation details", () => {
    expect(dunningErrorKey(new Error("Invoice must be sent before dunning starts"))).toBe("invoices_workspace_dunning_not_sent");
    expect(dunningErrorKey(new Error("Second reminder already exists for this invoice"))).toBe("invoices_workspace_dunning_changed");
    expect(dunningErrorKey(new Error("SQL database error"))).toBe("invoices_workspace_dunning_save_error");
  });
});
