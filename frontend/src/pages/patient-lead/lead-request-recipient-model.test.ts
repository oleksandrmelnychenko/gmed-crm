import { describe, expect, it } from "vitest";

import type { LeadRequestBilling, LeadRequestPayer } from "./lead-request-api";
import {
  draftFromPayer,
  payerChoiceOf,
  payerDraftFromRecipient,
  recipientPayerExtras,
  unansweredPayerDraft,
  withPayerChoice,
} from "./lead-request-model";
import {
  OTHER_PAYER_CHOICES,
  PAYER_PARTIES,
  draftFromRecipient,
  flowOf,
  payerChoices,
  payerFitsFlow,
  payerPartyOf,
  recipientFieldOf,
  recipientKey,
  recipientPatch,
  withOwnParent,
  withRecipientAnswer,
  withRecipientRelationship,
  withRecipientType,
} from "./lead-request-recipient-model";

const billing = (overrides: Partial<LeadRequestBilling> = {}): LeadRequestBilling => ({
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
  account_holder_suggestion: null,
  invoice_recipient: null,
  invoice_recipient_is_payer: null,
  recipient: null,
  ...overrides,
});

const viktor: LeadRequestPayer = {
  payer_kind: "third_party",
  payer_type: "person",
  first_name: "Viktor",
  last_name: "Zahler",
  date_of_birth: "1960-02-03",
  street: null,
  zip: null,
  city: "Wien",
  country: "AT",
  citizenships: ["AT"],
  relationship: null,
  relationship_kind: "friend",
  email: "viktor.zahler@example.com",
  phone: "+43 1 234567",
  messenger: "+43 1 234567",
  organisation_name: null,
  contact_consent_at: "2026-10-11T08:00:00Z",
};

