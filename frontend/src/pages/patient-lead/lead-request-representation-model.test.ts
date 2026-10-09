import { describe, expect, it } from "vitest";

import type { LeadRequestRepresentation, LeadRequestRepresentative } from "./lead-request-api";
import { SUBMIT_FIELDS, missingForSubmit } from "./lead-request-model";
import {
  BASE_REPRESENTATIVE_FIELDS,
  REPRESENTATION_SUBMIT_FIELDS,
  REPRESENTATIVE_FIELDS,
  ROLE_OF_SLOT,
  asksRepresentativeField,
  authorityProofOf,
  draftFromRepresentation,
  draftFromRepresentative,
  hasChildAddress,
  hasRepresentativeEntries,
  newRepresentativeId,
  refusedRepresentativeField,
  removedByAnswers,
  representationPatch,
  representativeInSlot,
  representativeName,
  representativePatch,
  representativeSubmitPart,
  representativesOnFile,
  requiresRepresentativeField,
  shownSlots,
  stillRejectedRepresentative,
  withChildAddress,
  withRejectedRepresentative,
} from "./lead-request-representation-model";
import {
  LEAD_CABINET_LANGS,
  leadRequestText,
  representativeHeading,
  representativeOnFileNote,
  representativeUploadLabel,
  submitFieldLabel,
} from "./lead-request-text";

const de = leadRequestText("de");

function person(overrides: Partial<LeadRequestRepresentative> = {}): LeadRequestRepresentative {
  return {
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
    birth_place: null,
    birth_country: null,
    citizenships: [],
    street: null,
    zip: null,
    city: null,
    country: null,
    email: "anna.muster@example.com",
    phone: null,
    identity_documents: [],
    authority_documents: [],
    ...overrides,
  };
}

function representation(overrides: Partial<LeadRequestRepresentation> = {}): LeadRequestRepresentation {
  return {
    has_representative: null,
    under_guardianship: null,
    custody: null,
    custody_stated: false,
    representatives: [],
    ...overrides,
  };
}

const ben = person({
  id: "22222222-2222-4222-8222-222222222222",
  slot: "rep2",
  mine: false,
  email_locked: false,
  can_remove: true,
  first_name: "Ben",
  email: "ben.muster@example.com",
});

