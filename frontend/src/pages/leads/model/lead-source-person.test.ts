import { describe, expect, it } from "vitest";

import {
  fillMissingFromSeed,
  fillMissingIdentityNames,
  leadSourcePersonFromSearchParams,
  newRequestForPersonHref,
  prefilledFieldLabels,
  prefilledFromSourceNotice,
  seedFromPatientRelation,
  seedFromTrustedContact,
  sourcePepHint,
  splitPersonName,
  withoutLeadSourcePersonParams,
} from "./lead-source-person";
import { sourcePepHintActive } from "./lead-source-person";

const tx = (ru: string) => ru;

describe("new request for a person: the wizard link", () => {
  it("round-trips a patient relation and a lead contact through the query", () => {
    const relation = { patient_id: "patient-1", relation_id: "relation-1" };
    const contact = { lead_id: "lead-1", contact_id: "contact-1" };
    const relationHref = newRequestForPersonHref(relation);
    expect(relationHref).toBe("/leads?new=person&source_patient=patient-1&source_relation=relation-1");
    expect(leadSourcePersonFromSearchParams(new URL(relationHref, "http://x").searchParams)).toEqual(relation);
    expect(leadSourcePersonFromSearchParams(new URL(newRequestForPersonHref(contact), "http://x").searchParams)).toEqual(contact);
  });
  it("ignores other links and half-filled sources", () => {
    expect(leadSourcePersonFromSearchParams(new URLSearchParams("lead=abc&view=wizard"))).toBeNull();
    expect(leadSourcePersonFromSearchParams(new URLSearchParams("new=person&source_patient=p"))).toBeNull();
    expect(leadSourcePersonFromSearchParams(new URLSearchParams("new=other&source_lead=l&source_contact=c"))).toBeNull();
  });
  it("strips only its own parameters", () => {
    const left = withoutLeadSourcePersonParams(new URLSearchParams("new=person&source_lead=l&source_contact=c&status=new"));
    expect(left.toString()).toBe("status=new");
  });
});

describe("the seed the frontend already knows", () => {
  it("splits a one-field name like the server: the last word is the last name", () => {
    expect(splitPersonName("Anna Maria Muster")).toEqual({ firstName: "Anna Maria", lastName: "Muster" });
    expect(splitPersonName(" Muster ")).toEqual({ firstName: "", lastName: "Muster" });
    expect(splitPersonName(null)).toEqual({ firstName: "", lastName: "" });
  });
  it("takes name, contact and address from a patient relation", () => {
    expect(seedFromPatientRelation({
      related_name: "Anna Muster", phone: "+49 30 1", email: "anna@example.com",
      address_street: "Weg 1", address_zip: "10115", address_city: "Berlin", address_country: "DE",
    })).toEqual({ firstName: "Anna", lastName: "Muster", birthDate: "", citizenships: [], phone: "+49 30 1", email: "anna@example.com", street: "Weg 1", zip: "10115", city: "Berlin", country: "DE" });
  });
  it("takes name, contact and birth date from a trusted contact", () => {
    expect(seedFromTrustedContact({ name: "Ben Muster", phone: null, email: "ben@example.com", birth_date: "1980-01-02" }))
      .toEqual({ firstName: "Ben", lastName: "Muster", phone: "", email: "ben@example.com", birthDate: "1980-01-02", street: "", zip: "", city: "", country: "", citizenships: [] });
  });
  it("fills only empty draft fields", () => {
    const draft = { firstName: "", lastName: "Typed", birthDate: "", email: "", phone: "+1", street: "", zip: "", city: "", country: "", other: 1 };
    const next = fillMissingFromSeed(draft, { firstName: "Anna", lastName: "Muster", phone: "+2", city: "Berlin" });
    expect(next).toMatchObject({ firstName: "Anna", lastName: "Typed", phone: "+1", city: "Berlin", other: 1 });
  });
  it("takes the stored names and e-mail after creation only when the draft has none", () => {
    const next = fillMissingIdentityNames({ firstName: "", lastName: "Typed", email: " " }, { first_name: "Anna", last_name: "Muster", email: "anna@example.com" });
    expect(next).toEqual({ firstName: "Anna", lastName: "Typed", email: "anna@example.com" });
  });
});

