import { describe, expect, it } from "vitest";

import type { LeadRequest, LeadRequestDocument } from "./lead-request-api";
import { requestSummary } from "./lead-request-summary";
import { leadRequestText } from "./lead-request-text";

const de = leadRequestText("de");

function upload(id: string, fileName: string): LeadRequestDocument {
  return {
    id,
    file_name: fileName,
    size_bytes: 2048,
    mime_type: "application/pdf",
    uploaded_at: "2026-10-05T09:20:00Z",
    uploaded_by_me: true,
    reviewed: false,
    can_delete: true,
  };
}

function request(overrides: Partial<LeadRequest> = {}): LeadRequest {
  return {
    lead_id: "lead-1",
    access_kind: "self",
    created_at: "2026-10-05T08:00:00Z",
    personal_data: {
      first_name: "Anna",
      middle_name: null,
      last_name: "Muster",
      date_of_birth: "1988-05-01",
      legal_sex: "female",
      citizenships: ["UA", "DE"],
      street_address: "Musterstraße 1",
      zip_code: "10115",
      city: "Berlin",
      country: "DE",
      phone: null,
      primary_language: "uk",
      has_insurance: true,
      insurance_type: "private",
      insurance_provider: "Allianz Care",
      insurance_number: null,
      insurance_covers_germany: "not_sure",
    },
    progress: { filled: 9, total: 12, missing_for_submit: [] },
    payer: {
      payer_kind: "third_party",
      first_name: "Viktor",
      last_name: "Zahler",
      date_of_birth: "1960-02-03",
      street: null,
      zip: null,
      city: "München",
      country: "DE",
      citizenships: ["UA"],
      relationship: "Vater",
      email: null,
      phone: null,
      acts_on_own_account: false,
      beneficial_owner: "Viktor Zahler, 03.02.1960, Kyiv",
    },
    identification: {
      salutation: "ms",
      former_names: "Beispiel",
      birth_place: "Kyiv",
      birth_country: "UA",
      habitual_residence_country: null,
      contact_channels: ["email", "messenger"],
      id_document_type: "passport",
      id_document_number: "FE123456",
      id_issuing_authority: "8001",
      id_issuing_country: "UA",
      id_issued_on: "2021-03-04",
      id_valid_until: "2031-03-04",
      pep_self: false,
      pep_self_details: null,
      pep_related: true,
      pep_related_details: "Viktor Zahler, Vater, Minister, Ukraine",
      high_risk_country: true,
      high_risk_country_code: "IR",
      sanctions_links: null,
      sanctions_links_details: null,
      payment_background: "Mein Vater unterstützt mich.",
      declared_correct_at: null,
    },
    identity_documents: [upload("id-1", "pass-vorne.jpg"), upload("id-2", "pass-hinten.jpg")],
    minor: false,
    documents: [upload("doc-1", "befund.pdf")],
    max_documents: 30,
    consents: {},
    submitted_at: null,
    retention_deadline_at: null,
    ...overrides,
  };
}

function rows(groups: ReturnType<typeof requestSummary>, id: string): Record<string, string> {
  const group = groups.find((item) => item.id === id);
  return Object.fromEntries((group?.rows ?? []).map((row) => [row.label, row.value]));
}

