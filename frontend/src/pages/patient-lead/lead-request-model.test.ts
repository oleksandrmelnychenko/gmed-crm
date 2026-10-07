import { describe, expect, it } from "vitest";

import type { LeadRequest, LeadRequestIdentification, LeadRequestPayer } from "./lead-request-api";
import {
  canSubmit,
  changedSinceSubmit,
  combinedSaveState,
  consentText,
  costEstimateConsentAsked,
  draftAnswer,
  draftFromIdentification,
  draftFromPayer,
  draftFromPersonalData,
  formatFileSize,
  identificationPatch,
  knowsPayerType,
  missingForSubmit,
  organisationPayerType,
  payerAnswer,
  payerInput,
  payerSelfOffered,
  payerTypeOf,
  payerContactRequired,
  personalDataPatch,
  rejectedValue,
  stillRejectedIdentification,
  withContactChannel,
  withInsuranceAnswer,
  withLegalAnswer,
  withPayerAnswer,
  withPayerType,
  withRejectedIdentification,
  withRelationshipKind,
} from "./lead-request-model";

const personal = {
  first_name: "Anna",
  middle_name: null,
  last_name: "Muster",
  date_of_birth: null,
  legal_sex: null,
  citizenships: ["UA"],
  street_address: null,
  zip_code: null,
  city: "Kyiv",
  country: null,
  phone: null,
  primary_language: null,
  has_insurance: null,
  insurance_type: null,
  insurance_provider: null,
  insurance_number: null,
  insurance_covers_germany: null,
};

function request(overrides: Partial<LeadRequest> = {}): LeadRequest {
  return {
    lead_id: "lead-1",
    access_kind: "self",
    created_at: "2026-10-03T08:00:00Z",
    personal_data: personal,
    progress: { filled: 4, total: 11, missing_for_submit: ["street_address", "date_of_birth"] },
    minor: false,
    documents: [],
    max_documents: 30,
    consents: {
      lead_inquiry_processing: {
        type: "lead_inquiry_processing",
        version: "2026-10-03",
        texts: { de: "Ich bin einverstanden …", ru: "Я согласен(на) …" },
        given_at: null,
      },
    },
    submitted_at: null,
    retention_deadline_at: "2026-10-17T08:00:00Z",
    ...overrides,
  };
}

describe("lead request autosave patch", () => {
  it("sends only the changed fields, trimmed", () => {
    const saved = draftFromPersonalData(personal);
    const draft = { ...saved, city: "  Lviv ", citizenships: ["UA", "DE"], phone: "" };
    expect(personalDataPatch(saved, draft)).toEqual({ city: "Lviv", citizenships: ["UA", "DE"] });
  });

  it("does not send empty names or a value the server refused", () => {
    const saved = draftFromPersonalData(personal);
    const draft = { ...saved, first_name: " ", date_of_birth: "2015-01-01" };
    const rejected = rejectedValue("date_of_birth", draft);
    expect(personalDataPatch(saved, draft, rejected)).toEqual({});
    expect(personalDataPatch(saved, { ...draft, date_of_birth: "1990-01-01" }, rejected)).toEqual({
      date_of_birth: "1990-01-01",
    });
    expect(rejectedValue("email", draft)).toBeNull();
  });

  it("clears an optional field with an empty string", () => {
    const saved = draftFromPersonalData(personal);
    expect(personalDataPatch(saved, { ...saved, city: "" })).toEqual({ city: "" });
  });
});

const identification: LeadRequestIdentification = {
  salutation: null,
  former_names: null,
  birth_place: "Kyiv",
  birth_country: "UA",
  habitual_residence_country: null,
  contact_channels: ["phone"],
  pep_self: null,
  pep_related: null,
  sanctions_links: null,
  payment_background: null,
  declared_correct_at: null,
};