describe("what the server copied", () => {
  it("labels the fields in order and collapses the identity document", () => {
    expect(prefilledFieldLabels(["first_name", "date_of_birth", "id_document_type", "id_document_number", "citizenships", "unknown_key"], tx))
      .toEqual(["имя", "дата рождения", "данные документа", "гражданство", "unknown_key"]);
  });
  it("names the child in the notice and stays silent when nothing was copied", () => {
    expect(prefilledFromSourceNotice({ fields: ["first_name", "last_name"] }, "Mia Muster", tx))
      .toBe("Данные заполнены из записи Mia Muster: имя, фамилия");
    expect(prefilledFromSourceNotice({ fields: [] }, "Mia Muster", tx)).toBeNull();
    expect(prefilledFromSourceNotice(null, "Mia Muster", tx)).toBeNull();
  });
  it("shows the PEP hint only for an explicit yes", () => {
    expect(sourcePepHint({ fields: [], hints: { pep_self: "yes" } })).toBe(true);
    expect(sourcePepHint({ fields: [], hints: { pep_self: "no" } })).toBe(false);
    expect(sourcePepHint({ fields: [], hints: null })).toBe(false);
  });
});

describe("item 97: what step 1 shows before the lead exists", () => {
  it("takes the date of birth from the relation or the conversion note, and the citizenships", () => {
    expect(seedFromPatientRelation({ related_name: "Marianne Muster", notes: "Email: m@x.test\nGeburtsdatum: 1985-05-02" }))
      .toMatchObject({ firstName: "Marianne", lastName: "Muster", birthDate: "1985-05-02", citizenships: [] });
    expect(seedFromPatientRelation({ related_name: "Jonas Muster", birth_date: "1983-01-02", citizenships: ["de", "UA", "DE"] }))
      .toMatchObject({ birthDate: "1983-01-02", citizenships: ["DE", "UA"] });
  });
  it("takes a representative's address, birth date and citizenships for a lead contact", () => {
    const seed = seedFromTrustedContact(
      { name: "Paul Allein", phone: null, email: null, birth_date: null },
      { date_of_birth: "1988-03-03", citizenships: ["DE"], street: "Weg 1", zip: "24103", city: "Kiel", country: "DE" },
    );
    expect(seed).toMatchObject({ birthDate: "1988-03-03", citizenships: ["DE"], street: "Weg 1", city: "Kiel", country: "DE" });
    expect(seed).not.toHaveProperty("legalSex");
  });
  it("fills empty citizenships only", () => {
    const blank = { firstName: "", lastName: "", birthDate: "", email: "", phone: "", street: "", zip: "", city: "", country: "", citizenships: [] as string[] };
    expect(fillMissingFromSeed(blank, { citizenships: ["IR"] }).citizenships).toEqual(["IR"]);
    expect(fillMissingFromSeed({ ...blank, citizenships: ["DE"] }, { citizenships: ["IR"] }).citizenships).toEqual(["DE"]);
  });
});

describe("the PEP hint of the source stays until answered", () => {
  it("shows in the creating session and from the lead's source, never after an answer", () => {
    expect(sourcePepHintActive(null, { sessionHint: true, pepAnswer: null })).toBe(true);
    expect(sourcePepHintActive(null, { sessionHint: true, pepAnswer: false })).toBe(false);
    const lead = { source_relation_id: "r1", source_pep_hint: "yes" as const };
    expect(sourcePepHintActive(lead, { sessionHint: false, pepAnswer: undefined })).toBe(true);
    expect(sourcePepHintActive(lead, { sessionHint: false, pepAnswer: null })).toBe(true);
    expect(sourcePepHintActive(lead, { sessionHint: false, pepAnswer: true })).toBe(false);
    expect(sourcePepHintActive(lead, { sessionHint: false, pepAnswer: false })).toBe(false);
    expect(sourcePepHintActive({ source_relation_id: "r1", source_pep_hint: "no" }, { sessionHint: false, pepAnswer: null })).toBe(false);
    expect(sourcePepHintActive({ source_pep_hint: null }, { sessionHint: false, pepAnswer: null })).toBe(false);
  });
});
