import { describe, expect, it } from "vitest";

import type { LeadRequest, LeadRequestBilling, LeadRequestDocument, LeadRequestRepresentative } from "./lead-request-api";
import { answeredPayerRows, payerAnsweredByPayer, requestSummary } from "./lead-request-summary";
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
      relationship: null,
      email: null,
      phone: null,
      acts_on_own_account: false,
      beneficial_owner: "Viktor Zahler, 03.02.1960, Kyiv",
      payer_type: "person",
      organisation_name: null,
      relationship_kind: "parent",
      contact_consent_at: "2026-10-05T09:25:00Z",
    },
    identification: {
      salutation: "ms",
      former_names: "Beispiel",
      birth_place: "Kyiv",
      birth_country: "UA",
      habitual_residence_country: null,
      contact_channels: ["email", "messenger"],
      pep_self: false,
      pep_related: true,
      sanctions_links: null,
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
      "Geburtsname (falls abweichend)": "Beispiel",
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
    // The identity document: the copies only, GMED enters the data (trigger flow).
    expect(rows(groups, "identity")).toEqual({
      "Foto oder Scan des Ausweises": "pass-vorne.jpg, pass-hinten.jpg",
    });
    expect(rows(groups, "insurance")).toEqual({
      "Krankenversicherung vorhanden?": "Ja",
      Versicherungsart: "Privat",
      Versicherer: "Allianz Care",
      "Deckt Behandlung in Deutschland": "Weiß ich nicht",
    });
    expect(rows(groups, "payer")).toEqual({
      "Wer übernimmt die Kosten der Behandlung?": "Eine andere Person oder Organisation",
      "Wer ist der Zahler?": "Privatperson",
      Vorname: "Viktor",
      Nachname: "Zahler",
      Geburtsdatum: "03.02.1960",
      "Staatsangehörigkeit(en)": "Ukraine",
      "Beziehung zur Patientin / zum Patienten": "Elternteil",
      Ort: "München",
      Wohnsitzland: "Deutschland",
      "Einverständnis zur Kontaktaufnahme": "Zugestimmt am 05.10.2026 11:25",
      "Handeln Sie im eigenen wirtschaftlichen Interesse?": "Nein",
      "In wessen Interesse handeln Sie? (Name, Geburtsdatum, Geburtsort, Anschrift)": "Viktor Zahler, 03.02.1960, Kyiv",
    });
    // An answered question shows its answer (yes or no only); an open one is left to the missing list.
    expect(rows(groups, "legal")).toEqual({
      [de.identificationFields.pep_self]: "Nein",
      [de.identificationFields.pep_related]: "Ja",
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
        pep_self: null,
        pep_related: null,
      },
    });
    const groups = requestSummary(empty, de, "de");
    for (const id of ["identity", "payer", "documents"]) {
      expect(groups.find((group) => group.id === id)?.rows, id).toEqual([]);
    }
    // The legal questions are block L only: no empty group in the base form (QA 2026-10-10).
    expect(groups.find((group) => group.id === "legal")).toBeUndefined();
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

  it("names a company, organisation or insurer by its name and its seat", () => {
    const company = request({
      payer: {
        ...request().payer!,
        payer_type: "company",
        organisation_name: "Beispiel GmbH",
        // What the server has dropped for an organisation.
        first_name: null,
        last_name: null,
        date_of_birth: null,
        citizenships: [],
        street: "Musterstraße 1",
        relationship_kind: "employer",
        contact_consent_at: null,
        acts_on_own_account: true,
        beneficial_owner: null,
      },
    });
    expect(rows(requestSummary(company, de, "de"), "payer")).toEqual({
      "Wer übernimmt die Kosten der Behandlung?": "Eine andere Person oder Organisation",
      "Wer ist der Zahler?": "Unternehmen",
      "Name des Unternehmens": "Beispiel GmbH",
      "Beziehung zur Patientin / zum Patienten": "Arbeitgeber",
      "Sitz (Straße und Hausnummer)": "Musterstraße 1",
      Ort: "München",
      "Land des Sitzes": "Deutschland",
      // The consent not given yet is left to the missing list.
      "Handeln Sie im eigenen wirtschaftlichen Interesse?": "Ja",
    });
    // The organisation mask (trigger flow): legal form, register number, contact person.
    const masked = request({
      payer: {
        ...company.payer!,
        organisation_legal_form: "GmbH",
        organisation_register_number: "HRB 12345",
        organisation_contact_name: "Ben Muster",
      },
    });
    expect(rows(requestSummary(masked, de, "de"), "payer")).toMatchObject({
      Rechtsform: "GmbH",
      "Registernummer (falls vorhanden)": "HRB 12345",
      Ansprechperson: "Ben Muster",
    });
    const insurer = request({
      payer: { ...company.payer!, payer_type: "insurance", relationship_kind: "other", relationship: " Auslandskrankenversicherung " },
    });
    expect(rows(requestSummary(insurer, leadRequestText("en"), "en"), "payer")).toMatchObject({
      "Who is the payer?": "Insurer",
      "Name of the insurer": "Beispiel GmbH",
      // "Other" is shown in the person's own words.
      "Relationship to the patient": "Auslandskrankenversicherung",
      "Country of the registered office": "Germany",
    });
    // "Other" without the words yet, and a text stored before the list existed.
    const other = request({ payer: { ...request().payer!, relationship_kind: "other", relationship: null } });
    expect(rows(requestSummary(other, de, "de"), "payer")["Beziehung zur Patientin / zum Patienten"]).toBe("Sonstige");
    const before = request({ payer: { ...request().payer!, relationship_kind: null, relationship: "Vater" } });
    expect(rows(requestSummary(before, de, "de"), "payer")["Beziehung zur Patientin / zum Patienten"]).toBe("Vater");
  });

  it("shows a parent's own answer 'I pay' as it was given", () => {
    const parent = request({
      access_kind: "guardian",
      payer_self_template: { first_name: "Maria", last_name: "Muster", date_of_birth: null, email: null, phone: null },
      payer: { ...request().payer!, first_name: "Maria", last_name: "Muster" },
    });
    expect(rows(requestSummary(parent, de, "de"), "payer")).toMatchObject({
      "Wer übernimmt die Kosten der Behandlung?": "Ich zahle (als Elternteil)",
      "Wer ist der Zahler?": "Privatperson",
      Vorname: "Maria",
      "Beziehung zur Patientin / zum Patienten": "Elternteil",
    });
    // Another name is another person; so is the same name in a request of one's own.
    const other = request({ ...parent, payer: { ...parent.payer!, first_name: "Viktor" } });
    expect(rows(requestSummary(other, de, "de"), "payer")["Wer übernimmt die Kosten der Behandlung?"]).toBe(
      "Eine andere Person oder Organisation",
    );
    expect(
      rows(requestSummary(request({ ...parent, access_kind: "self" }), de, "de"), "payer")[
        "Wer übernimmt die Kosten der Behandlung?"
      ],
    ).toBe("Eine andere Person oder Organisation");
  });

  it("shows only what the lead named once the payer answered on the own link, with the note why", () => {
    // What the server sends then (BE2): the name, the type, the relationship and the consent; the rest is null.
    const answered = request({
      payer: {
        ...request().payer!,
        date_of_birth: null,
        city: null,
        country: null,
        citizenships: [],
        answered_by_payer: true,
      },
    });
    expect(payerAnsweredByPayer(answered)).toBe(true);
    const expected = {
      "Wer übernimmt die Kosten der Behandlung?": "Eine andere Person oder Organisation",
      "Wer ist der Zahler?": "Privatperson",
      Vorname: "Viktor",
      Nachname: "Zahler",
      "Beziehung zur Patientin / zum Patienten": "Elternteil",
      "Einverständnis zur Kontaktaufnahme": "Zugestimmt am 05.10.2026 11:25",
      "Handeln Sie im eigenen wirtschaftlichen Interesse?": "Nein",
      "In wessen Interesse handeln Sie? (Name, Geburtsdatum, Geburtsort, Anschrift)": "Viktor Zahler, 03.02.1960, Kyiv",
    };
    expect(Object.fromEntries(answeredPayerRows(answered, de).map((row) => [row.label, row.value]))).toEqual(expected);
    const groups = requestSummary(answered, de, "de");
    expect(rows(groups, "payer")).toEqual(expected);
    expect(groups.find((group) => group.id === "payer")?.note).toBe(
      "Die zahlende Person hat ihre Angaben selbst gemacht. Änderungen nur über GMED.",
    );
    // Even a value the server still sent is not shown: the block names what the lead named.
    const leftover = request({ payer: { ...request().payer!, answered_by_payer: true } });
    expect(rows(requestSummary(leftover, de, "de"), "payer")).not.toHaveProperty("Geburtsdatum");
    // Not answered yet, or an older server without the key: the summary as before, without a note.
    for (const payer of [{ ...request().payer!, answered_by_payer: false }, request().payer!]) {
      const open = requestSummary(request({ payer }), de, "de").find((group) => group.id === "payer");
      expect(payerAnsweredByPayer(request({ payer }))).toBe(false);
      expect(open?.note).toBeUndefined();
      expect(Object.fromEntries(open!.rows.map((row) => [row.label, row.value]))).toMatchObject({ Geburtsdatum: "03.02.1960" });
    }
  });

  it("lists the consent to pass the cost estimate on once given, also after the payer answered", () => {
    const label = "Einwilligung zur Weitergabe des Kostenvoranschlags";
    const given = request({ payer: { ...request().payer!, cost_estimate_consent_at: "2026-10-06T08:30:00Z" } });
    const payerRows = rows(requestSummary(given, de, "de"), "payer");
    expect(payerRows[label]).toBe("Zugestimmt am 06.10.2026 10:30");
    const order = Object.keys(payerRows);
    expect(order.indexOf(label)).toBe(order.indexOf("Einverständnis zur Kontaktaufnahme") + 1);
    // Not given yet, or an older server: no row (the list of what is missing names it).
    for (const payer of [{ ...request().payer!, cost_estimate_consent_at: null }, request().payer!]) {
      expect(rows(requestSummary(request({ payer }), de, "de"), "payer")).not.toHaveProperty(label);
    }
    // After the payer answered: among what the lead named, in the block and in the summary.
    const answered = request({ payer: { ...given.payer!, answered_by_payer: true } });
    expect(Object.fromEntries(answeredPayerRows(answered, de).map((row) => [row.label, row.value]))).toMatchObject({
      [label]: "Zugestimmt am 06.10.2026 10:30",
    });
    expect(rows(requestSummary(answered, leadRequestText("en"), "en"), "payer")["Consent to pass on the cost estimate"]).toBe(
      "Agreed on 06.10.2026 10:30",
    );
  });

  it("shows a payer of a server without the payer type as before", () => {
    // Only the keys such a server sends: the relationship is a text, there is no type and no consent.
    const older = request({
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
    });
    expect(rows(requestSummary(older, de, "de"), "payer")).toEqual({
      "Wer übernimmt die Kosten der Behandlung?": "Eine andere Person oder Organisation",
      Vorname: "Viktor",
      Nachname: "Zahler",
      Geburtsdatum: "03.02.1960",
      "Staatsangehörigkeit(en)": "Ukraine",
      "Beziehung zur Patientin / zum Patienten": "Vater",
      Ort: "München",
      Wohnsitzland: "Deutschland",
      "Handeln Sie im eigenen wirtschaftlichen Interesse?": "Nein",
      "In wessen Interesse handeln Sie? (Name, Geburtsdatum, Geburtsort, Anschrift)": "Viktor Zahler, 03.02.1960, Kyiv",
    });
  });

  it("speaks of the patient when a parent fills in the request of a child", () => {
    const groups = requestSummary(request({ access_kind: "guardian" }), de, "de");
    expect(rows(groups, "payer")).toMatchObject({
      "Wer übernimmt die Kosten der Behandlung?": "Eine andere Person oder Organisation",
      "Handelt die Patientin / der Patient im eigenen wirtschaftlichen Interesse?": "Nein",
    });
    expect(Object.keys(rows(groups, "legal"))).toContain(de.identificationFieldsGuardian.pep_self);
    expect(requestSummary(request(), leadRequestText("en"), "en").find((group) => group.id === "legal")?.rows).toContainEqual({
      label: "Is an immediate family member or a person close to you politically exposed?",
      value: "Yes",
    });
  });

  it("shows the answers of the open follow-up blocks and the reason of the request", () => {
    const base = request();
    const followUp = request({
      submitted_at: "2026-10-07T09:30:00Z",
      payer: { ...base.payer!, payer_kind: "self" },
      identification: {
        ...base.identification!,
        relationship_since: "2010",
        residence_since: "2015",
        stay_reason: "work",
        former_citizenships: ["RU"],
        pep_office: "Bürgermeister",
        pep_country: "UA",
        request_reason: "Zweitmeinung zur Knie-OP",
      },
      follow_up: {
        required: true,
        blocks: ["A", "F", "H", "D"],
        missing: {},
        answered_at: null,
        answers: {
          funds_source: "income",
          funds_description: "Gehalt",
          occupation: "Ingenieurin",
          sector: "Maschinenbau",
          payer_funds_source: null,
          payer_funds_description: null,
        },
        funds_proof_documents: [upload("proof-1", "kontoauszug.pdf")],
      },
    });
    const groups = requestSummary(followUp, de, "de");
    expect(groups.map((group) => group.id).slice(-3)).toEqual(["follow_up", "request", "documents"]);
    expect(groups.find((group) => group.id === "follow_up")?.title).toBe("Ergänzende Angaben");
    // Only the blocks the server opened (D is the payer link's); never why.
    expect(rows(groups, "follow_up")).toEqual({
      "Herkunft der Mittel": "Einkommen",
      "Bitte beschreiben Sie die Herkunft der Mittel": "Gehalt",
      "Ihr Beruf": "Ingenieurin",
      "Branche / Sektor Ihrer Tätigkeit": "Maschinenbau",
      "Nachweise zur Herkunft der Mittel": "kontoauszug.pdf",
      "Seit wann wohnen Sie in Ihrem Wohnsitzland?": "2015",
      "Grund des Aufenthalts im Wohnsitzland": "Arbeit",
      "Frühere Staatsangehörigkeiten": "Russland",
      "Amt bzw. Funktion": "Bürgermeister",
      Land: "Ukraine",
    });
    expect(rows(groups, "request")).toEqual({ "Grund der Anfrage": "Zweitmeinung zur Knie-OP" });
    // Without open blocks nothing of the follow-up is listed.
    expect(requestSummary(request(), de, "de").map((group) => group.id)).not.toContain("follow_up");
    // Only K and L open (listed under the person and the declarations): no empty group.
    const kAndL = request({
      follow_up: { required: true, blocks: ["K", "L"], missing: {}, answered_at: null },
    });
    expect(requestSummary(kAndL, de, "de").map((group) => group.id)).not.toContain("follow_up");
  });

  it("shows who acts for an adult after the identity document: the answers, then each person with the files", () => {
    const agent: LeadRequestRepresentative = {
      id: "11111111-1111-4111-8111-111111111111",
      slot: "agent",
      role: "authorised_representative",
      relation: "representative",
      mine: false,
      email_locked: false,
      can_remove: true,
      first_name: "Ben",
      last_name: "Muster",
      date_of_birth: "1980-01-15",
      birth_place: null,
      // Not asked of an adult's representative: not shown either.
      birth_country: "DE",
      citizenships: ["DE"],
      street: "Musterstraße 2",
      zip: "10115",
      city: "Berlin",
      country: "DE",
      email: null,
      phone: null,
      identity_documents: [upload("rep-id-1", "ausweis-ben.jpg")],
      authority_documents: [upload("rep-auth-1", "vollmacht.pdf")],
    };
    const groups = requestSummary(
      request({
        representation: {
          has_representative: true,
          under_guardianship: false,
          custody: null,
          custody_stated: false,
          representatives: [agent],
        },
      }),
      de,
      "de",
    );
    expect(groups.map((group) => group.id).slice(3, 6)).toEqual(["identity", "representation", "insurance"]);
    const group = groups.find((item) => item.id === "representation");
    expect(group?.title).toBe("Vertretung");
    expect(rows(groups, "representation")).toEqual({
      "Handelt jemand für Sie (Vertreter/in, Bote/Botin, bevollmächtigte Person)?": "Ja",
      "Stehen Sie unter rechtlicher Betreuung?": "Nein",
    });
    expect(group?.parts?.map((part) => [part.id, part.title])).toEqual([["agent", "Angaben zur vertretenden Person"]]);
    expect(Object.fromEntries((group?.parts?.[0].rows ?? []).map((row) => [row.label, row.value]))).toEqual({
      Vorname: "Ben",
      Nachname: "Muster",
      Geburtsdatum: "15.01.1980",
      "Staatsangehörigkeit(en)": "Deutschland",
      "Straße und Hausnummer": "Musterstraße 2",
      Postleitzahl: "10115",
      Ort: "Berlin",
      Wohnsitzland: "Deutschland",
      "Foto oder Scan des Ausweises": "ausweis-ben.jpg",
      "Nachweis der Vertretungsmacht (z. B. Vollmacht)": "vollmacht.pdf",
    });

    // Not answered yet: the group says so, and names nobody.
    const open = requestSummary(
      request({
        representation: {
          has_representative: null,
          under_guardianship: null,
          custody: null,
          custody_stated: false,
          representatives: [],
        },
      }),
      de,
      "de",
    ).find((item) => item.id === "representation");
    expect(open?.rows).toEqual([]);
    expect(open?.parts).toEqual([]);
    expect(open?.empty).toBe("Noch keine Angaben");
  });

  it("shows the custody and the legal representatives of a minor", () => {
    const parent = (overrides: Partial<LeadRequestRepresentative>): LeadRequestRepresentative => ({
      id: "11111111-1111-4111-8111-111111111111",
      slot: "rep1",
      role: "legal_representative",
      relation: "parent",
      mine: true,
      email_locked: true,
      can_remove: false,
      first_name: "Anna",
      last_name: "Muster",
      date_of_birth: "1985-03-02",
      birth_place: "Kyiv",
      birth_country: "UA",
      citizenships: ["UA"],
      street: null,
      zip: null,
      city: null,
      country: null,
      email: "anna.muster@example.com",
      phone: null,
      identity_documents: [],
      authority_documents: [upload("rep-auth-2", "urkunde.pdf")],
      ...overrides,
    });
    const minor = (custody: "joint" | "guardian") =>
      requestSummary(
        request({
          access_kind: "guardian",
          minor: true,
          representation: {
            has_representative: null,
            under_guardianship: null,
            custody,
            custody_stated: custody !== "joint",
            representatives: [
              parent({}),
              parent({ id: "22222222-2222-4222-8222-222222222222", slot: custody === "joint" ? "rep2" : null, mine: false, first_name: "Ben", email: null, authority_documents: [] }),
            ],
          },
        }),
        de,
        "de",
      ).find((item) => item.id === "representation");

    const joint = minor("joint");
    expect(joint?.title).toBe("Gesetzliche Vertreter");
    expect(joint?.rows).toEqual([{ label: "Wer vertritt das Kind?", value: "Beide Eltern gemeinsam" }]);
    expect(joint?.parts?.map((part) => part.title)).toEqual(["1. Vertreter/in – Sie", "2. Vertreter/in – anderer Elternteil"]);
    // Parents with joint custody show no proof: a file from an earlier answer is not listed.
    expect(joint?.parts?.[0].rows).toEqual([
      { label: "Vorname", value: "Anna" },
      { label: "Nachname", value: "Muster" },
      { label: "Geburtsdatum", value: "02.03.1985" },
      { label: "Geburtsort", value: "Kyiv" },
      { label: "Geburtsland", value: "Ukraine" },
      { label: "Staatsangehörigkeit(en)", value: "Ukraine" },
      { label: "E-Mail", value: "anna.muster@example.com" },
    ]);

    // A guardian shows the certificate of appointment; a person on file without a place in the form is not the lead's statement.
    const guardian = minor("guardian");
    expect(guardian?.rows).toEqual([{ label: "Wer vertritt das Kind?", value: "Vormund oder Pfleger" }]);
    expect(guardian?.parts?.map((part) => part.id)).toEqual(["rep1"]);
    expect(guardian?.parts?.[0].rows.at(-1)).toEqual({ label: "Bestallungsurkunde", value: "urkunde.pdf" });
  });

  it("shows invoice and payment after the payer: the recipient, and the route when it is asked", () => {
    const billing = (overrides: Partial<LeadRequestBilling> = {}): LeadRequestBilling => ({
      invoice_to: "other",
      invoice_name: "Beispiel GmbH",
      invoice_street: "Musterstraße 2",
      invoice_zip: "10115",
      invoice_city: "Berlin",
      invoice_country: "DE",
      invoice_email: "rechnung@example.com",
      payer_declared: true,
      payment_route_by: "patient",
      payment_method: "bank_transfer",
      payment_method_details: "stale",
      account_country: "DE",
      account_holder: "Anna Muster",
      bank_name: "Musterbank",
      via_third_party: true,
      via_third_party_details: "Mein Bruder zahlt über PayPal.",
      account_holder_suggestion: "Anna Muster",
      ...overrides,
    });
    const groups = requestSummary(request({ billing: billing() }), de, "de");
    expect(groups.map((group) => group.id).slice(5, 8)).toEqual(["payer", "billing", "legal"]);
    expect(groups.find((group) => group.id === "billing")?.title).toBe("Rechnung und Zahlung");
    expect(rows(groups, "billing")).toEqual({
      "Wohin soll die Rechnung gehen?": "An eine andere Adresse",
      "Name auf der Rechnung": "Beispiel GmbH",
      "Straße und Hausnummer": "Musterstraße 2",
      PLZ: "10115",
      Ort: "Berlin",
      Land: "Deutschland",
      "E-Mail für Rechnungen (optional)": "rechnung@example.com",
      "Wie werden Sie bezahlen?": "Überweisung",
      "Land des Kontos": "Deutschland",
      "Kontoinhaber/in": "Anna Muster",
      "Name der Bank": "Musterbank",
      "Erfolgt die Zahlung über eine dritte Person oder einen Zahlungsdienstleister?": "Ja",
      "Bitte beschreiben (wer, welcher Dienst)": "Mein Bruder zahlt über PayPal.",
    });

    // "To me" names no address; cash has no account; a "no" has no details.
    const self = requestSummary(
      request({ billing: billing({ invoice_to: "self", payment_method: "cash", via_third_party: false }) }),
      de,
      "de",
    );
    expect(rows(self, "billing")).toEqual({
      "Wohin soll die Rechnung gehen?": "An mich",
      "E-Mail für Rechnungen (optional)": "rechnung@example.com",
      "Wie werden Sie bezahlen?": "Bar",
      "Erfolgt die Zahlung über eine dritte Person oder einen Zahlungsdienstleister?": "Nein",
    });
    // "Other" shows its details.
    expect(rows(requestSummary(request({ billing: billing({ payment_method: "other", payment_method_details: "Scheck" }) }), de, "de"), "billing")).toMatchObject({
      "Wie werden Sie bezahlen?": "Sonstiges",
      "Bitte beschreiben": "Scheck",
    });

    // To the payer: no e-mail; the payer answers the route, which the summary says in one row.
    const payer = requestSummary(
      request({ billing: billing({ invoice_to: "payer", payment_route_by: "payer", payment_method: null, via_third_party: null }) }),
      de,
      "de",
    );
    expect(rows(payer, "billing")).toEqual({
      "Wohin soll die Rechnung gehen?": "An die zahlende Person / Organisation",
      Zahlungsweg: "gibt die zahlende Person an",
    });
    // A paying parent reads "to me (I pay)"; a parent reads "to me" as "to the patient".
    const parent = requestSummary(
      request({ access_kind: "guardian", billing: billing({ invoice_to: "payer", payment_route_by: "guardian" }) }),
      de,
      "de",
    );
    expect(rows(parent, "billing")["Wohin soll die Rechnung gehen?"]).toBe("An mich (ich zahle)");
    expect(
      rows(requestSummary(request({ access_kind: "guardian", billing: billing({ invoice_to: "self" }) }), de, "de"), "billing")[
        "Wohin soll die Rechnung gehen?"
      ],
    ).toBe("An die Patientin / den Patienten (bei Minderjährigen an die gesetzlichen Vertreter)");
    expect(rows(requestSummary(request({ billing: billing({ invoice_to: "other" }) }), leadRequestText("en"), "en"), "billing")).toMatchObject({
      "Where should the invoice go?": "To another address",
      Country: "Germany",
      "How will you pay?": "Bank transfer",
    });

    // Nothing answered yet: the group says so.
    const open = requestSummary(
      request({
        billing: billing({
          invoice_to: null,
          invoice_name: null,
          invoice_street: null,
          invoice_zip: null,
          invoice_city: null,
          invoice_country: null,
          invoice_email: null,
          payment_method: null,
          account_country: null,
          account_holder: null,
          bank_name: null,
          via_third_party: null,
          via_third_party_details: null,
        }),
      }),
      de,
      "de",
    ).find((group) => group.id === "billing");
    expect(open?.rows).toEqual([]);
    expect(open?.empty).toBe("Noch keine Angaben");
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
