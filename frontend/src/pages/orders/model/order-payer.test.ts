import { describe, expect, it } from "vitest";

import {
  EMPTY_ORDER_PAYER,
  isPlausiblePayerEmail,
  orderPayerPayload,
  orderPayerToForm,
} from "./order-payer";

describe("order payer", () => {
  it("keeps a relation set earlier when the form is saved again", () => {
    const form = orderPayerToForm({
      payer_patient_relation_id: "rel-1",
      payer_role: "contracting_party",
      payer_contact_name: null,
      payer_contact_relationship: null,
      payer_contact_email: null,
      payer_contact_phone: null,
      payer_address_street: "Nebenweg 2",
      payer_notes: null,
    });
    expect(orderPayerPayload({ ...form, phone: "+49 89 1" })).toMatchObject({
      payer_patient_relation_id: "rel-1",
      payer_role: "contracting_party",
      payer_contact_phone: "+49 89 1",
      payer_address_street: "Nebenweg 2",
    });
  });

  it("sends a patient number only without a relation and drops the role without a payer", () => {
    expect(
      orderPayerPayload({ ...EMPTY_ORDER_PAYER, patientPid: " P-1 ", role: "cost_bearer" }),
    ).toMatchObject({ payer_patient_pid: "P-1", payer_role: "cost_bearer" });
    expect(
      orderPayerPayload({ ...EMPTY_ORDER_PAYER, relationId: "rel-2", patientPid: "P-1" }),
    ).toMatchObject({ payer_patient_relation_id: "rel-2", payer_patient_pid: null });
    expect(orderPayerPayload({ ...EMPTY_ORDER_PAYER, role: "cost_bearer" })).toMatchObject({
      payer_role: null,
      payer_contact_name: null,
    });
  });

  it("checks e-mail addresses like the server", () => {
    expect(isPlausiblePayerEmail("")).toBe(true);
    expect(isPlausiblePayerEmail("max@example.test")).toBe(true);
    expect(isPlausiblePayerEmail("max@example")).toBe(false);
    expect(isPlausiblePayerEmail("max muster@example.test")).toBe(false);
  });
});
