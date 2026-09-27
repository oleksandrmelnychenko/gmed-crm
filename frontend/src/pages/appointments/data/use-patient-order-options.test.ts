import { describe, expect, it } from "vitest";

import {
  defaultOrderIdFor,
  reconcileCreateOrderId,
  type PatientOrderOption,
} from "./use-patient-order-options";

function order(id: string, status = "active"): PatientOrderOption {
  return { id, order_number: `A-${id}`, phase: "execution", status };
}

describe("patient order options", () => {
  it("defaults to the only open order", () => {
    expect(defaultOrderIdFor([order("o1"), order("o2", "completed")])).toBe("o1");
    expect(defaultOrderIdFor([order("o1"), order("o2")])).toBe("");
  });

  it("keeps a preselected order while the patient's orders are loading", () => {
    expect(reconcileCreateOrderId("o2", [], false)).toBe("o2");
  });

  it("keeps a preselected order of the patient even with several open orders", () => {
    expect(reconcileCreateOrderId("o2", [order("o1"), order("o2")], true)).toBe(
      "o2",
    );
  });

  it("replaces an order that does not belong to the patient", () => {
    expect(reconcileCreateOrderId("other", [order("o1")], true)).toBe("o1");
    expect(reconcileCreateOrderId("other", [order("o1"), order("o2")], true)).toBe(
      "",
    );
    expect(reconcileCreateOrderId("other", [], true)).toBe("");
  });
});