describe("who the form asks for", () => {
  it("names one person per 'yes' of an adult", () => {
    const answers = draftFromRepresentation(representation());
    expect(answers).toEqual({ has_representative: "", under_guardianship: "", custody: "joint" });
    expect(shownSlots(false, answers)).toEqual([]);
    expect(shownSlots(false, { ...answers, has_representative: "no", under_guardianship: "no" })).toEqual([]);
    expect(shownSlots(false, { ...answers, has_representative: "yes" })).toEqual(["agent"]);
    expect(shownSlots(false, { ...answers, has_representative: "yes", under_guardianship: "yes" })).toEqual([
      "agent",
      "guardian",
    ]);
    expect(
      draftFromRepresentation(representation({ has_representative: true, under_guardianship: false })),
    ).toMatchObject({ has_representative: "yes", under_guardianship: "no" });
  });

  it("asks for both parents of a minor unless one person has custody alone", () => {
    // Not stated counts as joint custody.
    const answers = draftFromRepresentation(representation({ custody: "joint" }));
    expect(shownSlots(true, answers)).toEqual(["rep1", "rep2"]);
    expect(shownSlots(true, { ...answers, custody: "sole_parent" })).toEqual(["rep1"]);
    expect(shownSlots(true, { ...answers, custody: "guardian" })).toEqual(["rep1"]);
    // The answers of an adult play no part for a minor, and the other way round.
    expect(shownSlots(true, { ...answers, has_representative: "yes" })).toEqual(["rep1", "rep2"]);
    expect(shownSlots(false, { ...answers, custody: "joint" })).toEqual([]);
  });

  it("captions each person, and says who the parent at the form and the other parent are", () => {
    expect(de.representativeCaptions).toEqual({
      rep1: "1. Vertreter/in",
      rep2: "2. Vertreter/in",
      agent: "Angaben zur vertretenden Person",
      guardian: "Betreuer/in",
    });
    expect(representativeHeading(de, "rep1", true)).toBe("1. Vertreter/in – Sie");
    expect(representativeHeading(de, "rep1")).toBe("1. Vertreter/in");
    expect(representativeHeading(de, "rep2")).toBe("2. Vertreter/in – anderer Elternteil");
    expect(representativeHeading(de, "agent")).toBe("Angaben zur vertretenden Person");
    expect(representativeHeading(de, "guardian")).toBe("Betreuer/in");
    expect(representativeHeading(leadRequestText("en"), "rep1", true)).toBe("1st representative – you");
    for (const option of LEAD_CABINET_LANGS) {
      const text = leadRequestText(option.value);
      expect(new Set(Object.values(text.representativeCaptions)).size).toBe(4);
    }
  });

  it("names a guardian of a child as such, and the further person on file by custody", () => {
    expect(representativeHeading(de, "rep1", true, "guardian")).toBe("Vormund / Pfleger/in – Sie");
    expect(representativeHeading(de, "rep1", false, "guardian")).toBe("Vormund / Pfleger/in");
    // Parents keep their captions.
    expect(representativeHeading(de, "rep1", true, "joint")).toBe("1. Vertreter/in – Sie");
    expect(representativeHeading(de, "rep1", true, "sole_parent")).toBe("1. Vertreter/in – Sie");
    expect(representativeHeading(leadRequestText("en"), "rep1", true, "guardian")).toBe("Guardian / custodian – you");
    expect(representativeHeading(leadRequestText("uk"), "rep1", true, "guardian")).toBe("Опікун / піклувальник – ви");
    expect(representativeHeading(leadRequestText("ru"), "rep1", true, "guardian")).toBe("Опекун / попечитель – вы");
    expect(representativeOnFileNote(de, "Ben Muster", "guardian")).toBe(
      "Bei GMED ist eine weitere Person mit Sorgerecht hinterlegt: Ben Muster. Bitte sprechen Sie uns an.",
    );
    expect(representativeOnFileNote(de, "Ben Muster", "sole_parent")).toBe(
      "Bei GMED ist eine weitere sorgeberechtigte Person hinterlegt: Ben Muster. Bitte sprechen Sie uns an.",
    );
    for (const option of LEAD_CABINET_LANGS) {
      expect(representativeOnFileNote(leadRequestText(option.value), "Ben", "guardian")).toContain("Ben");
    }
  });

  it("finds the person of a place in the form, and those on file without one", () => {
    const onFile = person({ id: "33333333-3333-4333-8333-333333333333", slot: null, mine: false, first_name: "Mia" });
    const stored = representation({ custody: "sole_parent", custody_stated: true, representatives: [person(), onFile] });
    expect(representativeInSlot(stored, "rep1")?.first_name).toBe("Anna");
    expect(representativeInSlot(stored, "rep2")).toBeNull();
    expect(representativeInSlot(undefined, "agent")).toBeNull();
    expect(representativesOnFile(stored).map(representativeName)).toEqual(["Mia Muster"]);
    expect(representativeName({ first_name: null, last_name: " Muster " })).toBe("Muster");
    expect(representativeName({ first_name: null, last_name: null })).toBe("");
  });

  it("creates a person with the role of the place in the form", () => {
    expect(ROLE_OF_SLOT).toEqual({
      agent: "authorised_representative",
      guardian: "legal_guardian",
      rep1: "legal_representative",
      rep2: "legal_representative",
    });
  });
});

describe("what a change of the answers removes", () => {
  it("removes the removable second representative when custody is no longer joint", () => {
    const stored = representation({ custody: "joint", representatives: [person(), ben] });
    expect(removedByAnswers(stored, true, { ...draftFromRepresentation(stored), custody: "sole_parent" })).toEqual([ben]);
    expect(removedByAnswers(stored, true, { ...draftFromRepresentation(stored), custody: "guardian" })).toEqual([ben]);
    // Nothing changes, nothing goes.
    expect(removedByAnswers(stored, true, draftFromRepresentation(stored))).toEqual([]);
  });

  it("keeps the first representative and a second parent staff entered", () => {
    const staffEntered = { ...ben, can_remove: false };
    const stored = representation({ custody: "joint", representatives: [{ ...person(), can_remove: true }, staffEntered] });
    expect(removedByAnswers(stored, true, { ...draftFromRepresentation(stored), custody: "sole_parent" })).toEqual([]);
  });

  it("removes nobody on the way back to joint custody", () => {
    const stored = representation({ custody: "sole_parent", custody_stated: true, representatives: [person()] });
    expect(removedByAnswers(stored, true, { ...draftFromRepresentation(stored), custody: "joint" })).toEqual([]);
  });

  it("removes the person of an adult's answer that is no longer 'yes'", () => {
    const agent = person({ slot: "agent", role: "authorised_representative", mine: false, first_name: "Ben" });
    const guardian = person({ id: "44444444-4444-4444-8444-444444444444", slot: "guardian", role: "legal_guardian", first_name: "Mia" });
    const stored = representation({ has_representative: true, under_guardianship: true, representatives: [agent, guardian] });
    const answers = draftFromRepresentation(stored);
    expect(removedByAnswers(stored, false, answers)).toEqual([]);
    expect(removedByAnswers(stored, false, { ...answers, has_representative: "no" })).toEqual([agent]);
    // Taking an answer back removes the person as well.
    expect(removedByAnswers(stored, false, { ...answers, under_guardianship: "" })).toEqual([guardian]);
    expect(removedByAnswers(stored, false, { ...answers, has_representative: "no", under_guardianship: "no" })).toEqual([
      agent,
      guardian,
    ]);
  });
});

