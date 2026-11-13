import { describe, expect, it } from "vitest";

import {
  comparableName,
  defaultRecognitionSelection,
  normalizeIdentityRecognition,
  onlyFields,
  recognitionDocumentPatch,
  recognitionDocumentRows,
  recognitionErrorText,
  recognitionFailedChecks,
  recognitionHolderPatch,
  recognitionHolderRows,
  type RecognizedDocumentField,
} from "./identity-recognition";
import type { IdentityDocumentDraft } from "./lead-identity-document-data";

const tx = (ru: string) => ru;

const emptyDraft: IdentityDocumentDraft = {
  type: "",
  number: "",
  authority: "",
  country: "",
  issuedOn: "",
  validUntil: "",
  unreadable: false,
};

// Synthetic values only (the ICAO specimen "Anna Maria Eriksson" with a real country code).
const answer = (overrides: Record<string, unknown> = {}) => ({
  status: "verified",
  format: "TD3",
  checks: { document_number: true, birth_date: true, valid_until: true, composite: true },
  names_truncated: false,
  document: {
    id_document_type: "passport",
    id_document_number: "L898902C3",
    id_issuing_country: "UA",
    id_valid_until: "2031-04-15",
  },
  holder: {
    last_name: "Eriksson",
    first_name: "Anna Maria",
    date_of_birth: "1974-08-12",
    legal_sex: "female",
    citizenship: "UA",
  },
  ...overrides,
});

describe("normalizeIdentityRecognition", () => {
  it("reads the server's answer and refuses what is none", () => {
    const result = normalizeIdentityRecognition(answer());
    expect(result?.status).toBe("verified");
    expect(result?.document).toEqual({ type: "passport", number: "L898902C3", country: "UA", validUntil: "2031-04-15" });
    expect(result?.holder.date_of_birth).toBe("1974-08-12");
    expect(normalizeIdentityRecognition(null)).toBeNull();
    expect(normalizeIdentityRecognition({ status: "done" })).toBeNull();
    expect(normalizeIdentityRecognition({ status: "not_found" })?.document.number).toBe("");
  });

  it("drops a document type the form does not know and a date that is none", () => {
    const result = normalizeIdentityRecognition(
      answer({ document: { id_document_type: "visa", id_document_number: "l898902c3", id_issuing_country: "ua", id_valid_until: "15.04.2031" } }),
    );
    expect(result?.document).toEqual({ type: "", number: "L898902C3", country: "UA", validUntil: "" });
  });
});

describe("recognitionDocumentRows", () => {
  it("ticks the empty fields of a verified reading", () => {
    const result = normalizeIdentityRecognition(answer())!;
    const rows = recognitionDocumentRows(result, emptyDraft, tx, "ru");
    expect(rows.map((row) => [row.field, row.state, row.verified])).toEqual([
      ["type", "fill", true],
      ["number", "fill", true],
      ["country", "fill", true],
      ["validUntil", "fill", true],
    ]);
    const selected = defaultRecognitionSelection(rows);
    expect(selected).toEqual(["type", "number", "country", "validUntil"]);
    expect(recognitionDocumentPatch(rows, new Set(selected))).toEqual({
      type: "passport",
      number: "L898902C3",
      country: "UA",
      validUntil: "2031-04-15",
    });
    expect(rows.find((row) => row.field === "validUntil")?.proposed).toBe("15.04.2031");
  });

  it("never ticks a field that already holds another value, and skips equal ones", () => {
    const result = normalizeIdentityRecognition(answer())!;
    const draft = { ...emptyDraft, type: "passport", number: "fa 111111", validUntil: "2030-01-01" };
    const rows = recognitionDocumentRows(result, draft, tx, "ru");
    expect(rows.map((row) => [row.field, row.state])).toEqual([
      ["type", "same"],
      ["number", "differs"],
      ["country", "fill"],
      ["validUntil", "differs"],
    ]);
    expect(defaultRecognitionSelection(rows)).toEqual(["country"]);
    // Staff tick the number themselves: only then it replaces the typed one.
    const ticked = new Set<RecognizedDocumentField>(["type", "number", "country"]);
    expect(recognitionDocumentPatch(rows, ticked)).toEqual({ number: "L898902C3", country: "UA" });
    expect(rows.find((row) => row.field === "number")?.current).toBe("FA 111111");
  });

  it("ticks nothing when a check digit fails", () => {
    const result = normalizeIdentityRecognition(
      answer({ status: "unverified", checks: { document_number: true, birth_date: true, valid_until: false, composite: false } }),
    )!;
    const rows = recognitionDocumentRows(result, emptyDraft, tx, "ru");
    // The number's own digit holds; type and country need the whole zone.
    expect(rows.map((row) => [row.field, row.verified])).toEqual([
      ["type", false],
      ["number", true],
      ["country", false],
      ["validUntil", false],
    ]);
    expect(defaultRecognitionSelection(rows)).toEqual(["number"]);
    expect(recognitionFailedChecks(result, tx)).toEqual(["срок действия"]);
  });

  it("leaves out what the zone did not give", () => {
    const result = normalizeIdentityRecognition(
      answer({ document: { id_document_type: "passport", id_document_number: "L898902C3", id_issuing_country: null, id_valid_until: null } }),
    )!;
    expect(recognitionDocumentRows(result, emptyDraft, tx, "ru").map((row) => row.field)).toEqual(["type", "number"]);
  });
});

