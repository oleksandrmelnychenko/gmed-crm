import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";
import { representativeSubject } from "@/pages/leads/model/lead-identification";

import {
  contactConsentLabel,
  contactLine,
  contractingPartyLabel,
  conversionNote,
  identificationLines,
  invoiceRecipientSourceNote,
  invoiceTaxStatement,
  invoiceToStatement,
  isThirdPartyPayer,
  leadPath,
  minorWithoutPayerWarning,
  missingAddressWarning,
  normalizePatientPayerSummary,
  payerDisplayName,
  payerInformedLabel,
  payerRelationshipLabel,
  payerSummaryLoadFailure,
  postalAddressLine,
  whoPaysLabel,
  type PatientInvoiceRecipient,
  type PatientPayerDeclaration,
  type Tx,
} from "./patient-payer-summary";

const ru: Tx = (text) => text;
const de: Tx = (_ru, text) => text;

const PATIENT_ID = "00000000-0000-4000-8000-000000000001";
const LEAD_ID = "00000000-0000-4000-8000-000000000002";
const OLDER_LEAD_ID = "00000000-0000-4000-8000-000000000003";
const ANNA_CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const BEN_CONTACT_ID = "22222222-2222-4222-8222-222222222222";
const ANNA_RELATION_ID = "33333333-3333-4333-8333-333333333333";
const BEN_RELATION_ID = "44444444-4444-4444-8444-444444444444";

// Midday in Berlin, so the day never shifts across the time zone.
const SIGNED = { signed_at: "2026-10-05T10:01:00Z", test_mode: false };
const CONFIRMED = { confirmed_at: "2026-10-06T08:00:00Z", confirmed_by_name: "Olek", note: null };

function thirdPartyDeclaration(patch: Record<string, unknown> = {}) {
  return {
    payer_kind: "third_party",
    payer_type: "person",
    name: "Anna Muster",
    organisation_name: null,
    first_name: "Anna",
    last_name: "Muster",
    relationship_kind: "parent",
    relationship: null,
    street: "Musterweg 1",
    zip: "10115",
    city: "Berlin",
    country: "DE",
    email: "anna.muster@example.com",
    phone: "+49 30 000000",
    contact_consent_at: "2026-10-05T16:40:00Z",
    payer_informed_at: "2026-10-05T17:00:00Z",
    ...patch,
  };
}

function selfDeclaration() {
  return {
    payer_kind: "self",
    payer_type: null,
    name: null,
    organisation_name: null,
    first_name: null,
    last_name: null,
    relationship_kind: null,
    relationship: null,
    street: null,
    zip: null,
    city: null,
    country: null,
    email: null,
    phone: null,
    contact_consent_at: null,
    payer_informed_at: null,
  };
}

const PATIENT_RECIPIENT = {
  source: "none",
  role: null,
  kind: "patient",
  name: "Mia Muster",
  street: "Musterweg 1",
  zip: "10115",
  city: "Berlin",
  country: "DE",
  email: "mia.muster@example.com",
  payer_patient_relation_id: null,
  payer_patient_id: null,
  missing: [],
  minor_without_payer: false,
};

