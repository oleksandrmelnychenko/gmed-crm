import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  EMPTY_PAYER_DECLARATION_FORM,
  normalizePayerDeclarationResponse,
  payerAmlCountries,
  payerDeclarationPayload,
  payerDeclarationToForm,
  payerFormMissing,
  payerGateErrorText,
  payerReadinessReasonLabels,
  payerSignatureSequence,
  type PayerDeclaration,
  type PayerDeclarationStatus,
} from "./lead-payer";

const tx = (ru: string) => ru;

const thirdParty: PayerDeclaration = {
  payer_kind: "third_party",
  acts_on_own_account: true,
  beneficial_owner_name: null,
  beneficial_owner_note: null,
  source_of_funds: "savings",
  source_of_funds_description: null,
  source_of_funds_document_id: null,
  first_name: "Erika",
  last_name: "Muster",
  date_of_birth: "1970-05-01",
  place_of_birth: null,
  street: "Hauptstr. 1",
  zip: "10115",
  city: "Berlin",
  country: "DE",
  citizenships: ["de", "IR"],
  relationship: "Tochter",
  email: "erika@example.org",
  phone: null,
  payer_informed_at: "2026-10-03T10:00:00Z",
  payer_informed_by: "00000000-0000-0000-0000-000000000001",
};

const status = (patch: Partial<PayerDeclarationStatus> = {}): PayerDeclarationStatus => ({
  complete: false,
  missing: [],
  cost_assumption: { required: true, document_id: null, current: false, signed: false, signed_at: null },
  order_id: "order-1",
  order_number: "A-1",
  client_signed_order: false,
  agency_signed_order: false,
  agency_may_sign: false,
  agency_blocking: [],
  aml_countries: [],
  ...patch,
});

describe("payer declaration form", () => {
  it("round-trips a third-party payer and normalizes citizenships", () => {
    const form = payerDeclarationToForm(thirdParty);
    expect(form.kind).toBe("third_party");
    expect(form.citizenships).toEqual(["DE", "IR"]);
    expect(form.payerInformed).toBe(true);
    const payload = payerDeclarationPayload(form);
    expect(payload).toMatchObject({
      payer_kind: "third_party",
      first_name: "Erika",
      country: "DE",
      citizenships: ["DE", "IR"],
      payer_informed: true,
      beneficial_owner_name: null,
    });
  });

  it("sends no third-party data for a self-payer", () => {
    const form = { ...payerDeclarationToForm(thirdParty), kind: "self" as const };
    const payload = payerDeclarationPayload(form);
    expect(payload.first_name).toBeNull();
    expect(payload.citizenships).toEqual([]);
    expect(payload.payer_informed).toBe(false);
    expect(payload.source_of_funds).toBe("savings");
  });

  it("lists what is missing, like the server", () => {
    expect(payerFormMissing(EMPTY_PAYER_DECLARATION_FORM)).toEqual(["payer_declaration_missing"]);
    expect(payerFormMissing({ ...EMPTY_PAYER_DECLARATION_FORM, kind: "self" }))
      .toEqual(["payer_source_of_funds_missing"]);
    expect(payerFormMissing({
      ...EMPTY_PAYER_DECLARATION_FORM,
      kind: "self",
      sourceOfFunds: "other",
      actsOnOwnAccount: false,
    })).toEqual(["payer_beneficial_owner_missing", "payer_source_of_funds_missing"]);
    expect(payerFormMissing({ ...payerDeclarationToForm(thirdParty), citizenships: [], payerInformed: false }))
      .toEqual(["payer_identity_incomplete", "payer_not_informed"]);
    expect(payerFormMissing(payerDeclarationToForm(thirdParty))).toEqual([]);
  });
});

describe("payer AML and signing order", () => {
  it("feeds residence and citizenships of a third party into the AML risk", () => {
    expect(payerAmlCountries({ declaration: thirdParty, status: status() })).toEqual(["DE", "IR"]);
    expect(payerAmlCountries({ declaration: { ...thirdParty, payer_kind: "self" }, status: status() })).toEqual([]);
    expect(payerAmlCountries(null)).toEqual([]);
  });

  it("shows client, payer and GMED in signing order", () => {
    expect(payerSignatureSequence(status())).toEqual({ client: "pending", payer: "pending", agency: "pending" });
    expect(payerSignatureSequence(status({
      client_signed_order: true,
      cost_assumption: { required: true, document_id: "d", current: true, signed: true, signed_at: "x" },
      agency_signed_order: true,
    }))).toEqual({ client: "done", payer: "done", agency: "done" });
    expect(payerSignatureSequence(status({
      cost_assumption: { required: false, document_id: null, current: false, signed: false, signed_at: null },
    })).payer).toBe("not_required");
  });

  it("explains the server's agency signature gate", () => {
    const error = new ApiRequestError("GMED signs only after the client and the payer", {
      status: 409,
      code: "payer_gate_blocked",
      body: {
        error: "payer_gate_blocked",
        reasons: ["client_order_signature_missing", "cost_assumption_unsigned"],
      },
    });
    expect(payerGateErrorText(error, tx)).toBe(
      "GMED подписывает только после клиента и плательщика: "
        + "Сначала клиент подписывает заказ; Получите подпись плательщика на согласии",
    );
    expect(payerGateErrorText(new Error("other"), tx)).toBeNull();
  });

  it("accepts only payer declaration responses", () => {
    expect(normalizePayerDeclarationResponse({})).toBeNull();
    expect(normalizePayerDeclarationResponse(null)).toBeNull();
    const normalized = normalizePayerDeclarationResponse({ declaration: null, status: { missing: ["x"] } });
    expect(normalized?.status.cost_assumption.required).toBe(false);
    expect(normalized?.status.agency_blocking).toEqual([]);
    expect(normalized?.status.missing).toEqual(["x"]);
  });

  it("translates every payer readiness reason of the server", () => {
    const labels = payerReadinessReasonLabels(tx);
    expect(labels["Cost assumption declaration is not signed"]).toBe("Получите подпись плательщика на согласии");
    expect(Object.values(labels)).not.toContain("Проверьте данные плательщика");
  });
});
