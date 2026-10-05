import { describe, expect, it } from "vitest";

import {
  normalizeLeadPortalBilling,
  normalizeLeadPortalIntake,
  normalizeLeadRepresentation,
  type LeadGwgIdentification,
  type LeadPortalBilling,
  type LeadRepresentation,
  type LeadRepresentative,
} from "../data/lead-portal-intake-api";
import {
  answerLabel,
  billingStatements,
  complianceFlagLabel,
  complianceFlagsLine,
  contactChannelsLabel,
  custodyLabel,
  custodyStatement,
  gwgLegalAnswers,
  hasBillingStatements,
  hasGwgStatements,
  hasRepresentationStatements,
  idDocumentTypeLabel,
  idDocumentValidity,
  ownAccountStatement,
  paymentMethodLabel,
  paymentRouteByPayerNote,
  representationStatements,
  representationWarnings,
  representationWarningText,
  representativeAddress,
  representativeName,
  representativeRoleLabel,
  salutationLabel,
} from "./lead-gwg-statements";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const EMPTY_IDENTIFICATION: LeadGwgIdentification = {
  salutation: null,
  former_names: null,
  birth_place: null,
  birth_country: null,
  habitual_residence_country: null,
  contact_channels: [],
  id_document_type: null,
  id_document_number: null,
  id_issuing_authority: null,
  id_issuing_country: null,
  id_issued_on: null,
  id_valid_until: null,
  pep_self: null,
  pep_self_details: null,
  pep_related: null,
  pep_related_details: null,
  high_risk_country: null,
  high_risk_country_code: null,
  sanctions_links: null,
  sanctions_links_details: null,
  payment_background: null,
  declared_correct_at: null,
};

describe("GwG statements in the portal state of a lead", () => {
  it("has none when an older backend does not send them", () => {
    const intake = normalizeLeadPortalIntake({ lead_id: "lead-1", fill_mode: "patient" });
    expect(intake?.identification).toBeNull();
    expect(intake?.identification_updated_at).toBeNull();
    expect(intake?.identification_hidden).toBe(false);
    expect(intake?.identity_documents).toEqual([]);
    expect(hasGwgStatements(intake)).toBe(false);
  });

  it("knows when the server keeps the statements from the caller's role", () => {
    expect(normalizeLeadPortalIntake({ lead_id: "lead-1", identification_hidden: true })?.identification_hidden).toBe(true);
    expect(normalizeLeadPortalIntake({ lead_id: "lead-1", identification_hidden: false })?.identification_hidden).toBe(false);
  });

  it("keeps what the lead stated and fills every missing key", () => {
    const intake = normalizeLeadPortalIntake({
      lead_id: "lead-1",
      identification: {
        salutation: "ms",
        birth_place: " Kyiv ",
        birth_country: "UA",
        contact_channels: ["email", "messenger"],
        id_valid_until: "2031-04-30",
        pep_self: false,
        sanctions_links: true,
        sanctions_links_details: "Example Trading Ltd.",
      },
      identification_updated_at: "2026-10-05T09:20:00Z",
      identity_documents: [
        { id: "doc-1", file_name: "pass.pdf", uploaded_at: "2026-10-05T09:10:00Z", reviewed: false },
      ],
    });
    expect(intake?.identification).toEqual({
      ...EMPTY_IDENTIFICATION,
      salutation: "ms",
      birth_place: "Kyiv",
      birth_country: "UA",
      contact_channels: ["email", "messenger"],
      id_valid_until: "2031-04-30",
      pep_self: false,
      sanctions_links: true,
      sanctions_links_details: "Example Trading Ltd.",
    });
    expect(intake?.identification_updated_at).toBe("2026-10-05T09:20:00Z");
    expect(intake?.identity_documents).toEqual([
      { id: "doc-1", file_name: "pass.pdf", uploaded_at: "2026-10-05T09:10:00Z", reviewed: false },
    ]);
  });

  it("drops values of a wrong shape", () => {
    for (const identification of ["text", 7, [], true]) {
      expect(normalizeLeadPortalIntake({ lead_id: "lead-1", identification })?.identification).toBeNull();
    }
    const intake = normalizeLeadPortalIntake({
      lead_id: "lead-1",
      identification: {
        salutation: 5,
        former_names: "   ",
        contact_channels: ["phone", 3, "", null],
        id_issued_on: { year: 2020 },
        pep_self: "yes",
        pep_related: 1,
        high_risk_country: true,
      },
      identification_updated_at: 1759656000,
      identity_documents: [
        null,
        "pass.pdf",
        { file_name: "no-id.pdf" },
        { id: "doc-2", file_name: 9, uploaded_at: null, reviewed: "true" },
      ],
    });
    expect(intake?.identification).toEqual({
      ...EMPTY_IDENTIFICATION,
      contact_channels: ["phone"],
      high_risk_country: true,
    });
    expect(intake?.identification_updated_at).toBeNull();
    expect(intake?.identity_documents).toEqual([{ id: "doc-2", file_name: "", uploaded_at: null, reviewed: false }]);
    expect(normalizeLeadPortalIntake({ lead_id: "lead-1", identity_documents: { id: "doc-1" } })?.identity_documents).toEqual([]);
  });

  it("tells a lead who entered nothing from one who answered", () => {
    const state = (patch: Partial<LeadGwgIdentification> = {}) => ({
      identification: { ...EMPTY_IDENTIFICATION, ...patch },
      identification_updated_at: null,
      identity_documents: [],
    });
    expect(hasGwgStatements(null)).toBe(false);
    expect(hasGwgStatements(state())).toBe(false);
    // A "no" is an answer too.
    expect(hasGwgStatements(state({ pep_self: false }))).toBe(true);
    expect(hasGwgStatements(state({ contact_channels: ["email"] }))).toBe(true);
    expect(hasGwgStatements(state({ birth_place: "Kyiv" }))).toBe(true);
    expect(hasGwgStatements({ ...state(), identification_updated_at: "2026-10-05T09:20:00Z" })).toBe(true);
    expect(
      hasGwgStatements({
        ...state(),
        identification: null,
        identity_documents: [{ id: "doc-1", file_name: "pass.pdf", uploaded_at: null, reviewed: false }],
      }),
    ).toBe(true);
  });
});

