import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TRUSTED_CONTACT_RELATIONS,
  emailChangedOnSave,
  guardianRelationOptionLabel,
  isParentOrGuardianRelation,
  leadUpdateWithChangedContacts,
  mergeTrustedContacts,
  representativeCabinetAddress,
  representativeMinorOnSave,
  storedTrustedContactDrafts,
  trustedContactRelationLabel,
  trustedContactsChanged,
  trustedContactsPayload,
  withoutTrustedContacts,
  type TrustedContactDraft,
} from "./lead-trusted-contacts";
import {
  CONTACT_EMAIL_CHECK_DEBOUNCE_MS,
  changedRepresentativeDetails,
  contactEmailLoginWarning,
  contactEmailToCheck,
  createContactEmailLoginCheck,
} from "./lead-trusted-contacts";
import type { ContactEmailLoginOwner } from "../data/leads-api";

describe("the relation of a trusted contact", () => {
  const ru = (text: string) => text;
  const de = (_ru: string, text: string) => text;

  it("offers a court-appointed guardian apart from the parents (the Linda case)", () => {
    expect(guardianRelationOptionLabel("father", ru)).toBe("Отец (родитель)");
    expect(guardianRelationOptionLabel("mother", de)).toBe("Mutter (Elternteil)");
    expect(guardianRelationOptionLabel("guardian", ru)).toBe("Опекун по решению суда (не родитель)");
    expect(guardianRelationOptionLabel("guardian", de)).toBe("Vormund, vom Gericht bestellt (kein Elternteil)");
    // An adult is represented by a Betreuer, never by the parents.
    expect(guardianRelationOptionLabel("guardian", de, false)).toBe("Betreuer/in, vom Gericht bestellt");
    expect(guardianRelationOptionLabel("father", ru, false)).toBe("Отец");
    expect(guardianRelationOptionLabel("spouse", ru, false)).toBe("Супруг / супруга");
  });

  it("reads as words, never as the stored value", () => {
    expect(trustedContactRelationLabel("guardian", ru)).toBe("Опекун");
    expect(trustedContactRelationLabel("guardian", de)).toBe("Vormund/Betreuer");
    expect(trustedContactRelationLabel("representative", ru)).toBe("Уполномоченный представитель");
    expect(trustedContactRelationLabel("representative", de)).toBe("Bevollmächtigte Person");
    expect(trustedContactRelationLabel("parent", ru)).toBe("Родитель — роль не уточнена");
    expect(trustedContactRelationLabel("parent", de)).toBe("Elternteil — Rolle nicht angegeben");
    expect(trustedContactRelationLabel("mother", ru)).toBe("Мать");
    expect(trustedContactRelationLabel("father", ru)).toBe("Отец");
    expect(trustedContactRelationLabel("Mutter", ru)).toBe("Мать");
    expect(trustedContactRelationLabel("Vater", de)).toBe("Vater");
    expect(TRUSTED_CONTACT_RELATIONS).not.toContain("parent");
    for (const relation of TRUSTED_CONTACT_RELATIONS) {
      expect(trustedContactRelationLabel(relation, ru)).not.toBe(relation);
      expect(trustedContactRelationLabel(relation, de)).not.toBe(relation);
    }
  });

  it("shows a relation typed as text in older data as it is", () => {
    expect(trustedContactRelationLabel("Tante", de)).toBe("Tante");
  });

  it("keeps explicit mothers and fathers in the minor's representative block", () => {
    for (const relation of ["mother", "father", "parent", "guardian", " Mutter ", "Vater"]) expect(isParentOrGuardianRelation(relation)).toBe(true);
    for (const relation of ["spouse", "representative", "relative", "other", ""]) expect(isParentOrGuardianRelation(relation)).toBe(false);
  });

  it("reads free-text relations as the server does", () => {
    for (const relation of ["Elternteil", "Vormund", "мама", "папа", "родитель", "опекун", "Stiefvater"]) {
      expect(isParentOrGuardianRelation(relation)).toBe(true);
    }
    // The server's order: a spouse, a child or a sibling first.
    for (const relation of ["Ehepartner", "Tochter", "Bruder", "Tante", "Betreuer"]) {
      expect(isParentOrGuardianRelation(relation)).toBe(false);
    }
  });
});
import { patientEventChangesLeadData } from "./use-lead-step1-portal";