describe("lead request identification autosave", () => {
  it("sends only the changed statements, trimmed", () => {
    const saved = draftFromIdentification(identification);
    const draft = {
      ...saved,
      birth_place: "  Lviv ",
      former_names: " Anna  Beispiel ",
      salutation: "ms",
    };
    expect(identificationPatch(saved, draft)).toEqual({
      salutation: "ms",
      former_names: "Anna Beispiel",
      birth_place: "Lviv",
    });
    expect(identificationPatch(saved, saved)).toEqual({});
    // A removed text, date or choice is cleared with an empty string.
    expect(identificationPatch(saved, { ...saved, birth_country: "", birth_place: " " })).toEqual({
      birth_place: "",
      birth_country: "",
    });
    // Nothing entered yet, and an older server without the statements: an empty form.
    expect(draftFromIdentification(undefined)).toMatchObject({ birth_place: "", contact_channels: [], pep_self: "" });
    expect(identificationPatch(draftFromIdentification(undefined), draftFromIdentification(null))).toEqual({});
    // The identity document's data are staff's (trigger flow): the form has no such field and never sends one.
    expect(Object.keys(draftFromIdentification(identification)).some((key) => key.startsWith("id_"))).toBe(false);
  });

  it("sends the legal answers as true, false or null, without details", () => {
    const saved = draftFromIdentification(identification);
    expect(identificationPatch(saved, withLegalAnswer(saved, "pep_self", "yes"))).toEqual({ pep_self: true });
    expect(identificationPatch(saved, withLegalAnswer(saved, "sanctions_links", "no"))).toEqual({ sanctions_links: false });
    const stored = draftFromIdentification({ ...identification, pep_related: true });
    expect(stored).toMatchObject({ pep_related: "yes" });
    expect(identificationPatch(stored, withLegalAnswer(stored, "pep_related", ""))).toEqual({ pep_related: null });
  });

  it("sends the follow-up statements: several lines stay, former citizenships as codes", () => {
    const saved = draftFromIdentification({ ...identification, former_citizenships: ["ru"], request_reason: null });
    expect(saved.former_citizenships).toEqual(["RU"]);
    const draft = {
      ...saved,
      former_citizenships: ["RU", "ua", "RU"],
      pep_wealth_origin: " Gehalt,\nErbschaft ",
      residence_since: " 2015 ",
      request_reason: " Zweitmeinung\nzur Knie-OP ",
      stay_reason: "work",
    };
    expect(identificationPatch(saved, draft)).toEqual({
      residence_since: "2015",
      former_citizenships: ["RU", "UA"],
      stay_reason: "work",
      pep_wealth_origin: "Gehalt,\nErbschaft",
      request_reason: "Zweitmeinung\nzur Knie-OP",
    });
  });

  it("keeps the contact channels a set in the order of the form", () => {
    const saved = draftFromIdentification(identification);
    const more = withContactChannel(withContactChannel(saved, "messenger", true), "email", true);
    expect(more.contact_channels).toEqual(["email", "phone", "messenger"]);
    expect(identificationPatch(saved, more)).toEqual({ contact_channels: ["email", "phone", "messenger"] });
    expect(withContactChannel(more, "phone", true).contact_channels).toEqual(["email", "phone", "messenger"]);
    expect(identificationPatch(saved, withContactChannel(saved, "phone", false))).toEqual({ contact_channels: [] });
    // The same channels in another order are no change.
    const stored = draftFromIdentification({ ...identification, contact_channels: ["messenger", "email", "email", "fax"] });
    expect(stored.contact_channels).toEqual(["email", "messenger"]);
  });

  it("does not repeat a value the server refused until the patient changes it", () => {
    const saved = draftFromIdentification(identification);
    const draft = { ...saved, residence_since: "x".repeat(61), birth_place: "Lviv" };
    const rejected = withRejectedIdentification({}, "residence_since", draft);
    expect(rejected).toEqual({ residence_since: "x".repeat(61) });
    // The refused value stays out; the rest of the patch still goes.
    expect(identificationPatch(saved, draft, rejected ?? {})).toEqual({ birth_place: "Lviv" });
    // A second refusal keeps the first.
    expect(withRejectedIdentification(rejected ?? {}, "birth_place", draft)).toEqual({
      residence_since: "x".repeat(61),
      birth_place: "Lviv",
    });
    // A changed value may be sent again.
    const corrected = { ...draft, residence_since: "2015" };
    expect(stillRejectedIdentification(rejected ?? {}, draft)).toEqual(rejected);
    expect(stillRejectedIdentification(rejected ?? {}, corrected)).toEqual({});
    expect(identificationPatch(saved, corrected, stillRejectedIdentification(rejected ?? {}, corrected))).toMatchObject({
      residence_since: "2015",
    });
    // A field the form does not know (also staff's `id_*`) is not the form's to hold back.
    expect(withRejectedIdentification({}, "declared_correct_at", draft)).toBeNull();
    expect(withRejectedIdentification({}, "id_valid_until", draft)).toBeNull();
  });
});

/** A third party as the server stores it once it is named: a person, nothing else stated yet. */
const storedPayer: LeadRequestPayer = {
  payer_kind: "third_party",
  first_name: null,
  last_name: null,
  date_of_birth: null,
  street: null,
  zip: null,
  city: null,
  country: null,
  citizenships: [],
  relationship: null,
  email: null,
  phone: null,
  payer_type: "person",
  organisation_name: null,
  relationship_kind: null,
  contact_consent_at: null,
};