describe("labels of the lead's statements", () => {
  it("names salutation, document type and contact channels in both languages", () => {
    expect(salutationLabel("mr", ru)).toBe("Господин");
    expect(salutationLabel("ms", de)).toBe("Frau");
    expect(salutationLabel("none", de)).toBe("Keine Anrede");
    expect(idDocumentTypeLabel("passport", ru)).toBe("Паспорт");
    expect(idDocumentTypeLabel("id_card", de)).toBe("Personalausweis");
    expect(idDocumentTypeLabel("residence_permit", de)).toBe("Aufenthaltstitel");
    expect(contactChannelsLabel(["messenger", "email", "email"], ru)).toBe("E-mail, Мессенджер");
    expect(contactChannelsLabel(["phone"], de)).toBe("Telefon");
  });

  it("shows an unknown value as it is and an empty one as nothing", () => {
    expect(salutationLabel("mx", ru)).toBe("mx");
    expect(salutationLabel("constructor", ru)).toBe("constructor");
    expect(salutationLabel(null, ru)).toBe("");
    expect(idDocumentTypeLabel(undefined, de)).toBe("");
    expect(contactChannelsLabel(["fax", "phone"], ru)).toBe("Телефон, fax");
    expect(contactChannelsLabel([], ru)).toBe("");
    expect(contactChannelsLabel(null, ru)).toBe("");
  });

  it("tells yes, no and not answered apart", () => {
    expect([true, false, null, undefined].map((value) => answerLabel(value, ru))).toEqual([
      "Да",
      "Нет",
      "Не отвечено",
      "Не отвечено",
    ]);
    expect([true, false, null].map((value) => answerLabel(value, de))).toEqual(["Ja", "Nein", "Nicht beantwortet"]);
  });
});

describe("validity of the identity document", () => {
  const today = "2026-10-05";

  it("is expired from the day after the last day of validity", () => {
    expect(idDocumentValidity("2026-10-04", today)).toBe("expired");
    expect(idDocumentValidity("2026-10-05", today)).toBe("valid");
    expect(idDocumentValidity("2031-04-30", today)).toBe("valid");
    expect(idDocumentValidity("2019-12-31", today)).toBe("expired");
  });

  it("is missing without a readable date", () => {
    expect(idDocumentValidity(null, today)).toBe("missing");
    expect(idDocumentValidity(undefined, today)).toBe("missing");
    expect(idDocumentValidity("", today)).toBe("missing");
    expect(idDocumentValidity("soon", today)).toBe("missing");
  });
});