const ANNA_ID = "11111111-1111-4111-8111-111111111111";
const BEN_ID = "22222222-2222-4222-8222-222222222222";
const MIA_ID = "33333333-3333-4333-8333-333333333333";

function contact(patch: Partial<TrustedContactDraft> & { id: string; name: string }): TrustedContactDraft {
  return {
    relatedPatientId: "",
    relatedPatientLabel: patch.name,
    phone: "",
    email: "",
    relation: "parent",
    birthDate: "",
    address: "",
    ...patch,
  };
}

const anna = contact({ id: ANNA_ID, name: "Anna Muster", email: "anna.muster@example.com", birthDate: "1985-03-02" });
const ben = contact({ id: BEN_ID, name: "Ben Muster", email: "ben.muster@example.com" });
const aunt = contact({ id: MIA_ID, name: "Mia Muster", relation: "relative" });

/** What the wizard loaded: the contacts as the server stores them. */
const stored = (...contacts: TrustedContactDraft[]) => trustedContactsPayload(contacts);

/** The rest of a wizard save; the contacts are decided separately. */
const update = { email: "child@example.com", trusted_contacts: ["placeholder of the wizard"], wizard_state: { step: "documents" } };

describe("a contact as the server takes it", () => {
  it("trims the texts and sends null for what is empty", () => {
    expect(
      trustedContactsPayload([
        contact({ id: ANNA_ID, name: "  Anna Muster ", phone: " +49 30 100001 ", email: " ", relation: " parent ", address: "  " }),
      ]),
    ).toEqual([
      {
        id: ANNA_ID,
        related_patient_id: null,
        name: "Anna Muster",
        phone: "+49 30 100001",
        email: null,
        relation: "parent",
        birth_date: null,
        address: null,
      },
    ]);
    expect(trustedContactsPayload([contact({ id: BEN_ID, name: "Ben Muster", relatedPatientId: "patient-7", birthDate: "1984-01-15" })])[0])
      .toMatchObject({ related_patient_id: "patient-7", birth_date: "1984-01-15" });
  });
});

describe("what the server stores of a loaded draft", () => {
  it("is every contact that has its own id on the server", () => {
    expect(storedTrustedContactDrafts([{ id: ANNA_ID }, { id: BEN_ID }], [anna, ben])).toEqual([anna, ben]);
  });

  it("leaves out a contact whose id was made in the browser, so the next save writes it", () => {
    // Read from the older single-contact fields: nothing stored in the array.
    expect(storedTrustedContactDrafts([], [anna])).toEqual([]);
    expect(storedTrustedContactDrafts(null, [anna])).toEqual([]);
    expect(storedTrustedContactDrafts(undefined, [anna])).toEqual([]);
    // Stored without an id: the draft gave it one.
    expect(storedTrustedContactDrafts([{ id: ANNA_ID }, { id: null }, {}], [anna, ben])).toEqual([anna]);
  });
});

describe("whether staff changed the contacts since they were loaded", () => {
  it("is false for the loaded list, whatever was typed around the values", () => {
    expect(trustedContactsChanged(stored(anna, ben), stored(anna, ben))).toBe(false);
    expect(trustedContactsChanged(stored({ ...anna, name: " Anna Muster " }), stored(anna))).toBe(false);
    expect(trustedContactsChanged([], [])).toBe(false);
  });

  it("is true once a contact is added, removed or edited", () => {
    expect(trustedContactsChanged(stored(anna, ben), stored(anna))).toBe(true);
    expect(trustedContactsChanged(stored(anna), stored(anna, ben))).toBe(true);
    expect(trustedContactsChanged([], stored(anna))).toBe(true);
    for (const patch of [
      { name: "Anna Beispiel" },
      { email: "anna.beispiel@example.com" },
      { phone: "+49 30 100001" },
      { relation: "guardian" },
      { birthDate: "1985-03-03" },
      { address: "Musterweg 1, 10115 Berlin" },
      { relatedPatientId: "patient-7" },
    ]) {
      expect(trustedContactsChanged(stored({ ...anna, ...patch }), stored(anna))).toBe(true);
    }
    expect(trustedContactsChanged(stored(ben, anna), stored(anna, ben))).toBe(true);
  });
});

