import { describe, expect, it } from "vitest";

import { normalizePatientOrderRecheck } from "./order-api";

describe("normalizePatientOrderRecheck", () => {
  it("defaults partial re-check payloads to render-safe arrays and objects", () => {
    const value = normalizePatientOrderRecheck({
      requires_recheck: true,
      can_create_order: false,
      blocking_reasons: null,
      document_alerts: null,
    });

    expect(value.requires_recheck).toBe(true);
    expect(value.can_create_order).toBe(false);
    expect(value.checks).toEqual([]);
    expect(value.base_data_missing_fields).toEqual([]);
    expect(value.blocking_reasons).toEqual([]);
    expect(value.document_alerts).toEqual({
      missing_documents: [],
      missing_count: 0,
      out_of_sync: false,
      stored_document_pack_complete: undefined,
    });
    expect(value.latest_framework_contract).toBeNull();
  });

  it("normalizes nested debt workflow values without trusting API shape", () => {
    const value = normalizePatientOrderRecheck({
      requires_recheck: true,
      debt_management: {
        blocking: true,
        overdue_invoice_count: 2,
        outstanding_balance: "42.50",
        latest_workflow: {
          order_number: "ORD-1",
          blocking: true,
          overdue_invoice_count: 2,
        },
      },
      checks: [{ key: "identity", passed: true }],
    });

    expect(value.debt_management?.blocking).toBe(true);
    expect(value.debt_management?.latest_workflow?.order_number).toBe("ORD-1");
    expect(value.debt_management?.latest_workflow?.outstanding_balance).toBe("0");
    expect(value.checks[0]).toEqual({
      key: "identity",
      label: "",
      passed: true,
      blocking_for: "",
    });
  });
});
