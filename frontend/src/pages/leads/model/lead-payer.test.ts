import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  EMPTY_PAYER_DECLARATION_FORM,
  PAYER_RELATIONSHIP_KINDS,
  PAYER_TYPES,
  declaredPayerType,
  invoiceTaxFieldsShown,
  invoiceTaxLine,
  invoiceToLabel,
  isOrganisationPayerForm,
  normalizePayerDeclarationResponse,
  payerAmlCountries,
  payerDeclarationPayload,
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
      "spouse", "parent", "child", "relative", "employer", "friend", "business_partner", "other",
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
      label: "ждёт Kostenübernahmeerklärung",
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
