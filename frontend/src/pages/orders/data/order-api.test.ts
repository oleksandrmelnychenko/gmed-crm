import { describe, expect, it } from "vitest";

import { normalizeOrderGroup, normalizePatientOrderRecheck } from "./order-api";

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

describe("normalizeOrderGroup", () => {
  it("fills a render-safe head + subs from a full payload", () => {
    const group = normalizeOrderGroup({
      head: {
        id: "head-1",
        order_number: "A-1",
        patient_id: "father",
        order_role: "main",
        status: "active",
        total_estimated: "1000",
        currency: "EUR",
        payer_patient_relation_id: "rel-1",
        payer_contact_name: "Vater",
      },
      subs: [
        { id: "sub-1", order_number: "A-2", patient_id: "child", status: "active", total_estimated: "300" },
      ],
      covered_patient_ids: ["father", "child"],
      rollup_total_estimated: "1300",
    });

    expect(group.head.order_role).toBe("main");
    expect(group.head.payer_contact_name).toBe("Vater");
    expect(group.subs).toHaveLength(1);
    expect(group.subs[0].order_number).toBe("A-2");
    expect(group.covered_patient_ids).toEqual(["father", "child"]);
    expect(group.rollup_total_estimated).toBe("1300");
  });

  it("defaults a partial/garbage payload without throwing", () => {
    const group = normalizeOrderGroup({ head: null, subs: null, covered_patient_ids: null, rollup_total_estimated: null });

    expect(group.head.order_role).toBe("standalone");
    expect(group.head.currency).toBe("EUR");
    expect(group.head.total_estimated).toBeNull();
    expect(group.head.payer_contact_name).toBeNull();
    expect(group.subs).toEqual([]);
    expect(group.covered_patient_ids).toEqual([]);
    expect(group.rollup_total_estimated).toBeNull();
  });
});
