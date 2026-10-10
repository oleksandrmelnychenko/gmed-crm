import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  identificationErrorText,
  identificationLacksRepresentative,
  identificationPersons,
  isRepresentativeSubject,
  normalizeLeadIdentificationStatus,
  ownAccountPaymentLabel,
  payerSamePerson,
  qualifiedSignatureLabel,
  representativeSubject,
  type LeadIdentificationStatus,
  type PersonIdentification,
  type RepresentativeIdentification,
} from "./lead-identification";
import { identificationStatusChanged } from "./use-lead-identification-status";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const NOTHING: PersonIdentification = { qes: null, own_account_payment: null };
const SIGNED = { signed_at: "2026-10-05T09:20:00Z", test_mode: false };
const CONFIRMED = { confirmed_at: "2026-10-05T10:00:00Z", confirmed_by_name: "Petra Manager", note: null };

const ANNA_ID = "11111111-1111-4111-8111-111111111111";
const BEN_ID = "22222222-2222-4222-8222-222222222222";

function representative(patch: Partial<RepresentativeIdentification> & { id: string; name: string }): RepresentativeIdentification {
  return {
    ...NOTHING,
    subject: representativeSubject(patch.id),
    relation: "parent",
    has_email: true,
    ...patch,
  };
}

/** A lead as the server answers it: an adult unless the patch says otherwise. */
function status(patch: Partial<LeadIdentificationStatus> = {}): LeadIdentificationStatus {
  return { contract_partner: NOTHING, payer: null, minor: false, representatives: [], acting_persons: [], ...patch };
}

describe("normalizeLeadIdentificationStatus", () => {
  it("reads the patient and, when a third party pays, the payer", () => {
    expect(
      normalizeLeadIdentificationStatus({
        contract_partner: {
          qes: { signed_at: "2026-10-05T09:20:00Z", test_mode: false },
          own_account_payment: null,
        },
        payer: {
          qes: null,
          own_account_payment: {
            confirmed_at: "2026-10-05T10:00:00Z",
            confirmed_by_name: "Petra Manager",
            note: "  ",
          },
          same_person_as: null,
        },
        minor: false,
        representatives: [],
      }),
    ).toEqual({
      contract_partner: {
        qes: { signed_at: "2026-10-05T09:20:00Z", test_mode: false },
        own_account_payment: null,
      },
      payer: {
        qes: null,
        own_account_payment: {
          confirmed_at: "2026-10-05T10:00:00Z",
          confirmed_by_name: "Petra Manager",
          note: null,
        },
        same_person_as: null,
      },
      minor: false,
      representatives: [],
      acting_persons: [],
    });
  });

  it("reads an adult's representative and Betreuer, and none for a minor", () => {
    const raw = {
      contract_partner: { qes: SIGNED, own_account_payment: null },
      payer: null,
      minor: false,
      representatives: [],
      acting_persons: [
        {
          id: BEN_ID,
          subject: "payer",
          slot: "agent",
          role: "authorised_representative",
          name: " Ben Vertreter ",
          relation: "representative",
          has_email: true,
          qes: SIGNED,
          own_account_payment: null,
        },
        {
          id: ANNA_ID,
          slot: "guardian",
          role: "legal_guardian",
          name: "Mia Betreuerin",
          relation: "legal_guardian",
          qes: null,
          own_account_payment: CONFIRMED,
        },
        // Not an acting person: a minor's slot, no slot, no id.
        { id: "33333333-3333-4333-8333-333333333333", slot: "rep1", name: "Tante Muster" },
        { id: "44444444-4444-4444-8444-444444444444", name: "Onkel Muster" },
        { slot: "agent", name: "Nobody" },
      ],
    };
    const answer = normalizeLeadIdentificationStatus(raw);
    expect(answer?.acting_persons).toEqual([
      {
        ...representative({ id: BEN_ID, name: "Ben Vertreter", relation: "representative", qes: SIGNED }),
        slot: "agent",
        role: "authorised_representative",
      },
      {
        // Without the flag there is no e-mail.
        ...representative({
          id: ANNA_ID,
          name: "Mia Betreuerin",
          relation: "legal_guardian",
          has_email: false,
          own_account_payment: CONFIRMED,
        }),
        slot: "guardian",
        role: "legal_guardian",
      },
    ]);
    // The subject always follows the id.
    expect(answer?.acting_persons[0].subject).toBe(`representative:${BEN_ID}`);
    expect(answer?.representatives).toEqual([]);
    // A minor is represented by the legal representatives only.
    expect(normalizeLeadIdentificationStatus({ ...raw, minor: true })?.acting_persons).toEqual([]);
    // An older server: no acting persons.
    expect(normalizeLeadIdentificationStatus({ contract_partner: {} })?.acting_persons).toEqual([]);
  });

  it("reads a server that does not know minors yet as an adult lead", () => {
    expect(normalizeLeadIdentificationStatus({ contract_partner: {}, payer: null })).toEqual(status());
    expect(normalizeLeadIdentificationStatus({ contract_partner: {}, payer: {} })).toEqual(
      status({ payer: { ...NOTHING, same_person_as: null } }),
    );
  });

  it("drops a signature or a confirmation without its time", () => {
    const answer = normalizeLeadIdentificationStatus({
      contract_partner: { qes: { test_mode: true }, own_account_payment: { confirmed_by_name: "Petra Manager" } },
    });
    expect(answer).toEqual(status());
  });

  it("knows nothing about a reply that is not a status", () => {
    for (const reply of [null, undefined, [], "ok", {}, { payer: null }, { contract_partner: [] }]) {
      expect(normalizeLeadIdentificationStatus(reply)).toBeNull();
    }
  });

  it("reads the legal representatives of a minor, each with the own signature and payment", () => {
    const answer = normalizeLeadIdentificationStatus({
      // The child neither signs nor pays.
      contract_partner: { qes: null, own_account_payment: null },
      payer: null,
      minor: true,
      representatives: [
        {
          id: ANNA_ID,
          subject: `representative:${ANNA_ID}`,
          name: " Anna Muster ",
          relation: "parent",
          has_email: true,
          qes: SIGNED,
          own_account_payment: CONFIRMED,
        },
        { id: BEN_ID, subject: "payer", name: "Ben Muster", relation: null, qes: null, own_account_payment: null },
        // Not a person: no id.
        { name: "Nobody" },
        "text",
      ],
    });
    expect(answer).toEqual(
      status({
        minor: true,
        representatives: [
          representative({ id: ANNA_ID, name: "Anna Muster", qes: SIGNED, own_account_payment: CONFIRMED }),
          // The subject always follows the id; without the flag there is no e-mail.
          representative({ id: BEN_ID, name: "Ben Muster", relation: null, has_email: false }),
        ],
      }),
    );
    expect(answer?.representatives[1].subject).toBe(`representative:${BEN_ID}`);
  });

  it("names the representative a paying parent is, and only one of this answer", () => {
    const raw = {
      contract_partner: {},
      minor: true,
      representatives: [{ id: ANNA_ID, name: "Anna Muster", relation: "parent", has_email: true }],
    };
    const same = normalizeLeadIdentificationStatus({
      ...raw,
      payer: { qes: SIGNED, own_account_payment: null, same_person_as: `representative:${ANNA_ID}` },
    });
    expect(same?.payer).toEqual({ qes: SIGNED, own_account_payment: null, same_person_as: `representative:${ANNA_ID}` });
    expect(payerSamePerson(same)?.name).toBe("Anna Muster");

    for (const samePersonAs of [`representative:${BEN_ID}`, "contract_partner", "representative:", 7, null]) {
      const other = normalizeLeadIdentificationStatus({ ...raw, payer: { same_person_as: samePersonAs } });
      expect(other?.payer?.same_person_as).toBeNull();
      expect(payerSamePerson(other)).toBeNull();
    }
    expect(payerSamePerson(null)).toBeNull();
  });
});

