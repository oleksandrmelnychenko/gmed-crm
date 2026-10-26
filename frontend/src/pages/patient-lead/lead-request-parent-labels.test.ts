import { describe, expect, it } from "vitest";

import type { LeadRequest, LeadRequestRepresentative } from "./lead-request-api";
import { draftFromPayer, otherParentOf, payerChoiceOf, payerInput, withPayerChoice } from "./lead-request-model";
import { payerPartyOf } from "./lead-request-recipient-model";
import { leadRequestText, submitFieldLabel } from "./lead-request-text";

// QA 2026-10-22: a parent on a phone must see whose field is meant (the child's, the own, the other
// parent's), and the other parent of joint custody pays as a representative, never as a third party.

const ru = leadRequestText("ru");

function parent(id: string, slot: "rep1" | "rep2", mine: boolean, firstName: string): LeadRequestRepresentative {
  return {
    id, slot, role: "legal_representative", relation: "parent", mine, email_locked: mine, can_remove: false,
    first_name: firstName, last_name: "Muster", date_of_birth: "1985-04-12", birth_place: null, birth_country: null,
    citizenships: ["DE"], street: "Weg 1", zip: "10115", city: "Berlin", country: "DE",
    email: `${firstName.toLowerCase()}@example.com`, phone: null, identity_documents: [], authority_documents: [],
  };
}

const maria = parent("m", "rep1", true, "Maria");
const ben = parent("b", "rep2", false, "Ben");

function guardianRequest(representatives: LeadRequestRepresentative[]): LeadRequest {
  return {
    access_kind: "guardian",
    minor: true,
    representation: { has_representative: null, under_guardianship: null, custody: "joint", custody_stated: true, representatives },
  } as unknown as LeadRequest;
}

describe("the missing list of a parent's login", () => {
  it("names the child's fields as the child's", () => {
    expect(submitFieldLabel(ru, "date_of_birth", true, null, true)).toBe("Личные данные ребёнка: Дата рождения");
    expect(submitFieldLabel(ru, "city", true, null, true)).toBe("Адрес ребёнка: Город");
    // An adult's own request keeps the bare field name.
    expect(submitFieldLabel(ru, "date_of_birth")).toBe("Дата рождения");
  });

  it("names the parents as 'you' and 'the other parent'", () => {
    const who = { mineSlot: "rep1" as const, custody: "joint" as const };
    expect(submitFieldLabel(ru, "rep1_citizenships", true, null, true, who)).toBe("Вы: Гражданство");
    expect(submitFieldLabel(ru, "rep2_first_name", true, null, true, who)).toBe("Второй родитель: Имя");
    // Without a login among the parents: no place numbers either (labels audit 2026-10-26, B5).
    expect(submitFieldLabel(ru, "rep2_first_name", true, null, true, { mineSlot: null, custody: "joint" })).toBe("Другой родитель: Имя");
  });
});

describe("the other parent pays", () => {
  it("is the other parent of joint custody of a parent's login only", () => {
    expect(otherParentOf(guardianRequest([maria, ben]))?.id).toBe("b");
    expect(otherParentOf(guardianRequest([maria]))).toBeNull();
    expect(otherParentOf(guardianRequest([{ ...maria, mine: false }, ben]))).toBeNull();
    expect(otherParentOf({ ...guardianRequest([maria, ben]), access_kind: "self" })).toBeNull();
  });

  it("is saved as that representative, never as a third party", () => {
    const draft = withPayerChoice(draftFromPayer(null), "other_parent", null, ben);
    expect(payerChoiceOf(draft)).toBe("other_parent");
    expect(payerInput(draft)).toEqual({ payer_kind: "representative", payer_representative_id: "b" });
  });

  it("is another person than the signed-in parent", () => {
    const payer = { ...draftFromPayer(null), payer_kind: "representative", payer_representative_id: "b" } as never;
    expect(payerPartyOf(payer, false)).toBe("other");
    expect(payerPartyOf(payer, true)).toBe("patient");
  });
});
