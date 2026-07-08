import { describe, expect, it } from "vitest";

import {
  normalizeOrderAmendment,
  orderGroupCandidates,
  normalizeOrderGroup,
  normalizePatientOrderRecheck,
} from "./order-api";

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
      status: "unknown",
      expiry: null,
      days_until_expiry: null,
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

describe("normalizePatientOrderRecheck passport (#6)", () => {
  it("carries passport status + expiry through the payload and the check", () => {
    const value = normalizePatientOrderRecheck({
      requires_recheck: true,
      can_create_order: true,
      passport_status: "expiring",
      passport_expiring: true,
      passport_expired: false,
      passport_expiry: "2026-08-01",
      passport_days_until_expiry: 23,
      checks: [
        {
          key: "passport_valid",
          label: "Passport not expired",
          passed: true,
          blocking_for: "none",
          status: "expiring",
          expiry: "2026-08-01",
          days_until_expiry: 23,
        },
      ],
    });

    expect(value.passport_status).toBe("expiring");
    expect(value.passport_expiring).toBe(true);
    expect(value.passport_expiry).toBe("2026-08-01");
    expect(value.passport_days_until_expiry).toBe(23);
    const check = value.checks.find((entry) => entry.key === "passport_valid");
    expect(check?.status).toBe("expiring");
    expect(check?.expiry).toBe("2026-08-01");
    expect(check?.days_until_expiry).toBe(23);
    expect(check?.blocking_for).toBe("none");
  });

  it("defaults an unknown/absent passport safely", () => {
    const value = normalizePatientOrderRecheck({ requires_recheck: false, checks: [] });

    expect(value.passport_status).toBe("unknown");
    expect(value.passport_expiring).toBe(false);
    expect(value.passport_expired).toBe(false);
    expect(value.passport_expiry).toBeNull();
    expect(value.passport_days_until_expiry).toBeNull();
  });
});

describe("normalizeOrderAmendment (#10)", () => {
  it("fills a render-safe amendment from a full payload", () => {
    const amendment = normalizeOrderAmendment({
      id: "amd-1",
      order_id: "ord-1",
      delta_amount: "150",
      currency: "EUR",
      agreed_note: "3 extra hours agreed",
      status: "pending",
      requested_by: "user-1",
      decided_by: null,
      decided_at: null,
      decision_note: null,
      created_at: "2026-07-09T10:00:00Z",
    });

    expect(amendment.delta_amount).toBe("150");
    expect(amendment.status).toBe("pending");
    expect(amendment.decided_by).toBeNull();
    expect(amendment.agreed_note).toBe("3 extra hours agreed");
  });

  it("defaults a garbage payload", () => {
    const amendment = normalizeOrderAmendment(null);

    expect(amendment.delta_amount).toBe("0");
    expect(amendment.currency).toBe("EUR");
    expect(amendment.status).toBe("pending");
    expect(amendment.decided_at).toBeNull();
  });
});

describe("orderGroupCandidates", () => {
  const order = (id: string) => ({
    id,
    order_number: id,
    patient_id: "p",
    patient_name: "P",
    patient_pid: "PID",
    phase: "discovery",
    status: "active",
    created_at: "2026-07-09",
  });

  it("excludes the head and its current subs, keeps the rest", () => {
    const candidates = orderGroupCandidates(
      [order("head"), order("sub-1"), order("free-1"), order("free-2")],
      "head",
      ["sub-1"],
    );
    expect(candidates.map((o) => o.id)).toEqual(["free-1", "free-2"]);
  });

  it("returns everything when nothing is excluded yet", () => {
    const candidates = orderGroupCandidates([order("a"), order("b")], "head", []);
    expect(candidates.map((o) => o.id)).toEqual(["a", "b"]);
  });
});
