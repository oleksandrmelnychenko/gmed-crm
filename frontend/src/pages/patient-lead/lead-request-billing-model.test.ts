import { describe, expect, it } from "vitest";

import type { LeadRequestBilling } from "./lead-request-api";
import {
  BILLING_FIELDS,
  BILLING_SUBMIT_FIELDS,
  INVOICE_FIELDS,
  PAYMENT_ROUTE_FIELDS,
  asksBillingField,
  billingPatch,
  changedOnServer,
  draftFromBilling,
  invoiceTargets,
  requiresBillingField,
  stillRejectedBilling,
  withInvoiceTo,
  withPaymentMethod,
  withRejectedBilling,
  withViaThirdParty,
  type BillingContext,
  type BillingField,
} from "./lead-request-billing-model";

/** Nothing answered yet: an adult who pays himself. */
function billing(overrides: Partial<LeadRequestBilling> = {}): LeadRequestBilling {
  return {
    invoice_to: null,
    invoice_name: null,
    invoice_street: null,
    invoice_zip: null,
    invoice_city: null,
    invoice_country: null,
    invoice_email: null,
    payer_declared: false,
    payment_route_by: "patient",
    payment_method: null,
    payment_method_details: null,
    account_country: null,
    account_holder: null,
    bank_name: null,
    via_third_party: null,
    via_third_party_details: null,
    account_holder_suggestion: "Anna Muster",
    ...overrides,
  };
}

const patient: BillingContext = { routeBy: "patient", payerDeclared: false };
const guardianPays: BillingContext = { routeBy: "guardian", payerDeclared: true };
const payerAnswers: BillingContext = { routeBy: "payer", payerDeclared: true };

const asked = (draft: ReturnType<typeof draftFromBilling>, context: BillingContext) =>
  BILLING_FIELDS.filter((field) => asksBillingField(field, draft, context));
const required = (draft: ReturnType<typeof draftFromBilling>, context: BillingContext) =>
  BILLING_FIELDS.filter((field) => requiresBillingField(field, draft, context));

describe("lead request billing: what is asked", () => {
  it("splits the fields into the two sections in form order", () => {
    expect(INVOICE_FIELDS).toEqual([
      "invoice_to",
      "invoice_name",
      "invoice_street",
      "invoice_zip",
      "invoice_city",
      "invoice_country",
      "invoice_email",
    ]);
    expect(PAYMENT_ROUTE_FIELDS).toEqual([
      "payment_method",
      "payment_method_details",
      "account_country",
      "account_holder",
      "bank_name",
      "via_third_party",
      "via_third_party_details",
    ]);
    // The e-mail for invoices is never missing: it is not a key of the missing list.
    expect(BILLING_SUBMIT_FIELDS).toEqual(BILLING_FIELDS.filter((field) => field !== "invoice_email"));
  });

  it("offers 'to the payer' only with a declared third party", () => {
    expect(invoiceTargets({ payerDeclared: false })).toEqual(["self", "other"]);
    expect(invoiceTargets({ payerDeclared: true })).toEqual(["self", "payer", "other"]);
  });

  it("asks the address with 'another address' and the e-mail with anything but 'to the payer'", () => {
    const empty = draftFromBilling(billing());
    expect(asked(empty, patient)).toEqual(["invoice_to", "payment_method", "via_third_party"]);
    expect(asked({ ...empty, invoice_to: "self" }, patient)).toContain("invoice_email");
    expect(asked({ ...empty, invoice_to: "self" }, patient)).not.toContain("invoice_name");
    expect(asked({ ...empty, invoice_to: "other" }, patient).slice(0, 7)).toEqual(INVOICE_FIELDS);
    expect(asked({ ...empty, invoice_to: "payer" }, payerAnswers)).toEqual(["invoice_to"]);
    // The e-mail is optional: it is never required, whatever the answer.
    expect(required({ ...empty, invoice_to: "other" }, patient)).not.toContain("invoice_email");
    expect(required({ ...empty, invoice_to: "other" }, patient)).toEqual([
      "invoice_to",
      "invoice_name",
      "invoice_street",
      "invoice_zip",
      "invoice_city",
      "invoice_country",
      "payment_method",
      "via_third_party",
    ]);
  });

  it("asks section 8 of the patient and the paying parent, never of the payer", () => {
    const empty = draftFromBilling(billing());
    expect(asked(empty, guardianPays)).toEqual(["invoice_to", "payment_method", "via_third_party"]);
    expect(asked(empty, payerAnswers)).toEqual(["invoice_to"]);
    expect(required(empty, payerAnswers)).toEqual(["invoice_to"]);
  });

  it("asks the account with a bank transfer or a card, the details with 'other' and a 'yes'", () => {
    const empty = draftFromBilling(billing());
    const section8 = (draft: typeof empty) => asked(draft, patient).filter((field) => PAYMENT_ROUTE_FIELDS.includes(field));
    expect(section8({ ...empty, payment_method: "bank_transfer" })).toEqual([
      "payment_method",
      "account_country",
      "account_holder",
      "bank_name",
      "via_third_party",
    ]);
    expect(section8({ ...empty, payment_method: "card" })).toEqual(section8({ ...empty, payment_method: "bank_transfer" }));
    expect(section8({ ...empty, payment_method: "cash" })).toEqual(["payment_method", "via_third_party"]);
    expect(section8({ ...empty, payment_method: "crypto" })).toEqual(["payment_method", "via_third_party"]);
    expect(section8({ ...empty, payment_method: "other" })).toEqual(["payment_method", "payment_method_details", "via_third_party"]);
    expect(section8({ ...empty, via_third_party: "yes" })).toEqual(["payment_method", "via_third_party", "via_third_party_details"]);
    expect(section8({ ...empty, via_third_party: "no" })).toEqual(["payment_method", "via_third_party"]);
    // The bank is required for a transfer, optional for a card.
    expect(required({ ...empty, payment_method: "bank_transfer" }, patient)).toContain("bank_name");
    expect(required({ ...empty, payment_method: "card" }, patient)).not.toContain("bank_name");
    expect(required({ ...empty, payment_method: "card" }, patient)).toContain("account_holder");
  });
});