describe("the body of a save", () => {
  it("sends the changed answers that fit the lead's age", () => {
    const saved = draftFromRepresentation(representation());
    expect(representationPatch(saved, saved, false)).toEqual({});
    expect(representationPatch(saved, { ...saved, has_representative: "yes" }, false)).toEqual({ has_representative: true });
    expect(
      representationPatch(saved, { ...saved, has_representative: "no", under_guardianship: "no" }, false),
    ).toEqual({ has_representative: false, under_guardianship: false });
    // An answer taken back is sent as null.
    const answered = draftFromRepresentation(representation({ has_representative: true }));
    expect(representationPatch(answered, { ...answered, has_representative: "" }, false)).toEqual({ has_representative: null });
    // The custody is a minor's; the two questions are an adult's.
    expect(representationPatch(saved, { ...saved, custody: "guardian" }, false)).toEqual({});
    expect(representationPatch(saved, { ...saved, custody: "guardian" }, true)).toEqual({ custody: "guardian" });
    expect(representationPatch(saved, { ...saved, has_representative: "yes" }, true)).toEqual({});
  });

  it("creates a person with the first save once the last name is there", () => {
    const empty = draftFromRepresentative(null);
    expect(hasRepresentativeEntries(empty)).toBe(false);
    const typed = { ...empty, first_name: " Ben ", date_of_birth: "1984-07-09" };
    expect(hasRepresentativeEntries(typed)).toBe(true);
    // No last name, no person.
    expect(representativePatch(empty, typed, { create: "legal_representative" })).toBeNull();
    expect(
      representativePatch(empty, { ...typed, last_name: "Muster", citizenships: ["DE"] }, { create: "legal_representative" }),
    ).toEqual({
      role: "legal_representative",
      first_name: "Ben",
      last_name: "Muster",
      date_of_birth: "1984-07-09",
      citizenships: ["DE"],
    });
    // A refused last name is no last name.
    expect(
      representativePatch(empty, { ...typed, last_name: "Muster" }, { create: "legal_guardian", rejected: { last_name: "Muster" } }),
    ).toBeNull();
  });

  it("patches a known person with the changed keys only, trimmed, without the role", () => {
    const saved = draftFromRepresentative(person());
    expect(representativePatch(saved, saved)).toBeNull();
    expect(representativePatch(saved, { ...saved, street: " Musterstraße  1 ", zip: "10115" })).toEqual({
      street: "Musterstraße 1",
      zip: "10115",
    });
    // The identity document's data are staff's (trigger flow): the form has no such field.
    expect(Object.keys(saved).some((key) => key.startsWith("id_"))).toBe(false);
    // A cleared text is sent as an empty string; a person keeps the last name.
    expect(representativePatch(saved, { ...saved, first_name: "", last_name: " " })).toEqual({ first_name: "" });
    expect(representativePatch(saved, { ...saved, citizenships: ["UA", "DE"] })).toEqual({ citizenships: ["UA", "DE"] });
  });

  it("never sends a sign-in address and does not repeat a refused value", () => {
    const saved = draftFromRepresentative(person());
    const draft = { ...saved, email: "other@example.com", phone: "+49 30 1234567" };
    expect(representativePatch(saved, draft, { emailLocked: true })).toEqual({ phone: "+49 30 1234567" });
    expect(representativePatch(saved, draft)).toEqual({ email: "other@example.com", phone: "+49 30 1234567" });

    const rejected = withRejectedRepresentative({}, "email", draft);
    expect(rejected).toEqual({ email: "other@example.com" });
    expect(representativePatch(saved, draft, { rejected })).toEqual({ phone: "+49 30 1234567" });
    // Changed, the value may be sent again; the refusal of the old value is over.
    const changed = { ...draft, email: "ben.muster@example.com" };
    expect(stillRejectedRepresentative(rejected, draft)).toEqual(rejected);
    expect(stillRejectedRepresentative(rejected, changed)).toEqual({});
    expect(representativePatch(saved, changed, { rejected: stillRejectedRepresentative(rejected, changed) })).toMatchObject({
      email: "ben.muster@example.com",
    });
  });

  it("puts a refusal of the server at its field", () => {
    expect(refusedRepresentativeField("invalid_field", "date_of_birth")).toBe("date_of_birth");
    // Staff's identity document data are no field of the form.
    expect(refusedRepresentativeField("staff_only", "id_valid_until")).toBeNull();
    // The refusals of an e-mail need no field.
    expect(refusedRepresentativeField("representative_email_duplicate", undefined)).toBe("email");
    expect(refusedRepresentativeField("representative_email_is_login", undefined)).toBe("email");
    expect(refusedRepresentativeField("invalid_field", "rep2_zip")).toBe("zip");
    // What concerns the person as a whole has no field.
    expect(refusedRepresentativeField("representative_limit", undefined)).toBeNull();
    expect(refusedRepresentativeField("invalid_field", "role")).toBeNull();
    expect(refusedRepresentativeField("invalid_field", "rep1_id_upload")).toBeNull();
  });

  it("takes the child's address over", () => {
    const child = { street_address: "Musterstraße 1", zip_code: "10115", city: "Berlin", country: "DE" };
    const draft = { ...draftFromRepresentative(person()), street: "Alt", city: "Hamburg" };
    expect(withChildAddress(draft, child)).toMatchObject({
      street: "Musterstraße 1",
      zip: "10115",
      city: "Berlin",
      country: "DE",
      first_name: "Anna",
    });
    expect(hasChildAddress(child)).toBe(true);
    expect(hasChildAddress({ street_address: null, zip_code: " ", city: null, country: null })).toBe(false);
  });

  it("makes an id of its own for a new person", () => {
    const id = newRepresentativeId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newRepresentativeId()).not.toBe(id);
  });
});