describe("a wizard save and the trusted contacts", () => {
  it("does not send the contacts while staff have not changed them", () => {
    const { body, contacts } = leadUpdateWithChangedContacts(update, [anna], stored(anna));
    expect(contacts).toBeNull();
    expect(body).toEqual({ email: "child@example.com", wizard_state: { step: "documents" } });
    expect("trusted_contacts" in body).toBe(false);
  });

  it("keeps a second parent the cabinet created out of reach of an older wizard tab", () => {
    // The tab was opened when the mother was the only contact. Meanwhile she
    // added the father in the cabinet; this tab does not know him.
    const openedWith = stored(anna);
    const staleDraft = [anna];
    // Any later save of the tab (another field changed) leaves the contacts alone.
    const save = leadUpdateWithChangedContacts({ ...update, email: "new@example.com" }, staleDraft, openedWith);
    expect(save.contacts).toBeNull();
    expect(save.body).not.toHaveProperty("trusted_contacts");
    expect(save.body).toMatchObject({ email: "new@example.com" });
  });

  it("sends the contacts once staff add, edit or remove one", () => {
    const added = leadUpdateWithChangedContacts(update, [anna, aunt], stored(anna));
    expect(added.contacts).toEqual(stored(anna, aunt));
    expect(added.body).toEqual({
      email: "child@example.com",
      wizard_state: { step: "documents" },
      trusted_contacts: stored(anna, aunt),
      // The list the wizard loaded: what staff left as loaded keeps the
      // server's value (a parent's change in the cabinet since the load).
      trusted_contacts_base: stored(anna),
    });
    const edited = leadUpdateWithChangedContacts(update, [{ ...anna, phone: "+49 30 100001" }], stored(anna));
    expect(edited.contacts?.[0].phone).toBe("+49 30 100001");
    const removed = leadUpdateWithChangedContacts(update, [], stored(anna));
    expect(removed.contacts).toEqual([]);
    expect(removed.body).toMatchObject({ trusted_contacts: [] });
  });

  it("sends a contact read from the older fields, which the server does not store as a contact yet", () => {
    const loaded = [anna];
    const base = trustedContactsPayload(storedTrustedContactDrafts([], loaded));
    expect(leadUpdateWithChangedContacts(update, loaded, base).contacts).toEqual(stored(anna));
  });

  it("compares with the list of its own last save, so nothing is repeated and nothing is lost", () => {
    const first = leadUpdateWithChangedContacts(update, [anna, aunt], stored(anna));
    expect(first.contacts).toEqual(stored(anna, aunt));
    // What the server has now is the list of that save.
    const afterFirst = first.contacts ?? [];
    // A second save of the same draft (another field changed) does not repeat the contacts.
    const repeated = leadUpdateWithChangedContacts(update, [anna, aunt], afterFirst);
    expect(repeated.contacts).toBeNull();
    expect(repeated.body).not.toHaveProperty("trusted_contacts");
    // Staff remove the aunt again: back to the list the tab was opened with,
    // but a change against what the server has by now.
    const removedAgain = leadUpdateWithChangedContacts(update, [anna], afterFirst);
    expect(removedAgain.contacts).toEqual(stored(anna));
  });

  it("takes the contacts out of a body without touching the rest", () => {
    const body = withoutTrustedContacts(update);
    expect(body).toEqual({ email: "child@example.com", wizard_state: { step: "documents" } });
    expect(update.trusted_contacts).toEqual(["placeholder of the wizard"]);
  });
});