describe("lead request billing: the draft after an answer", () => {
  it("reads the stored answers", () => {
    const stored = draftFromBilling(
      billing({
        invoice_to: "other",
        invoice_name: "Beispiel GmbH",
        invoice_country: "DE",
        payment_method: "bank_transfer",
        account_holder: "Anna Muster",
        via_third_party: false,
      }),
    );
    expect(stored).toMatchObject({
      invoice_to: "other",
      invoice_name: "Beispiel GmbH",
      invoice_street: "",
      invoice_country: "DE",
      payment_method: "bank_transfer",
      account_holder: "Anna Muster",
      via_third_party: "no",
      via_third_party_details: "",
    });
    expect(draftFromBilling(billing({ via_third_party: true })).via_third_party).toBe("yes");
    expect(draftFromBilling(billing()).via_third_party).toBe("");
    expect(draftFromBilling(undefined)).toEqual(draftFromBilling(billing()));
  });

  it("drops the address with anything but 'another address', and the e-mail with 'to the payer'", () => {
    const other = {
      ...draftFromBilling(billing()),
      invoice_to: "other",
      invoice_name: "Beispiel GmbH",
      invoice_street: "Musterstraße 1",
      invoice_zip: "10115",
      invoice_city: "Berlin",
      invoice_country: "DE",
      invoice_email: "rechnung@example.com",
    };
    expect(withInvoiceTo(other, "self")).toMatchObject({
      invoice_to: "self",
      invoice_name: "",
      invoice_street: "",
      invoice_zip: "",
      invoice_city: "",
      invoice_country: "",
      invoice_email: "rechnung@example.com",
    });
    expect(withInvoiceTo(other, "payer")).toMatchObject({ invoice_to: "payer", invoice_name: "", invoice_email: "" });
    expect(withInvoiceTo(other, "other")).toEqual(other);
  });

  it("drops what belongs to another method, and offers the name of the person who pays as account holder once", () => {
    const empty = draftFromBilling(billing());
    const transfer = withPaymentMethod(empty, "bank_transfer", "Anna Muster");
    expect(transfer).toMatchObject({ payment_method: "bank_transfer", account_holder: "Anna Muster" });
    // The holder typed stays; the suggestion fills an empty field only.
    expect(withPaymentMethod({ ...empty, account_holder: "Ben Muster" }, "card", "Anna Muster").account_holder).toBe("Ben Muster");
    expect(withPaymentMethod(empty, "card", null).account_holder).toBe("");
    expect(withPaymentMethod(empty, "cash", "Anna Muster").account_holder).toBe("");
    // Cash has no account; "other" has its details, and nothing else.
    const filled = { ...transfer, account_country: "DE", bank_name: "Musterbank", payment_method_details: "stale" };
    expect(withPaymentMethod(filled, "cash")).toMatchObject({
      payment_method: "cash",
      account_country: "",
      account_holder: "",
      bank_name: "",
      payment_method_details: "",
    });
    expect(withPaymentMethod(filled, "other")).toMatchObject({ payment_method: "other", account_holder: "", payment_method_details: "stale" });
    expect(withPaymentMethod(filled, "card")).toMatchObject({ payment_method: "card", account_holder: "Anna Muster", bank_name: "Musterbank" });
  });

  it("keeps the details of a third party for a 'yes' only", () => {
    const yes = { ...draftFromBilling(billing()), via_third_party: "yes", via_third_party_details: "Mein Bruder zahlt über PayPal." };
    expect(withViaThirdParty(yes, "no")).toMatchObject({ via_third_party: "no", via_third_party_details: "" });
    expect(withViaThirdParty(yes, "")).toMatchObject({ via_third_party: "", via_third_party_details: "" });
    expect(withViaThirdParty(yes, "yes")).toEqual(yes);
  });
});

