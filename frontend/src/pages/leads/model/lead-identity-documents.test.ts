import { describe, expect, it } from "vitest";

import type { StaffPayerQuestionnaire } from "../data/lead-payer-link-api";
import type { LeadPortalIntake, LeadRepresentative } from "../data/lead-portal-intake-api";
import {
  identityDocumentCount,
  identityDocumentGroups,
  identityDocumentOriginLabel,
} from "./lead-identity-documents";

const ru = (ruText: string) => ruText;

const file = (id: string, extra: Record<string, unknown> = {}) => ({
  id, file_name: `${id}.pdf`, uploaded_at: "2026-10-24T08:00:00Z", reviewed: false, ...extra,
});

const mother = {
  id: "rep-1", slot: "rep1", role: "legal_representative", relation: "mother",
  first_name: "Anna", last_name: "Muster",
  identity_documents: [file("mother-id", { uploaded_by_staff: true })],
  authority_documents: [file("custody-order")],
} as unknown as LeadRepresentative;

const unnamedAgent = {
  id: "rep-2", slot: "agent", role: "authorised_representative", relation: "representative",
  first_name: null, last_name: null, identity_documents: [], authority_documents: [],
} as unknown as LeadRepresentative;

const intake = {
  identity_documents: [file("pass-front"), file("pass-back", { reviewed: true })],
  representation: { representatives: [mother, unnamedAgent] },
} as unknown as LeadPortalIntake;

const payer = {
  answers: { first_name: "Otto", last_name: "Zahler" },
  identity_documents: [{ id: "payer-id", file_name: "payer-id.jpg", uploaded_at: null, reviewed: true }],
} as unknown as StaffPayerQuestionnaire;

describe("the identity copies the lead detail lists", () => {
  it("groups the lead's, each representative's and the payer's files, in that order", () => {
    const groups = identityDocumentGroups(intake, payer, ru);
    expect(groups.map((group) => [group.kind, group.title, group.subtitle])).toEqual([
      ["patient", "Пациент", ""],
      ["representative", "Anna Muster", "Мать"],
      // A representative without a name is called by the role.
      ["representative", "Уполномоченный представитель", ""],
      ["payer", "Otto Zahler", "Плательщик"],
    ]);
    expect(groups[0].files.map((item) => [item.id, item.origin, item.reviewed])).toEqual([
      ["pass-front", "cabinet", false],
      ["pass-back", "cabinet", true],
    ]);
    expect(groups[1].files[0]).toMatchObject({ id: "mother-id", origin: "staff" });
    expect(groups[1].authority.map((item) => item.id)).toEqual(["custody-order"]);
    expect(groups[3].files[0]).toMatchObject({ id: "payer-id", origin: "payer_link", reviewed: true });
    expect(identityDocumentCount(groups)).toBe(5);
  });

  it("always lists the lead's own group, and the payer only with a file", () => {
    const groups = identityDocumentGroups(null, null, ru);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "patient", files: [] });
    expect(identityDocumentCount(groups)).toBe(0);
    const noPayerFiles = identityDocumentGroups(intake, { ...payer, identity_documents: [] }, ru);
    expect(noPayerFiles.some((group) => group.kind === "payer")).toBe(false);
  });

  it("names a nameless payer by the role", () => {
    const groups = identityDocumentGroups(null, { ...payer, answers: { first_name: null, last_name: " " } } as StaffPayerQuestionnaire, ru);
    expect(groups[1]).toMatchObject({ kind: "payer", title: "Плательщик", subtitle: "" });
  });

  it("says who uploaded a file", () => {
    expect(identityDocumentOriginLabel("cabinet", ru)).toBe("Из кабинета");
    expect(identityDocumentOriginLabel("staff", ru)).toBe("Загружено сотрудником");
    expect(identityDocumentOriginLabel("payer_link", ru)).toBe("По ссылке плательщика");
  });
});
