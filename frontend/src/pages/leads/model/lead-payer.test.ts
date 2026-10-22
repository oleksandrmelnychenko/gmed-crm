import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  EMPTY_PAYER_DECLARATION_FORM,
  PAYER_RELATIONSHIP_KINDS,
  PAYER_TYPES,
  costEstimateConsentLine,
  declaredPayerType,
  invoiceTaxFieldsShown,
  invoiceTaxLine,
  invoiceToLabel,
  isOrganisationPayerForm,
  leadSelfFundsStated,
  normalizePayerDeclarationResponse,
  patientDeclarationLeadId,
  payerAmlCountries,
  payerDeclarationPayload,
  payerDeclarationPrefillForm,
  payerDeclarationToForm,
  payerFormMissing,
  payerGateErrorText,
  payerReadinessReasonLabels,
  payerReasonLabel,
  payerRelationshipKindLabel,
  payerRelationshipTextShown,
  payerSignatureSequence,
  payerStatusBadge,
  payerTypeLabel,
  STATED_FUNDS_SOURCES,
  statedFundsSourceLabel,
  statedFundsSourcesLabel,
  taxNumberFormatWarning,
  vatIdFormatWarning,
  withPayerDeclarationField,
  type PayerDeclaration,
  type PayerDeclarationStatus,
} from "./lead-payer";

const tx = (ru: string) => ru;
const de = (_ru: string, german: string) => german;

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

/** The same person as a server that stores the payer type answers. */
const typedPerson: PayerDeclaration = {
  ...thirdParty,
  payer_type: "person",
  organisation_name: null,
  relationship_kind: "child",
  relationship: null,
  contact_consent_at: "2026-10-05T09:30:00Z",
};

