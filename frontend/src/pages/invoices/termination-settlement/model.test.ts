import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  canCreateFinalInvoice,
  countDueInFull,
  isValidForceNote,
  settlementActionErrorMessage,
  settlementBalanceClass,
  settlementBalanceLabel,
  settlementBalanceTone,
  settlementLineStatusLabel,
  toAmount,
} from "./model";
import type { TerminationSettlement, TerminationSettlementLine } from "./api";

const figures = {
  accrued_net: "0",
  accrued_gross: "0",
  invoiced_gross: "0",
  paid_gross: "0",
  balance_gross: "0",
  uninvoiced_gross: "0",
};

function line(overrides: Partial<TerminationSettlementLine>): TerminationSettlementLine {
  return {
    source: "order_service",
    order_leistung_id: "l1",
    external_invoice_id: null,
    description: "Service",
    quantity: "1",
    unit_price: "100",
    vat_rate: "19",
    net: "100",
    vat: "19",
    gross: "119",
    status: "delivered",
    due_in_full: false,
    is_cost_passthrough: false,
    ...overrides,
  };
}

describe("termination settlement model", () => {
  it("parses decimal strings", () => {
    expect(toAmount("749.7")).toBe(749.7);
    expect(toAmount("-12,50")).toBe(-12.5);
    expect(toAmount("abc")).toBe(0);
    expect(toAmount(null)).toBe(0);
  });

  it("classifies the balance sign with a half-cent tolerance", () => {
    expect(settlementBalanceTone("749.7")).toBe("owed");
    expect(settlementBalanceTone("-20")).toBe("refund");
    expect(settlementBalanceTone("0.004")).toBe("even");
    expect(settlementBalanceTone("-0.001")).toBe("even");
    expect(settlementBalanceClass("10")).toContain("amber");
    expect(settlementBalanceClass("-10")).toContain("rose");
    expect(settlementBalanceClass("0")).toContain("emerald");
  });

  it("labels the balance in RU and DE", () => {
    expect(settlementBalanceLabel("749.7", "EUR", "ru")).toMatch(/^Пациент должен 749,70\s€$/);
    expect(settlementBalanceLabel("-20", "EUR", "ru")).toMatch(/^Вернуть пациенту 20,00\s€$/);
    expect(settlementBalanceLabel("0", "EUR", "ru")).toMatch(/^Итог: 0,00\s€$/);
    expect(settlementBalanceLabel("749.7", "EUR", "de")).toMatch(/^Patient schuldet 749,70\s€$/);
    expect(settlementBalanceLabel("-20", "EUR", "de")).toMatch(/^Erstattung an Patient 20,00\s€$/);
  });

  it("allows a final invoice only for an open settlement with an uninvoiced amount", () => {
    const base = { status: "open" as const, current: { ...figures, warnings: [] } };
    expect(canCreateFinalInvoice({ ...base, current: { ...base.current, uninvoiced_gross: "50" } })).toBe(true);
    expect(canCreateFinalInvoice(base)).toBe(false);
    expect(canCreateFinalInvoice({ ...base, current: { ...base.current, uninvoiced_gross: "-5" } })).toBe(false);
    expect(
      canCreateFinalInvoice({
        status: "settled",
        current: { ...base.current, uninvoiced_gross: "50" },
      } satisfies Pick<TerminationSettlement, "status" | "current">),
    ).toBe(false);
  });

  it("requires a note of at least three characters for a forced close", () => {
    expect(isValidForceNote("  ab ")).toBe(false);
    expect(isValidForceNote("abc")).toBe(true);
  });

  it("labels lines and counts flat fees due in full", () => {
    expect(settlementLineStatusLabel(line({ status: "cancelled" }), "ru")).toBe("Отменено");
    expect(settlementLineStatusLabel(line({ status: "cancelled" }), "de")).toBe("Storniert");
    expect(settlementLineStatusLabel(line({ due_in_full: true }), "de")).toBe("Pauschale, voll fällig");
    expect(countDueInFull([line({ due_in_full: true }), line({}), line({ due_in_full: true })])).toBe(2);
  });

  it("maps settlement API errors", () => {
    const notBalanced = new ApiRequestError("x", {
      status: 409,
      body: { error: "termination_settlement_not_balanced" },
    });
    expect(settlementActionErrorMessage(notBalanced, "ru", "fallback")).toContain("не сведён");
    const nothing = new ApiRequestError("x", { status: 422, body: { error: "nothing_to_invoice" } });
    expect(settlementActionErrorMessage(nothing, "de", "fallback")).toContain("nicht berechneten");
    const settled = new ApiRequestError("x", { status: 409, body: { error: "conflict" } });
    expect(settlementActionErrorMessage(settled, "ru", "fallback")).toBe("Расчёт уже закрыт.");
    expect(settlementActionErrorMessage(new Error("boom"), "ru", "fallback")).toBe("fallback");
  });
});
