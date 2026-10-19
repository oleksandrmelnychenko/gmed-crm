import { describe, expect, it } from "vitest";

import {
  EMPTY_ORDER_PAYER,
  isPlausiblePayerEmail,
  orderPayerPayload,
  orderPayerToForm,
  organisationAfterTypedName,
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

  it("keeps the role invoice_address (the party at another address) and drops an unknown role", () => {
    const stored = {
      payer_patient_relation_id: null,
      payer_role: "invoice_address",
      payer_contact_name: "Beispiel GmbH",
      payer_contact_relationship: null,
      payer_contact_email: "rechnung@example.com",
      payer_contact_phone: null,
      payer_address_street: "Industriestraße 9",
      payer_notes: null,
    };
    const form = orderPayerToForm(stored);
    expect(form.role).toBe("invoice_address");
    expect(orderPayerPayload({ ...form, notes: "Rechnung per Post" })).toMatchObject({
      payer_role: "invoice_address",
      payer_contact_name: "Beispiel GmbH",
      payer_notes: "Rechnung per Post",
    });
    expect(orderPayerToForm({ ...stored, payer_role: "guarantor" }).role).toBe("");
  });

  it("sends the organisation box of a contact and lets a legal form tick it until staff decide", () => {
    const stored = {
      payer_patient_relation_id: null,
      payer_contact_name: "Polartek Shipping",
      payer_contact_relationship: null,
      payer_contact_email: null,
      payer_contact_phone: null,
      payer_notes: null,
      payer_contact_is_organisation: true,
    };
    const form = orderPayerToForm(stored);
    expect(form.isOrganisation).toBe(true);
    expect(form.organisationTouched).toBe(true);
    expect(orderPayerPayload(form)).toMatchObject({
      payer_contact_name: "Polartek Shipping",
      payer_contact_is_organisation: true,
    });
    // A saved answer stays when the name is corrected.
    expect(organisationAfterTypedName(form, "Polartek Shipping Ltd")).toBe(true);
    expect(
      organisationAfterTypedName({ ...form, isOrganisation: false }, "Beispiel GmbH"),
    ).toBe(false);
    // A new contact: the legal form ticks the box, a person's name does not.
    expect(organisationAfterTypedName(EMPTY_ORDER_PAYER, "Beispiel GmbH")).toBe(true);
    expect(organisationAfterTypedName(EMPTY_ORDER_PAYER, "Viktor Zahler")).toBe(false);
    // A bank without a legal form is an organisation too (QA 2026-10-12).
    expect(organisationAfterTypedName(EMPTY_ORDER_PAYER, "Testgrad Commerce Bank")).toBe(true);
    // Without a contact name no answer is sent.
    expect(
      orderPayerPayload({ ...EMPTY_ORDER_PAYER, patientPid: "P-1", isOrganisation: true }),
    ).toMatchObject({ payer_contact_is_organisation: null });
    expect(orderPayerToForm({ ...stored, payer_contact_name: null }).isOrganisation).toBe(false);
  });

  it("checks e-mail addresses like the server", () => {
    expect(isPlausiblePayerEmail("")).toBe(true);
    expect(isPlausiblePayerEmail("max@example.test")).toBe(true);
    expect(isPlausiblePayerEmail("max@example")).toBe(false);
    expect(isPlausiblePayerEmail("max muster@example.test")).toBe(false);
    expect(isPlausiblePayerEmail("a@b.c")).toBe(false);
    expect(isPlausiblePayerEmail("max@example.d")).toBe(false);
  });
});