describe("what is needed about a person", () => {
  it("asks an adult's person for less than a minor's representative", () => {
    expect(asksRepresentativeField("agent", "birth_country")).toBe(false);
    expect(asksRepresentativeField("guardian", "birth_place")).toBe(true);
    expect(asksRepresentativeField("rep1", "birth_country")).toBe(true);
    // Place of birth, citizenship and contact are asked of an adult's person, but not required.
    for (const field of ["birth_place", "citizenships", "email", "phone"] as const) {
      expect(requiresRepresentativeField("agent", field), field).toBe(false);
      expect(requiresRepresentativeField("rep2", field), field).toBe(true);
    }
    for (const slot of ["agent", "guardian", "rep1", "rep2"] as const) {
      expect(requiresRepresentativeField(slot, "last_name")).toBe(true);
      expect(requiresRepresentativeField(slot, "birth_country")).toBe(false);
    }
    // The first step asks a minor's parents for names and contacts only; the rest is block G.
    expect(BASE_REPRESENTATIVE_FIELDS).toEqual(["first_name", "last_name", "email", "phone"]);
  });

  it("asks for the proof of authority that fits the person", () => {
    expect(authorityProofOf("agent", null)).toEqual({ proof: "power_of_attorney", required: true });
    expect(authorityProofOf("guardian", null)).toEqual({ proof: "guardianship_certificate", required: true });
    expect(authorityProofOf("rep1", "guardian")).toEqual({ proof: "appointment_certificate", required: true });
    expect(authorityProofOf("rep1", "sole_parent")).toEqual({ proof: "sole_custody", required: false });
    // Parents with joint custody show no proof.
    expect(authorityProofOf("rep1", "joint")).toBeNull();
    expect(authorityProofOf("rep2", "joint")).toBeNull();
    expect(representativeUploadLabel(de, "agent", "authority")).toBe("Nachweis der Vertretungsmacht (z. B. Vollmacht)");
    expect(representativeUploadLabel(de, "guardian", "authority")).toBe("Bestellungsurkunde oder Betreuerausweis");
    expect(representativeUploadLabel(de, "guardian", "identity")).toBe("Ausweis der Betreuerin / des Betreuers");
    expect(representativeUploadLabel(de, "rep1", "authority", "guardian")).toBe("Bestallungsurkunde");
    expect(representativeUploadLabel(de, "rep1", "authority", "sole_parent")).toBe("Nachweis des alleinigen Sorgerechts");
    expect(representativeUploadLabel(de, "rep1", "identity")).toBe("Foto oder Scan des Ausweises");
  });
});