describe("recognitionHolderRows", () => {
  it("compares names without case, diacritics and hyphens", () => {
    expect(comparableName("Müller-Lüdenscheidt")).toBe(comparableName("MULLER LUDENSCHEIDT"));
    const result = normalizeIdentityRecognition(answer())!;
    const rows = recognitionHolderRows(
      result,
      { lastName: "eriksson", firstName: "Anna-Maria", birthDate: "1974-08-12", legalSex: "female", citizenships: ["DE", "UA"] },
      tx,
      "ru",
    );
    expect(rows.map((row) => row.state)).toEqual(["same", "same", "same", "same", "same"]);
    expect(recognitionHolderPatch(rows, new Set(["lastName", "citizenship"]))).toEqual({});
  });

  it("marks what differs and adds a citizenship instead of replacing the list", () => {
    const result = normalizeIdentityRecognition(answer())!;
    const rows = recognitionHolderRows(
      result,
      { lastName: "Эрикссон", firstName: "", birthDate: "1974-08-21", legalSex: "", citizenships: ["DE"] },
      tx,
      "ru",
    );
    expect(rows.map((row) => [row.field, row.state])).toEqual([
      ["lastName", "differs"],
      ["firstName", "fill"],
      ["birthDate", "differs"],
      ["legalSex", "fill"],
      ["citizenship", "differs"],
    ]);
    expect(rows.find((row) => row.field === "birthDate")?.current).toBe("21.08.1974");
    expect(recognitionHolderPatch(rows, new Set(["firstName", "birthDate", "citizenship"]))).toEqual({
      firstName: "Anna Maria",
      birthDate: "1974-08-12",
      citizenship: "UA",
    });
  });

  it("offers no sex for a person whose form has none (a representative)", () => {
    const result = normalizeIdentityRecognition(answer())!;
    const rows = recognitionHolderRows(result, { lastName: "Eriksson", firstName: "Anna", birthDate: "", citizenships: [] }, tx, "ru");
    expect(rows.map((row) => row.field)).not.toContain("legalSex");
  });
});

describe("recognitionErrorText (QA 2026-11-11, B-11)", () => {
  it("does not ask for a PDF when the refused file is called .pdf", () => {
    const text = recognitionErrorText("unsupported_file", tx);
    expect(text).not.toContain("нужен PDF");
    expect(text).toContain("Введите данные вручную");
  });
});

// Owner 2026-11-13: the patient card reads the scan too; its form keeps number and "valid until" only.
describe("onlyFields", () => {
  it("offers only the fields the form has, and ticks only among them", () => {
    const rows = recognitionDocumentRows(normalizeIdentityRecognition(answer())!, emptyDraft, tx, "ru");
    const card = onlyFields(rows, ["number", "validUntil"] as const);
    expect(card.map((row) => row.field)).toEqual(["number", "validUntil"]);
    expect(recognitionDocumentPatch(card, new Set(defaultRecognitionSelection(card)))).toEqual({ number: "L898902C3", validUntil: "2031-04-15" });
    expect(onlyFields(rows, undefined)).toBe(rows);
  });
});