describe("the subject of a legal representative", () => {
  it("is the id of the trusted contact behind a prefix", () => {
    expect(representativeSubject(ANNA_ID)).toBe(`representative:${ANNA_ID}`);
    expect(isRepresentativeSubject(`representative:${ANNA_ID}`)).toBe(true);
    for (const value of ["representative:", "payer", "contract_partner", "", null, 5]) {
      expect(isRepresentativeSubject(value)).toBe(false);
    }
  });
});

describe("qualifiedSignatureLabel", () => {
  it("says that there is no qualified signature yet", () => {
    expect(qualifiedSignatureLabel(NOTHING, ru)).toEqual({
      tone: "neutral",
      text: "Квалифицированной подписи ещё нет",
    });
    expect(qualifiedSignatureLabel(NOTHING, de).text).toBe("Noch keine qualifizierte Signatur");
  });

  it("dates the signature on the Berlin day", () => {
    // 22:30 UTC is already the next day in Berlin.
    const person = { ...NOTHING, qes: { signed_at: "2026-10-04T22:30:00Z", test_mode: false } };
    expect(qualifiedSignatureLabel(person, ru)).toEqual({
      tone: "success",
      text: "Квалифицированная подпись · 05.10.2026",
    });
    expect(qualifiedSignatureLabel(person, de).text).toBe("Qualifizierte Signatur · 05.10.2026");
  });

  it("marks a signature of the demo account as a test, without the success tone", () => {
    const person = { ...NOTHING, qes: { signed_at: "2026-10-05T09:20:00Z", test_mode: true } };
    expect(qualifiedSignatureLabel(person, ru)).toEqual({
      tone: "info",
      text: "Квалифицированная подпись · 05.10.2026 · тест",
    });
    expect(qualifiedSignatureLabel(person, de).text).toBe("Qualifizierte Signatur · 05.10.2026 · Test");
  });
});