describe("lead request billing autosave patch", () => {
  it("sends only the changed keys, trimmed, and clears with an empty string", () => {
    const saved = draftFromBilling(billing({ invoice_to: "self", invoice_email: "anna@example.com", payment_method: "cash" }));
    const draft = {
      ...saved,
      invoice_email: "  anna.muster@example.com ",
      payment_method: "bank_transfer",
      account_holder: " Anna  Muster ",
      via_third_party: "no",
      via_third_party_details: "",
    };
    expect(billingPatch(saved, draft, "patient")).toEqual({
      invoice_email: "anna.muster@example.com",
      payment_method: "bank_transfer",
      account_holder: "Anna Muster",
      via_third_party: false,
    });
    expect(billingPatch(saved, { ...saved, invoice_email: "", payment_method: "" }, "patient")).toEqual({
      invoice_email: "",
      payment_method: "",
    });
    expect(billingPatch(saved, saved, "patient")).toEqual({});
  });

  it("sends the yes/no answer as a boolean, taken back as null", () => {
    const saved = draftFromBilling(billing({ via_third_party: true, via_third_party_details: "PayPal" }));
    expect(billingPatch(saved, withViaThirdParty(saved, ""), "patient")).toEqual({ via_third_party: null, via_third_party_details: "" });
    expect(billingPatch(saved, { ...saved, via_third_party_details: " Mein Bruder,\nPayPal " }, "patient")).toEqual({
      via_third_party_details: "Mein Bruder,\nPayPal",
    });
  });

  it("never sends section 8 while the payer answers it", () => {
    const saved = draftFromBilling(billing({ payment_route_by: "payer", payer_declared: true }));
    const draft = { ...saved, invoice_to: "payer", payment_method: "cash", via_third_party: "no" };
    expect(billingPatch(saved, draft, "payer")).toEqual({ invoice_to: "payer" });
    expect(billingPatch(saved, draft, "guardian")).toEqual({ invoice_to: "payer", payment_method: "cash", via_third_party: false });
  });

  it("does not repeat a refused value until it is changed", () => {
    const saved = draftFromBilling(billing({ invoice_to: "self" }));
    const draft = { ...saved, invoice_email: "not-an-address", account_holder: "Anna Muster" };
    const rejected = withRejectedBilling({}, "invoice_email", draft);
    expect(rejected).toEqual({ invoice_email: "not-an-address" });
    expect(billingPatch(saved, draft, "patient", rejected ?? {})).toEqual({ account_holder: "Anna Muster" });
    // Changed: the refusal is over, and the new value goes.
    const corrected = { ...draft, invoice_email: "anna.muster@example.com" };
    expect(stillRejectedBilling(rejected ?? {}, corrected)).toEqual({});
    expect(billingPatch(saved, corrected, "patient", stillRejectedBilling(rejected ?? {}, corrected))).toEqual({
      invoice_email: "anna.muster@example.com",
      account_holder: "Anna Muster",
    });
    expect(withRejectedBilling({}, "payer_declared", draft)).toBeNull();
  });

  it("names the fields another save changed on the server", () => {
    const saved = draftFromBilling(
      billing({ invoice_to: "payer", payer_declared: true, payment_method: "bank_transfer", account_holder: "Viktor Zahler" }),
    );
    // "Who pays" became "I pay myself": "to the payer" is taken back and section 8 is cleared.
    const incoming = draftFromBilling(billing({ invoice_to: null, payer_declared: false }));
    expect(changedOnServer(saved, incoming)).toEqual(["invoice_to", "payment_method", "account_holder"]);
    expect(changedOnServer(saved, saved)).toEqual([]);
  });

  it("knows every field of both sections", () => {
    const all: BillingField[] = [...INVOICE_FIELDS, ...PAYMENT_ROUTE_FIELDS];
    expect(all).toEqual(BILLING_FIELDS);
  });
});
