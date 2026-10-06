import { describe, expect, it } from "vitest";

import {
  TRUSTED_CONTACT_RELATIONS,
  leadUpdateWithChangedContacts,
  mergeTrustedContacts,
  storedTrustedContactDrafts,
  trustedContactRelationLabel,
  trustedContactsChanged,
  trustedContactsPayload,
  withoutTrustedContacts,
  type TrustedContactDraft,
} from "./lead-trusted-contacts";

describe("the relation of a trusted contact", () => {
  const ru = (text: string) => text;
  const de = (_ru: string, text: string) => text;

  it("reads as words, never as the stored value", () => {
    expect(trustedContactRelationLabel("guardian", ru)).toBe("Опекун");
    expect(trustedContactRelationLabel("guardian", de)).toBe("Vormund/Betreuer");
    expect(trustedContactRelationLabel("representative", ru)).toBe("Уполномоченный представитель");
    expect(trustedContactRelationLabel("representative", de)).toBe("Bevollmächtigte Person");
    expect(trustedContactRelationLabel("parent", ru)).toBe("Мать / отец");
    expect(trustedContactRelationLabel("parent", de)).toBe("Mutter / Vater");
    for (const relation of TRUSTED_CONTACT_RELATIONS) {
      expect(trustedContactRelationLabel(relation, ru)).not.toBe(relation);
      expect(trustedContactRelationLabel(relation, de)).not.toBe(relation);
    }
  });

  it("shows a relation typed as text in older data as it is", () => {
    expect(trustedContactRelationLabel("Tante", de)).toBe("Tante");
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