describe("lead request send step", () => {
  it("lists the missing fields in form order and needs the request consent", () => {
    expect(missingForSubmit(request())).toEqual(["date_of_birth", "street_address"]);
    const complete = request({ progress: { filled: 9, total: 11, missing_for_submit: [] } });
    expect(canSubmit(complete, "lead_inquiry_processing")).toBe(false);
    const consented = request({
      progress: { filled: 9, total: 11, missing_for_submit: [] },
      consents: {
        lead_inquiry_processing: { ...request().consents.lead_inquiry_processing, given_at: "2026-10-03T09:00:00Z" },
      },
    });
    expect(canSubmit(consented, "lead_inquiry_processing")).toBe(true);
  });

  it("shows the consent text the server will store, in the portal language", () => {
    expect(consentText(request(), "lead_inquiry_processing", "ru")).toBe("Я согласен(на) …");
    expect(consentText(request(), "lead_inquiry_processing", "en")).toBe("Ich bin einverstanden …");
    expect(consentText(request(), "health_data_processing", "de")).toBe("");
  });

  it("keeps the insurance block consistent with the answer", () => {
    const insured = draftFromPersonalData({
      ...personal,
      has_insurance: true,
      insurance_type: "private",
      insurance_provider: "Allianz Care",
      insurance_number: "A-123",
      insurance_covers_germany: "not_sure",
    });
    expect(insured.has_insurance).toBe("yes");
    expect(draftFromPersonalData({ ...personal, has_insurance: false }).has_insurance).toBe("no");
    expect(draftFromPersonalData(personal).has_insurance).toBe("");

    // "No" is the self-payer: the details go, and only the difference is sent.
    const selfPayer = withInsuranceAnswer(insured, "no");
    expect(selfPayer).toMatchObject({
      has_insurance: "no",
      insurance_type: "self_pay",
      insurance_provider: "",
      insurance_number: "",
      insurance_covers_germany: "",
    });
    expect(personalDataPatch(insured, selfPayer)).toEqual({
      has_insurance: "no",
      insurance_type: "self_pay",
      insurance_provider: "",
      insurance_number: "",
      insurance_covers_germany: "",
    });
    // Back to "yes": an insured person is not the self-payer type.
    expect(withInsuranceAnswer(selfPayer, "yes")).toMatchObject({ has_insurance: "yes", insurance_type: "" });
    expect(withInsuranceAnswer(insured, "")).toMatchObject({ has_insurance: "", insurance_provider: "Allianz Care" });
  });

  it("offers to send again only after a change", () => {
    expect(changedSinceSubmit(request())).toBe(false);
    const sent = request({ submitted_at: "2026-10-03T09:30:00Z" });
    expect(changedSinceSubmit(sent)).toBe(false);
    expect(changedSinceSubmit({ ...sent, changed_since_submit: true })).toBe(true);
    expect(changedSinceSubmit({ ...sent, changed_since_submit: false })).toBe(false);
    // An older server does not say; a document uploaded afterwards still counts.
    const document = {
      id: "doc-1",
      file_name: "befund.pdf",
      size_bytes: 1,
      mime_type: "application/pdf",
      uploaded_by_me: true,
      reviewed: false,
      can_delete: true,
    };
    expect(changedSinceSubmit({ ...sent, documents: [{ ...document, uploaded_at: "2026-10-03T09:00:00Z" }] })).toBe(false);
    expect(changedSinceSubmit({ ...sent, documents: [{ ...document, uploaded_at: "2026-10-03T10:00:00Z" }] })).toBe(true);
  });

  it("sends who pays as a whole answer", () => {
    // Not answered yet: nothing to send.
    expect(payerInput(draftFromPayer(null))).toBeNull();
    expect(payerInput(draftFromPayer(undefined))).toBeNull();
    const other = {
      ...draftFromPayer(null),
      payer_kind: "third_party",
      first_name: "  Viktor ",
      last_name: "Zahler",
      citizenships: ["UA", "DE"],
      city: " München  Ost ",
    };
    // Trimmed, empty fields left out. A third party not said to be anything else is a
    // person, and the consent to contact the payer goes along, given or not.
    expect(payerInput(other)).toEqual({
      payer_kind: "third_party",
      payer_type: "person",
      first_name: "Viktor",
      last_name: "Zahler",
      city: "München Ost",
      // Always sent with a third party: an emptied number is cleared.
      messenger: "",
      citizenships: ["UA", "DE"],
      contact_consent: false,
    });
    // "I pay myself" carries no data of another person, whatever was typed before.
    expect(payerInput({ ...other, payer_kind: "self", contact_consent: true })).toEqual({ payer_kind: "self" });
    // What the server returned is the same answer again.
    const stored = draftFromPayer({
      ...storedPayer,
      first_name: "Viktor",
      last_name: "Zahler",
      city: "München Ost",
      citizenships: ["UA", "DE"],
    });
    expect(payerInput(stored)).toEqual(payerInput(other));
  });

  it("names a person with the relationship and the consent", () => {
    const person = draftFromPayer({
      ...storedPayer,
      first_name: "Viktor",
      last_name: "Zahler",
      date_of_birth: "1960-02-03",
      citizenships: ["UA"],
      relationship_kind: "parent",
      contact_consent_at: "2026-10-05T09:20:00Z",
    });
    expect(person).toMatchObject({ payer_type: "person", relationship_kind: "parent", contact_consent: true });
    expect(payerInput(person)).toEqual({
      payer_kind: "third_party",
      payer_type: "person",
      first_name: "Viktor",
      last_name: "Zahler",
      date_of_birth: "1960-02-03",
      citizenships: ["UA"],
      relationship_kind: "parent",
      messenger: "",
      contact_consent: true,
    });
    // A name of an organisation typed by mistake is not a person's.
    expect(payerInput({ ...person, organisation_name: "Beispiel GmbH" })).toEqual(payerInput(person));
    // The consent taken back is sent as such, so the server removes it.
    expect(payerInput({ ...person, contact_consent: false })).toMatchObject({ contact_consent: false });

    // "Other" says the relationship in words; any other kind carries no text.
    const other = withRelationshipKind(person, "other");
    expect(payerInput({ ...other, relationship: "  Nachbar " })).toMatchObject({
      relationship_kind: "other",
      relationship: "Nachbar",
    });
    expect(payerInput(other)).not.toHaveProperty("relationship");
    const friend = withRelationshipKind({ ...other, relationship: "Nachbar" }, "friend");
    expect(friend.relationship).toBe("");
    expect(payerInput(friend)).toMatchObject({ relationship_kind: "friend" });
    expect(payerInput(friend)).not.toHaveProperty("relationship");
    // No kind chosen: nothing of the relationship is sent.
    expect(payerInput(withRelationshipKind(friend, ""))).not.toHaveProperty("relationship_kind");

    // A text stored before the list existed stays until a kind is chosen, and shows with "other".
    const before = draftFromPayer({ ...storedPayer, relationship: "Vater" });
    expect(payerInput(before)).toMatchObject({ relationship: "Vater" });
    expect(payerInput(before)).not.toHaveProperty("relationship_kind");
    expect(withRelationshipKind(before, "other").relationship).toBe("Vater");
    expect(withRelationshipKind(before, "parent").relationship).toBe("");
  });

  it("names a company, organisation or insurer instead of a person", () => {
    const person = {
      ...draftFromPayer(null),
      payer_kind: "third_party",
      first_name: "Viktor",
      last_name: "Zahler",
      date_of_birth: "1960-02-03",
      citizenships: ["UA"],
      relationship_kind: "employer",
      street: "Musterstraße 1",
      country: "DE",
      email: "kontakt@example.com",
      contact_consent: true,
    };
    // The data of a natural person go with the answer, as on the server; seat and contact stay.
    // The consent was given for the person: for the company it is asked again.
    const company = withPayerType(person, "company");
    expect(company).toMatchObject({
      payer_type: "company",
      first_name: "",
      last_name: "",
      date_of_birth: "",
      citizenships: [],
      relationship_kind: "employer",
      street: "Musterstraße 1",
      country: "DE",
      email: "kontakt@example.com",
      contact_consent: false,
    });
    // The same answer again changes nothing; a third party not said to be anything else is a person.
    expect(withPayerType(person, "person")).toBe(person);
    expect(withPayerType(company, "company")).toBe(company);
    expect(payerInput({ ...company, organisation_name: "  Beispiel   GmbH " })).toEqual({
      payer_kind: "third_party",
      payer_type: "company",
      organisation_name: "Beispiel GmbH",
      relationship_kind: "employer",
      street: "Musterstraße 1",
      country: "DE",
      email: "kontakt@example.com",
      messenger: "",
      contact_consent: false,
    });
    // The organisation mask (trigger flow): legal form, register number and contact person, trimmed.
    const masked = {
      ...company,
      organisation_name: "Beispiel GmbH",
      organisation_legal_form: " GmbH ",
      organisation_register_number: "HRB  12345",
      organisation_contact_name: "Ben Muster",
    };
    expect(payerInput(masked)).toMatchObject({
      organisation_legal_form: "GmbH",
      organisation_register_number: "HRB 12345",
      organisation_contact_name: "Ben Muster",
    });
    // An older server without the payer type gets none of them.
    expect(payerInput(masked, false)).not.toHaveProperty("organisation_legal_form");
    // Back to a person: the whole mask goes, as on the server.
    expect(withPayerType(masked, "person")).toMatchObject({
      organisation_name: "",
      organisation_legal_form: "",
      organisation_register_number: "",
      organisation_contact_name: "",
    });
    expect(payerInput(withPayerType(masked, "person"))).not.toHaveProperty("organisation_contact_name");
    // An insurer is named the same way: the name stays.
    const insurer = withPayerType({ ...company, organisation_name: "Beispiel Versicherung AG" }, "insurance");
    expect(insurer.organisation_name).toBe("Beispiel Versicherung AG");
    expect(payerInput(insurer)).toMatchObject({ payer_type: "insurance", organisation_name: "Beispiel Versicherung AG" });
    // Back to a person: the name of the organisation goes.
    const again = withPayerType(insurer, "person");
    expect(again).toMatchObject({ payer_type: "person", organisation_name: "", first_name: "" });
    expect(payerInput(again)).not.toHaveProperty("organisation_name");

    // What the server stored for an organisation is the same answer again.
    const stored = draftFromPayer({
      ...storedPayer,
      payer_type: "organisation",
      organisation_name: "Beispiel Stiftung",
      country: "CH",
      relationship_kind: "other",
      relationship: "Stipendium",
      contact_consent_at: "2026-10-05T09:20:00Z",
    });
    expect(payerInput(stored)).toEqual({
      payer_kind: "third_party",
      payer_type: "organisation",
      organisation_name: "Beispiel Stiftung",
      relationship_kind: "other",
      relationship: "Stipendium",
      country: "CH",
      messenger: "",
      contact_consent: true,
    });
    expect(organisationPayerType("organisation")).toBe("organisation");
    expect(organisationPayerType("person")).toBeNull();
    expect(organisationPayerType(null)).toBeNull();
    expect(payerTypeOf({ payer_type: undefined })).toBe("person");
  });

  it("fills a parent's own data in for 'I pay (as a parent)'", () => {
    const template = {
      first_name: "Maria",
      last_name: "Muster",
      date_of_birth: "1985-04-12",
      email: "maria.muster@example.com",
      phone: null,
    };
    const empty = draftFromPayer(null, template);
    expect(draftAnswer(empty)).toBe("");
    const parent = withPayerAnswer({ ...empty, acts_on_own_account: "yes" }, "guardian", template);
    expect(draftAnswer(parent)).toBe("guardian");
    // Stored as a third party: a person, the patient's parent. The consent is still to give.
    expect(payerInput(parent)).toEqual({
      payer_kind: "third_party",
      payer_type: "person",
      first_name: "Maria",
      last_name: "Muster",
      date_of_birth: "1985-04-12",
      relationship_kind: "parent",
      email: "maria.muster@example.com",
      messenger: "",
      contact_consent: false,
      acts_on_own_account: true,
    });
    // The data stay editable, and the answer stays the parent's while the form is open.
    const edited = { ...parent, phone: "+49 30 7654321", citizenships: ["UA"], contact_consent: true };
    expect(draftAnswer(edited)).toBe("guardian");
    expect(payerInput(edited)).toMatchObject({ phone: "+49 30 7654321", citizenships: ["UA"], contact_consent: true });

    // "The patient" hides them; back at "I pay" they are there again, the consent is asked anew.
    const self = withPayerAnswer(edited, "self", template);
    expect(payerInput(self)).toEqual({ payer_kind: "self", acts_on_own_account: true });
    expect(withPayerAnswer(self, "guardian", template)).toMatchObject({
      payer_kind: "third_party",
      guardian_pays: true,
      phone: "+49 30 7654321",
      citizenships: ["UA"],
      contact_consent: false,
    });
    // Another person or organisation is somebody else: nothing of the parent stays.
    for (const from of [edited, self]) {
      const other = withPayerAnswer(from, "third_party", template);
      expect(draftAnswer(other)).toBe("third_party");
      expect(payerInput(other)).toEqual({
        payer_kind: "third_party",
        payer_type: "person",
        messenger: "",
        contact_consent: false,
        acts_on_own_account: true,
      });
    }
    // And the parent's answer replaces what was typed about another person.
    const viktor = { ...withPayerAnswer(empty, "third_party", template), first_name: "Viktor", street: "Musterstraße 1" };
    expect(withPayerAnswer(viktor, "guardian", template)).toMatchObject({ first_name: "Maria", street: "", guardian_pays: true });

    // The same answer again changes nothing; without the own data on file there is no third answer.
    expect(withPayerAnswer(edited, "guardian", template)).toBe(edited);
    expect(draftAnswer(withPayerAnswer(empty, "guardian", null))).toBe("third_party");
    // What was typed about another person stays while "I pay myself" hides it; the consent does not.
    const back = withPayerAnswer(withPayerAnswer({ ...viktor, contact_consent: true }, "self"), "third_party");
    expect(back).toMatchObject({ first_name: "Viktor", street: "Musterstraße 1", contact_consent: false });
  });

  it("takes a paying parent's citizenships and address from the representative data, and asks no consent", () => {
    const template = {
      first_name: "Anna",
      last_name: "Muster",
      date_of_birth: "1985-03-12",
      email: "anna.muster@example.com",
      phone: "+49 30 1234567",
      citizenships: ["DE", "AT"],
      street: "Musterweg 1",
      zip: "10115",
      city: "Berlin",
      country: "DE",
    };
    const parent = withPayerAnswer(draftFromPayer(null, template), "guardian", template);
    expect(parent).toMatchObject({
      guardian_pays: true,
      citizenships: ["DE", "AT"],
      street: "Musterweg 1",
      zip: "10115",
      city: "Berlin",
      country: "DE",
    });
    // The parent is the payer: the consent to contact the payer is left out, the server keeps what it has.
    const input = payerInput(parent, true, false);
    expect(input).toEqual({
      payer_kind: "third_party",
      payer_type: "person",
      first_name: "Anna",
      last_name: "Muster",
      date_of_birth: "1985-03-12",
      relationship_kind: "parent",
      street: "Musterweg 1",
      zip: "10115",
      city: "Berlin",
      country: "DE",
      phone: "+49 30 1234567",
      email: "anna.muster@example.com",
      messenger: "",
      citizenships: ["DE", "AT"],
    });
    expect(input).not.toHaveProperty("contact_consent");
    // The template is a copy: editing the draft does not change it.
    parent.citizenships.push("UA");
    expect(template.citizenships).toEqual(["DE", "AT"]);
    // An older server sends no citizenships or address: they stay empty, to be typed.
    const older = { first_name: "Anna", last_name: "Muster", date_of_birth: null, email: null, phone: null };
    expect(withPayerAnswer(draftFromPayer(null, older), "guardian", older)).toMatchObject({
      citizenships: [],
      street: "",
      zip: "",
      city: "",
      country: "",
    });
  });

  it("offers 'the patient pays' for a minor only as the stored answer of an older request", () => {
    expect(payerSelfOffered({ minor: false, payer: null })).toBe(true);
    expect(payerSelfOffered({ minor: true, payer: null })).toBe(false);
    expect(payerSelfOffered({ minor: true, payer: storedPayer })).toBe(false);
    expect(payerSelfOffered({ minor: true, payer: { ...storedPayer, payer_kind: "self" } })).toBe(true);
  });

  it("requires the contact data of a third party, not of the paying parent", () => {
    const progress = (missing: string[]) => ({ progress: { filled: 0, total: 0, missing_for_submit: missing } });
    expect(payerContactRequired({ guardian_pays: false }, progress([]), "payer_email")).toBe(true);
    expect(payerContactRequired({ guardian_pays: true }, progress([]), "payer_city")).toBe(false);
    // A server that lists it as missing gets the mark, or the request could not be sent.
    expect(payerContactRequired({ guardian_pays: true }, progress(["payer_phone"]), "payer_phone")).toBe(true);
  });

  it("asks for the consent to pass the cost estimate on about a stored third party, not about the paying parent", () => {
    const request = (payer: LeadRequestPayer | null, missing: string[] = []) => ({
      payer,
      progress: { filled: 0, total: 0, missing_for_submit: missing },
    });
    const thirdParty = { ...storedPayer, cost_estimate_consent_at: null };
    expect(costEstimateConsentAsked(request(thirdParty), false)).toBe(true);
    // Given, it is still shown: it can be taken back.
    expect(costEstimateConsentAsked(request({ ...thirdParty, cost_estimate_consent_at: "2026-10-06T10:00:00Z" }), false)).toBe(true);
    // Also after the payer answered on the own link: the consent is the lead's own.
    expect(costEstimateConsentAsked(request({ ...thirdParty, answered_by_payer: true }), false)).toBe(true);
    // The parent who pays is not asked to send the estimate to oneself.
    expect(costEstimateConsentAsked(request(thirdParty), true)).toBe(false);
    // Nobody else pays, nothing is stored yet, or an older server that does not know it: no box.
    expect(costEstimateConsentAsked(request({ ...thirdParty, payer_kind: "self" }), false)).toBe(false);
    expect(costEstimateConsentAsked(request(null), false)).toBe(false);
    expect(costEstimateConsentAsked(request(storedPayer), false)).toBe(false);
    // A server that lists it as missing gets the box in any case, or the request could not be sent.
    expect(costEstimateConsentAsked(request(thirdParty, ["payer_cost_estimate_consent"]), true)).toBe(true);
    expect(costEstimateConsentAsked(request(storedPayer, ["payer_cost_estimate_consent"]), false)).toBe(true);
  });

  it("shows a stored payer as the first answer it was given as", () => {
    const template = { first_name: "Maria", last_name: "Muster", date_of_birth: null, email: null, phone: null };
    const parent = {
      ...storedPayer,
      first_name: "Maria",
      last_name: " Muster ",
      relationship_kind: "parent",
    };
    expect(payerAnswer(null, template)).toBe("");
    expect(payerAnswer({ ...storedPayer, payer_kind: "self", payer_type: null }, template)).toBe("self");
    // A person, the patient's parent, with the name of the parent's own data: "I pay (as a parent)".
    expect(payerAnswer(parent, template)).toBe("guardian");
    expect(draftFromPayer(parent, template).guardian_pays).toBe(true);
    expect(draftAnswer(draftFromPayer(parent, template))).toBe("guardian");
    // Anybody else is another person or organisation: another name, another relationship, a company.
    expect(payerAnswer({ ...parent, first_name: "Viktor" }, template)).toBe("third_party");
    expect(payerAnswer({ ...parent, last_name: "Zahler" }, template)).toBe("third_party");
    expect(payerAnswer({ ...parent, relationship_kind: "relative" }, template)).toBe("third_party");
    expect(payerAnswer({ ...parent, payer_type: "company" }, template)).toBe("third_party");
    // Without the own data on file (not a parent's login, no trusted contact) there is no such answer.
    expect(payerAnswer(parent, null)).toBe("third_party");
    expect(payerAnswer(parent)).toBe("third_party");
    expect(draftFromPayer(parent).guardian_pays).toBe(false);
    // A name of one word is the last name; the first name is then empty on both sides.
    const oneWord = { ...template, first_name: "" };
    expect(payerAnswer({ ...parent, first_name: null }, oneWord)).toBe("guardian");
  });

  it("asks an older server for a person as before", () => {
    const older = {
      payer_kind: "third_party" as const,
      first_name: "Viktor",
      last_name: "Zahler",
      date_of_birth: null,
      street: null,
      zip: null,
      city: null,
      country: null,
      citizenships: ["UA"],
      relationship: "Vater",
      email: null,
      phone: null,
    };
    // An answered question shows by its keys what the server knows.
    expect(knowsPayerType({ payer: older })).toBe(false);
    expect(knowsPayerType({ payer: { ...older, payer_type: "person" } })).toBe(true);
    expect(knowsPayerType({ payer: { ...older, payer_kind: "self", payer_type: null } })).toBe(true);
    // Before the answer, the key every such server sends does.
    expect(knowsPayerType({ payer: null })).toBe(false);
    expect(knowsPayerType({ payer: null, payer_self_template: null })).toBe(true);
    // None of the new keys is sent: such a server refuses what it does not know.
    const draft = { ...draftFromPayer(older), payer_type: "company", organisation_name: "Beispiel GmbH", contact_consent: true };
    expect(payerInput(draft, false)).toEqual({
      payer_kind: "third_party",
      first_name: "Viktor",
      last_name: "Zahler",
      relationship: "Vater",
      citizenships: ["UA"],
    });
    expect(payerInput(draftFromPayer(older), false)).toEqual(payerInput(draft, false));
  });

  it("lists missing payer fields after the personal data", () => {
    const missing = missingForSubmit({
      progress: { filled: 3, total: 12, missing_for_submit: ["payer_last_name", "city", "payer_kind", "unknown"] },
    });
    expect(missing).toEqual(["city", "payer_kind", "payer_last_name"]);
    // An organisation as payer, the relationship and the consent, in the order of the block.
    const organisation = missingForSubmit({
      progress: {
        filled: 3,
        total: 12,
        missing_for_submit: [
          "payer_own_account",
          "payer_cost_estimate_consent",
          "payer_contact_consent",
          "payer_email_or_phone",
          "payer_country",
          "payer_relationship",
          "payer_contact_name",
          "payer_relationship_kind",
          "payer_legal_form",
          "payer_organisation_name",
        ],
      },
    });
    expect(organisation).toEqual([
      // The organisation mask (trigger flow): name, legal form, contact person.
      "payer_organisation_name",
      "payer_legal_form",
      "payer_contact_name",
      "payer_relationship_kind",
      "payer_relationship",
      "payer_email_or_phone",
      "payer_country",
      "payer_contact_consent",
      // The consent to pass the cost estimate on comes right after the one to contact the payer.
      "payer_cost_estimate_consent",
      "payer_own_account",
    ]);
  });

  it("sends the own economic interest with the answer who pays", () => {
    const self = { ...draftFromPayer(null), payer_kind: "self" };
    // Not answered yet: left out, so the server keeps what it has.
    expect(payerInput(self)).toEqual({ payer_kind: "self" });
    expect(payerInput({ ...self, acts_on_own_account: "yes", beneficial_owner: "stale" })).toEqual({
      payer_kind: "self",
      acts_on_own_account: true,
    });
    // "No" names the person; an emptied text is sent empty, so the server drops the old one.
    expect(payerInput({ ...self, acts_on_own_account: "no", beneficial_owner: "  Viktor Zahler,\n01.02.1970 " })).toEqual({
      payer_kind: "self",
      acts_on_own_account: false,
      beneficial_owner: "Viktor Zahler,\n01.02.1970",
    });
    expect(payerInput({ ...self, acts_on_own_account: "no" })).toEqual({
      payer_kind: "self",
      acts_on_own_account: false,
      beneficial_owner: "",
    });
    // Without "who pays" there is no answer to attach it to.
    expect(payerInput({ ...draftFromPayer(null), acts_on_own_account: "yes" })).toBeNull();

    const olderServer = {
      payer_kind: "self" as const,
      first_name: null,
      last_name: null,
      date_of_birth: null,
      street: null,
      zip: null,
      city: null,
      country: null,
      citizenships: [],
      relationship: null,
      email: null,
      phone: null,
    };
    const stored = draftFromPayer({ ...olderServer, acts_on_own_account: false, beneficial_owner: "Viktor Zahler" });
    expect(stored).toMatchObject({ acts_on_own_account: "no", beneficial_owner: "Viktor Zahler" });
    expect(draftFromPayer({ ...olderServer, acts_on_own_account: null, beneficial_owner: null }).acts_on_own_account).toBe("");
    // An older server does not send the two keys: the question counts as not answered.
    expect(draftFromPayer(olderServer).acts_on_own_account).toBe("");
  });

  it("lists the missing statements of the identification in the order of the steps", () => {
    const missing = missingForSubmit({
      progress: {
        filled: 3,
        total: 12,
        missing_for_submit: [
          "request_reason",
          "sanctions_links",
          "payer_beneficial_owner",
          "has_representative",
          "id_document_upload",
          "birth_country",
          "city",
          "birth_place",
          "payer_own_account",
          "payer_kind",
          "pep_self",
          // Keys of an older server the steps no longer ask are left out.
          "pep_self_details",
          "id_valid_until",
        ],
      },
    });
    expect(missing).toEqual([
      "birth_place",
      "birth_country",
      "has_representative",
      "city",
      "id_document_upload",
      "payer_kind",
      "payer_own_account",
      "payer_beneficial_owner",
      "pep_self",
      "sanctions_links",
      "request_reason",
    ]);
  });

  it("lists what is missing about invoice and payment after the payer, before the legal questions", () => {
    const missing = missingForSubmit({
      progress: {
        filled: 3,
        total: 12,
        missing_for_submit: [
          "pep_self",
          "via_third_party_details",
          "bank_name",
          "invoice_country",
          "payer_beneficial_owner",
          "payment_method",
          "invoice_to",
          "account_holder",
          "via_third_party",
          "invoice_name",
          "payment_method_details",
          "account_country",
          "invoice_city",
          "invoice_zip",
          "invoice_street",
          "payer_kind",
        ],
      },
    });
    expect(missing).toEqual([
      "payer_kind",
      "payer_beneficial_owner",
      "invoice_to",
      "invoice_name",
      "invoice_street",
      "invoice_zip",
      "invoice_city",
      "invoice_country",
      "payment_method",
      "payment_method_details",
      "account_country",
      "account_holder",
      "bank_name",
      "via_third_party",
      "via_third_party_details",
      "pep_self",
    ]);
  });

  it("shows one save state for the parts of the form", () => {
    expect(combinedSaveState(["idle", "idle", "idle"])).toBe("idle");
    expect(combinedSaveState(["saved", "idle", "idle"])).toBe("saved");
    // A part that could not be saved is not hidden by another that was.
    expect(combinedSaveState(["saved", "error", "idle"])).toBe("error");
    expect(combinedSaveState(["saved", "error", "saving"])).toBe("saving");
  });

  it("formats file sizes", () => {
    expect(formatFileSize(2048, "de")).toBe("2 KB");
    expect(formatFileSize(3 * 1024 * 1024, "de")).toBe("3 MB");
    expect(formatFileSize(null, "de")).toBe("");
  });
});