describe("legal questions", () => {
  it("lists the four answers and keeps details only for a yes", () => {
    const answers = gwgLegalAnswers(
      {
        ...EMPTY_IDENTIFICATION,
        pep_self: true,
        pep_self_details: " Member of parliament, 2021–2024 ",
        pep_related: false,
        pep_related_details: "left over",
        high_risk_country: true,
        high_risk_country_code: "IR",
      },
      ru,
      "ru",
    );
    expect(answers.map((item) => [item.key, item.answer, item.details])).toEqual([
      ["pep_self", true, "Member of parliament, 2021–2024"],
      ["pep_related", false, ""],
      ["high_risk_country", true, "Иран"],
      ["sanctions_links", null, ""],
    ]);
    expect(answers.every((item) => item.question.length > 0)).toBe(true);
  });

  it("names the high-risk country in the language of the user", () => {
    const answers = gwgLegalAnswers(
      { ...EMPTY_IDENTIFICATION, high_risk_country: true, high_risk_country_code: "KP" },
      de,
      "de",
    );
    expect(answers.find((item) => item.key === "high_risk_country")?.details).toBe("Nordkorea");
    expect(answers[0].question).toContain("PEP");
  });
});

describe("own economic interest from the payer declaration", () => {
  it("is not answered without a declaration or without the answer", () => {
    expect(ownAccountStatement(null)).toEqual({ answer: null, beneficialOwner: "" });
    expect(ownAccountStatement(undefined)).toEqual({ answer: null, beneficialOwner: "" });
    expect(ownAccountStatement({ acts_on_own_account: null })).toEqual({ answer: null, beneficialOwner: "" });
    // The stored default is not an answer.
    expect(ownAccountStatement({ acts_on_own_account: true, own_account_answered: false })).toEqual({
      answer: null,
      beneficialOwner: "",
    });
    expect(ownAccountStatement({ acts_on_own_account: true, own_account_answered: true }).answer).toBe(true);
  });

  it("names the beneficial owner only for a no", () => {
    expect(ownAccountStatement({ acts_on_own_account: true, beneficial_owner_name: "Viktor Zahler" })).toEqual({
      answer: true,
      beneficialOwner: "",
    });
    expect(
      ownAccountStatement({
        acts_on_own_account: false,
        beneficial_owner_name: " Viktor Zahler ",
        beneficial_owner_note: "born 02.03.1970 in Wien",
      }),
    ).toEqual({ answer: false, beneficialOwner: "Viktor Zahler · born 02.03.1970 in Wien" });
    expect(
      ownAccountStatement({
        acts_on_own_account: false,
        beneficial_owner: "Viktor Zahler, 02.03.1970, Wien, Musterweg 1",
        beneficial_owner_name: "ignored",
      }),
    ).toEqual({ answer: false, beneficialOwner: "Viktor Zahler, 02.03.1970, Wien, Musterweg 1" });
    expect(ownAccountStatement({ acts_on_own_account: false })).toEqual({ answer: false, beneficialOwner: "" });
  });
});

const ANNA_ID = "11111111-1111-4111-8111-111111111111";
const BEN_ID = "22222222-2222-4222-8222-222222222222";

/** A representative as the server sends it; only the id is required. */
function person(patch: Partial<LeadRepresentative> & { id: string }): LeadRepresentative {
  const normalized = normalizeLeadRepresentation({ representatives: [patch] })?.representatives[0];
  if (!normalized) throw new Error("not a representative");
  return normalized;
}

function representation(patch: Partial<LeadRepresentation> = {}): LeadRepresentation {
  return {
    has_representative: null,
    under_guardianship: null,
    custody: null,
    custody_stated: false,
    representatives: [],
    ...patch,
  };
}

const anna = person({ id: ANNA_ID, slot: "rep1", relation: "parent", first_name: "Anna", last_name: "Muster", has_data: true });
const ben = person({ id: BEN_ID, slot: "rep2", relation: "parent", first_name: "Ben", last_name: "Muster" });