describe("step 3: the invoice recipient first (owner spec 2026-10-11)", () => {
  it("stores the selected parent id and treats the other parent as a separate payer", () => {
    const saved = draftFromRecipient(billing({ invoice_recipient: "self", invoice_recipient_is_payer: true }));
    const father = { ...saved, representative_id: "parent-father", type: "person", first_name: "Viktor", last_name: "Zahler", email: viktor.email ?? "" };
    const parents = [{ id: father.representative_id, slot: "rep1" as const, first_name: "Viktor", last_name: "Zahler", email: viktor.email ?? null, date_of_birth: viktor.date_of_birth ?? null }];
    expect(recipientPatch(saved, { ...saved, representative_id: father.representative_id })).toEqual({ recipient_representative_id: "parent-father" });
    expect(payerFitsFlow(flowOf(father), viktor, father, false, parents)).toBe(true);
    expect(payerFitsFlow(flowOf(father), viktor, { ...father, email: "invoices@example.com" }, false, parents)).toBe(true);
    const mother = { ...viktor, email: "another-parent@example.com" };
    expect(payerFitsFlow(flowOf(father), mother, father, true, parents)).toBe(false);
    expect(payerFitsFlow({ recipient: "self", isPayer: "no" }, mother, father, true, parents)).toBe(true);
    expect(payerFitsFlow({ recipient: "self", isPayer: "no" }, viktor, father, false, parents)).toBe(false);
    expect(withRecipientAnswer(father, "third_party").representative_id).toBe("");
    expect(recipientFieldOf("recipient_representative_id")).toBe("representative_id");
  });
  it("'Ich' of a parent's login names the signed-in parent; a chosen parent stays", () => {
    const saved = draftFromRecipient(billing());
    const own = withOwnParent(withRecipientAnswer(saved, "self"), "parent-own");
    expect(own.representative_id).toBe("parent-own");
    expect(recipientPatch(saved, own)).toMatchObject({ invoice_recipient: "self", recipient_representative_id: "parent-own" });
    expect(withOwnParent({ ...own, representative_id: "parent-other" }, "parent-own").representative_id).toBe("parent-other");
    expect(withOwnParent(withRecipientAnswer(saved, "third_party"), "parent-own").representative_id).toBe("");
    expect(withOwnParent(withRecipientAnswer(saved, "self"), null).representative_id).toBe("");
  });
  it("reads the answers and sends only what changed", () => {
    const saved = draftFromRecipient(billing());
    expect(flowOf(saved)).toEqual({ recipient: "", isPayer: "" });
    const third = withRecipientType(withRecipientAnswer(saved, "third_party"), "person");
    const typed = { ...third, first_name: " Viktor ", last_name: "Zahler", is_payer: "no" };
    expect(recipientPatch(saved, typed)).toEqual({
      invoice_recipient: "third_party",
      invoice_recipient_is_payer: false,
      recipient_type: "person",
      recipient_first_name: "Viktor",
      recipient_last_name: "Zahler",
    });
    // A refused value is not sent again until it changes.
    expect(recipientPatch(saved, typed, { first_name: "Viktor" })).not.toHaveProperty("recipient_first_name");
    expect(recipientKey("is_payer")).toBe("invoice_recipient_is_payer");
    expect(recipientFieldOf("recipient_country")).toBe("country");
    expect(recipientFieldOf("invoice_recipient")).toBe("recipient");
    expect(recipientFieldOf("payer_country")).toBeNull();
  });

  it("ticks 'the recipient is also the payer' as soon as a recipient is chosen (owner 2026-10-11)", () => {
    const saved = draftFromRecipient(billing());
    const own = withRecipientAnswer(saved, "self");
    expect(own.is_payer).toBe("yes");
    expect(recipientPatch(saved, own)).toEqual({ invoice_recipient: "self", invoice_recipient_is_payer: true });
    // An answer given before stays with another recipient; no recipient, no answer.
    const unticked = { ...own, is_payer: "no" };
    expect(withRecipientAnswer(unticked, "third_party").is_payer).toBe("no");
    expect(withRecipientAnswer(unticked, "").is_payer).toBe("");
    // Who pays instead: the patient side or another person or organisation.
    expect(payerPartyOf(null, false)).toBe("");
    expect(payerPartyOf({ ...viktor, payer_kind: "self" }, false)).toBe("patient");
    expect(payerPartyOf(viktor, false)).toBe("other");
    expect(payerPartyOf(viktor, true)).toBe("patient");
    expect(PAYER_PARTIES).toEqual(["patient", "other"]);
    expect(OTHER_PAYER_CHOICES).toEqual(["person", "organisation"]);
  });

  it("drops what belongs to another answer", () => {
    const organisation = {
      ...withRecipientType(withRecipientAnswer(draftFromRecipient(billing()), "third_party"), "organisation"),
      organisation_name: "Beispiel GmbH",
      legal_form: "GmbH",
      payment_reason: "Arbeitgeber",
      email: "rechnung@example.com",
    };
    const person = withRecipientType(organisation, "person");
    expect(person.organisation_name).toBe("");
    expect(person.payment_reason).toBe("");
    // The patient side as recipient: nothing of the third party stays.
    const own = withRecipientAnswer(organisation, "self");
    expect(own).toMatchObject({ recipient: "self", type: "", organisation_name: "", email: "" });
    expect(withRecipientRelationship({ ...person, relationship: "Onkel" }, "friend").relationship).toBe("");
  });

  it("offers the patient himself only where it makes sense", () => {
    const adult = { access_kind: "self" as const, minor: false, payer: null };
    expect(payerChoices({ recipient: "self", isPayer: "no" }, adult, null)).toEqual(["person", "organisation"]);
    expect(payerChoices({ recipient: "third_party", isPayer: "no" }, adult, null)).toEqual(["self", "person", "organisation"]);
    const parent = { access_kind: "guardian" as const, minor: true, payer: null };
    const template = { first_name: "Anna", last_name: "Muster", date_of_birth: null, email: null, phone: null };
    expect(payerChoices({ recipient: "third_party", isPayer: "no" }, parent, template)).toEqual([
      "guardian",
      "person",
      "organisation",
    ]);
    // Insurance is no answer of the cabinet.
    expect(payerChoices({ recipient: "self", isPayer: "no" }, parent, template)).not.toContain("insurance");
  });

  it("shows a stored payer only where it answers the flow", () => {
    const own: LeadRequestPayer = { ...viktor, payer_kind: "self" };
    const recipient = draftFromRecipient(billing());
    expect(payerFitsFlow({ recipient: "self", isPayer: "yes" }, own, recipient, false)).toBe(true);
    expect(payerFitsFlow({ recipient: "self", isPayer: "no" }, own, recipient, false)).toBe(false);
    expect(payerFitsFlow({ recipient: "self", isPayer: "no" }, viktor, recipient, false)).toBe(true);
    expect(payerFitsFlow({ recipient: "third_party", isPayer: "yes" }, viktor, recipient, false)).toBe(false);
    // The recipient who does not pay is not the payer named.
    const named = { ...recipient, recipient: "third_party", type: "person", first_name: "viktor", last_name: "zahler" };
    expect(payerFitsFlow({ recipient: "third_party", isPayer: "no" }, viktor, named, false)).toBe(false);
    expect(payerFitsFlow({ recipient: "third_party", isPayer: "yes" }, viktor, named, false)).toBe(true);
    expect(payerFitsFlow({ recipient: "third_party", isPayer: "yes" }, viktor, { ...named, first_name: "Another" }, false)).toBe(false);
    expect(payerFitsFlow({ recipient: "third_party", isPayer: "yes" }, viktor, { ...named, type: "organisation", organisation_name: "Viktor Zahler" }, false)).toBe(false);
    expect(payerFitsFlow({ recipient: "self", isPayer: "no" }, viktor, named, true)).toBe(false);
    expect(payerFitsFlow({ recipient: "third_party", isPayer: "no" }, own, named, false)).toBe(true);
    expect(payerFitsFlow({ recipient: "", isPayer: "" }, viktor, recipient, false)).toBe(false);
    // Unanswered: the own economic interest stays, nobody is named.
    expect(unansweredPayerDraft({ ...viktor, acts_on_own_account: false, beneficial_owner: "Mia Muster" })).toMatchObject({
      payer_kind: "",
      first_name: "",
      acts_on_own_account: "no",
      beneficial_owner: "Mia Muster",
    });
  });

  it("answers who pays with one choice: the patient, the parent, a person or an organisation", () => {
    const empty = draftFromPayer(null);
    expect(payerChoiceOf(empty)).toBe("");
    const organisation = withPayerChoice(empty, "organisation");
    expect(organisation).toMatchObject({ payer_kind: "third_party", payer_type: "organisation" });
    expect(payerChoiceOf(organisation)).toBe("organisation");
    // A company stored before is an organisation and keeps its type.
    const company = draftFromPayer({ ...viktor, payer_type: "company", organisation_name: "Beispiel GmbH", first_name: null });
    expect(payerChoiceOf(company)).toBe("organisation");
    expect(withPayerChoice(company, "organisation")).toBe(company);
    expect(payerChoiceOf(withPayerChoice(company, "person"))).toBe("person");
    expect(withPayerChoice(organisation, "self").payer_kind).toBe("self");
    const template = { first_name: "Anna", last_name: "Muster", date_of_birth: null, email: "anna@example.com", phone: null };
    const parent = withPayerChoice(empty, "guardian", template);
    expect(parent).toMatchObject({ payer_kind: "third_party", guardian_pays: true, first_name: "Anna", relationship_kind: "parent" });
    expect(payerChoiceOf(parent)).toBe("guardian");
  });

  it("builds the payer from the recipient who pays", () => {
    const recipient = {
      ...draftFromRecipient(billing()),
      recipient: "third_party",
      is_payer: "yes",
      type: "person",
      first_name: "Viktor",
      last_name: "Zahler",
      relationship_kind: "friend",
      street: "Ring 1",
      zip: "1010",
      city: "Wien",
      country: "AT",
      email: "viktor.zahler@example.com",
      phone: "+43 1 234567",
    };
    const extras = recipientPayerExtras(viktor);
    expect(extras).toEqual({
      date_of_birth: "1960-02-03",
      citizenships: ["AT"],
      messenger: "+43 1 234567",
      register_number: "",
      contact_consent: true,
    });
    const base = draftFromPayer(null);
    expect(payerDraftFromRecipient(base, recipient, extras)).toMatchObject({
      payer_kind: "third_party",
      payer_type: "person",
      first_name: "Viktor",
      last_name: "Zahler",
      date_of_birth: "1960-02-03",
      citizenships: ["AT"],
      relationship_kind: "friend",
      street: "Ring 1",
      city: "Wien",
      country: "AT",
      contact_consent: true,
    });
    const organisation = payerDraftFromRecipient(
      base,
      { ...recipient, type: "organisation", organisation_name: "Beispiel GmbH", legal_form: "GmbH", contact_name: "Ben Muster" },
      { ...extras, register_number: "HRB 1" },
    );
    expect(organisation).toMatchObject({
      payer_type: "organisation",
      organisation_name: "Beispiel GmbH",
      organisation_legal_form: "GmbH",
      organisation_register_number: "HRB 1",
      organisation_contact_name: "Ben Muster",
      first_name: "",
      citizenships: [],
      relationship_kind: "",
    });
  });
});
