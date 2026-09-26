import { describe, expect, it } from "vitest";

import {
  amendmentDecisionActions,
  formatAmendmentDelta,
  localizedAmendmentError,
} from "./order-amendments-panel";

const tx = (...texts: [ru: string, de: string]) => texts[0];

describe("amendmentDecisionActions", () => {
  it("lets another manager approve or reject a pending amendment", () => {
    expect(
      amendmentDecisionActions({
        status: "pending",
        requestedBy: "pm-1",
        currentUserId: "billing-1",
        canManage: true,
      }),
    ).toEqual({ ownRequest: false, canApprove: true, canReject: true });
  });

  it("offers the requester only to withdraw, since the server refuses self-approval", () => {
    expect(
      amendmentDecisionActions({
        status: "pending",
        requestedBy: "pm-1",
        currentUserId: "pm-1",
        canManage: true,
      }),
    ).toEqual({ ownRequest: true, canApprove: false, canReject: true });
  });

  it("offers no decision for decided amendments or read-only roles", () => {
    expect(
      amendmentDecisionActions({
        status: "approved",
        requestedBy: "pm-1",
        currentUserId: "ceo-1",
        canManage: true,
      }),
    ).toMatchObject({ canApprove: false, canReject: false });
    expect(
      amendmentDecisionActions({
        status: "pending",
        requestedBy: "pm-1",
        currentUserId: "assistant-1",
        canManage: false,
      }),
    ).toMatchObject({ canApprove: false, canReject: false });
  });
});

describe("formatAmendmentDelta", () => {
  it("formats the delta as money and keeps the plus sign", () => {
    expect(formatAmendmentDelta("150", "EUR")).toBe("+150,00 €");
    expect(formatAmendmentDelta("-50.5", "EUR")).toBe("-50,50 €");
  });
});

describe("localizedAmendmentError", () => {
  it("translates the server's decision errors and passes unknown texts through", () => {
    expect(
      localizedAmendmentError("An amendment must be approved by someone other than its requester", tx),
    ).toBe("Изменение должен одобрить другой сотрудник, не автор предложения.");
    expect(localizedAmendmentError("Something else", tx)).toBe("Something else");
  });
});