/** The full example of the contract: a minor, the parent Anna pays and is the default payer. */
function minorExample() {
  return {
    patient_id: PATIENT_ID,
    patient_is_minor: true,
    source: { lead_id: LEAD_ID, converted_at: "2026-10-06T09:12:00Z", declared_at: "2026-10-05T16:40:00Z" },
    declaration: thirdPartyDeclaration(),
    contracting_party: {
      kind: "legal_representatives",
      explicit: false,
      patient_id: PATIENT_ID,
      patient_name: "Mia Muster",
      patient_is_minor: true,
      debtor_name: "Anna Muster und Ben Muster",
      representatives: [
        {
          relation_id: ANNA_RELATION_ID,
          related_patient_id: null,
          relation_type: "parent",
          name: "Anna Muster",
          email: "anna.muster@example.com",
          address: "Musterweg 1, 10115 Berlin, DE",
          is_default_payer: true,
        },
        {
          relation_id: BEN_RELATION_ID,
          related_patient_id: null,
          relation_type: "parent",
          name: "Ben Muster",
          email: "ben.muster@example.com",
          address: null,
          is_default_payer: false,
        },
      ],
    },
    invoice_recipient: {
      source: "default_payer",
      role: "contracting_party",
      kind: "relation",
      name: "Anna Muster",
      street: "Musterweg 1",
      zip: "10115",
      city: "Berlin",
      country: "DE",
      email: "anna.muster@example.com",
      payer_patient_relation_id: ANNA_RELATION_ID,
      payer_patient_id: null,
      missing: [],
      minor_without_payer: false,
    },
    identification: {
      minor: true,
      contract_partner: { qes: null, own_account_payment: null },
      payer: { qes: SIGNED, own_account_payment: null, same_person_as: representativeSubject(ANNA_CONTACT_ID) },
      representatives: [
        {
          id: ANNA_CONTACT_ID,
          subject: representativeSubject(ANNA_CONTACT_ID),
          name: "Anna Muster",
          relation: "parent",
          has_email: true,
          qes: SIGNED,
          own_account_payment: CONFIRMED,
        },
        {
          id: BEN_CONTACT_ID,
          name: "Ben Muster",
          relation: "parent",
          has_email: true,
          qes: null,
          own_account_payment: null,
        },
      ],
    },
    open_request: null,
  };
}

