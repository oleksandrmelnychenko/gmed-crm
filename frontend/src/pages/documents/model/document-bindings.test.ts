import { describe, expect, it } from "vitest";

import {
  DOCUMENT_BINDING_FIELDS,
  buildBindingsPayload,
  prefillDocumentBindingsFromText,
} from "./document-bindings";

describe("document template binding payloads", () => {
  it("casts order sequence bindings to numbers", () => {
    expect(
      buildBindingsPayload("single_order", {
        order_sequence: " 3 ",
        order_number: " EA-123 ",
        unknown_field: "drop me",
      }),
    ).toEqual({
      order_sequence: 3,
      order_number: "EA-123",
    });
  });

  it("omits invalid number fields instead of sending malformed bindings", () => {
    expect(
      buildBindingsPayload("cost_coverage_declaration", {
        order_sequence: "3.5",
        payer_name: "Justus Geldgeber",
      }),
    ).toEqual({
      payer_name: "Justus Geldgeber",
    });
    expect(
      buildBindingsPayload("single_order", {
        order_sequence: "0",
        order_number: "EA-123",
      }),
    ).toEqual({
      order_number: "EA-123",
    });
  });

  it("parses cost coverage service lines from textarea input", () => {
    const payload = buildBindingsPayload("cost_coverage_declaration", {
      service_lines_text:
        "Organisation der Behandlung | 999,00 EUR | 1 | 999,00 EUR | inkl. Planung\n\nDolmetscher | 150,00 EUR",
      payer_name: "Justus Geldgeber",
    });

    expect(payload).toMatchObject({
      payer_name: "Justus Geldgeber",
      service_lines: [
        {
          description: "Organisation der Behandlung",
          fee: "999,00 EUR",
          quantity: "1",
          line_total: "999,00 EUR",
          note: "inkl. Planung",
        },
        {
          description: "Dolmetscher",
          fee: "150,00 EUR",
        },
      ],
    });
  });

  it("maps cost estimate second column to the line total range", () => {
    expect(
      buildBindingsPayload("cost_estimate", {
        service_lines_text: "Kardiologische Untersuchung | 100,00 - 1000,00 EUR",
      }),
    ).toMatchObject({
      service_lines: [
        {
          description: "Kardiologische Untersuchung",
          line_total: "100,00 - 1000,00 EUR",
        },
      ],
    });
  });

  it("parses clinic textarea rows for correspondence templates", () => {
    expect(
      buildBindingsPayload("appointment_confirmation", {
        clinics_text:
          "Klinik München | Musterstr. 1, München\nPraxis Berlin",
        passport_number: "MA1234567",
        passport_valid_until: "2050-01-01",
      }),
    ).toEqual({
      passport_number: "MA1234567",
      passport_valid_until: "2050-01-01",
      clinics: [
        { name: "Klinik München", address: "Musterstr. 1, München" },
        { name: "Praxis Berlin", address: undefined },
      ],
    });
  });

  it("shows passport sockets first for appointment confirmation", () => {
    expect(
      DOCUMENT_BINDING_FIELDS.appointment_confirmation
        .slice(0, 2)
        .map((field) => field.key),
    ).toEqual(["passport_number", "passport_valid_until"]);
    expect(
      DOCUMENT_BINDING_FIELDS.appointment_confirmation.some(
        (field) => field.key === "doc_id",
      ),
    ).toBe(false);
  });

  it("prefills passport bindings from extracted PDF text", () => {
    expect(
      prefillDocumentBindingsFromText(
        "appointment_confirmation",
        "hiermit bestätigen wir, dass Herr MUSTERMAN, Max, geb. am 01.01.1930, Reisepass Nr.: MA1234567, gültig bis 01.01.2050, sämtliche Termine hat.",
      ),
    ).toEqual({
      passport_number: "MA1234567",
      passport_valid_until: "2050-01-01",
    });
    expect(
      prefillDocumentBindingsFromText(
        "visa_invitation_letter",
        "Hiermit bestätigen wir, dass Frau MUSTER, Anna, Reisepass Nr.: AA987654, gültig bis 31.12.2049, eingeladen ist.",
      ),
    ).toEqual({
      passport_number: "AA987654",
      passport_valid_until: "2049-12-31",
    });
  });

  it("does not prefill blank appointment confirmation passport sockets", () => {
    expect(
      prefillDocumentBindingsFromText(
        "appointment_confirmation",
        "Reisepass Nr.: ____________, gültig bis ____________, sämtliche Termine",
      ),
    ).toEqual({});
  });

  it("returns null when a template has no non-empty known bindings", () => {
    expect(
      buildBindingsPayload("visa_invitation_letter", {
        passport_number: "   ",
        unknown_field: "ignored",
      }),
    ).toBeNull();
  });

  it("exposes code fields for every patient sticker template", () => {
    for (const templateId of [
      "patient_sticker_compact",
      "patient_sticker_standard",
      "patient_sticker_sheet",
    ]) {
      expect(
        DOCUMENT_BINDING_FIELDS[templateId].map((field) => field.key),
      ).toEqual(["kt1", "kt2", "cost_code"]);
    }
  });
});