describe("taking a change of the cabinet into an open wizard", () => {
  it("adds the second parent the cabinet created", () => {
    expect(mergeTrustedContacts([anna], stored(anna), [anna, ben])).toEqual([anna, ben]);
  });

  it("replaces a contact staff did not edit by the fresh one", () => {
    const corrected = { ...anna, name: "Anna Maria Muster", relatedPatientLabel: "Anna Maria Muster" };
    expect(mergeTrustedContacts([anna, ben], stored(anna, ben), [corrected, ben])).toEqual([corrected, ben]);
  });

  it("keeps what staff edited, added or removed since the load", () => {
    const edited = { ...anna, phone: "+49 30 100001" };
    const corrected = { ...anna, name: "Anna Maria Muster" };
    // Staff edited the mother, added the aunt and removed nobody; the cabinet corrected the mother and added the father.
    expect(mergeTrustedContacts([edited, aunt], stored(anna), [corrected, ben])).toEqual([edited, ben, aunt]);
    // Staff removed the father: he stays removed here although the server still has him.
    expect(mergeTrustedContacts([anna], stored(anna, ben), [anna, ben])).toEqual([anna]);
  });

  it("drops a contact that is gone on the server and untouched here", () => {
    expect(mergeTrustedContacts([anna, ben], stored(anna, ben), [anna])).toEqual([anna]);
    // One staff edited meanwhile stays, to be saved again.
    const edited = { ...ben, phone: "+49 30 100002" };
    expect(mergeTrustedContacts([anna, edited], stored(anna, ben), [anna])).toEqual([anna, edited]);
  });

  it("follows the order of the server, which decides who is the first representative", () => {
    expect(mergeTrustedContacts([anna, ben], stored(anna, ben), [ben, anna])).toEqual([ben, anna]);
    expect(mergeTrustedContacts([aunt, anna], stored(anna), [anna, ben])).toEqual([anna, ben, aunt]);
  });

  it("leaves the save alone when only the cabinet changed something", () => {
    const fresh = [{ ...anna, name: "Anna Maria Muster" }, ben];
    const merged = mergeTrustedContacts([anna], stored(anna), fresh);
    // After the merge the fresh contacts are what the server stores.
    expect(leadUpdateWithChangedContacts(update, merged, stored(...fresh)).contacts).toBeNull();
    // With a staff edit on top the list goes out, the father included.
    const withEdit = mergeTrustedContacts([{ ...anna, phone: "+49 30 100001" }], stored(anna), fresh);
    expect(leadUpdateWithChangedContacts(update, withEdit, stored(...fresh)).contacts).toEqual(
      stored({ ...anna, phone: "+49 30 100001" }, ben),
    );
  });
});

describe("which patient events reach the wizard draft", () => {
  it("are the personal data and the representation", () => {
    expect(patientEventChangesLeadData("personal_data")).toBe(true);
    expect(patientEventChangesLeadData("representation")).toBe(true);
    for (const change of ["payer", "identification", "document_reviewed", "", undefined, null]) {
      expect(patientEventChangesLeadData(change)).toBe(false);
    }
  });
});

describe("a parent or representative entered by staff", () => {
  const today = "2026-10-24";
  const person = (relation: string, birthDate: string) => ({ relation, birthDate });

  it("is of full age when the date or the role is new or changed, as in the cabinet", () => {
    expect(representativeMinorOnSave(person("mother", "2015-03-02"), undefined, today)).toBe(true);
    expect(representativeMinorOnSave(person("representative", "2010-01-01"), undefined, today)).toBe(true);
    expect(representativeMinorOnSave(person("Vormund", "2010-01-01"), person("Vormund", "2011-01-01"), today)).toBe(true);
    expect(representativeMinorOnSave(person("father", "2008-10-24"), undefined, today)).toBe(false);
    // A sibling may be a child; an unchanged stored parent keeps saving.
    expect(representativeMinorOnSave(person("relative", "2015-03-02"), undefined, today)).toBe(false);
    expect(representativeMinorOnSave(person("mother", "2015-03-02"), person("mother", "2015-03-02"), today)).toBe(false);
    expect(representativeMinorOnSave(person("mother", "2015-03-02"), person("relative", "2015-03-02"), today)).toBe(true);
    expect(representativeMinorOnSave(person("mother", ""), undefined, today)).toBe(false);
  });
});