describe("who acts for the lead, in the portal state", () => {
  it("has none when the server sends none (an older backend, or a role that may not read it)", () => {
    for (const raw of [{ lead_id: "lead-1" }, { lead_id: "lead-1", representation: null }, { lead_id: "lead-1", representation: "joint" }]) {
      const intake = normalizeLeadPortalIntake(raw);
      expect(intake?.representation).toBeNull();
      expect(intake?.representation_updated_at).toBeNull();
      expect(representationStatements(intake, ru)).toBeNull();
      expect(hasRepresentationStatements(intake)).toBe(false);
    }
  });

  it("keeps the answers, the custody and each person with every key present", () => {
    const intake = normalizeLeadPortalIntake({
      lead_id: "lead-1",
      minor: true,
      representation_updated_at: "2026-10-05T09:40:00Z",
      representation: {
        has_representative: null,
        under_guardianship: null,
        custody: "sole_parent",
        custody_stated: true,
        representatives: [
          {
            id: ANNA_ID,
            slot: "rep1",
            role: "legal_representative",
            relation: "parent",
            first_name: " Anna ",
            last_name: "Muster",
            date_of_birth: "1985-03-02",
            citizenships: ["DE", "", 4, "UA"],
            email: "anna.muster@example.com",
            id_document_type: "passport",
            id_valid_until: "2031-04-30",
            identity_documents: [{ id: "doc-a", file_name: "anna-pass.pdf", uploaded_at: "2026-10-05T09:10:00Z", reviewed: true }],
            authority_documents: "none",
            has_login: true,
            has_data: true,
            contact_origin: "staff",
          },
          // Not a person: no id.
          { first_name: "Nobody" },
          null,
        ],
      },
    });
    expect(intake?.representation_updated_at).toBe("2026-10-05T09:40:00Z");
    expect(intake?.representation).toEqual({
      has_representative: null,
      under_guardianship: null,
      custody: "sole_parent",
      custody_stated: true,
      representatives: [
        {
          id: ANNA_ID,
          slot: "rep1",
          role: "legal_representative",
          relation: "parent",
          first_name: "Anna",
          last_name: "Muster",
          date_of_birth: "1985-03-02",
          birth_place: null,
          birth_country: null,
          citizenships: ["DE", "UA"],
          street: null,
          zip: null,
          city: null,
          country: null,
          email: "anna.muster@example.com",
          phone: null,
          id_document_type: "passport",
          id_document_number: null,
          id_issuing_authority: null,
          id_issuing_country: null,
          id_issued_on: null,
          id_valid_until: "2031-04-30",
          identity_documents: [{ id: "doc-a", file_name: "anna-pass.pdf", uploaded_at: "2026-10-05T09:10:00Z", reviewed: true }],
          authority_documents: [],
          has_login: true,
          has_data: true,
          contact_origin: "staff",
        },
      ],
    });
  });

  it("reads an unknown custody as not stated", () => {
    expect(normalizeLeadRepresentation({ custody: "shared", custody_stated: true })).toMatchObject({
      custody: null,
      custody_stated: false,
    });
    expect(normalizeLeadRepresentation({ custody: "joint" })).toMatchObject({ custody: "joint", custody_stated: false });
    expect(normalizeLeadRepresentation({ custody: "guardian", custody_stated: true })).toMatchObject({
      custody: "guardian",
      custody_stated: true,
    });
  });

  it("counts what was entered in the cabinet as the lead's statements, not what staff know", () => {
    // A parent who is only a trusted contact, and a custody staff stated.
    const known = { representation: representation({ custody: "joint", custody_stated: true, representatives: [ben] }) };
    expect(hasRepresentationStatements(known)).toBe(false);
    expect(hasRepresentationStatements({ ...known, representation_updated_at: "2026-10-05T09:40:00Z" })).toBe(true);
    expect(hasRepresentationStatements({ representation: representation({ representatives: [anna] }) })).toBe(true);
    expect(
      hasRepresentationStatements({
        representation: representation({
          representatives: [person({ id: BEN_ID, authority_documents: [{ id: "doc-b", file_name: "order.pdf", uploaded_at: null, reviewed: false }] })],
        }),
      }),
    ).toBe(true);
    // An adult's "no" is an answer.
    expect(hasRepresentationStatements({ representation: representation({ has_representative: false }) })).toBe(true);
    expect(hasRepresentationStatements({ representation: representation({ under_guardianship: true }) })).toBe(true);
    expect(hasRepresentationStatements({ representation: representation() })).toBe(false);
    // The whole block is then no longer "nothing entered yet".
    expect(
      hasGwgStatements({
        identification: EMPTY_IDENTIFICATION,
        identification_updated_at: null,
        identity_documents: [],
        representation: representation({ has_representative: false }),
      }),
    ).toBe(true);
  });
});