describe("what is missing about the representation", () => {
  const adult = [
    "first_name",
    "last_name",
    "date_of_birth",
    "street",
    "zip",
    "city",
    "country",
    "id_upload",
    "authority_upload",
  ];
  const parent = [
    "first_name",
    "last_name",
    "date_of_birth",
    "birth_place",
    "citizenships",
    "street",
    "zip",
    "city",
    "country",
    "email",
    "phone",
    "id_upload",
  ];

  it("knows every key of the contract, in the order of the form", () => {
    expect(REPRESENTATION_SUBMIT_FIELDS).toEqual([
      "has_representative",
      ...adult.map((part) => `agent_${part}`),
      "under_guardianship",
      ...adult.map((part) => `guardian_${part}`),
      ...parent.map((part) => `rep1_${part}`),
      "rep1_authority_upload",
      ...parent.map((part) => `rep2_${part}`),
    ]);
    // In the first step, after the person, before address and residence (trigger flow).
    const first = SUBMIT_FIELDS.indexOf("has_representative");
    expect(SUBMIT_FIELDS[first - 1]).toBe("citizenships");
    expect(SUBMIT_FIELDS[first + REPRESENTATION_SUBMIT_FIELDS.length]).toBe("street_address");
    expect(new Set(SUBMIT_FIELDS).size).toBe(SUBMIT_FIELDS.length);
  });

  it("reads a key as a person and a field or upload", () => {
    expect(representativeSubmitPart("rep1_first_name")).toEqual({ slot: "rep1", part: "first_name" });
    // Staff's identity document data are no part of a person in the form.
    expect(representativeSubmitPart("guardian_id_valid_until")).toBeNull();
    expect(representativeSubmitPart("agent_authority_upload")).toEqual({ slot: "agent", part: "authority_upload" });
    expect(representativeSubmitPart("rep2_id_upload")).toEqual({ slot: "rep2", part: "id_upload" });
    expect(representativeSubmitPart("payer_first_name")).toBeNull();
    expect(representativeSubmitPart("rep1_unknown")).toBeNull();
    expect(representativeSubmitPart("first_name")).toBeNull();
    for (const field of REPRESENTATIVE_FIELDS) {
      expect(representativeSubmitPart(`rep2_${field}`)).toEqual({ slot: "rep2", part: field });
    }
  });

  it("lists what is missing in form order, each field with the caption of its person", () => {
    const missing = missingForSubmit({
      progress: {
        filled: 0,
        total: 0,
        // As the server may send them: in any order, among the other keys.
        missing_for_submit: [
          "rep2_id_upload",
          "payer_kind",
          "rep2_last_name",
          "rep1_authority_upload",
          "rep1_citizenships",
          "id_document_upload",
          "rep2_email",
          "rep1_birth_place",
        ],
      },
    });
    expect(missing).toEqual([
      "rep1_birth_place",
      "rep1_citizenships",
      "rep1_authority_upload",
      "rep2_last_name",
      "rep2_email",
      "rep2_id_upload",
      "id_document_upload",
      "payer_kind",
    ]);
    expect(missing.map((field) => submitFieldLabel(de, field, true))).toEqual([
      "1. Vertreter/in: Geburtsort",
      "1. Vertreter/in: Staatsangehörigkeit(en)",
      "1. Vertreter/in: Bestallungsurkunde",
      "2. Vertreter/in: Nachname",
      "2. Vertreter/in: E-Mail",
      "2. Vertreter/in: Foto oder Scan des Ausweises",
      "Ausweisdokument: Foto oder Scan des Ausweises",
      "Wer übernimmt die Kosten der Behandlung?",
    ]);
  });

  it("names the answers and the persons of an adult", () => {
    const missing = missingForSubmit({
      progress: {
        filled: 0,
        total: 0,
        missing_for_submit: [
          "guardian_authority_upload",
          "guardian_id_upload",
          "under_guardianship",
          "agent_authority_upload",
          "agent_street",
          "has_representative",
        ],
      },
    });
    expect(missing.map((field) => submitFieldLabel(de, field))).toEqual([
      "Handelt jemand für Sie (Vertreter/in, Bote/Botin, bevollmächtigte Person)?",
      "Angaben zur vertretenden Person: Straße und Hausnummer",
      "Angaben zur vertretenden Person: Nachweis der Vertretungsmacht (z. B. Vollmacht)",
      "Stehen Sie unter rechtlicher Betreuung?",
      "Betreuer/in: Ausweis der Betreuerin / des Betreuers",
      "Betreuer/in: Bestellungsurkunde oder Betreuerausweis",
    ]);
    expect(submitFieldLabel(leadRequestText("en"), "agent_last_name")).toBe("Representative's details: Last name");
    expect(submitFieldLabel(leadRequestText("uk"), "rep2_phone")).toBe("2-й представник: Телефон");
    expect(submitFieldLabel(leadRequestText("ru"), "guardian_zip")).toBe("Опекун: Почтовый индекс");
  });
});