describe("the address a representative stated in the cabinet", () => {
  const name = (code: string) => ({ DE: "Deutschland", UA: "Ukraine" } as Record<string, string>)[code] ?? code;

  it("is one line of the parts the documents print", () => {
    expect(representativeCabinetAddress({ street: " Hauptstr. 1 ", zip: "10115", city: "Berlin", country: "DE" }, name))
      .toBe("Hauptstr. 1, 10115 Berlin, Deutschland");
    expect(representativeCabinetAddress({ street: null, zip: null, city: "Kyiv", country: "UA" }, name)).toBe("Kyiv, Ukraine");
  });

  it("is null without any part, so staff keep editing the contact's address", () => {
    expect(representativeCabinetAddress({ street: " ", zip: null, city: "", country: null }, name)).toBeNull();
    expect(representativeCabinetAddress(null, name)).toBeNull();
  });
});

describe("whether an e-mail address is judged by its domain on save", () => {
  it("judges only an address new or changed in this edit, as the server does", () => {
    // QA 2026-10-24, B-1a: a stored parent address rated "no_mail" blocked the phone change.
    expect(emailChangedOnSave("anna@dead.example", "anna@dead.example")).toBe(false);
    expect(emailChangedOnSave("  Anna@Dead.example ", "anna@dead.example")).toBe(false);
    expect(emailChangedOnSave("anna@dead.example", null)).toBe(true);
    expect(emailChangedOnSave("anna@dead.example", undefined)).toBe(true);
    expect(emailChangedOnSave("anna@other.example", "anna@dead.example")).toBe(true);
    expect(emailChangedOnSave("", "anna@dead.example")).toBe(false);
  });
});

describe("F-11: a representative's citizenships and birth data go with the contact", () => {
  const contact: TrustedContactDraft = {
    id: "c1", relatedPatientId: "", relatedPatientLabel: "", name: "Iwan Parallelov", phone: "", email: "",
    relation: "father", birthDate: "", address: "",
  };
  it("sends only the keys staff changed, and counts them as a change", () => {
    const changed = changedRepresentativeDetails(
      { citizenships: ["IR"], birth_place: "Moskau", birth_country: "RU" },
      { citizenships: ["RU"], birth_place: "Moskau", birth_country: "ru" },
    );
    expect(changed).toEqual({ citizenships: ["IR"] });
    const stored = trustedContactsPayload([contact]);
    const payload = trustedContactsPayload([{ ...contact, representativeDetails: changed }]);
    expect(payload[0]).toMatchObject({ citizenships: ["IR"] });
    expect(payload[0]).not.toHaveProperty("birth_place");
    expect(trustedContactsChanged(payload, stored)).toBe(true);
    expect(trustedContactsChanged(payload, payload)).toBe(false);
    expect(leadUpdateWithChangedContacts({}, [{ ...contact, representativeDetails: changed }], stored).contacts?.[0].citizenships).toEqual(["IR"]);
  });
  it("clears a birth place with null and leaves the payload alone without changes", () => {
    expect(changedRepresentativeDetails(
      { citizenships: ["RU"], birth_place: " ", birth_country: "" },
      { citizenships: ["RU"], birth_place: "Moskau", birth_country: "" },
    )).toEqual({ birth_place: null });
    expect(changedRepresentativeDetails(
      { citizenships: ["RU"], birth_place: "Moskau", birth_country: "" },
      { citizenships: ["ru"], birth_place: "Moskau ", birth_country: "" },
    )).toBeUndefined();
    expect(trustedContactsPayload([contact])[0]).not.toHaveProperty("citizenships");
  });
});

