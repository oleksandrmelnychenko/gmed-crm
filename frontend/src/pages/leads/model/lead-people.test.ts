import { describe, expect, it } from "vitest";

import { cabinetPeople, consentFormRecipients, mergeLeadPeople, personNameKey } from "./lead-people";
import type { LeadPortalConsentForm } from "./lead-portal-consents";

const contact = (id: string, name: string, relation: string) => ({ id, name, relation });
const form = (namedRecipients: boolean | null, names: string[]): LeadPortalConsentForm => ({
  version: "1",
  choices: { named_recipients: namedRecipients } as LeadPortalConsentForm["choices"],
  recipients: names.map((name) => ({ name, relation: "spouse", contact: null })),
  chosen_at: null, chosen_by: null, chosen_by_name: null, chosen_by_role: null, access_kind: "self",
});

describe("one list of people", () => {
  it("matches «Kurz, Inga» with «Inga Kurz»", () => {
    expect(personNameKey("Kurz, Inga")).toBe(personNameKey("Inga  Kurz"));
  });

  it("shows a person in both sources once, staff entry first, cabinet-only persons after", () => {
    const rows = mergeLeadPeople(
      [contact("a", "Alfred Pupkin", "father"), contact("b", "Inga Kurz", "spouse")],
      [{ name: "Kurz, Inga", relation: "spouse", contact: null }, { name: "Dr. Hausarzt", relation: "family_doctor", contact: null }],
    );
    expect(rows.map((row) => [row.name, Boolean(row.contact), Boolean(row.cabinet)])).toEqual([
      ["Alfred Pupkin", true, false],
      ["Inga Kurz", true, true],
      ["Dr. Hausarzt", false, true],
    ]);
  });

  it("takes the trusted persons and the choice's recipients once each", () => {
    const people = cabinetPeople([{ name: "Inga Kurz", relation: "spouse", contact: null }], form(true, ["Kurz, Inga", "Max Muster"]));
    expect(people.map((person) => person.name)).toEqual(["Inga Kurz", "Max Muster"]);
  });
});

describe("who the consent form names", () => {
  const contacts = [contact("a", "Alfred Pupkin", "father"), contact("b", "Inga Kurz", "spouse")];

  it("prints the cabinet recipients while the client ticked «named recipients»", () => {
    expect(consentFormRecipients(form(true, ["Max Muster"]), contacts, false)).toEqual({ source: "cabinet", names: ["Max Muster"] });
    expect(consentFormRecipients(form(false, ["Max Muster"]), contacts, false)).toEqual({ source: "cabinet", names: [] });
  });

  it("prints the staff contacts without a cabinet choice, without parents on a minor's form", () => {
    expect(consentFormRecipients(null, contacts, false)).toEqual({ source: "staff", names: ["Alfred Pupkin", "Inga Kurz"] });
    expect(consentFormRecipients(null, contacts, true)).toEqual({ source: "staff", names: ["Inga Kurz"] });
  });
});