describe("normalizePatientPayerSummary", () => {
  it("keeps the full example: minor, paying parent as default payer, identification of both parents", () => {
    const summary = normalizePatientPayerSummary(minorExample());
    expect(summary).not.toBeNull();
    expect(summary!.patient_id).toBe(PATIENT_ID);
    expect(summary!.patient_is_minor).toBe(true);
    expect(summary!.source).toEqual({
      lead_id: LEAD_ID,
      converted_at: "2026-10-06T09:12:00Z",
      declared_at: "2026-10-05T16:40:00Z",
    });
    expect(summary!.declaration).toMatchObject({
      payer_kind: "third_party",
      payer_type: "person",
      name: "Anna Muster",
      relationship_kind: "parent",
      relationship: null,
      country: "DE",
      contact_consent_at: "2026-10-05T16:40:00Z",
      payer_informed_at: "2026-10-05T17:00:00Z",
    });
    expect(summary!.contracting_party).toMatchObject({
      kind: "legal_representatives",
      debtor_name: "Anna Muster und Ben Muster",
    });
    expect(summary!.contracting_party!.representatives.map((item) => [item.name, item.is_default_payer])).toEqual([
      ["Anna Muster", true],
      ["Ben Muster", false],
    ]);
    expect(summary!.invoice_recipient).toMatchObject({
      source: "default_payer",
      role: "contracting_party",
      kind: "relation",
      name: "Anna Muster",
      payer_patient_relation_id: ANNA_RELATION_ID,
      missing: [],
      minor_without_payer: false,
    });
    expect(summary!.identification).not.toBeNull();
    expect(summary!.identification!.minor).toBe(true);
    expect(summary!.identification!.payer?.same_person_as).toBe(representativeSubject(ANNA_CONTACT_ID));
    expect(summary!.identification!.representatives.map((item) => item.name)).toEqual(["Anna Muster", "Ben Muster"]);
    expect(summary!.open_request).toBeNull();
  });

  it("self-payer adult: every payer field null, the patient is party and recipient, no payer line", () => {
    const summary = normalizePatientPayerSummary({
      patient_id: PATIENT_ID,
      patient_is_minor: false,
      source: { lead_id: LEAD_ID, converted_at: "2026-10-06T09:12:00Z", declared_at: "2026-10-05T16:40:00Z" },
      declaration: selfDeclaration(),
      contracting_party: {
        kind: "patient",
        explicit: false,
        patient_id: PATIENT_ID,
        patient_name: "Anna Muster",
        patient_is_minor: false,
        debtor_name: "Anna Muster",
        representatives: [],
      },
      invoice_recipient: { ...PATIENT_RECIPIENT, name: "Anna Muster" },
      identification: { minor: false, contract_partner: { qes: SIGNED, own_account_payment: null }, payer: null, representatives: [] },
      open_request: null,
    })!;
    expect(summary.declaration).toMatchObject({ payer_kind: "self", payer_type: null, name: null, street: null, email: null });
    expect(isThirdPartyPayer(summary.declaration)).toBe(false);
    expect(summary.contracting_party?.kind).toBe("patient");
    expect(summary.invoice_recipient).toMatchObject({ source: "none", role: null, kind: "patient", name: "Anna Muster" });
    expect(summary.identification?.payer).toBeNull();
    expect(summary.identification?.representatives).toEqual([]);
  });

  it("third-party person, adult: the recipient comes from the declaration as cost bearer", () => {
    const summary = normalizePatientPayerSummary({
      patient_id: PATIENT_ID,
      patient_is_minor: false,
      source: { lead_id: LEAD_ID, converted_at: "2026-10-06T09:12:00Z", declared_at: null },
      declaration: thirdPartyDeclaration({
        name: "Viktor Zahler",
        first_name: "Viktor",
        last_name: "Zahler",
        relationship_kind: "relative",
        country: "AT",
        city: "Wien",
        zip: "1010",
      }),
      contracting_party: { kind: "patient", explicit: false, patient_id: PATIENT_ID, patient_name: "Ben Muster", patient_is_minor: false, debtor_name: "Ben Muster", representatives: [] },
      invoice_recipient: {
        source: "payer_declaration",
        role: "cost_bearer",
        kind: "contact",
        name: "Viktor Zahler",
        street: "Musterweg 1",
        zip: "1010",
        city: "Wien",
        country: "AT",
        email: "anna.muster@example.com",
        payer_patient_relation_id: null,
        payer_patient_id: null,
        missing: [],
        minor_without_payer: false,
      },
      identification: {
        minor: false,
        contract_partner: { qes: SIGNED, own_account_payment: null },
        payer: { qes: null, own_account_payment: null, same_person_as: null },
        representatives: [],
      },
      open_request: null,
    })!;
    expect(summary.declaration).toMatchObject({ payer_type: "person", name: "Viktor Zahler", relationship_kind: "relative" });
    expect(summary.invoice_recipient).toMatchObject({ source: "payer_declaration", role: "cost_bearer", kind: "contact" });
    expect(summary.identification?.payer).toEqual({ qes: null, own_account_payment: null, same_person_as: null });
  });

  it("organisation payer: the name is the organisation, no personal name parts", () => {
    const summary = normalizePatientPayerSummary({
      patient_id: PATIENT_ID,
      declaration: thirdPartyDeclaration({
        payer_type: "insurance",
        name: "Muster Versicherung AG",
        organisation_name: "Muster Versicherung AG",
        first_name: null,
        last_name: null,
        relationship_kind: "other",
        relationship: "Krankenversicherer",
      }),
      invoice_recipient: { ...PATIENT_RECIPIENT, source: "payer_declaration", role: "cost_bearer", kind: "contact", name: "Muster Versicherung AG" },
      identification: {
        minor: false,
        contract_partner: { qes: SIGNED, own_account_payment: null },
        payer: { qes: SIGNED, own_account_payment: null, same_person_as: null },
        representatives: [],
      },
    })!;
    expect(summary.declaration).toMatchObject({
      payer_type: "insurance",
      name: "Muster Versicherung AG",
      organisation_name: "Muster Versicherung AG",
      first_name: null,
      last_name: null,
      relationship_kind: "other",
      relationship: "Krankenversicherer",
    });
    expect(summary.identification?.payer?.qes).toEqual(SIGNED);
    // Keys an older server leaves out read as "not known".
    expect(summary.source).toBeNull();
    expect(summary.contracting_party).toBeNull();
    expect(summary.open_request).toBeNull();
  });

  it("minor, parent pays, older conversion without the default-payer mark: the declaration addresses the invoice", () => {
    const example = minorExample();
    example.contracting_party.representatives[0].is_default_payer = false;
    example.invoice_recipient = {
      ...example.invoice_recipient,
      source: "payer_declaration",
      role: "cost_bearer",
      kind: "contact",
      payer_patient_relation_id: null,
    };
    const summary = normalizePatientPayerSummary(example)!;
    expect(summary.contracting_party?.representatives.some((item) => item.is_default_payer)).toBe(false);
    expect(summary.invoice_recipient).toMatchObject({ source: "payer_declaration", role: "cost_bearer", kind: "contact", name: "Anna Muster" });
  });

  it("minor, third party is not a parent: both parents and a separate payer line", () => {
    const example = minorExample();
    example.declaration = thirdPartyDeclaration({ name: "Viktor Zahler", first_name: "Viktor", last_name: "Zahler", relationship_kind: "relative" });
    example.identification.payer = { qes: null, own_account_payment: null, same_person_as: null };
    const summary = normalizePatientPayerSummary(example)!;
    expect(summary.declaration?.relationship_kind).toBe("relative");
    const lines = identificationLines(summary.identification!, ru);
    expect(lines.map((line) => [line.subject, line.name])).toEqual([
      [representativeSubject(ANNA_CONTACT_ID), "Anna Muster"],
      [representativeSubject(BEN_CONTACT_ID), "Ben Muster"],
      ["payer", "Плательщик"],
    ]);
  });

  it("never a lead: no source, no declaration, no identification; a minor without relations is flagged", () => {
    const summary = normalizePatientPayerSummary({
      patient_id: PATIENT_ID,
      patient_is_minor: true,
      source: null,
      declaration: null,
      contracting_party: { kind: "legal_representatives", explicit: false, patient_id: PATIENT_ID, patient_name: "Mia Muster", patient_is_minor: true, debtor_name: "Mia Muster", representatives: [] },
      invoice_recipient: { ...PATIENT_RECIPIENT, street: null, missing: ["street"], minor_without_payer: true },
      identification: null,
      open_request: null,
    })!;
    expect(summary.source).toBeNull();
    expect(summary.declaration).toBeNull();
    expect(summary.identification).toBeNull();
    expect(summary.invoice_recipient).toMatchObject({ missing: ["street"], minor_without_payer: true });
    expect(whoPaysLabel(summary.declaration, ru)).toBe("Декларация плательщика отсутствует (пациент создан без обращения)");
    expect(whoPaysLabel(summary.declaration, de)).toBe("Keine Zahlererklärung (Patient ohne Anfrage angelegt)");
  });

  it("several converted leads: the source names the newest conversion", () => {
    const example = minorExample();
    const summary = normalizePatientPayerSummary({
      ...example,
      source: { lead_id: LEAD_ID, converted_at: "2026-10-06T09:12:00Z", declared_at: "2026-10-05T16:40:00Z" },
    })!;
    expect(summary.source?.lead_id).toBe(LEAD_ID);
    expect(summary.source?.lead_id).not.toBe(OLDER_LEAD_ID);
  });

  it("prospect or open repeat lead: the open request is reported beside the declaration", () => {
    const withDeclaration = normalizePatientPayerSummary({
      ...minorExample(),
      open_request: { lead_id: OLDER_LEAD_ID, has_declaration: true },
    })!;
    expect(withDeclaration.open_request).toEqual({ lead_id: OLDER_LEAD_ID, has_declaration: true });
    expect(withDeclaration.declaration?.payer_kind).toBe("third_party");

    const prospect = normalizePatientPayerSummary({
      patient_id: PATIENT_ID,
      declaration: null,
      open_request: { lead_id: OLDER_LEAD_ID },
    })!;
    expect(prospect.declaration).toBeNull();
    expect(prospect.open_request).toEqual({ lead_id: OLDER_LEAD_ID, has_declaration: false });
    // Without a lead id there is no request to open.
    expect(normalizePatientPayerSummary({ patient_id: PATIENT_ID, open_request: { has_declaration: true } })?.open_request).toBeNull();
  });

  it("Billing: the same answer with identification null", () => {
    const summary = normalizePatientPayerSummary({ ...minorExample(), identification: null })!;
    expect(summary.identification).toBeNull();
    expect(summary.declaration?.name).toBe("Anna Muster");
    expect(summary.invoice_recipient?.source).toBe("default_payer");
  });

  it("tolerates missing keys, unknown values and an older server", () => {
    const summary = normalizePatientPayerSummary({ patient_id: PATIENT_ID, declaration: { payer_kind: "third_party", first_name: "Anna", last_name: "Muster" } })!;
    expect(summary.patient_is_minor).toBe(false);
    // A third party without a stored type is a person; the name is built from the parts.
    expect(summary.declaration).toMatchObject({ payer_kind: "third_party", payer_type: "person", name: "Anna Muster", relationship_kind: null, street: null });
    expect(summary.contracting_party).toBeNull();
    expect(summary.invoice_recipient).toBeNull();
    expect(summary.identification).toBeNull();

    const unknownSource = normalizePatientPayerSummary({
      patient_id: PATIENT_ID,
      declaration: { payer_kind: "self", first_name: "stray" },
      invoice_recipient: { source: "something_new", missing: ["street", 7, ""] },
    })!;
    // A self-payer carries no payer fields, whatever the server sends.
    expect(unknownSource.declaration?.first_name).toBeNull();
    expect(unknownSource.invoice_recipient).toMatchObject({ source: "none", missing: ["street"] });

    // Not a summary at all.
    expect(normalizePatientPayerSummary(null)).toBeNull();
    expect(normalizePatientPayerSummary([])).toBeNull();
    expect(normalizePatientPayerSummary("forbidden")).toBeNull();
  });

  it("drops representatives without a name and an id, keeps the rest", () => {
    const summary = normalizePatientPayerSummary({
      patient_id: PATIENT_ID,
      contracting_party: {
        kind: "legal_representatives",
        representatives: [{}, { name: "  " }, { relation_id: BEN_RELATION_ID }, { name: "Anna Muster", is_default_payer: "yes" }],
      },
    })!;
    expect(summary.contracting_party?.representatives).toEqual([
      { relation_id: BEN_RELATION_ID, related_patient_id: null, relation_type: null, name: "", email: null, address: null, is_default_payer: false },
      { relation_id: null, related_patient_id: null, relation_type: null, name: "Anna Muster", email: null, address: null, is_default_payer: false },
    ]);
  });
});