describe("the login warning of the contact editor (DEV QA V-A6)", () => {
  const ru = (text: string) => text;
  const de = (_ru: string, text: string) => text;
  const patientOwner: ContactEmailLoginOwner = {
    kind: "patient",
    patient_id: "p-1",
    patient_number: "P-2026-0007",
    lead_id: null,
    display_name: "Olga Beispiel",
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks only about a well-formed address that is not the stored one", () => {
    expect(contactEmailToCheck("", null)).toBeNull();
    expect(contactEmailToCheck("anna@", null)).toBeNull();
    expect(contactEmailToCheck(" Anna@Example.de ", "anna@example.de")).toBeNull();
    expect(contactEmailToCheck(" anna@example.de ", "old@example.de")).toBe("anna@example.de");
    expect(contactEmailToCheck("anna@example.de", undefined)).toBe("anna@example.de");
  });

  it("names the patient when the server does, and only the kind otherwise", () => {
    expect(contactEmailLoginWarning(null, ru)).toBeNull();
    expect(contactEmailLoginWarning(patientOwner, ru)).toBe(
      "Этот адрес — логин другого пациента (P-2026-0007, Olga Beispiel). Проверьте, тот ли это человек.",
    );
    expect(contactEmailLoginWarning(patientOwner, de)).toBe(
      "Diese Adresse ist der Login einer anderen Person (P-2026-0007, Olga Beispiel). Bitte prüfen.",
    );
    expect(contactEmailLoginWarning({ ...patientOwner, patient_id: null, patient_number: null, display_name: null }, ru))
      .toBe("Этот адрес — логин другого пациента. Проверьте, тот ли это человек.");
    expect(contactEmailLoginWarning({ ...patientOwner, kind: "staff", patient_number: null, display_name: null }, de))
      .toBe("Diese Adresse ist der Login eines GMED-Mitarbeiters. Bitte prüfen.");
    expect(contactEmailLoginWarning({ ...patientOwner, kind: "lead", patient_number: null, display_name: "Anna Muster" }, ru))
      .toBe("Этот адрес — логин другого человека (Anna Muster). Проверьте, тот ли это человек.");
  });

  it("waits 400 ms after the last change and clears the warning at once", async () => {
    const lookup = vi.fn<(email: string) => Promise<ContactEmailLoginOwner | null>>(async () => patientOwner);
    const shown: (ContactEmailLoginOwner | null)[] = [];
    const check = createContactEmailLoginCheck(lookup, (owner) => shown.push(owner));

    check.update("anna@exam", null);
    check.update("anna@example.de", null);
    await vi.advanceTimersByTimeAsync(CONTACT_EMAIL_CHECK_DEBOUNCE_MS - 1);
    expect(lookup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("anna@example.de");
    expect(shown.at(-1)).toEqual(patientOwner);

    check.update("anna@example.d", null);
    expect(shown.at(-1)).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for the stored address and drops a stale or failed answer", async () => {
    let resolve: (owner: ContactEmailLoginOwner | null) => void = () => {};
    const lookup = vi.fn<(email: string) => Promise<ContactEmailLoginOwner | null>>(() => new Promise((done) => { resolve = done; }));
    const shown: (ContactEmailLoginOwner | null)[] = [];
    const check = createContactEmailLoginCheck(lookup, (owner) => shown.push(owner));

    check.update("anna@example.de", "anna@example.de");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lookup).not.toHaveBeenCalled();

    check.update("olga@example.de", "anna@example.de");
    await vi.advanceTimersByTimeAsync(CONTACT_EMAIL_CHECK_DEBOUNCE_MS);
    expect(lookup).toHaveBeenCalledTimes(1);
    check.cancel();
    resolve(patientOwner);
    await vi.advanceTimersByTimeAsync(0);
    expect(shown.filter(Boolean)).toEqual([]);

    const failing = createContactEmailLoginCheck(() => Promise.reject(new Error("offline")), (owner) => shown.push(owner));
    failing.update("olga@example.de", null);
    await vi.advanceTimersByTimeAsync(CONTACT_EMAIL_CHECK_DEBOUNCE_MS);
    expect(shown.at(-1)).toBeNull();
  });
});
