import { describe, expect, it } from "vitest";

import {
  orderStatusBlockerReason,
  parseOrderStatusBlocker,
  resolveOrderNextStep,
} from "./order-next-step";

const completionBlocked = {
  status: "completed" as const,
  blocked: true,
  reasons: ["1-week follow-up must be completed or marked not required"],
};

describe("resolveOrderNextStep", () => {
  it("offers no further step for a cancelled or completed order", () => {
    const lifecycle = {
      next_stage: "intake",
      allowed_transitions: [
        {
          phase: "intake",
          blocked: true,
          reasons: [orderStatusBlockerReason("cancelled")],
        },
      ],
      allowed_status_transitions: [],
    };
    expect(resolveOrderNextStep({ status: "cancelled", lifecycle })).toEqual({
      kind: "terminal",
      status: "cancelled",
    });
    expect(resolveOrderNextStep({ status: "completed", lifecycle: null })).toEqual({
      kind: "terminal",
      status: "completed",
    });
  });

  it("shows the next phase with its blockers while one is left", () => {
    expect(
      resolveOrderNextStep({
        status: "active",
        lifecycle: {
          next_stage: "execution",
          allowed_transitions: [
            { phase: "execution", blocked: true, reasons: ["Preparation documents still need to be sent"] },
          ],
          allowed_status_transitions: [completionBlocked],
        },
      }),
    ).toEqual({
      kind: "phase",
      nextPhase: "execution",
      blocked: true,
      reasons: ["Preparation documents still need to be sent"],
    });
  });

  it("switches to completion in the last phase instead of calling the order finished", () => {
    expect(
      resolveOrderNextStep({
        status: "active",
        lifecycle: {
          next_stage: null,
          allowed_transitions: [],
          allowed_status_transitions: [
            { status: "paused", blocked: false, reasons: [] },
            completionBlocked,
          ],
        },
      }),
    ).toEqual({ kind: "completion", blocked: true, reasons: completionBlocked.reasons });
    expect(
      resolveOrderNextStep({
        status: "active",
        lifecycle: {
          next_stage: null,
          allowed_transitions: [],
          allowed_status_transitions: [{ status: "completed", blocked: false, reasons: [] }],
        },
      }),
    ).toEqual({ kind: "completion", blocked: false, reasons: [] });
  });

  it("asks to resume a paused order in the last phase before completion", () => {
    expect(
      resolveOrderNextStep({
        status: "paused",
        lifecycle: {
          next_stage: null,
          allowed_transitions: [],
          allowed_status_transitions: [
            { status: "active", blocked: false, reasons: [] },
            { status: "cancelled", blocked: false, reasons: [] },
          ],
        },
      }),
    ).toEqual({
      kind: "completion",
      blocked: true,
      reasons: ["Order status must be active (currently paused)"],
    });
  });
});

describe("parseOrderStatusBlocker", () => {
  it("reads the status from the server's status blockers", () => {
    expect(parseOrderStatusBlocker("Order status must be active (currently paused)")).toBe("paused");
    expect(
      parseOrderStatusBlocker("Order status must be active before changing phase (currently cancelled)"),
    ).toBe("cancelled");
    expect(parseOrderStatusBlocker("Order signatures are still incomplete")).toBeNull();
  });
});
