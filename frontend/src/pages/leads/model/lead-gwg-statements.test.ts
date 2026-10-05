import { describe, expect, it } from "vitest";

import { normalizeLeadPortalIntake, type LeadGwgIdentification } from "../data/lead-portal-intake-api";
import {
  answerLabel,
  contactChannelsLabel,
  gwgLegalAnswers,
  hasGwgStatements,
  idDocumentTypeLabel,
  idDocumentValidity,
  ownAccountStatement,
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