describe("labels of the representation", () => {
  it("names the custody and says when nobody stated it", () => {
    expect(custodyLabel("joint", ru)).toBe("Оба родителя совместно");
    expect(custodyLabel("sole_parent", de)).toBe("Ein Elternteil allein (alleiniges Sorgerecht)");
    expect(custodyLabel("guardian", de)).toBe("Vormund oder Pfleger");
    expect(custodyLabel(null, ru)).toBe("");
    expect(custodyStatement({ custody: "joint", custody_stated: false }, ru)).toBe("не указано — оба родителя");
    expect(custodyStatement({ custody: "joint", custody_stated: false }, de)).toBe("nicht angegeben – beide Eltern");
    expect(custodyStatement({ custody: "joint", custody_stated: true }, ru)).toBe("Оба родителя совместно");
    expect(custodyStatement({ custody: "guardian", custody_stated: true }, ru)).toBe("Опекун или попечитель");
    expect(custodyStatement({ custody: null, custody_stated: true }, ru)).toBe("не указано — оба родителя");
  });

  it("names the capacity a person acts in", () => {
    expect(representativeRoleLabel({ role: "legal_representative", relation: "parent" }, ru)).toBe("Родитель");
    expect(representativeRoleLabel({ role: "legal_representative", relation: "Guardian" }, de)).toBe("Vormund");
    // A relation staff typed freely.
    expect(representativeRoleLabel({ role: "legal_representative", relation: "Mutter" }, ru)).toBe("Законный представитель");
    expect(representativeRoleLabel({ role: "authorised_representative", relation: "representative" }, ru)).toBe(
      "Уполномоченный представитель",
    );
    expect(representativeRoleLabel({ role: "authorised_representative", relation: null }, de)).toBe("Bevollmächtigte Person");
    expect(representativeRoleLabel({ role: "legal_guardian", relation: "guardian" }, de)).toBe("Betreuer/in");
  });

  it("writes the name and the address from the parts that are known", () => {
    expect(representativeName(anna)).toBe("Anna Muster");
    expect(representativeName({ first_name: null, last_name: " Muster " })).toBe("Muster");
    expect(representativeName({ first_name: null, last_name: null })).toBe("");
    expect(representativeAddress({ street: "Musterweg 1", zip: "10115", city: "Berlin", country: "DE" }, "ru")).toBe(
      "Musterweg 1, 10115 Berlin, Германия",
    );
    expect(representativeAddress({ street: null, zip: null, city: "Wien", country: "AT" }, "de")).toBe("Wien, Österreich");
    expect(representativeAddress({ street: null, zip: null, city: null, country: null }, "ru")).toBe("");
  });
});

describe("warnings about the representation of a minor", () => {
  it("asks for a parent or guardian when nobody is on file", () => {
    expect(representationWarnings(representation({ custody: "joint" }), true)).toEqual(["no_representative"]);
    expect(representationWarnings(representation({ custody: "sole_parent", custody_stated: true }), true)).toEqual([
      "no_representative",
    ]);
    expect(representationWarningText("no_representative", ru)).toBe("Добавьте родителя или законного представителя");
  });

  it("misses the second parent while both represent the child", () => {
    expect(representationWarnings(representation({ custody: "joint", representatives: [anna] }), true)).toEqual([
      "joint_custody_incomplete",
    ]);
    // Without an answer both parents represent the child.
    expect(representationWarnings(representation({ custody: null, representatives: [anna] }), true)).toEqual([
      "joint_custody_incomplete",
    ]);
    expect(representationWarnings(representation({ custody: "joint", representatives: [anna, ben] }), true)).toEqual([]);
    expect(representationWarningText("joint_custody_incomplete", de)).toContain("nur ein Elternteil erfasst");
  });

  it("points at several representatives when one person represents the child alone", () => {
    for (const custody of ["sole_parent", "guardian"] as const) {
      expect(representationWarnings(representation({ custody, custody_stated: true, representatives: [anna, ben] }), true)).toEqual([
        "single_custody_several",
      ]);
      expect(representationWarnings(representation({ custody, custody_stated: true, representatives: [anna] }), true)).toEqual([]);
    }
    expect(representationWarningText("single_custody_several", ru)).toContain("указано несколько представителей");
  });

  it("has none for an adult or without the representation", () => {
    expect(representationWarnings(representation({ representatives: [] }), false)).toEqual([]);
    expect(representationWarnings(representation({ has_representative: true, representatives: [anna, ben] }), false)).toEqual([]);
    expect(representationWarnings(null, true)).toEqual([]);
  });
});

/** Sections 7–8 as the server sends them for a self-payer who has answered nothing yet. */
function billing(patch: Partial<LeadPortalBilling> = {}): LeadPortalBilling {
  return {
    invoice_to: null,
    invoice_name: null,
    invoice_street: null,
    invoice_zip: null,
    invoice_city: null,
    invoice_country: null,
    invoice_email: null,
    invoice_vat_id: null,
    invoice_tax_number: null,
    payment_route_by: "patient",
    payment_method: null,
    payment_method_details: null,
    account_country: null,
    account_holder: null,
    bank_name: null,
    via_third_party: null,
    via_third_party_details: null,
    compliance_flags: [],
    ...patch,
  };
}