describe("payerSummaryLoadFailure", () => {
  it("hides the card on 403 and shows an error otherwise", () => {
    expect(payerSummaryLoadFailure(new ApiRequestError("forbidden", { status: 403, code: "forbidden" }))).toBe("forbidden");
    expect(payerSummaryLoadFailure(new ApiRequestError("not found", { status: 404, code: "not_found" }))).toBe("error");
    expect(payerSummaryLoadFailure(new ApiRequestError("server", { status: 500 }))).toBe("error");
    expect(payerSummaryLoadFailure(new TypeError("Failed to fetch"))).toBe("error");
    expect(payerSummaryLoadFailure(undefined)).toBe("error");
  });
});

describe("label helpers", () => {
  const declaration = normalizePatientPayerSummary({ patient_id: PATIENT_ID, declaration: thirdPartyDeclaration() })!.declaration as PatientPayerDeclaration;

  it("says who pays, with the payer type for a third party", () => {
    expect(whoPaysLabel(declaration, ru)).toBe("Третье лицо — Частное лицо");
    expect(whoPaysLabel(declaration, de)).toBe("Dritte/r — Privatperson");
    const insurance = { ...declaration, payer_type: "insurance" as const };
    expect(whoPaysLabel(insurance, ru)).toBe("Третье лицо — Страховая");
    expect(whoPaysLabel(insurance, de)).toBe("Dritte/r — Versicherung");
    const self = normalizePatientPayerSummary({ patient_id: PATIENT_ID, declaration: selfDeclaration() })!.declaration;
    expect(whoPaysLabel(self, ru)).toBe("Пациент сам");
    expect(whoPaysLabel(self, de)).toBe("Patient selbst");
  });

  it("names the payer: the organisation, else the person, else a dash", () => {
    expect(payerDisplayName(declaration)).toBe("Anna Muster");
    expect(payerDisplayName({ ...declaration, name: null, organisation_name: "Muster GmbH" })).toBe("Muster GmbH");
    expect(payerDisplayName({ ...declaration, name: null, first_name: null, last_name: "Muster" })).toBe("Muster");
    expect(payerDisplayName({ ...declaration, name: null, first_name: null, last_name: null })).toBe("—");
  });

  it("labels the relationship: the kind, the free text beside 'other', else a dash", () => {
    expect(payerRelationshipLabel(declaration, ru)).toBe("Родитель");
    expect(payerRelationshipLabel(declaration, de)).toBe("Elternteil");
    expect(payerRelationshipLabel({ ...declaration, relationship_kind: "other", relationship: "Patenonkel" }, de)).toBe("Patenonkel");
    expect(payerRelationshipLabel({ ...declaration, relationship_kind: "other", relationship: null }, ru)).toBe("Другое (уточните)");
    expect(payerRelationshipLabel({ ...declaration, relationship_kind: null, relationship: "brother" }, ru)).toBe("brother");
    expect(payerRelationshipLabel({ ...declaration, relationship_kind: null, relationship: null }, ru)).toBe("—");
  });

  it("joins the address with the country name in the viewer's language", () => {
    expect(postalAddressLine(declaration, "ru")).toBe("Musterweg 1, 10115 Berlin, Германия");
    expect(postalAddressLine(declaration, "de")).toBe("Musterweg 1, 10115 Berlin, Deutschland");
    expect(postalAddressLine({ street: null, zip: null, city: "Wien", country: "AT" }, "de")).toBe("Wien, Österreich");
    expect(postalAddressLine({ street: null, zip: null, city: null, country: null }, "de")).toBe("—");
  });

  it("joins e-mail and phone", () => {
    expect(contactLine(declaration)).toBe("anna.muster@example.com · +49 30 000000");
    expect(contactLine({ email: null, phone: "+49 30 000000" })).toBe("+49 30 000000");
    expect(contactLine({ email: null, phone: null })).toBe("—");
  });

  it("dates the consent and the information of the payer, DD.MM.YYYY", () => {
    expect(contactConsentLabel(declaration, ru)).toBe("дано 05.10.2026");
    expect(contactConsentLabel(declaration, de)).toBe("erteilt am 05.10.2026");
    expect(contactConsentLabel({ ...declaration, contact_consent_at: null }, ru)).toBe("не дано");
    expect(contactConsentLabel({ ...declaration, contact_consent_at: null }, de)).toBe("nicht erteilt");
    expect(payerInformedLabel(declaration, ru)).toBe("да, 05.10.2026");
    expect(payerInformedLabel(declaration, de)).toBe("ja, 05.10.2026");
    expect(payerInformedLabel({ ...declaration, payer_informed_at: null }, ru)).toBe("нет");
    expect(payerInformedLabel({ ...declaration, payer_informed_at: null }, de)).toBe("nein");
  });

  it("names the contracting party", () => {
    const minor = normalizePatientPayerSummary(minorExample())!.contracting_party!;
    expect(contractingPartyLabel(minor, ru)).toBe("Законные представители: Anna Muster und Ben Muster");
    expect(contractingPartyLabel(minor, de)).toBe("Gesetzliche Vertreter: Anna Muster und Ben Muster");
    expect(contractingPartyLabel({ ...minor, kind: "patient" }, ru)).toBe("Пациент");
    expect(contractingPartyLabel({ ...minor, kind: "patient" }, de)).toBe("Patient");
    expect(contractingPartyLabel({ ...minor, debtor_name: null }, de)).toBe("Gesetzliche Vertreter: —");
    // Without a parent on file the server's debtor name is the child's own; the line says none is recorded instead.
    expect(contractingPartyLabel({ ...minor, debtor_name: "Mia Muster", representatives: [] }, ru)).toBe("Законные представители: не указаны");
    expect(contractingPartyLabel({ ...minor, debtor_name: "Mia Muster", representatives: [] }, de)).toBe("Gesetzliche Vertreter: nicht erfasst");
  });

  it("notes where the invoice recipient comes from", () => {
    expect(invoiceRecipientSourceNote("payer_declaration", ru)).toBe("по декларации плательщика");
    expect(invoiceRecipientSourceNote("payer_declaration", de)).toBe("laut Zahlererklärung");
    expect(invoiceRecipientSourceNote("invoice_address", ru)).toBe("адрес для счетов по декларации");
    expect(invoiceRecipientSourceNote("invoice_address", de)).toBe("Rechnungsanschrift laut Erklärung");
    expect(invoiceRecipientSourceNote("default_payer", ru)).toBe("плательщик по умолчанию");
    expect(invoiceRecipientSourceNote("default_payer", de)).toBe("Standardzahler");
    expect(invoiceRecipientSourceNote("contracting_party", ru)).toBe("сторона договора");
    expect(invoiceRecipientSourceNote("contracting_party", de)).toBe("Vertragspartei");
    expect(invoiceRecipientSourceNote("order", ru)).toBe("из заказа");
    expect(invoiceRecipientSourceNote("head_order", de)).toBe("aus dem Auftrag");
    expect(invoiceRecipientSourceNote("none", ru)).toBe("пациент");
    expect(invoiceRecipientSourceNote("none", de)).toBe("Patient");
  });

  it("warns about a missing address and a minor as recipient", () => {
    const recipient = normalizePatientPayerSummary({ patient_id: PATIENT_ID, invoice_recipient: PATIENT_RECIPIENT })!.invoice_recipient as PatientInvoiceRecipient;
    expect(missingAddressWarning(recipient, ru)).toBeNull();
    const incomplete = { ...recipient, missing: ["street", "zip", "country", "something_else"] };
    expect(missingAddressWarning(incomplete, ru)).toBe("Адрес неполный: улица, индекс, страна, something_else");
    expect(missingAddressWarning(incomplete, de)).toBe("Adresse unvollständig: Straße, PLZ, Land, something_else");
    expect(missingAddressWarning({ ...recipient, missing: ["name", "city"] }, de)).toBe("Adresse unvollständig: Name, Ort");
    expect(minorWithoutPayerWarning(ru)).toBe("Несовершеннолетний получит счёт — укажите плательщика");
    expect(minorWithoutPayerWarning(de)).toBe("Minderjährige/r als Empfänger – Zahler angeben");
  });

  it("dates the conversion in the footer and links the request", () => {
    const source = { lead_id: LEAD_ID, converted_at: "2026-10-06T09:12:00Z", declared_at: "2026-10-05T16:40:00Z" };
    expect(conversionNote(source, ru)).toBe("Зафиксировано при конвертации обращения 06.10.2026");
    expect(conversionNote(source, de)).toBe("Bei der Umwandlung der Anfrage am 06.10.2026 festgehalten");
    expect(conversionNote({ ...source, converted_at: null }, de)).toBe("Bei der Umwandlung der Anfrage am 05.10.2026 festgehalten");
    expect(conversionNote({ ...source, converted_at: null, declared_at: null }, ru)).toBe("Зафиксировано при конвертации обращения");
    expect(leadPath(LEAD_ID)).toBe(`/leads?lead=${LEAD_ID}`);
    expect(leadPath("a b")).toBe("/leads?lead=a%20b");
  });

  it("says where the invoice goes (section 7) and shows the staff fields when set", () => {
    const other = normalizePatientPayerSummary({
      patient_id: PATIENT_ID,
      declaration: {
        ...selfDeclaration(),
        invoice_to: "other",
        invoice_name: "Beispiel GmbH",
        invoice_street: "Beispielstraße 2",
        invoice_zip: "10117",
        invoice_city: "Berlin",
        invoice_country: "DE",
        invoice_email: "rechnung@example.com",
        invoice_vat_id: "DE123456789",
        invoice_tax_number: "30/123/45678",
      },
    })!.declaration!;
    expect(other).toMatchObject({
      payer_kind: "self",
      invoice_to: "other",
      invoice_name: "Beispiel GmbH",
      invoice_country: "DE",
      invoice_vat_id: "DE123456789",
    });
    expect(invoiceToStatement(other, ru, "ru")).toEqual({
      label: "по другому адресу",
      name: "Beispiel GmbH",
      address: "Beispielstraße 2, 10117 Berlin, Германия",
      email: "rechnung@example.com",
    });
    expect(invoiceToStatement(other, de, "de")).toMatchObject({ label: "an eine andere Adresse", address: "Beispielstraße 2, 10117 Berlin, Deutschland" });
    expect(invoiceTaxStatement(other)).toBe("USt-IdNr. DE123456789 · Steuernummer 30/123/45678");

    // "To me": only the e-mail for invoices, when given.
    const self = { ...other, invoice_to: "self" as const };
    expect(invoiceToStatement(self, ru, "ru")).toEqual({ label: "пациенту", name: null, address: null, email: "rechnung@example.com" });
    expect(invoiceToStatement({ ...self, invoice_email: null }, de, "de")).toEqual({ label: "an die Patientin / den Patienten", name: null, address: null, email: null });
    // "To the payer": the invoice goes to the third party; no e-mail of its own.
    const payer = { ...thirdPartyDeclaration(), invoice_to: "payer", invoice_email: "stray@example.com", invoice_vat_id: null, invoice_tax_number: null };
    const payerDeclaration = normalizePatientPayerSummary({ patient_id: PATIENT_ID, declaration: payer })!.declaration!;
    expect(invoiceToStatement(payerDeclaration, ru, "ru")).toEqual({ label: "плательщику", name: null, address: null, email: null });
    expect(invoiceToStatement(payerDeclaration, de, "de")?.label).toBe("an die zahlende Person / Organisation");
    expect(invoiceTaxStatement(payerDeclaration)).toBeNull();
    // Unanswered: the line says so.
    const open = normalizePatientPayerSummary({ patient_id: PATIENT_ID, declaration: { ...selfDeclaration(), invoice_to: null } })!.declaration!;
    expect(invoiceToStatement(open, ru, "ru")).toEqual({ label: "не указано", name: null, address: null, email: null });
    // An unknown value of the server reads as not answered.
    const unknown = normalizePatientPayerSummary({ patient_id: PATIENT_ID, declaration: { ...selfDeclaration(), invoice_to: "parents" } })!.declaration!;
    expect(unknown.invoice_to).toBeNull();
    expect(invoiceToStatement(unknown, ru, "ru")?.label).toBe("не указано");
  });

  it("shows no section-7 line on a server that does not send it, and never a section-8 key", () => {
    const older = normalizePatientPayerSummary({ patient_id: PATIENT_ID, declaration: thirdPartyDeclaration() })!.declaration!;
    expect(older).not.toHaveProperty("invoice_to");
    expect(older.invoice_name).toBeNull();
    expect(invoiceToStatement(older, ru, "ru")).toBeNull();
    expect(invoiceTaxStatement(older)).toBeNull();
    expect(invoiceToStatement(null, ru, "ru")).toBeNull();
    const withRoute = normalizePatientPayerSummary({
      patient_id: PATIENT_ID,
      declaration: { ...selfDeclaration(), invoice_to: "self", payment_method: "cash", via_third_party: true, account_holder: "Anna Muster" },
    })!.declaration!;
    for (const key of ["payment_method", "via_third_party", "account_holder"]) {
      expect(withRoute).not.toHaveProperty(key);
    }
  });

  it("knows the recipient of another address (role invoice_address)", () => {
    const summary = normalizePatientPayerSummary({
      patient_id: PATIENT_ID,
      invoice_recipient: {
        ...PATIENT_RECIPIENT,
        source: "invoice_address",
        role: "invoice_address",
        kind: "contact",
        name: "Beispiel GmbH",
        street: "Beispielstraße 2",
        zip: "10117",
        email: "rechnung@example.com",
      },
    })!;
    expect(summary.invoice_recipient).toMatchObject({ source: "invoice_address", role: "invoice_address", kind: "contact", name: "Beispiel GmbH" });
    expect(invoiceRecipientSourceNote(summary.invoice_recipient!.source, ru)).toBe("адрес для счетов по декларации");
  });

  it("lists the identification with the wizard's words", () => {
    const status = normalizePatientPayerSummary(minorExample())!.identification!;
    const lines = identificationLines(status, ru);
    expect(lines.map((line) => line.name)).toEqual([
      "Anna Muster",
      "Ben Muster",
      "Плательщик — тот же человек, что и представитель Anna Muster",
    ]);
    expect(lines[0]).toMatchObject({
      detail: "родитель",
      signature: { tone: "success", text: "Квалифицированная подпись · 05.10.2026" },
      payment: { tone: "success", text: "Платёж с собственного счёта подтверждён · 06.10.2026 · Olek" },
      note: "",
    });
    expect(lines[1]).toMatchObject({
      signature: { tone: "neutral", text: "Квалифицированной подписи ещё нет" },
      payment: { tone: "warning", text: "Ожидается платёж с собственного счёта" },
    });
    const german = identificationLines(status, de);
    expect(german[0].detail).toBe("Elternteil");
    expect(german[0].signature.text).toBe("Qualifizierte Signatur · 05.10.2026");
    expect(german[1].payment.text).toBe("Zahlung vom eigenen Konto ausstehend");
  });
});