describe("ownAccountPaymentLabel", () => {
  it("awaits the payment until staff confirm it", () => {
    expect(ownAccountPaymentLabel(NOTHING, ru)).toEqual({
      tone: "warning",
      text: "Ожидается платёж с собственного счёта",
    });
    expect(ownAccountPaymentLabel(NOTHING, de).text).toBe("Zahlung vom eigenen Konto ausstehend");
  });

  it("names the day and who confirmed the payment", () => {
    const person = {
      ...NOTHING,
      own_account_payment: { confirmed_at: "2026-10-05T10:00:00Z", confirmed_by_name: "Petra Manager", note: null },
    };
    expect(ownAccountPaymentLabel(person, ru)).toEqual({
      tone: "success",
      text: "Платёж с собственного счёта подтверждён · 05.10.2026 · Petra Manager",
    });
    expect(ownAccountPaymentLabel(person, de).text).toBe(
      "Zahlung vom eigenen Konto bestätigt · 05.10.2026 · Petra Manager",
    );
  });

  it("leaves out the name of a user who no longer exists", () => {
    const person = {
      ...NOTHING,
      own_account_payment: { confirmed_at: "2026-10-05T10:00:00Z", confirmed_by_name: null, note: null },
    };
    expect(ownAccountPaymentLabel(person, ru).text).toBe("Платёж с собственного счёта подтверждён · 05.10.2026");
  });
});

describe("identificationPersons", () => {
  const line = { detail: "", canConfirm: true, wide: false, note: "" };

  it("lists the patient alone while the patient pays", () => {
    expect(identificationPersons(status(), ru)).toEqual([
      { ...line, subject: "contract_partner", role: "Пациент", person: NOTHING },
    ]);
    expect(identificationLacksRepresentative(status())).toBe(false);
  });

  it("adds the payer when a third party pays", () => {
    const payer = { ...NOTHING, qes: SIGNED };
    expect(identificationPersons(status({ payer: { ...payer, same_person_as: null } }), de)).toEqual([
      { ...line, subject: "contract_partner", role: "Patient/in", person: NOTHING },
      { ...line, subject: "payer", role: "Kostenübernehmer", person: payer },
    ]);
  });

  it("lists the legal representatives of a minor and no line for the child", () => {
    const minor = status({
      // Whatever an older row says about the child: it has no line.
      contract_partner: { qes: SIGNED, own_account_payment: CONFIRMED },
      minor: true,
      representatives: [
        representative({ id: ANNA_ID, name: "Anna Muster", qes: SIGNED, own_account_payment: CONFIRMED }),
        representative({ id: BEN_ID, name: "Ben Muster", relation: "guardian", has_email: false }),
      ],
    });
    expect(identificationPersons(minor, ru)).toEqual([
      {
        subject: `representative:${ANNA_ID}`,
        role: "Anna Muster",
        detail: "родитель",
        person: { qes: SIGNED, own_account_payment: CONFIRMED },
        canConfirm: true,
        wide: false,
        note: "",
      },
      {
        subject: `representative:${BEN_ID}`,
        role: "Ben Muster",
        detail: "опекун",
        person: NOTHING,
        canConfirm: true,
        wide: false,
        // A signature is attributed by the signer's e-mail.
        note: "нет e-mail — подпись не засчитается",
      },
    ]);
    const german = identificationPersons(minor, de);
    expect(german.map((person) => person.detail)).toEqual(["Elternteil", "Vormund"]);
    expect(german[1].note).toBe("keine E-Mail – die Signatur wird nicht angerechnet");
    expect(identificationLacksRepresentative(minor)).toBe(false);
  });

  it("lists an adult's representative and Betreuer after the patient and before the payer", () => {
    const payer = { ...NOTHING, same_person_as: null };
    const adult = status({
      payer,
      acting_persons: [
        {
          ...representative({ id: BEN_ID, name: "Ben Vertreter", relation: "representative", qes: SIGNED }),
          slot: "agent",
          role: "authorised_representative",
        },
        {
          ...representative({ id: ANNA_ID, name: "", relation: null, has_email: false, own_account_payment: CONFIRMED }),
          slot: "guardian",
          role: "legal_guardian",
        },
      ],
    });
    expect(identificationPersons(adult, ru)).toEqual([
      { ...line, subject: "contract_partner", role: "Пациент", person: NOTHING },
      {
        ...line,
        subject: `representative:${BEN_ID}`,
        role: "Ben Vertreter",
        detail: "уполномоченный представитель",
        person: { qes: SIGNED, own_account_payment: null },
      },
      {
        ...line,
        subject: `representative:${ANNA_ID}`,
        // Without a name the line is captioned by the role.
        role: "Опекун (Betreuer)",
        detail: "опекун (Betreuer)",
        person: { qes: null, own_account_payment: CONFIRMED },
        note: "нет e-mail — подпись не засчитается",
      },
      { ...line, subject: "payer", role: "Плательщик", person: NOTHING },
    ]);
    const german = identificationPersons(adult, de);
    expect(german.map((person) => person.detail)).toEqual(["", "bevollmächtigte Person", "Betreuer/in", ""]);
    expect(german[2].role).toBe("Betreuer/in");
    expect(identificationLacksRepresentative(adult)).toBe(false);
  });

  it("captions a representative without a name or a known relation", () => {
    const minor = status({
      minor: true,
      representatives: [representative({ id: ANNA_ID, name: "", relation: "Mutter" })],
    });
    expect(identificationPersons(minor, ru)[0]).toMatchObject({
      role: "Законный представитель",
      detail: "законный представитель",
    });
  });

  it("shows a paying parent once: the payer line repeats the representative and confirms nothing", () => {
    const minor = status({
      minor: true,
      representatives: [
        representative({ id: ANNA_ID, name: "Anna Muster", qes: SIGNED, own_account_payment: CONFIRMED }),
        representative({ id: BEN_ID, name: "Ben Muster" }),
      ],
      // The server repeats the representative's values; the line reads them from the representative.
      payer: { ...NOTHING, same_person_as: `representative:${ANNA_ID}` },
    });
    const persons = identificationPersons(minor, ru);
    expect(persons.map((person) => person.subject)).toEqual([
      `representative:${ANNA_ID}`,
      `representative:${BEN_ID}`,
      "payer",
    ]);
    expect(persons[2]).toEqual({
      subject: "payer",
      role: "Плательщик — тот же человек, что и представитель Anna Muster",
      detail: "",
      person: { qes: SIGNED, own_account_payment: CONFIRMED },
      canConfirm: false,
      wide: true,
      note: "",
    });
    expect(identificationPersons(minor, de)[2].role).toBe(
      "Kostenträger — dieselbe Person wie Vertreter/in Anna Muster",
    );
  });

  it("keeps the own line of a payer who is somebody else", () => {
    const minor = status({
      minor: true,
      representatives: [representative({ id: ANNA_ID, name: "Anna Muster" })],
      payer: { ...NOTHING, qes: SIGNED, same_person_as: null },
    });
    expect(identificationPersons(minor, ru)[1]).toEqual({
      ...line,
      subject: "payer",
      role: "Плательщик",
      person: { ...NOTHING, qes: SIGNED },
    });
  });

  it("knows a minor without a parent or guardian on file", () => {
    const alone = status({ minor: true, payer: { ...NOTHING, same_person_as: null } });
    expect(identificationLacksRepresentative(alone)).toBe(true);
    // Only the payer is left to identify.
    expect(identificationPersons(alone, ru).map((person) => person.subject)).toEqual(["payer"]);
  });
});