const rows = (statements: ReturnType<typeof billingStatements>["invoice"]) =>
  statements.map((row) => [row.key, row.value, row.details, row.warning]);

describe("invoice recipient and payment route in the portal state", () => {
  it("has none when the server sends none (an older backend, or a role that may not read it)", () => {
    for (const raw of [{ lead_id: "lead-1" }, { lead_id: "lead-1", billing: null }, { lead_id: "lead-1", billing: "self" }]) {
      const intake = normalizeLeadPortalIntake(raw);
      expect(intake?.billing).toBeNull();
      expect(intake?.billing_updated_at).toBeNull();
      expect(hasBillingStatements(intake)).toBe(false);
    }
  });

  it("keeps the answers with every key present and reads unknown values as not answered", () => {
    const intake = normalizeLeadPortalIntake({
      lead_id: "lead-1",
      billing_updated_at: "2026-10-06T09:40:00Z",
      billing: {
        invoice_to: "other",
        invoice_name: " Beispiel GmbH ",
        invoice_street: "Beispielstraße 2",
        invoice_zip: "10117",
        invoice_city: "Berlin",
        invoice_country: "DE",
        invoice_email: "rechnung@example.com",
        invoice_vat_id: "DE123456789",
        payment_route_by: "patient",
        payment_method: "cash",
        via_third_party: true,
        via_third_party_details: "Paid by my brother through a payment service",
        compliance_flags: ["cash_payment", "third_party_payment", "something_new", 4],
      },
    });
    expect(intake?.billing_updated_at).toBe("2026-10-06T09:40:00Z");
    expect(intake?.billing).toEqual(
      billing({
        invoice_to: "other",
        invoice_name: "Beispiel GmbH",
        invoice_street: "Beispielstraße 2",
        invoice_zip: "10117",
        invoice_city: "Berlin",
        invoice_country: "DE",
        invoice_email: "rechnung@example.com",
        invoice_vat_id: "DE123456789",
        payment_method: "cash",
        via_third_party: true,
        via_third_party_details: "Paid by my brother through a payment service",
        compliance_flags: ["cash_payment", "third_party_payment"],
      }),
    );
    expect(normalizeLeadPortalBilling({ invoice_to: "parents", payment_method: "paypal", payment_route_by: "guardian", via_third_party: "yes" })).toEqual(
      billing(),
    );
    expect(normalizeLeadPortalBilling({ payment_route_by: "payer" })?.payment_route_by).toBe("payer");
    expect(normalizeLeadPortalBilling({ compliance_flags: "cash_payment" })?.compliance_flags).toEqual([]);
  });

  it("counts the lead's answers as statements, not the staff fields", () => {
    expect(hasBillingStatements({ billing: billing() })).toBe(false);
    expect(hasBillingStatements({ billing: billing({ invoice_vat_id: "DE123456789", invoice_tax_number: "12/345/67890" }) })).toBe(false);
    expect(hasBillingStatements({ billing: billing({ compliance_flags: ["cash_payment"] }) })).toBe(false);
    expect(hasBillingStatements({ billing: billing(), billing_updated_at: "2026-10-06T09:40:00Z" })).toBe(true);
    expect(hasBillingStatements({ billing: billing({ invoice_to: "self" }) })).toBe(true);
    // A "no" is an answer too.
    expect(hasBillingStatements({ billing: billing({ via_third_party: false }) })).toBe(true);
    expect(hasBillingStatements({ billing: billing({ payment_method: "bank_transfer" }) })).toBe(true);
    // The whole block is then no longer "nothing entered yet".
    expect(
      hasGwgStatements({
        identification: EMPTY_IDENTIFICATION,
        identification_updated_at: null,
        identity_documents: [],
        billing: billing({ invoice_to: "self" }),
      }),
    ).toBe(true);
    expect(
      hasGwgStatements({ identification: EMPTY_IDENTIFICATION, identification_updated_at: null, identity_documents: [], billing: billing() }),
    ).toBe(false);
  });
});

