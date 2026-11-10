import { describe, expect, it } from "vitest";

import { normalizeIdentityRecognition } from "@/pages/leads/model/identity-recognition-result";

import { defaultRecognitionSelection, recognitionRows } from "./lead-request-identity-recognition";
import { leadRequestText } from "./lead-request-text";

// Synthetic values of the ICAO Doc 9303 specimen ("Utopia"), never a real document.
const answer = (status: "verified" | "unverified", checks: Partial<Record<string, boolean>> = {}) =>
  normalizeIdentityRecognition({
    status,
    format: "TD3",
    checks: { document_number: true, birth_date: true, valid_until: true, composite: true, ...checks },
    document: {
      id_document_type: "passport",
      id_document_number: "L898902C3",
      id_issuing_country: "DE",
      id_valid_until: "2032-04-15",
    },
    holder: { last_name: "Eriksson", first_name: "Anna Maria", date_of_birth: "1974-08-12", legal_sex: "female", citizenship: "DE" },
  })!;

const empty = { id_document_type: "", id_document_number: "", id_issuing_country: "", id_valid_until: "" };
const text = leadRequestText("de");

describe("the cabinet's proposal from the scan", () => {
  it("ticks every empty field when the check digits hold", () => {
    const rows = recognitionRows(answer("verified"), empty, text, "de");
    expect(rows.map((row) => [row.field, row.state, row.shown])).toEqual([
      ["id_document_type", "fill", "Reisepass"],
      ["id_document_number", "fill", "L898902C3"],
      ["id_issuing_country", "fill", "Deutschland"],
      ["id_valid_until", "fill", "15.04.2032"],
    ]);
    expect(defaultRecognitionSelection(rows)).toEqual(["id_document_type", "id_document_number", "id_issuing_country", "id_valid_until"]);
  });

  it("never ticks a field that holds another value, and names a matching one", () => {
    const rows = recognitionRows(
      answer("verified"),
      { ...empty, id_document_number: " l898902c3 ", id_valid_until: "2030-01-01" },
      text,
      "de",
    );
    expect(rows.find((row) => row.field === "id_document_number")?.state).toBe("same");
    expect(rows.find((row) => row.field === "id_valid_until")).toMatchObject({ state: "differs", current: "01.01.2030" });
    expect(defaultRecognitionSelection(rows)).toEqual(["id_document_type", "id_issuing_country"]);
  });

  it("ticks nothing a failed check digit covers", () => {
    const rows = recognitionRows(answer("unverified", { document_number: false, composite: false }), empty, text, "de");
    // The type and the country need the whole zone; the date has its own digit.
    expect(defaultRecognitionSelection(rows)).toEqual(["id_valid_until"]);
  });

  it("has the words in every language of the cabinet", () => {
    for (const lang of ["de", "en", "uk", "ru"] as const) {
      const words = leadRequestText(lang).recognition;
      for (const value of Object.values(words)) expect(value.trim()).not.toBe("");
    }
  });
});
