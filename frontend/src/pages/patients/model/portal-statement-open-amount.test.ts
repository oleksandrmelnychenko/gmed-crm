import { describe, expect, it } from "vitest";

import { portalStatementOpenAmount, type PortalAccountStatementItem } from "./portal-shared";

function row(patch: Partial<PortalAccountStatementItem>): PortalAccountStatementItem {
  return {
    id: "row",
    kind: "invoice",
    entry_date: "2026-10-11",
    description: "",
    status: "sent",
    payment_state: "unpaid",
    amounts_visible: true,
    ...patch,
  };
}

describe("portal statement open amount", () => {
  it("shows what an unpaid advance invoice asks for (QA D-50)", () => {
    expect(
      portalStatementOpenAmount(
        row({ kind: "prepayment", amount_due: "1000", prepayment_available: "0" }),
      ),
    ).toEqual({ kind: "due", amount: "1000" });
  });

  it("shows the unused money of a paid advance", () => {
    expect(
      portalStatementOpenAmount(
        row({ kind: "prepayment", amount_due: "0", prepayment_available: "250" }),
      ),
    ).toEqual({ kind: "available", amount: "250" });
  });

  it("shows what an invoice still asks for", () => {
    expect(portalStatementOpenAmount(row({ amount_due: "400" }))).toEqual({
      kind: "due",
      amount: "400",
    });
  });
});