describe("labels of sections 7–8", () => {
  it("names the payment methods and the compliance flags in both languages", () => {
    expect(["bank_transfer", "card", "cash", "crypto", "other"].map((value) => paymentMethodLabel(value, ru))).toEqual([
      "Банковский перевод",
      "Банковская карта",
      "Наличные",
      "Криптовалюта",
      "Иной способ",
    ]);
    expect(["bank_transfer", "card", "cash", "crypto", "other"].map((value) => paymentMethodLabel(value, de))).toEqual([
      "Überweisung",
      "Karte",
      "Bar",
      "Kryptowährung",
      "Sonstiges",
    ]);
    expect(paymentMethodLabel(null, ru)).toBe("");
    expect(paymentMethodLabel("cheque", ru)).toBe("cheque");
    expect(["cash_payment", "crypto_payment", "other_method", "third_party_payment"].map((flag) => complianceFlagLabel(flag, ru))).toEqual([
      "наличные",
      "криптовалюта",
      "иной способ оплаты",
      "платёж через третье лицо",
    ]);
    expect(["cash_payment", "crypto_payment", "other_method", "third_party_payment"].map((flag) => complianceFlagLabel(flag, de))).toEqual([
      "Barzahlung",
      "Kryptowährung",
      "sonstiger Zahlungsweg",
      "Zahlung über Dritte",
    ]);
    expect(complianceFlagsLine([], ru)).toBe("");
    expect(complianceFlagsLine(["cash_payment", "third_party_payment"], ru)).toBe(
      "Требуется проверка комплаенса: наличные, платёж через третье лицо",
    );
    expect(complianceFlagsLine(["crypto_payment"], de)).toBe("Compliance-Prüfung erforderlich: Kryptowährung");
    expect(paymentRouteByPayerNote(de)).toBe("Den Zahlungsweg gibt der Zahler selbst an (eigener Link folgt)");
  });
});

