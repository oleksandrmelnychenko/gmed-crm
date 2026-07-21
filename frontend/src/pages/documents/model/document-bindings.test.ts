import { describe, expect, it } from "vitest";

import {
  DOCUMENT_BINDING_FIELDS,
  buildBindingsPayload,
  hydrateDocumentBindings,
  isDesignedAgencyDocumentTemplate,
  isFixedLegalDocumentTemplate,
  keepPatientPartyBindings,
  patientPartyBindingDefaults,
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

  it("serializes every privacy checkbox as a boolean", () => {
    expect(
      buildBindingsPayload("privacy_consents", {
        consent_healthcare: "true",
        consent_provider_release: "false",
        consent_privacy: "true",
        consent_email: "true",
        consent_threema: "false",
        consent_whatsapp: "true",
        consent_telegram: "false",
      }),
    ).toMatchObject({
      consent_healthcare: true,
      consent_provider_release: false,
      consent_privacy: true,
      consent_email: true,
      consent_threema: false,
      consent_whatsapp: true,
      consent_telegram: false,
    });
  });

  it("sends explicit false defaults for untouched privacy checkboxes", () => {
    expect(buildBindingsPayload("privacy_consents", {})).toMatchObject({
      consent_healthcare: false,
      consent_provider_release: false,
      consent_privacy: false,
      consent_email: false,
      consent_threema: false,
      consent_whatsapp: false,
      consent_telegram: false,
    });
  });

  it("keeps fixed legal templates on the protected renderer", () => {
    expect(isFixedLegalDocumentTemplate("confidentiality_release")).toBe(true);
    expect(isFixedLegalDocumentTemplate("privacy_information")).toBe(true);
    expect(isFixedLegalDocumentTemplate("privacy_consents")).toBe(true);
    expect(isFixedLegalDocumentTemplate("cost_estimate")).toBe(false);
  });

  it("keeps every canonical lead document on the designed PDF renderer", () => {
    for (const templateId of [
      "framework_contract",
      "single_order",
      "order_cost_estimate",
      "cost_estimate",
      "confidentiality_release",
      "privacy_information",
      "privacy_consents",
    ]) {
      expect(isDesignedAgencyDocumentTemplate(templateId)).toBe(true);
    }
    expect(isDesignedAgencyDocumentTemplate("appointment_confirmation")).toBe(false);
  });

  it("prefills visible party fields without binding trusted contacts", () => {
    expect(
      patientPartyBindingDefaults({
        address_street: "Musterallee 11",
        address_zip: "81735",
        address_city: "München",
        address_country: "",
        residence_country: "Germany",
        nationality: "Ukraine",
        email: "patient@example.test",
        phone_primary: "+49 89 123",
        intake_profile: {
          trusted_contacts: [
            {
              name: "Alex Beispiel",
              birth_date: "1989-02-03",
              relation: "Bruder",
              phone: "+49 30 123",
            },
          ],
        },
      }),
    ).toEqual({
      party_street: "Musterallee 11",
      party_zip: "81735",
      party_city: "München",
      party_country: "Germany",
      party_email: "patient@example.test",
      party_phone: "+49 89 123",
      party_sign_place: "München",
    });
  });

  it("keeps patient defaults while dropping fields from the previous template", () => {
    expect(
      keepPatientPartyBindings({
        party_city: "München",
        party_email: "patient@example.test",
        order_number: "A-1",
        estimate_total: "1.000,00 EUR",
      }),
    ).toEqual({
      party_city: "München",
      party_email: "patient@example.test",
    });
  });

  it("uses country selectors for patient and payer country bindings", () => {
    expect(
      DOCUMENT_BINDING_FIELDS.framework_contract.find(
        (field) => field.key === "party_country",
      ),
    ).toMatchObject({ kind: "country" });
    expect(
      DOCUMENT_BINDING_FIELDS.cost_coverage_declaration.find(
        (field) => field.key === "payer_country",
      ),
    ).toMatchObject({ kind: "country" });
  });

  it("submits selected ISO countries in German and preserves legacy free text", () => {
    expect(
      hydrateDocumentBindings(
        "single_order",
        { party_country: "Germany" },
        null,
      ),
    ).toMatchObject({ party_country: "Germany" });
    expect(
      buildBindingsPayload("single_order", {
        party_country: "Germany",
      }),
    ).toMatchObject({ party_country: "Deutschland" });
    expect(
      buildBindingsPayload("cost_coverage_declaration", {
        payer_country: " FR ",
        payer_name: " Justus Geldgeber ",
      }),
    ).toMatchObject({
      payer_country: "Frankreich",
      payer_name: "Justus Geldgeber",
    });
    expect(
      buildBindingsPayload("single_order", {
        party_country: "Legacy free-text country",
      }),
    ).toMatchObject({ party_country: "Legacy free-text country" });
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

  it("hydrates every persisted scalar and structured binding for a new version", () => {
    expect(
      hydrateDocumentBindings(
        "cost_coverage_declaration",
        {
          order_sequence: 3,
          payer_name: "Justus Geldgeber",
          payer_sign_place: "Monaco",
          service_lines: [
            {
              description: "Dolmetscher-/Betreuungsleistung",
              fee: "100,00 EUR/1 Stunde",
              quantity: "4",
              line_total: "400,00 EUR",
              note: "Leistungsumfang 10, 11",
            },
          ],
        },
        null,
      ),
    ).toEqual({
      order_sequence: "3",
      payer_name: "Justus Geldgeber",
      payer_sign_place: "Monaco",
      service_lines_text:
        "Dolmetscher-/Betreuungsleistung | 100,00 EUR/1 Stunde | 4 | 400,00 EUR | Leistungsumfang 10, 11",
    });
  });

  it("keeps explicit per-party signatures ahead of legacy shared signatures", () => {
    expect(
      hydrateDocumentBindings(
        "single_order",
        {
          sign_place: "Legacy place",
          sign_date: "2025-11-11",
          party_sign_place: "Patient place",
          party_sign_date: "2025-11-12",
        },
        null,
      ),
    ).toMatchObject({
      party_sign_place: "Patient place",
      party_sign_date: "2025-11-12",
    });
  });

  it("falls back to PDF passport extraction only when no persisted value exists", () => {
    expect(
      hydrateDocumentBindings(
        "appointment_confirmation",
        { passport_number: "PERSISTED-1" },
        "Reisepass Nr.: EXTRACTED-2, gültig bis 31.12.2049, sämtliche Termine",
      ),
    ).toMatchObject({
      passport_number: "PERSISTED-1",
      passport_valid_until: "2049-12-31",
    });
  });

  it("hydrates persisted checked and unchecked consent values", () => {
    expect(
      hydrateDocumentBindings(
        "privacy_consents",
        {
          consent_healthcare: true,
          consent_provider_release: false,
          consent_whatsapp: true,
          consent_telegram: false,
        },
        null,
      ),
    ).toMatchObject({
      consent_healthcare: "true",
      consent_provider_release: "false",
      consent_whatsapp: "true",
      consent_telegram: "false",
    });
  });
});
