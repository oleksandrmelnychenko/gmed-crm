import { describe, expect, it } from "vitest";

import {
  amendmentDecisionActions,
  amendmentVatLabel,
  formatAmendmentDelta,
  localizedAmendmentError,
  parseAmendmentDelta,
} from "./order-amendments-panel";

const tx = (...texts: [ru: string, de: string]) => texts[0];
const txDe = (...texts: [ru: string, de: string]) => texts[1];

describe("amendmentDecisionActions", () => {
  it("lets another manager approve or reject a pending amendment", () => {
    expect(
      amendmentDecisionActions({
        status: "pending",
        requestedBy: "pm-1",
        currentUserId: "billing-1",
        canManage: true,
      }),
    ).toEqual({ ownRequest: false, canApprove: true, canReject: true, canBill: false });
  });

  it("offers the requester only to withdraw, since the server refuses self-approval", () => {
    expect(
      amendmentDecisionActions({
        status: "pending",
        requestedBy: "pm-1",
        currentUserId: "pm-1",
        canManage: true,
      }),
    ).toEqual({ ownRequest: true, canApprove: false, canReject: true, canBill: false });
  });

  it("offers no decision for decided amendments or read-only roles", () => {
    expect(
      amendmentDecisionActions({
        status: "approved",
        requestedBy: "pm-1",
        currentUserId: "ceo-1",
        canManage: true,
      }),
    ).toMatchObject({ canApprove: false, canReject: false, canBill: false });
    expect(
      amendmentDecisionActions({
        status: "pending",
        requestedBy: "pm-1",
        currentUserId: "assistant-1",
        canManage: false,
      }),
    ).toMatchObject({ canApprove: false, canReject: false });
  });

  it("offers billing only for an approved amendment that has no service line yet", () => {
    expect(
      amendmentDecisionActions({
        status: "approved",
        requestedBy: "pm-1",
        currentUserId: "pm-1",
        canManage: true,
        billable: true,
      }).canBill,
    ).toBe(true);
    expect(
      amendmentDecisionActions({
        status: "approved",
        requestedBy: "pm-1",
        currentUserId: "pm-1",
        canManage: false,
        billable: true,
      }).canBill,
    ).toBe(false);
  });
});

describe("formatAmendmentDelta", () => {
  it("formats the delta as money and keeps the plus sign", () => {
    expect(formatAmendmentDelta("150", "EUR")).toBe("+150,00 €");
    expect(formatAmendmentDelta("-50.5", "EUR")).toBe("-50,50 €");
  });
});

describe("parseAmendmentDelta", () => {
  it("accepts a positive amount with up to two decimals, comma or dot", () => {
    expect(parseAmendmentDelta("150")).toBe("150");
    expect(parseAmendmentDelta(" 150,5 ")).toBe("150.5");
    expect(parseAmendmentDelta("0.01")).toBe("0.01");
  });

  it("rejects reductions, zero, too many decimals and garbage", () => {
    expect(parseAmendmentDelta("-50")).toBeNull();
    expect(parseAmendmentDelta("0")).toBeNull();
    expect(parseAmendmentDelta("10.005")).toBeNull();
    expect(parseAmendmentDelta("abc")).toBeNull();
    expect(parseAmendmentDelta("")).toBeNull();
  });
});

describe("amendmentVatLabel", () => {
  it("names how the amount is taxed in both staff languages", () => {
    expect(amendmentVatLabel("standard_vat", tx, "19")).toBe("Услуга агентства · НДС 19 %");
    expect(amendmentVatLabel("standard_vat", txDe, "7")).toBe("Agenturleistung · 7 % USt.");
    expect(amendmentVatLabel("termin_fee_0", tx)).toBe("Организация лечения · НДС 0 %");
    expect(amendmentVatLabel("cost_passthrough", txDe)).toBe("Durchlaufende Kosten · ohne USt.");
    expect(amendmentVatLabel(null, tx)).toBe("НДС не указан");
  });
});

describe("localizedAmendmentError", () => {
  it("translates the server's decision errors and passes unknown texts through", () => {
    expect(
      localizedAmendmentError("An amendment must be approved by someone other than its requester", tx),
    ).toBe("Изменение должен одобрить другой сотрудник, не автор предложения.");
    expect(
      localizedAmendmentError("vat_treatment is required (how the amended amount is taxed)", tx),
    ).toBe("Выберите, как облагается НДС эта сумма.");
    expect(localizedAmendmentError("Something else", tx)).toBe("Something else");
  });
});