describe("sections 7–8 as the group shows them", () => {
  it("lists a self-payer's transfer without a warning", () => {
    const statements = billingStatements(
      billing({
        invoice_to: "self",
        invoice_email: "anna.muster@example.com",
        payment_method: "bank_transfer",
        account_country: "DE",
        account_holder: "Anna Muster",
        bank_name: "Musterbank",
        via_third_party: false,
      }),
      ru,
      "ru",
    );
    expect(rows(statements.invoice)).toEqual([
      ["invoice_to", "пациенту", "", false],
      ["invoice_email", "anna.muster@example.com", "", false],
    ]);
    expect(rows(statements.payment)).toEqual([
      ["payment_method", "Банковский перевод", "", false],
      ["account_country", "Германия", "", false],
      ["account_holder", "Anna Muster", "", false],
      ["bank_name", "Musterbank", "", false],
      ["via_third_party", "Нет", "", false],
    ]);
    expect(statements.byPayer).toBe(false);
    expect(statements.complianceLine).toBe("");
  });

  it("warns about cash and a payment through a third party, and names the other address", () => {
    const statements = billingStatements(
      billing({
        invoice_to: "other",
        invoice_name: "Beispiel GmbH",
        invoice_street: "Beispielstraße 2",
        invoice_zip: "10117",
        invoice_city: "Berlin",
        invoice_country: "DE",
        invoice_email: "rechnung@example.com",
        invoice_vat_id: "DE123456789",
        invoice_tax_number: "30/123/45678",
        payment_method: "cash",
        via_third_party: true,
        via_third_party_details: "My brother brings the money",
        compliance_flags: ["cash_payment", "third_party_payment"],
      }),
      ru,
      "ru",
    );
    expect(rows(statements.invoice)).toEqual([
      ["invoice_to", "по другому адресу", "", false],
      ["invoice_name", "Beispiel GmbH", "", false],
      ["invoice_address", "Beispielstraße 2, 10117 Berlin, Германия", "", false],
      ["invoice_email", "rechnung@example.com", "", false],
      ["invoice_tax", "USt-IdNr. DE123456789 · Steuernummer 30/123/45678", "", false],
    ]);
    // No account for cash: the server clears it.
    expect(rows(statements.payment)).toEqual([
      ["payment_method", "Наличные", "", true],
      ["via_third_party", "Да", "My brother brings the money", true],
    ]);
    expect(statements.complianceLine).toBe("Требуется проверка комплаенса: наличные, платёж через третье лицо");
  });

  it("warns about crypto and another method, with what the lead described", () => {
    const crypto = billingStatements(billing({ payment_method: "crypto", compliance_flags: ["crypto_payment"] }), de, "de");
    expect(rows(crypto.payment)[0]).toEqual(["payment_method", "Kryptowährung", "", true]);
    expect(crypto.payment.map((row) => row.key)).toEqual(["payment_method", "via_third_party"]);
    expect(crypto.complianceLine).toBe("Compliance-Prüfung erforderlich: Kryptowährung");

    const other = billingStatements(
      billing({ payment_method: "other", payment_method_details: " Cheque from abroad ", compliance_flags: ["other_method"] }),
      ru,
      "ru",
    );
    expect(rows(other.payment)[0]).toEqual(["payment_method", "Иной способ", "Cheque from abroad", true]);
    expect(other.complianceLine).toBe("Требуется проверка комплаенса: иной способ оплаты");

    // A card needs the account rows; the bank is optional there.
    const card = billingStatements(billing({ payment_method: "card", account_country: "AT", account_holder: "Anna Muster" }), de, "de");
    expect(rows(card.payment)).toEqual([
      ["payment_method", "Karte", "", false],
      ["account_country", "Österreich", "", false],
      ["account_holder", "Anna Muster", "", false],
      ["bank_name", "", "", false],
      ["via_third_party", "Nicht beantwortet", "", false],
    ]);
  });

  it("shows a lead who has not answered yet every row, empty", () => {
    const statements = billingStatements(billing(), ru, "ru");
    expect(rows(statements.invoice)).toEqual([
      ["invoice_to", "не указано", "", false],
      ["invoice_email", "", "", false],
    ]);
    expect(rows(statements.payment)).toEqual([
      ["payment_method", "", "", false],
      ["account_country", "", "", false],
      ["account_holder", "", "", false],
      ["bank_name", "", "", false],
      ["via_third_party", "Не отвечено", "", false],
    ]);
    expect(statements.complianceLine).toBe("");
  });

  it("asks nothing of section 8 while the third-party payer answers it himself", () => {
    const statements = billingStatements(
      billing({ invoice_to: "payer", invoice_vat_id: "ATU12345678", payment_route_by: "payer" }),
      ru,
      "ru",
    );
    expect(statements.byPayer).toBe(true);
    expect(statements.payment).toEqual([]);
    expect(rows(statements.invoice)).toEqual([
      ["invoice_to", "плательщику", "", false],
      ["invoice_email", "", "", false],
      ["invoice_tax", "USt-IdNr. ATU12345678", "", false],
    ]);
    expect(statements.complianceLine).toBe("");
  });

  it("reads in German too", () => {
    const statements = billingStatements(
      billing({
        invoice_to: "other",
        invoice_name: "Beispiel GmbH",
        invoice_city: "Wien",
        invoice_country: "AT",
        payment_method: "bank_transfer",
        account_country: "AT",
        via_third_party: true,
        via_third_party_details: "Zahlungsdienstleister",
        compliance_flags: ["third_party_payment"],
      }),
      de,
      "de",
    );
    expect(statements.invoice.map((row) => [row.label, row.value])).toEqual([
      ["Rechnung geht an", "an eine andere Adresse"],
      ["Name auf der Rechnung", "Beispiel GmbH"],
      ["Rechnungsanschrift", "Wien, Österreich"],
      ["E-Mail für Rechnungen", ""],
    ]);
    expect(statements.payment.map((row) => [row.label, row.value, row.details, row.warning])).toEqual([
      ["Zahlungsweg", "Überweisung", "", false],
      ["Land des Kontos", "Österreich", "", false],
      ["Kontoinhaber/in", "", "", false],
      ["Bank", "", "", false],
      ["Zahlung über Dritte / Zahlungsdienstleister", "Ja", "Zahlungsdienstleister", true],
    ]);
    expect(statements.complianceLine).toBe("Compliance-Prüfung erforderlich: Zahlung über Dritte");
  });
});

describe("the representation as the block shows it", () => {
  it("shows a minor the custody, the legal representatives and the warnings", () => {
    const statements = representationStatements(
      { minor: true, representation: representation({ custody: "joint", representatives: [anna] }) },
      ru,
    );
    expect(statements).toEqual({
      kind: "minor",
      custody: "не указано — оба родителя",
      persons: [anna],
      warnings: ["joint_custody_incomplete"],
    });
  });

  it("shows an adult the two answers and the persons a yes names", () => {
    const agent = person({ id: ANNA_ID, slot: "agent", role: "authorised_representative", first_name: "Anna", last_name: "Muster", has_data: true });
    expect(
      representationStatements(
        {
          minor: false,
          representation: representation({ has_representative: true, under_guardianship: false, representatives: [agent] }),
        },
        de,
      ),
    ).toEqual({ kind: "adult", hasRepresentative: true, underGuardianship: false, persons: [agent] });
    expect(representationStatements({ minor: false, representation: representation() }, ru)).toEqual({
      kind: "adult",
      hasRepresentative: null,
      underGuardianship: null,
      persons: [],
    });
  });
});
