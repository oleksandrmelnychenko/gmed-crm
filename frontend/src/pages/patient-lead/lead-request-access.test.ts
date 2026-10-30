import { describe, expect, it } from "vitest";

import { actsAsGuardian, staffForChild } from "./lead-request-access";
import type { LeadRequest, LeadRequestRepresentative } from "./lead-request-api";
import { choosesForChild } from "./lead-request-consent-form";
import { consentFormText } from "./lead-request-consent-form-text";
import { otherParentOf } from "./lead-request-model";
import { parentDocumentSlots } from "./lead-request-step-forms";
import { extraWorkSubject, hasInsuranceLabel, leadRequestText, recipientOptions } from "./lead-request-text";
import { disclosureSubject, disclosureWording, trustedPersonsText } from "./lead-trusted-persons-text";

// DEV QA 2026-10-30 (owner): staff who fill in a minor's form act for the child as the parents
// do — the texts speak of the child and the parents' choices are offered — but are none of the
// parents themselves.

const ru = leadRequestText("ru");

function parent(id: string, slot: "rep1" | "rep2", firstName: string): LeadRequestRepresentative {
  return {
    id, slot, role: "legal_representative", relation: "parent", mine: false, email_locked: false, can_remove: false,
    first_name: firstName, last_name: "Muster", date_of_birth: "1985-04-12", birth_place: null, birth_country: null,
    citizenships: ["DE"], street: "Weg 1", zip: "10115", city: "Berlin", country: "DE",
    email: `${firstName.toLowerCase()}@example.com`, phone: null, identity_documents: [], authority_documents: [],
  };
}

const maria = parent("m", "rep1", "Maria");
const ben = parent("b", "rep2", "Ben");

function request(accessKind: "self" | "guardian" | "staff", minor: boolean, custody: string | null = "joint"): LeadRequest {
  return {
    access_kind: accessKind,
    minor,
    representation: { has_representative: null, under_guardianship: null, custody, custody_stated: true, representatives: [maria, ben] },
  } as unknown as LeadRequest;
}

describe("who acts for the child", () => {
  it("is a parent's login, or staff on a minor's form; staff on an adult's form answer as the patient", () => {
    expect(actsAsGuardian(request("guardian", true))).toBe(true);
    expect(actsAsGuardian(request("guardian", false))).toBe(true);
    expect(actsAsGuardian(request("staff", true))).toBe(true);
    expect(actsAsGuardian(request("staff", false))).toBe(false);
    expect(actsAsGuardian(request("self", true))).toBe(false);
    expect(staffForChild(request("staff", true))).toBe(true);
    expect(staffForChild(request("guardian", true))).toBe(false);
  });

  it("staff on a minor's form read the child's insurance, recipient and consent wording", () => {
    const staff = request("staff", true);
    expect(hasInsuranceLabel(ru, staff)).toBe(ru.hasInsuranceGuardian);
    expect(hasInsuranceLabel(ru, request("staff", false))).toBe(ru.fields.has_insurance);
    // Staff are none of the parents: "one of the parents", never "I".
    expect(recipientOptions(ru, staff, true).self).toBe("Один из родителей");
    expect(extraWorkSubject(staff)).toBe("child");
    expect(choosesForChild(staff)).toBe(true);
    expect(consentFormText("ru", choosesForChild(staff)).options).toEqual(consentFormText("ru", true).options);
    expect(disclosureSubject(staff)).toBe("child");
    const persons = trustedPersonsText("ru");
    expect(disclosureWording(persons, staff)).toEqual(disclosureWording(persons, request("guardian", true)));
    expect(disclosureWording(persons, staff).introduction).not.toBe(persons.introduction);
  });

  it("the other parent, for staff, is the one besides the parent who receives the invoice", () => {
    const staff = request("staff", true);
    expect(otherParentOf(staff, "b")?.id).toBe("m");
    expect(otherParentOf(staff, "m")?.id).toBe("b");
    // Without a named parent nobody is "the other".
    expect(otherParentOf(staff)).toBeNull();
    // A parent's login keeps its own: the parent who is not signed in.
    const login = { ...request("guardian", true) };
    login.representation = { ...login.representation!, representatives: [{ ...maria, mine: true }, ben] };
    expect(otherParentOf(login, "m")?.id).toBe("b");
  });

  it("staff upload each parent's identity copy on step Document", () => {
    expect(parentDocumentSlots(request("staff", true, "joint"))).toEqual(["rep1", "rep2"]);
    expect(parentDocumentSlots(request("staff", true, "sole_parent"))).toEqual(["rep1"]);
    expect(parentDocumentSlots(request("staff", true, "guardian"))).toEqual([]);
  });

  it("names the new choices in every language", () => {
    for (const lang of ["de", "ru", "uk", "en"] as const) {
      const text = leadRequestText(lang);
      expect(text.recipient.isPayerOtherParent, lang).toBeTruthy();
      expect(text.recipient.isPayerOtherParent, lang).not.toBe(text.recipient.isPayerSelf);
      expect(text.recipient.payerPartyParents.patient, lang).not.toBe(text.recipient.payerPartyGuardian.patient);
      expect(text.recipient.parentPayerQuestion, lang).toBeTruthy();
      expect(text.parentDocumentTitle("Ben Muster"), lang).toContain("Ben Muster");
      expect(text.parentRelationOptions.mother, lang).toBeTruthy();
      expect(text.parentRelationOptions.father, lang).toBeTruthy();
    }
  });
});
