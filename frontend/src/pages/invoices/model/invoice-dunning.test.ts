import { describe, expect, it } from "vitest";
import {
  automaticDunningNote,
  dunningBlockReason,
  dunningDeadlineHint,
  dunningDeadlineRunning,
  dunningErrorKey,
  isDunningDeadlineError,
} from "./invoice-dunning";

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

describe("next dunning level after the previous deadline (QA D2-06)", () => {
  const reminder = { level: "first", payment_due_date: "2026-10-26" };
  it("waits while the reminder's deadline runs, the last day included", () => {
    expect(dunningDeadlineRunning([reminder], "second", "2026-10-12")).toBe("2026-10-26");
    expect(dunningDeadlineRunning([reminder], "second", "2026-10-26")).toBe("2026-10-26");
    expect(dunningDeadlineRunning([reminder], "second", "2026-10-27")).toBeNull();
    expect(dunningDeadlineRunning([], "first", "2026-10-12")).toBeNull();
    expect(
      dunningDeadlineRunning(
        [reminder, { level: "second", payment_due_date: "2026-11-30" }],
        "collections",
        "2026-11-01",
      ),
    ).toBe("2026-11-30");
  });
  it("says from when, and that only the CEO may send earlier", () => {
    expect(dunningDeadlineHint("2026-10-26", "ru", false)).toContain("с 27.10.2026");
    expect(dunningDeadlineHint("2026-10-26", "ru", true)).toContain("CEO");
    expect(dunningDeadlineHint("2026-10-26", "de", false)).toContain("ab 27.10.2026");
    expect(isDunningDeadlineError({ code: "dunning_previous_deadline_running" })).toBe(true);
    expect(isDunningDeadlineError(new Error("x"))).toBe(false);
  });
  it("words automatic reminders in the UI language (QA D2-12)", () => {
    expect(automaticDunningNote("first", "ru")).toBe("Создано автоматически: срок оплаты истёк.");
    expect(automaticDunningNote("second", "de")).toContain("Automatisch erstellt");
    expect(automaticDunningNote("first", "de")).not.toMatch(/system auto-dunning/i);
  });
});