describe("lead request summary", () => {
  it("groups what will be sent like the form, in the cabinet language", () => {
    const groups = requestSummary(request(), de, "de");
    expect(groups.map((group) => group.id)).toEqual([
      "person",
      "address",
      "contact",
      "identity",
      "insurance",
      "payer",
      "legal",
      "documents",
    ]);
    expect(groups.map((group) => group.title)).toEqual([
      "Persönliche Daten",
      "Adresse",
      "Kontakt",
      "Ausweisdokument",
      "Versicherung",
      "Wer zahlt",
      "Gesetzliche Fragen (Geldwäscheprävention)",
      "Ihre Unterlagen",
    ]);

    // Codes are shown as the person chose them: names, dates as DD.MM.YYYY.
    expect(rows(groups, "person")).toEqual({
      Anrede: "Frau",
      Vorname: "Anna",
      Nachname: "Muster",
      "Frühere Namen (z. B. Geburtsname)": "Beispiel",
      Geburtsdatum: "01.05.1988",
      Geburtsort: "Kyiv",
      Geburtsland: "Ukraine",
      "Geschlecht laut Ausweis": "Weiblich",
      "Staatsangehörigkeit(en)": "Ukraine, Deutschland",
    });
    expect(rows(groups, "address")).toEqual({
      "Straße und Hausnummer": "Musterstraße 1",
      Postleitzahl: "10115",
      Ort: "Berlin",
      Wohnsitzland: "Deutschland",
    });
    expect(rows(groups, "contact")).toEqual({
      "Bevorzugte Sprache": "Ukrainisch",
      "Wie dürfen wir Sie kontaktieren?": "E-Mail, Messenger",
    });
    expect(rows(groups, "identity")).toEqual({
      "Art des Dokuments": "Reisepass",
      Dokumentnummer: "FE123456",
      "Ausstellende Behörde": "8001",
      Ausstellungsland: "Ukraine",
      "Ausgestellt am": "04.03.2021",
      "Gültig bis": "04.03.2031",
      "Foto oder Scan des Ausweises": "pass-vorne.jpg, pass-hinten.jpg",
    });
    expect(rows(groups, "insurance")).toEqual({
      "Krankenversicherung vorhanden?": "Ja",
      Versicherungsart: "Privat",
      Versicherer: "Allianz Care",
      "Deckt Behandlung in Deutschland": "Weiß ich nicht",
    });
    expect(rows(groups, "payer")).toEqual({
      "Wer übernimmt die Kosten der Behandlung?": "Eine andere Person",
      Vorname: "Viktor",
      Nachname: "Zahler",
      Geburtsdatum: "03.02.1960",
      "Staatsangehörigkeit(en)": "Ukraine",
      "Beziehung zur Patientin / zum Patienten": "Vater",
      Ort: "München",
      Wohnsitzland: "Deutschland",
      "Warum zahlt diese Person?": "Mein Vater unterstützt mich.",
      "Handeln Sie im eigenen wirtschaftlichen Interesse?": "Nein",
      "In wessen Interesse handeln Sie? (Name, Geburtsdatum, Geburtsort, Anschrift)": "Viktor Zahler, 03.02.1960, Kyiv",
    });
    // An answered question shows its answer, a "yes" its details; an open one is left to the missing list.
    expect(rows(groups, "legal")).toEqual({
      [de.identificationFields.pep_self]: "Nein",
      [de.identificationFields.pep_related]: "Ja",
      "Name der Person, Beziehung, Amt und Land": "Viktor Zahler, Vater, Minister, Ukraine",
      [de.identificationFields.high_risk_country]: "Ja",
      "Welches Land?": "Iran",
    });
    expect(groups.at(-1)?.rows).toEqual([{ label: "", value: "befund.pdf" }]);
  });

  it("says so when a group is still empty", () => {
    const empty = request({
      payer: null,
      documents: [],
      identity_documents: [],
      identification: {
        ...request().identification!,
        salutation: null,
        id_document_type: null,
        id_document_number: null,
        id_issuing_authority: null,
        id_issuing_country: null,
        id_issued_on: null,
        id_valid_until: null,
        pep_self: null,
        pep_related: null,
        pep_related_details: null,
        high_risk_country: null,
        high_risk_country_code: null,
      },
    });
    const groups = requestSummary(empty, de, "de");
    for (const id of ["identity", "payer", "legal", "documents"]) {
      expect(groups.find((group) => group.id === id)?.rows, id).toEqual([]);
    }
    expect(groups.find((group) => group.id === "legal")?.empty).toBe("Noch keine Angaben");
    expect(groups.find((group) => group.id === "documents")?.empty).toBe("Noch keine Unterlagen hochgeladen.");
  });

  it("leaves out what does not apply", () => {
    const self = request({
      personal_data: { ...request().personal_data, has_insurance: false, insurance_type: "self_pay", insurance_provider: null },
      payer: { ...request().payer!, payer_kind: "self", acts_on_own_account: true, beneficial_owner: "stale" },
    });
    const groups = requestSummary(self, de, "de");
    // No insurance: only the answer. "I pay myself": nobody else is named.
    expect(rows(groups, "insurance")).toEqual({ "Krankenversicherung vorhanden?": "Nein" });
    expect(rows(groups, "payer")).toEqual({
      "Wer übernimmt die Kosten der Behandlung?": "Ich selbst",
      "Handeln Sie im eigenen wirtschaftlichen Interesse?": "Ja",
    });
  });

  it("speaks of the patient when a parent fills in the request of a child", () => {
    const groups = requestSummary(request({ access_kind: "guardian" }), de, "de");
    expect(rows(groups, "payer")).toMatchObject({
      "Wer übernimmt die Kosten der Behandlung?": "Eine andere Person (zum Beispiel ein Elternteil)",
      "Handelt die Patientin / der Patient im eigenen wirtschaftlichen Interesse?": "Nein",
    });
    expect(Object.keys(rows(groups, "legal"))).toContain(de.identificationFieldsGuardian.pep_self);
    expect(requestSummary(request(), leadRequestText("en"), "en").find((group) => group.id === "legal")?.rows).toContainEqual({
      label: "Which country?",
      value: "Iran",
    });
  });

  it("shows no identification on a server that does not know it", () => {
    const older = request({ identification: undefined, identity_documents: undefined, payer: undefined });
    expect(requestSummary(older, de, "de").map((group) => group.id)).toEqual([
      "person",
      "address",
      "contact",
      "insurance",
      "documents",
    ]);
  });
});
