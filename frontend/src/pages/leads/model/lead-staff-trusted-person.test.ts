import { describe, expect, it } from "vitest";

import {
  actsForLeadRelation,
  staffTrustedPersonError,
  trustedPersonDraftFromContact,
  trustedPersonDraftFromStored,
  trustedPersonToSend,
} from "./lead-staff-trusted-person";

const tx = (ru: string) => ru;

describe("staff trusted person (owner 2026-11-18)", () => {
  it("keeps parents, guardians and representatives as wizard contacts", () => {
    for (const relation of ["mother", "father", "guardian", "Vormund", "representative"]) {
      expect(actsForLeadRelation(relation)).toBe(true);
    }
    for (const relation of ["spouse", "relative", "other", ""]) {
      expect(actsForLeadRelation(relation)).toBe(false);
    }
  });

  it("carries a wizard contact over with its data and asks for what the cabinet needs in addition", () => {
    const draft = trustedPersonDraftFromContact({
      name: " Maria Kontakt ", relation: "spouse", phone: "+49 30 5550111", email: "", birthDate: "1975-03-04", scopeCodes: ["all"],
    });
    expect(draft).toMatchObject({ name: "Maria Kontakt", relation: "spouse", phone: "+49 30 5550111", birthDate: "1975-03-04", scopeCodes: ["all"] });
    expect(trustedPersonToSend(draft)).toEqual({
      name: "Maria Kontakt", relation: "spouse", contact: null, phone: "+49 30 5550111", birth_date: "1975-03-04", scope_codes: ["all"],
    });
    // A relation the cabinet does not know is chosen again; without a scope nothing is sent.
    const unknown = trustedPersonDraftFromContact({ name: "Max", relation: "Nachbar", phone: "+49 30 5550112", email: "", birthDate: "1970-01-01" });
    expect(unknown.relation).toBe("");
    expect(trustedPersonToSend(unknown)).toBeNull();
  });

  it("edits a stored person with every field and sends the change", () => {
    const stored = { name: "Ben Zweiter", relation: "child", contact: null, phone: "+49 30 5550132", birth_date: "2001-04-05", citizenships: ["DE"], scope_codes: ["all" as const] };
    const draft = trustedPersonDraftFromStored(stored);
    expect(draft).toMatchObject({ name: "Ben Zweiter", relation: "child", citizenships: ["DE"], scopeCodes: ["all"] });
    expect(trustedPersonToSend({ ...draft, relation: "relative", citizenships: ["AT", "DE"], scopeCodes: ["medical"] })).toEqual({
      name: "Ben Zweiter", relation: "relative", contact: null, phone: "+49 30 5550132", birth_date: "2001-04-05",
      citizenships: ["AT", "DE"], scope_codes: ["medical"],
    });
  });

  it("keeps the e-mail address of a wizard contact and of a stored person", () => {
    const draft = trustedPersonDraftFromContact({
      name: "Maria Kontakt", relation: "relative", phone: "+49 30 5550111", email: "maria@example.org", birthDate: "1975-03-04", scopeCodes: ["medical"],
    });
    expect(trustedPersonToSend(draft)?.contact).toBe("maria@example.org");
    const stored = trustedPersonDraftFromStored({ name: "Olga", relation: "friend", contact: "olga@example.org", phone: "+49 30 5550122", birth_date: "1960-01-02", scope_codes: ["all"] });
    expect(trustedPersonToSend({ ...stored, phone: "+49 30 5550199" })).toMatchObject({ contact: "olga@example.org", phone: "+49 30 5550199" });
    const noMail = trustedPersonDraftFromContact({ name: "Max", relation: "other", phone: "+49 30 5550112", email: "kein", birthDate: "1970-01-01", scopeCodes: ["all"] });
    expect(trustedPersonToSend(noMail)?.contact).toBeNull();
  });

  it("names the refusal of the server", () => {
    expect(staffTrustedPersonError("trusted_person_exists", "name", tx)).toBe("Этот человек уже есть в списке.");
    expect(staffTrustedPersonError("consent_recipients_invalid", "persons", tx)).toBe("Не больше пяти доверенных лиц.");
    expect(staffTrustedPersonError("consent_recipients_invalid", "birth_date", tx)).toBe("Укажите дату рождения.");
  });
});