/** A company: a name and a seat, no personal identity. */
const company: PayerDeclaration = {
  ...thirdParty,
  payer_type: "company",
  organisation_name: "Beispiel GmbH",
  first_name: null,
  last_name: null,
  date_of_birth: null,
  place_of_birth: null,
  citizenships: [],
  relationship_kind: "employer",
  relationship: null,
  email: "office@example.com",
  contact_consent_at: null,
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

  it("shows the own-account question unanswered until someone answered it", () => {
    // The stored default "true" of a third party nobody asked is no answer: nothing ticked, nothing sent.
    const unanswered = payerDeclarationToForm({ ...thirdParty, acts_on_own_account: true, own_account_answered: false });
    expect(unanswered.actsOnOwnAccount).toBeNull();
    expect(payerDeclarationPayload(unanswered)).not.toHaveProperty("acts_on_own_account");
    expect(payerDeclarationPayload(unanswered).beneficial_owner_name).toBeNull();
    expect(payerFormMissing(unanswered)).toEqual([]);
    expect(EMPTY_PAYER_DECLARATION_FORM.actsOnOwnAccount).toBeNull();
    // Answered: the answer is shown and sent; "no" needs the beneficial owner.
    const yes = payerDeclarationToForm({ ...thirdParty, own_account_answered: true });
    expect(yes.actsOnOwnAccount).toBe(true);
    expect(payerDeclarationPayload(yes).acts_on_own_account).toBe(true);
    const no = { ...unanswered, actsOnOwnAccount: false, beneficialOwnerName: " Viktor Zahler " };
    expect(payerDeclarationPayload(no)).toMatchObject({ acts_on_own_account: false, beneficial_owner_name: "Viktor Zahler" });
    expect(payerFormMissing({ ...no, beneficialOwnerName: "" })).toEqual(["payer_beneficial_owner_missing"]);
    // An older server without the flag keeps showing the stored value.
    expect(payerDeclarationToForm(thirdParty).actsOnOwnAccount).toBe(true);
  });

  it("sends no third-party data for a self-payer", () => {
    const form = { ...payerDeclarationToForm(thirdParty), kind: "self" as const };
    const payload = payerDeclarationPayload(form);
    expect(payload.first_name).toBeNull();
    expect(payload.citizenships).toEqual([]);
    expect(payload.payer_informed).toBe(false);
    // One source per person (2026-10-23): staff's own choice is not the patient's funds.
    expect(payload.source_of_funds).toBeNull();
    expect(payload).not.toHaveProperty("self_funds_source");
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

describe("payer type: person, company, organisation or insurer", () => {
  it("reads a third party without a type as a person", () => {
    expect(declaredPayerType(thirdParty)).toBe("person");
    expect(declaredPayerType({ ...thirdParty, payer_type: null })).toBe("person");
    expect(declaredPayerType(company)).toBe("company");
    // Nobody but the patient pays: there is no payer to have a type.
    expect(declaredPayerType({ ...company, payer_kind: "self" })).toBeNull();
    expect(declaredPayerType(null)).toBeNull();
  });

  it("maps a person of a typed server to the form and back", () => {
    const form = payerDeclarationToForm(typedPerson);
    expect(form).toMatchObject({
      kind: "third_party",
      payerType: "person",
      organisationName: "",
      relationshipKind: "child",
      relationship: "",
      firstName: "Erika",
      payerTypeSupport: "supported",
    });
    expect(isOrganisationPayerForm(form)).toBe(false);
    expect(payerDeclarationPayload(form)).toMatchObject({
      payer_kind: "third_party",
      payer_type: "person",
      organisation_name: null,
      relationship_kind: "child",
      relationship: null,
      first_name: "Erika",
      last_name: "Muster",
      date_of_birth: "1970-05-01",
      citizenships: ["DE", "IR"],
      street: "Hauptstr. 1",
    });
  });

  it("maps a company to the form and back without a personal identity", () => {
    const form = payerDeclarationToForm(company);
    expect(form).toMatchObject({
      payerType: "company",
      organisationName: "Beispiel GmbH",
      relationshipKind: "employer",
      firstName: "",
      citizenships: [],
      street: "Hauptstr. 1",
      country: "DE",
      payerTypeSupport: "supported",
    });
    expect(isOrganisationPayerForm(form)).toBe(true);
    expect(payerDeclarationPayload(form)).toMatchObject({
      payer_kind: "third_party",
      payer_type: "company",
      organisation_name: "Beispiel GmbH",
      relationship_kind: "employer",
      relationship: null,
      first_name: null,
      last_name: null,
      date_of_birth: null,
      place_of_birth: null,
      citizenships: [],
      street: "Hauptstr. 1",
      zip: "10115",
      city: "Berlin",
      country: "DE",
      email: "office@example.com",
      payer_informed: true,
    });
  });

  it("clears the personal identity when a person becomes an organisation, and keeps it in the form", () => {
    const form = { ...payerDeclarationToForm(typedPerson), payerType: "insurance" as const, organisationName: " Beispiel Versicherung AG " };
    const payload = payerDeclarationPayload(form);
    expect(payload).toMatchObject({
      payer_type: "insurance",
      organisation_name: "Beispiel Versicherung AG",
      first_name: null,
      last_name: null,
      date_of_birth: null,
      place_of_birth: null,
      citizenships: [],
      street: "Hauptstr. 1",
    });
    // Switching back before the save brings the person back.
    expect(payerDeclarationPayload({ ...form, payerType: "person" })).toMatchObject({
      payer_type: "person",
      organisation_name: null,
      first_name: "Erika",
      citizenships: ["DE", "IR"],
    });
  });

  it("clears type, name and relationship for a self-payer on a typed server", () => {
    const payload = payerDeclarationPayload({ ...payerDeclarationToForm(company), kind: "self" });
    expect(payload).toMatchObject({
      payer_kind: "self",
      payer_type: null,
      organisation_name: null,
      relationship_kind: null,
      relationship: null,
      street: null,
    });
  });

  it("never sends the lead's contact consent", () => {
    for (const declaration of [typedPerson, company, thirdParty]) {
      const payload = payerDeclarationPayload(payerDeclarationToForm(declaration));
      expect(Object.keys(payload).filter((key) => key.includes("consent"))).toEqual([]);
    }
  });

  it("sends none of the new keys to an older server", () => {
    // `thirdParty` has no `payer_type` key: the server does not know it.
    const form = payerDeclarationToForm(thirdParty);
    expect(form).toMatchObject({ payerType: "person", relationshipKind: "", payerTypeSupport: "unsupported" });
    const payload = payerDeclarationPayload(form);
    for (const key of ["payer_type", "organisation_name", "relationship_kind"]) {
      expect(payload).not.toHaveProperty(key);
    }
    // The form is the one for a person, whatever its state says.
    const forced = { ...form, payerType: "company" as const, organisationName: "Beispiel GmbH", relationshipKind: "employer" as const };
    expect(isOrganisationPayerForm(forced)).toBe(false);
    const forcedPayload = payerDeclarationPayload(forced);
    expect(forcedPayload).not.toHaveProperty("payer_type");
    expect(forcedPayload).toMatchObject({ first_name: "Erika", relationship: "Tochter", citizenships: ["DE", "IR"] });
    expect(payerFormMissing(forced)).toEqual([]);
  });

  it("before the first save sends the new keys only when staff stated them", () => {
    const person = {
      ...payerDeclarationToForm(thirdParty),
      payerTypeSupport: "unknown" as const,
    };
    expect(EMPTY_PAYER_DECLARATION_FORM.payerTypeSupport).toBe("unknown");
    expect(payerDeclarationPayload(person)).not.toHaveProperty("payer_type");
    expect(payerDeclarationPayload({ ...EMPTY_PAYER_DECLARATION_FORM, kind: "self" })).not.toHaveProperty("payer_type");
    expect(payerDeclarationPayload({ ...person, relationshipKind: "friend" })).toMatchObject({
      payer_type: "person",
      organisation_name: null,
      relationship_kind: "friend",
      relationship: null,
    });
    expect(payerDeclarationPayload({ ...person, payerType: "organisation", organisationName: "Beispiel e. V." })).toMatchObject({
      payer_type: "organisation",
      organisation_name: "Beispiel e. V.",
      relationship_kind: null,
      first_name: null,
    });
  });

  it("asks the free-text relationship for \"other\" and keeps an earlier text visible", () => {
    const form = payerDeclarationToForm(typedPerson);
    expect(payerRelationshipTextShown(form, typedPerson)).toBe(false);
    expect(payerRelationshipTextShown({ ...form, relationshipKind: "other" }, typedPerson)).toBe(true);
    expect(payerDeclarationPayload({ ...form, relationshipKind: "other", relationship: " Nachbarin " })).toMatchObject({
      relationship_kind: "other",
      relationship: "Nachbarin",
    });
    // A kind that says it all drops the text, also one typed a moment ago.
    expect(payerDeclarationPayload({ ...form, relationshipKind: "spouse", relationship: "Nachbarin" })).toMatchObject({
      relationship_kind: "spouse",
      relationship: null,
    });

    // Typed by staff before the kinds existed: shown and kept until a kind replaces it.
    const earlier: PayerDeclaration = { ...typedPerson, relationship_kind: null, relationship: "Tochter" };
    const earlierForm = payerDeclarationToForm(earlier);
    expect(earlierForm).toMatchObject({ relationshipKind: "", relationship: "Tochter" });
    expect(payerRelationshipTextShown(earlierForm, earlier)).toBe(true);
    expect(payerRelationshipTextShown({ ...earlierForm, relationship: "" }, earlier)).toBe(true);
    expect(payerDeclarationPayload(earlierForm)).toMatchObject({ relationship_kind: null, relationship: "Tochter" });
    expect(payerRelationshipTextShown({ ...earlierForm, relationshipKind: "child" }, earlier)).toBe(false);

    // Nothing stored and nothing typed: only the select.
    const blank: PayerDeclaration = { ...typedPerson, relationship_kind: null, relationship: null };
    expect(payerRelationshipTextShown(payerDeclarationToForm(blank), blank)).toBe(false);
    // An older server has only the text.
    expect(payerRelationshipTextShown(payerDeclarationToForm(thirdParty), thirdParty)).toBe(true);
  });

  it("requires the name and the seat of an organisation instead of a personal identity", () => {
    const form = payerDeclarationToForm(company);
    expect(payerFormMissing(form)).toEqual([]);
    expect(payerFormMissing({ ...form, organisationName: "  " })).toEqual(["payer_identity_incomplete"]);
    for (const key of ["street", "zip", "city", "country"] as const) {
      expect(payerFormMissing({ ...form, [key]: "" })).toEqual(["payer_identity_incomplete"]);
    }
    expect(payerFormMissing({ ...form, payerInformed: false })).toEqual(["payer_not_informed"]);
    // A person still needs the personal identity; a name of an organisation does not help.
    const person = { ...form, payerType: "person" as const };
    expect(payerFormMissing(person)).toEqual(["payer_identity_incomplete"]);
    expect(payerFormMissing({ ...payerDeclarationToForm(typedPerson), citizenships: [] }))
      .toEqual(["payer_identity_incomplete"]);
    expect(payerFormMissing(payerDeclarationToForm(typedPerson))).toEqual([]);
  });

  it("words the incomplete identity for the payer type and keeps unknown codes readable", () => {
    const personText = payerReasonLabel("payer_identity_incomplete", tx, "person");
    expect(personText).toBe("Заполните данные плательщика: имя, дату рождения, адрес, гражданство");
    for (const type of ["company", "organisation", "insurance"] as const) {
      expect(payerReasonLabel("payer_identity_incomplete", tx, type))
        .toBe("Заполните данные плательщика: название и юридический адрес");
    }
    expect(payerReasonLabel("payer_identity_incomplete", de, "company"))
      .toBe("Angaben zum Kostenübernehmer ergänzen: Name und Sitz (Anschrift)");
    // Without the type (readiness list, signature gate) the text covers both.
    const neutral = payerReasonLabel("payer_identity_incomplete", tx);
    expect(neutral).toContain("гражданство");
    expect(neutral).toContain("название и юридический адрес");
    expect(payerReadinessReasonLabels(tx)["Third-party payer details are incomplete"]).toBe(neutral);
    expect(payerReasonLabel("a_code_of_tomorrow", tx, "company")).toBe("Проверьте данные плательщика");
    expect(payerReasonLabel("a_code_of_tomorrow", de)).toBe("Angaben zum Zahler prüfen");
  });

  it("labels every payer type and relationship kind in both languages", () => {
    expect(PAYER_TYPES.map((value) => payerTypeLabel(value, tx)))
      .toEqual(["Частное лицо", "Компания", "Организация", "Страховая"]);
    expect(PAYER_TYPES.map((value) => payerTypeLabel(value, de)))
      .toEqual(["Privatperson", "Unternehmen", "Organisation", "Versicherung"]);
    expect(PAYER_RELATIONSHIP_KINDS).toEqual([
      "spouse", "parent", "child", "sibling", "grandparent", "relative", "employer", "friend", "business_partner", "other",
    ]);
    for (const translate of [tx, de]) {
      const labels = PAYER_RELATIONSHIP_KINDS.map((value) => payerRelationshipKindLabel(value, translate));
      expect(labels.every(Boolean)).toBe(true);
      expect(new Set(labels).size).toBe(PAYER_RELATIONSHIP_KINDS.length);
    }
  });

  it("keeps the type, the name, the kind and the consent of a server response", () => {
    const normalized = normalizePayerDeclarationResponse({ declaration: company, status: {} });
    expect(normalized?.declaration).toMatchObject({
      payer_type: "company",
      organisation_name: "Beispiel GmbH",
      relationship_kind: "employer",
      contact_consent_at: null,
    });
    // The seat of an organisation still feeds the AML country risk.
    expect(payerAmlCountries(normalized)).toEqual(["DE"]);
    // An older response stays without the key, so the form knows the server.
    const older = normalizePayerDeclarationResponse({ declaration: thirdParty, status: {} });
    expect(older?.declaration).not.toHaveProperty("payer_type");
  });
});

/** The same company on a server that stores sections 7–8: the lead chose "to me", staff typed the VAT id. */
const billed: PayerDeclaration = {
  ...company,
  invoice_to: "self",
  invoice_name: null,
  invoice_street: null,
  invoice_zip: null,
  invoice_city: null,
  invoice_country: null,
  invoice_email: "anna.muster@example.com",
  invoice_vat_id: "DE123456789",
  invoice_tax_number: null,
  payment_method: "bank_transfer",
  payment_method_details: null,
  account_country: "DE",
  account_holder: "Anna Muster",
  bank_name: "Musterbank",
  via_third_party: false,
  via_third_party_details: null,
};

describe("USt-IdNr. / Steuernummer of the invoice recipient (section 7, staff fields)", () => {
  it("maps the two fields to the form and back, for a third party and a self-payer alike", () => {
    const form = payerDeclarationToForm(billed);
    expect(form).toMatchObject({ invoiceVatId: "DE123456789", invoiceTaxNumber: "", invoiceTaxSupport: "supported" });
    expect(invoiceTaxFieldsShown(form)).toBe(true);
    expect(payerDeclarationPayload({ ...form, invoiceTaxNumber: " 30/123/45678 " })).toMatchObject({
      payer_kind: "third_party",
      invoice_vat_id: "DE123456789",
      invoice_tax_number: "30/123/45678",
    });
    expect(payerDeclarationPayload({ ...form, kind: "self" })).toMatchObject({
      payer_kind: "self",
      invoice_vat_id: "DE123456789",
      invoice_tax_number: null,
    });
    // Cleared by staff: sent as null, which clears it on the server.
    expect(payerDeclarationPayload({ ...form, invoiceVatId: "  " })).toMatchObject({ invoice_vat_id: null, invoice_tax_number: null });
  });

  it("never sends the lead's answers of sections 7–8", () => {
    const payload = payerDeclarationPayload(payerDeclarationToForm(billed));
    for (const key of [
      "invoice_to", "invoice_name", "invoice_street", "invoice_zip", "invoice_city", "invoice_country", "invoice_email",
      "payment_method", "payment_method_details", "account_country", "account_holder", "bank_name", "via_third_party", "via_third_party_details",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("sends neither field to an older server and does not offer the inputs", () => {
    // `company` has no `invoice_vat_id` key: the server does not know it.
    const form = payerDeclarationToForm(company);
    expect(form).toMatchObject({ invoiceVatId: "", invoiceTaxNumber: "", invoiceTaxSupport: "unsupported" });
    expect(invoiceTaxFieldsShown(form)).toBe(false);
    const payload = payerDeclarationPayload({ ...form, invoiceVatId: "DE123456789" });
    expect(payload).not.toHaveProperty("invoice_vat_id");
    expect(payload).not.toHaveProperty("invoice_tax_number");
    // The key present with null still means "known".
    expect(payerDeclarationToForm({ ...company, invoice_vat_id: null }).invoiceTaxSupport).toBe("supported");
  });

  it("before the first save sends the fields only when staff entered one", () => {
    expect(EMPTY_PAYER_DECLARATION_FORM.invoiceTaxSupport).toBe("unknown");
    expect(invoiceTaxFieldsShown(EMPTY_PAYER_DECLARATION_FORM)).toBe(true);
    const fresh = { ...EMPTY_PAYER_DECLARATION_FORM, kind: "self" as const };
    expect(payerDeclarationPayload(fresh)).not.toHaveProperty("invoice_vat_id");
    expect(payerDeclarationPayload(fresh)).not.toHaveProperty("invoice_tax_number");
    expect(payerDeclarationPayload({ ...fresh, invoiceTaxNumber: "30/123/45678" })).toMatchObject({
      invoice_vat_id: null,
      invoice_tax_number: "30/123/45678",
    });
  });

  it("keeps the sixteen keys of a server response", () => {
    const normalized = normalizePayerDeclarationResponse({ declaration: billed, status: {} });
    expect(normalized?.declaration).toMatchObject({
      invoice_to: "self",
      invoice_email: "anna.muster@example.com",
      invoice_vat_id: "DE123456789",
      payment_method: "bank_transfer",
      account_holder: "Anna Muster",
      via_third_party: false,
    });
    expect(normalizePayerDeclarationResponse({ declaration: company, status: {} })?.declaration).not.toHaveProperty("invoice_to");
  });

  it("words where the invoice goes and the staff fields", () => {
    expect(invoiceToLabel("self", tx)).toBe("пациенту");
    expect(invoiceToLabel("payer", tx)).toBe("плательщику");
    expect(invoiceToLabel("other", tx)).toBe("по другому адресу");
    expect(invoiceToLabel(null, tx)).toBe("не указано");
    expect(invoiceToLabel(undefined, de)).toBe("nicht angegeben");
    expect(invoiceToLabel("self", de)).toBe("an die Patientin / den Patienten");
    expect(invoiceToLabel("payer", de)).toBe("an die zahlende Person / Organisation");
    expect(invoiceToLabel("other", de)).toBe("an eine andere Adresse");
    expect(invoiceToLabel("parents", de)).toBe("parents");
    // A minor never receives the invoice (legacy rows without the step-3 answer).
    expect(invoiceToLabel("self", tx, true)).toBe("родителю / законному представителю");
    expect(invoiceToLabel("self", de, true)).toBe("Elternteil / gesetzliche Vertretung");
    expect(invoiceToLabel("payer", tx, true)).toBe("плательщику");
    expect(invoiceTaxLine(billed)).toBe("USt-IdNr. DE123456789");
    expect(invoiceTaxLine({ invoice_vat_id: " DE123456789 ", invoice_tax_number: "30/123/45678" })).toBe(
      "USt-IdNr. DE123456789 · Steuernummer 30/123/45678",
    );
    expect(invoiceTaxLine({ invoice_vat_id: null, invoice_tax_number: "30/123/45678" })).toBe("Steuernummer 30/123/45678");
    expect(invoiceTaxLine(company)).toBe("");
    expect(invoiceTaxLine(null)).toBe("");
  });
});

describe("payer AML and signing order", () => {
  it("says the section waits for the Kostenübernahmeerklärung when nothing else is missing", () => {
    const de = (_ru: string, text: string) => text;
    expect(payerStatusBadge(status({ complete: true, missing: [] }), tx)).toEqual({ tone: "success", label: "Заполнено" });
    expect(payerStatusBadge(status({ complete: false, missing: ["cost_assumption_missing"] }), tx)).toEqual({
      tone: "info",
      label: "ждёт заявления о принятии расходов",
    });
    expect(payerStatusBadge(status({ complete: false, missing: ["cost_assumption_missing"] }), de).label).toBe(
      "wartet auf Kostenübernahmeerklärung",
    );
    expect(payerStatusBadge(status({ complete: false, missing: ["payer_not_informed", "cost_assumption_missing"] }), tx))
      .toEqual({ tone: "warning", label: "Не заполнено" });
    expect(payerStatusBadge(status({ complete: false, missing: [] }), de).label).toBe("Unvollständig");
    expect(payerStatusBadge(null, tx).label).toBe("Не заполнено");
  });

  it("feeds residence and citizenships of a third party into the AML risk", () => {
    expect(payerAmlCountries({ declaration: thirdParty, status: status() })).toEqual(["DE", "IR"]);
    expect(payerAmlCountries({ declaration: { ...thirdParty, payer_kind: "self" }, status: status() })).toEqual([]);
    expect(payerAmlCountries(null)).toEqual([]);
  });

  it("shows client, payer and GMED in signing order", () => {
    expect(payerSignatureSequence(null).agency).toBe("blocked");
    expect(payerSignatureSequence(status())).toEqual({ client: "pending", payer: "pending", agency: "blocked" });
    expect(payerSignatureSequence(status({ agency_may_sign: true })).agency).toBe("pending");
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
      "GMED подписывает последним: "
        + "Сначала клиент подписывает заказ; Получите подпись плательщика на заявлении о принятии расходов",
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

  it("waits for the payer's signature while the package is out", () => {
    const out = (packageStatus: string, missing: string[]) =>
      payerStatusBadge(
        status({ complete: false, missing, payer_package: { status: packageStatus as "pending", outdated: false, sent_at: null, signed_at: null } }),
        tx,
      );
    expect(out("pending", ["cost_assumption_unsigned"])).toEqual({ tone: "info", label: "ждёт подписи плательщика" });
    expect(out("sending", ["cost_assumption_missing"]).label).toBe("ждёт подписи плательщика");
    expect(
      payerStatusBadge(
        status({ complete: false, missing: ["cost_assumption_outdated"], payer_package: { status: "pending", outdated: true, sent_at: null, signed_at: null } }),
        de,
      ).label,
    ).toBe("wartet auf Unterschrift des Zahlers");
    // Something else missing, or the package not out: as before.
    expect(out("pending", ["payer_not_informed", "cost_assumption_unsigned"]).label).toBe("Не заполнено");
    expect(out("prepared", ["cost_assumption_missing"]).label).toBe("ждёт заявления о принятии расходов");
    expect(out("declined", ["cost_assumption_unsigned"]).label).toBe("Не заполнено");
  });

  it("reads the package and the cost estimate consent of a newer server only where sent", () => {
    const newer = normalizePayerDeclarationResponse({
      declaration: { ...typedPerson, cost_estimate_consent_at: "2026-10-06T08:00:00Z" },
      status: { cost_estimate_consent_required: true, payer_package: { status: "pending", outdated: false, sent_at: "2026-10-06T11:00:00Z" } },
    });
    expect(newer?.status.payer_package).toEqual({ status: "pending", outdated: false, sent_at: "2026-10-06T11:00:00Z", signed_at: null });
    expect(newer?.status.cost_estimate_consent_required).toBe(true);
    const none = normalizePayerDeclarationResponse({ declaration: typedPerson, status: { payer_package: null } });
    expect(none?.status.payer_package).toBeNull();
    const older = normalizePayerDeclarationResponse({ declaration: typedPerson, status: {} });
    expect(older?.status).not.toHaveProperty("payer_package");
    expect(older?.status).not.toHaveProperty("cost_estimate_consent_required");
  });

  it("states the lead's consent to pass the cost estimate on", () => {
    const line = (declaration: PayerDeclaration, required?: boolean, lang = tx) =>
      costEstimateConsentLine({ declaration, status: status(required === undefined ? {} : { cost_estimate_consent_required: required }) }, lang);
    expect(line({ ...typedPerson, cost_estimate_consent_at: "2026-10-06T08:00:00Z" }, true)).toEqual({
      state: "given",
      prefix: "Согласие на передачу сметы плательщику: ",
      value: "дано 06.10.2026",
    });
    expect(line({ ...typedPerson, cost_estimate_consent_at: null }, true, de)).toEqual({
      state: "missing",
      prefix: "Einwilligung zur Weitergabe des Kostenvoranschlags: ",
      value: "noch nicht erteilt",
    });
    expect(line({ ...typedPerson, cost_estimate_consent_at: null }, false)?.value).toBe("не требуется (платит родитель)");
    // The consent key alone tells a newer server.
    expect(line({ ...typedPerson, cost_estimate_consent_at: null })?.state).toBe("missing");
    // An older server, or the patient pays: nothing.
    expect(line(typedPerson)).toBeNull();
    expect(line({ ...typedPerson, payer_kind: "self", cost_estimate_consent_at: null }, true)).toBeNull();
    expect(costEstimateConsentLine(null, tx)).toBeNull();
  });

  it("translates every payer readiness reason of the server", () => {
    const labels = payerReadinessReasonLabels(tx);
    expect(labels["Cost assumption declaration is not signed"]).toBe("Получите подпись плательщика на заявлении о принятии расходов");
    expect(Object.values(labels)).not.toContain("Проверьте данные плательщика");
  });
});

describe("the self-payer's source of funds from the cabinet", () => {
  const own: PayerDeclaration = {
    ...thirdParty,
    payer_kind: "self",
    source_of_funds: null,
    // The extra step asks one choice (two-stage form 2026-10-07).
    self_funds_source: "other",
    self_funds_description: "Stipendium",
  };

  it("counts as stated with the choice and, for 'other', the words", () => {
    expect(leadSelfFundsStated(own)).toBe(true);
    expect(leadSelfFundsStated({ ...own, self_funds_description: " " })).toBe(false);
    expect(leadSelfFundsStated({ ...own, self_funds_source: "savings", self_funds_description: null })).toBe(true);
    expect(leadSelfFundsStated({ ...own, self_funds_source: null })).toBe(false);
    expect(leadSelfFundsStated({ ...own, payer_kind: "third_party" })).toBe(false);
    // An older server does not send the keys.
    expect(leadSelfFundsStated({ ...thirdParty, payer_kind: "self" })).toBe(false);
    expect(leadSelfFundsStated(null)).toBe(false);
  });

  it("is the one record staff edit, sent only once changed (owner decision 2026-10-23)", () => {
    const form = payerDeclarationToForm(own);
    expect(form.selfFundsSource).toBe("other");
    expect(form.selfFundsDescription).toBe("Stipendium");
    expect(form.selfFundsTouched).toBe(false);
    expect(payerFormMissing(form)).toEqual([]);
    // Untouched: never sent, so a save of another field keeps a newer answer of the lead.
    expect(payerDeclarationPayload(form)).not.toHaveProperty("self_funds_source");
    expect(payerDeclarationPayload(form)).not.toHaveProperty("selfFundsTouched");
    // Staff correct it: both keys go, staff's own choice never does.
    const corrected = withPayerDeclarationField(form, "selfFundsSource", "income");
    expect(corrected.selfFundsTouched).toBe(true);
    expect(payerDeclarationPayload(corrected)).toMatchObject({
      self_funds_source: "income",
      self_funds_description: "Stipendium",
      source_of_funds: null,
    });
    // "Other" without the words is not stated.
    const words = withPayerDeclarationField(form, "selfFundsDescription", " ");
    expect(payerFormMissing(words)).toEqual(["payer_source_of_funds_missing"]);
    expect(payerDeclarationPayload(words).self_funds_description).toBeNull();
    // Another payer: the patient's funds are not sent for it, and staff's
    // entry for the payer starts empty.
    const third = withPayerDeclarationField(corrected, "kind", "third_party");
    expect(third.selfFundsTouched).toBe(false);
    expect(third.sourceOfFunds).toBe("");
    expect(payerDeclarationPayload(third)).not.toHaveProperty("self_funds_source");
    // A third party states its own source; the lead's does not count for it.
    expect(payerFormMissing({ ...form, kind: "third_party" })).toContain("payer_source_of_funds_missing");
    // The payer's sent statement counts, staff need not enter one.
    expect(payerFormMissing({ ...form, kind: "third_party" }, true, false, false, true))
      .not.toContain("payer_source_of_funds_missing");
    expect(payerFormMissing(payerDeclarationToForm({ ...own, self_funds_source: null }))).toEqual([
      "payer_source_of_funds_missing",
    ]);
  });

  it("names a stated source in words, of the extra step or of the staff list", () => {
    expect(statedFundsSourceLabel("income", tx)).toBe("Доход");
    expect(statedFundsSourceLabel("inheritance_gift", de)).toBe("Erbschaft");
    expect(statedFundsSourceLabel("other", de)).toBe("Sonstiges");
    expect(statedFundsSourceLabel("employment", de)).toBe("Gehalt / nichtselbständige Arbeit");
    expect(statedFundsSourceLabel("lottery", de)).toBe("lottery");
    expect(statedFundsSourceLabel(null, tx)).toBe("");
    expect(statedFundsSourcesLabel(["savings", "other"], tx)).toBe("Сбережения, Другое");
    expect(STATED_FUNDS_SOURCES).toEqual(["income", "savings", "asset_sale", "inheritance_gift", "other"]);
  });
});

describe("the third-party payer's messenger / WhatsApp number", () => {
  it("is read, edited and sent for a server that stores it", () => {
    const form = payerDeclarationToForm({ ...thirdParty, messenger: "+49 151 0000000" });
    expect(form.messenger).toBe("+49 151 0000000");
    expect(form.messengerSupport).toBe("supported");
    expect(payerDeclarationPayload({ ...form, messenger: "  +49 160 1111111 " })).toMatchObject({ messenger: "+49 160 1111111" });
    expect(payerDeclarationPayload({ ...form, messenger: "" })).toMatchObject({ messenger: null });
    // The patient pays: nothing of a third party's number is kept.
    expect(payerDeclarationPayload({ ...form, kind: "self" })).toMatchObject({ messenger: null });
  });

  it("is not sent to an older server, and before the first save only when typed", () => {
    const older = payerDeclarationToForm(thirdParty);
    expect(older.messengerSupport).toBe("unsupported");
    expect(payerDeclarationPayload({ ...older, messenger: "+49 151 0000000" })).not.toHaveProperty("messenger");
    const fresh = { ...payerDeclarationToForm(null), kind: "third_party" as const };
    expect(payerDeclarationPayload(fresh)).not.toHaveProperty("messenger");
    expect(payerDeclarationPayload({ ...fresh, messenger: "+49 151 0000000" })).toMatchObject({ messenger: "+49 151 0000000" });
  });

  it("labels the new relationship kinds", () => {
    expect(payerRelationshipKindLabel("sibling", tx)).toBe("Брат / сестра");
    expect(payerRelationshipKindLabel("grandparent", tx)).toBe("Бабушка / дедушка");
    expect(payerRelationshipKindLabel("relative", tx)).toBe("Другой родственник");
  });
});

describe("a repeat intake starts from the patient's declaration (QA B-18)", () => {
  it("finds the lead of the last conversion, else the first source lead", () => {
    expect(patientDeclarationLeadId({
      legal_status: { payer_declaration: { lead_id: "lead-latest" } },
      source_lead_id: "lead-first",
    })).toBe("lead-latest");
    expect(patientDeclarationLeadId({ legal_status: {}, source_lead_id: "lead-first" })).toBe("lead-first");
    expect(patientDeclarationLeadId({ legal_status: null, source_lead_id: null })).toBeNull();
    expect(patientDeclarationLeadId(null)).toBeNull();
  });

  it("prefills who pays and the GwG answers, never what belongs to the earlier request", () => {
    const form = payerDeclarationPrefillForm({
      ...thirdParty,
      source_of_funds_document_id: "evidence-of-the-earlier-lead",
    });
    expect(form.kind).toBe("third_party");
    expect(form.firstName).toBe("Erika");
    expect(form.sourceOfFunds).toBe("savings");
    expect(form.actsOnOwnAccount).toBe(true);
    // Art. 14 DSGVO is confirmed per request; the file is the earlier lead's.
    expect(form.payerInformed).toBe(false);
    expect(form.sourceOfFundsDocumentId).toBe("");
  });

  it("takes the earlier statement of a self-payer into this lead's record, as staff's", () => {
    const form = payerDeclarationPrefillForm({
      ...thirdParty,
      payer_kind: "self",
      source_of_funds: "savings",
      self_funds_source: "inheritance_gift",
      self_funds_description: "Erbe der Großmutter",
    });
    expect(form.selfFundsSource).toBe("inheritance_gift");
    expect(form.selfFundsDescription).toBe("Erbe der Großmutter");
    // Written with the first save (staff checked it), staff's old choice is not.
    expect(form.selfFundsTouched).toBe(true);
    expect(form.sourceOfFunds).toBe("");
    expect(payerDeclarationPayload(form)).toMatchObject({
      self_funds_source: "inheritance_gift",
      self_funds_description: "Erbe der Großmutter",
      source_of_funds: null,
    });
    // Nothing stated before: nothing to write.
    expect(payerDeclarationPrefillForm({
      ...thirdParty,
      payer_kind: "self",
      source_of_funds: null,
      self_funds_source: null,
    }).selfFundsTouched).toBe(false);
  });

  it("names the paying parent of the earlier request by this lead's representative id", () => {
    const person = (id: string, first: string, birth: string | null) => ({
      id, slot: "rep1", relation: "mother", guardian: false, name: `${first} Muster`, first_name: first, last_name: "Muster",
      date_of_birth: birth, street: null, zip: null, city: null, country: null, citizenships: [], email: null, phone: null,
    });
    const earlier = { ...thirdParty, payer_kind: "representative" as const, payer_representative_id: "old-contact" };
    const current = [person("relation-anna", "Anna", "1985-03-02"), person("relation-ben", "Ben", null)];
    // The earlier contact id is not this lead's: matched by name and date of birth.
    expect(payerDeclarationPrefillForm(earlier, { previous: person("old-contact", "Anna", "1985-03-02"), current }).representativeId)
      .toBe("relation-anna");
    // No match: staff choose (the server would refuse the old id).
    expect(payerDeclarationPrefillForm(earlier, { previous: person("old-contact", "Clara", null), current }).representativeId).toBe("");
    expect(payerDeclarationPrefillForm(earlier).representativeId).toBe("");
    // The same id on the repeat lead stays.
    expect(payerDeclarationPrefillForm({ ...earlier, payer_representative_id: "relation-ben" }, { current }).representativeId)
      .toBe("relation-ben");
  });
});

describe("USt-IdNr. / Steuernummer format hints (owner decision 2026-10-22)", () => {
  const tx = (ru: string) => ru;
  it("warns about a USt-IdNr. that does not look like one, never about an empty or fitting one", () => {
    expect(vatIdFormatWarning("", tx)).toBeNull();
    expect(vatIdFormatWarning("DE123456789", tx)).toBeNull();
    expect(vatIdFormatWarning("de 123 456 789", tx)).toBeNull();
    expect(vatIdFormatWarning("ATU12345678", tx)).toBeNull();
    expect(vatIdFormatWarning("DE12345", tx)).toContain("USt-IdNr.");
    expect(vatIdFormatWarning("123456789", tx)).not.toBeNull();
    expect(vatIdFormatWarning("FR1", tx)).not.toBeNull();
  });

  it("warns about a Steuernummer outside 10–13 digits or with other characters", () => {
    expect(taxNumberFormatWarning(null, tx)).toBeNull();
    expect(taxNumberFormatWarning("12/345/67890", tx)).toBeNull();
    expect(taxNumberFormatWarning("2893081508152", tx)).toBeNull();
    expect(taxNumberFormatWarning("123/456", tx)).toContain("Steuernummer");
    expect(taxNumberFormatWarning("12-345-67890", tx)).not.toBeNull();
  });
});

describe("an organisation payer's legal form and register number (staff, 2026-10-22)", () => {
  const organisation = {
    ...EMPTY_PAYER_DECLARATION_FORM,
    kind: "third_party" as const,
    payerType: "company" as const,
    payerTypeSupport: "supported" as const,
    organisationName: "Muster GmbH",
  };

  it("sends both for an organisation on a server that stores them", () => {
    const body = payerDeclarationPayload({
      ...organisation,
      organisationDetailsSupport: "supported",
      organisationLegalForm: " GmbH ",
      organisationRegisterNumber: "",
    });
    expect(body).toMatchObject({ organisation_legal_form: "GmbH", organisation_register_number: null });
  });

  it("sends nothing once the payer answered on the own link, for a person or for an older server", () => {
    const locked = payerDeclarationPayload({
      ...organisation,
      organisationDetailsSupport: "supported",
      organisationDetailsLocked: true,
      organisationLegalForm: "GmbH",
    });
    expect(locked).not.toHaveProperty("organisation_legal_form");
    const older = payerDeclarationPayload({ ...organisation, organisationDetailsSupport: "unsupported", organisationLegalForm: "GmbH" });
    expect(older).not.toHaveProperty("organisation_legal_form");
    const person = payerDeclarationPayload({
      ...organisation,
      payerType: "person",
      organisationDetailsSupport: "supported",
      organisationLegalForm: "GmbH",
    });
    expect(person).not.toHaveProperty("organisation_register_number");
    // Before the first save only what staff entered.
    expect(payerDeclarationPayload({ ...organisation, organisationRegisterNumber: "HRB 1" })).toMatchObject({
      organisation_register_number: "HRB 1",
    });
    expect(payerDeclarationPayload(organisation)).not.toHaveProperty("organisation_legal_form");
  });

  it("reads the stored values and the lock from the declaration", () => {
    const response = normalizePayerDeclarationResponse({
      declaration: {
        payer_kind: "third_party",
        payer_type: "company",
        organisation_name: "Muster GmbH",
        citizenships: [],
        organisation_legal_form: "GmbH",
        organisation_register_number: "HRB 12345",
        organisation_details_locked: true,
      },
      status: { complete: false, missing: [] },
    });
    const form = payerDeclarationToForm(response!.declaration!);
    expect(form).toMatchObject({
      organisationLegalForm: "GmbH",
      organisationRegisterNumber: "HRB 12345",
      organisationDetailsSupport: "supported",
      organisationDetailsLocked: true,
    });
  });
});