describe("refusals of the server", () => {
  it("explains that the payment of a minor is confirmed for a representative", () => {
    const refused = new ApiRequestError("identification_subject_minor", {
      status: 422,
      code: "identification_subject_minor",
      body: { error: "identification_subject_minor" },
    });
    expect(identificationErrorText(refused, ru)).toContain("платёж подтверждается у законного представителя");
    expect(identificationErrorText(refused, de)).toContain("bei der gesetzlichen Vertretung");
    expect(identificationErrorText(new ApiRequestError("lead_converted", { status: 409 }), ru)).toBeNull();
    expect(identificationErrorText(new Error("identification_subject_minor"), ru)).toBeNull();
  });
});

describe("when the status is loaded again", () => {
  it("follows a confirmed payment, a new payer and a change of the representation", () => {
    expect(identificationStatusChanged({ type: "lead.updated", payload: { identification_updated: true } })).toBe(true);
    expect(identificationStatusChanged({ type: "lead.updated", payload: {} })).toBe(false);
    expect(identificationStatusChanged({ type: "lead.portal_updated", payload: { change: "payer" } })).toBe(true);
    // A parent in the cabinet (with `access_kind`) or a colleague (without).
    expect(
      identificationStatusChanged({ type: "lead.portal_updated", payload: { change: "representation", access_kind: "guardian" } }),
    ).toBe(true);
    expect(identificationStatusChanged({ type: "lead.portal_updated", payload: { change: "representation" } })).toBe(true);
    expect(identificationStatusChanged({ type: "lead.portal_updated", payload: { change: "personal_data" } })).toBe(false);
    expect(identificationStatusChanged({ type: "lead.portal_updated" })).toBe(false);
    expect(identificationStatusChanged({ type: "document.updated", payload: { change: "representation" } })).toBe(false);
  });
});
