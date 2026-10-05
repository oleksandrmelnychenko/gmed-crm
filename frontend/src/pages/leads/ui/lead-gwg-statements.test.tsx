import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { normalizeLeadPortalIntake, type LeadPortalIntake } from "../data/lead-portal-intake-api";
import type { GwgPayerStatement } from "../model/lead-gwg-statements";
import { LeadGwgStatements } from "./lead-gwg-statements";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const TODAY = "2026-10-05";

function portalState(patch: Record<string, unknown> = {}): LeadPortalIntake {
  return normalizeLeadPortalIntake({
    lead_id: "lead-1",
    fill_mode: "patient",
    identification: {
      salutation: "ms",
      former_names: "Anna Beispiel",
      birth_place: "Kyiv",
      birth_country: "UA",
      habitual_residence_country: "AT",
      contact_channels: ["email", "phone"],
      id_document_type: "passport",
      id_document_number: "FA1234567",
      id_issuing_authority: "Passamt 8031",
      id_issuing_country: "UA",
      id_issued_on: "2021-05-01",
      id_valid_until: "2031-04-30",
      pep_self: true,
      pep_self_details: "Member of parliament, 2021–2024",
      pep_related: false,
      pep_related_details: null,
      high_risk_country: true,
      high_risk_country_code: "IR",
      sanctions_links: null,
      sanctions_links_details: null,
      payment_background: "My brother pays for the treatment",
      declared_correct_at: "2026-10-05T09:30:00Z",
    },
    identification_updated_at: "2026-10-05T09:20:00Z",
    identity_documents: [
      { id: "doc-1", file_name: "pass-front.pdf", uploaded_at: "2026-10-05T09:10:00Z", reviewed: false },
      { id: "doc-2", file_name: "pass-back.jpg", uploaded_at: "2026-10-04T08:00:00Z", reviewed: true },
    ],
    ...patch,
  }) as LeadPortalIntake;
}

function render(
  intake: LeadPortalIntake | null,
  payer: GwgPayerStatement | null = { acts_on_own_account: true },
  lang: "ru" | "de" = "ru",
) {
  return renderToStaticMarkup(
    <LeadGwgStatements intake={intake} payer={payer} tx={lang === "de" ? de : ru} lang={lang} today={TODAY} />,
  );
}

/** The markup of one statement, found by its test id. */
function statement(html: string, testId: string): string {
  const start = html.indexOf(`data-testid="${testId}"`);
  if (start < 0) return "";
  const end = html.indexOf("</dd>", start);
  return html.slice(start, end);
}

describe("LeadGwgStatements", () => {
  it("shows what the lead stated, grouped and with the time of the last change", () => {
    const html = render(portalState());
    expect(html).toContain("Данные от пациента");
    // 09:20 UTC is 11:20 in Berlin.
    expect(html).toContain("от пациента · 05.10.2026 11:20");
    for (const text of [
      "Личность",
      "Госпожа",
      "Anna Beispiel",
      "Kyiv",
      "Украина",
      "Австрия",
      "E-mail, Телефон",
      "Документ, удостоверяющий личность",
      "Паспорт",
      "FA1234567",
      "Passamt 8031",
      "01.05.2021",
      "30.04.2031",
      "pass-front.pdf",
      " · 05.10.2026",
      "pass-back.jpg",
      " · 04.10.2026 · просмотрен",
      "Юридические вопросы",
      "My brother pays for the treatment",
      "Подтвердил правильность: 05.10.2026 11:30",
    ]) {
      expect(html).toContain(text);
    }
    expect(statement(html, "lead-gwg-id-valid-until")).not.toContain('data-warning="true"');
    expect(html).not.toContain("lead-gwg-statements-empty");
    // Nothing can be edited.
    expect(html).not.toMatch(/<(input|textarea|select|button)\b/);
  });

  it("emphasises a yes with its details and leaves the other answers plain", () => {
    const html = render(portalState());
    const pep = statement(html, "lead-gwg-answer-pep_self");
    expect(pep).toContain('data-warning="true"');
    expect(pep).toContain("Да");
    expect(pep).toContain("Member of parliament, 2021–2024");
    const country = statement(html, "lead-gwg-answer-high_risk_country");
    expect(country).toContain('data-warning="true"');
    expect(country).toContain("Иран");
    const related = statement(html, "lead-gwg-answer-pep_related");
    expect(related).not.toContain('data-warning="true"');
    expect(related).toContain("Нет");
    const sanctions = statement(html, "lead-gwg-answer-sanctions_links");
    expect(sanctions).not.toContain('data-warning="true"');
    expect(sanctions).toContain("Не отвечено");
  });

  it("warns about an expired or missing validity of the identity document", () => {
    const base = portalState().identification!;
    const expired = statement(
      render({ ...portalState(), identification: { ...base, id_valid_until: "2026-10-04" } }),
      "lead-gwg-id-valid-until",
    );
    expect(expired).toContain('data-warning="true"');
    expect(expired).toContain("04.10.2026 · срок истёк");
    const lastDay = statement(
      render({ ...portalState(), identification: { ...base, id_valid_until: TODAY } }),
      "lead-gwg-id-valid-until",
    );
    expect(lastDay).not.toContain('data-warning="true"');
    const missing = statement(
      render({ ...portalState(), identification: { ...base, id_valid_until: null } }),
      "lead-gwg-id-valid-until",
    );
    expect(missing).toContain('data-warning="true"');
    expect(missing).toContain("не указано");
  });

  it("takes the economic interest from the payer declaration", () => {
    const own = statement(render(portalState(), { acts_on_own_account: true }), "lead-gwg-own-account");
    expect(own).toContain("Да");
    expect(own).not.toContain('data-warning="true"');

    const html = render(portalState(), {
      acts_on_own_account: false,
      beneficial_owner_name: "Viktor Zahler",
      beneficial_owner_note: "02.03.1970, Wien",
    });
    const other = statement(html, "lead-gwg-own-account");
    expect(other).toContain("Нет");
    expect(other).toContain('data-warning="true"');
    expect(html).toContain("В чьих интересах");
    expect(html).toContain("Viktor Zahler · 02.03.1970, Wien");

    const unanswered = render(portalState(), null);
    expect(statement(unanswered, "lead-gwg-own-account")).toContain("Не отвечено");
    expect(unanswered).not.toContain("В чьих интересах");
    // A declaration whose own-account value is only the stored default.
    const byDefault = render(portalState(), { acts_on_own_account: true, own_account_answered: false });
    expect(statement(byDefault, "lead-gwg-own-account")).toContain("Не отвечено");
  });

  it("shows a dash for what the lead left empty", () => {
    const html = render(
      portalState({
        identification: { birth_place: "Kyiv" },
        identity_documents: [],
      }),
      null,
    );
    expect(html).toContain("Kyiv");
    expect(statement(html, "lead-gwg-identity-documents")).toContain("—");
    expect(html.match(/—/g)?.length).toBeGreaterThanOrEqual(10);
    expect(html).toContain("Подтвердил правильность: ещё нет");
  });

  it("says so when the lead entered nothing yet, and nothing else", () => {
    for (const intake of [
      portalState({ identification: {}, identification_updated_at: null, identity_documents: [] }),
      // An older backend sends no statements at all.
      normalizeLeadPortalIntake({ lead_id: "lead-1" }),
    ]) {
      const html = render(intake);
      expect(html).toContain("Данные от пациента");
      expect(html).toContain("Пациент ещё не заполнил эти данные в кабинете");
      expect(html).not.toContain("от пациента ·");
      expect(html).not.toContain("<dl");
      expect(html).not.toContain("Подтвердил правильность");
    }
    expect(render(portalState({ identification: {}, identification_updated_at: null, identity_documents: [] }), null, "de"))
      .toContain("Der Patient hat diese Angaben im Portal noch nicht gemacht");
  });

  it("stays out until the portal state is loaded", () => {
    expect(render(null)).toBe("");
  });

  it("does not claim empty statements for a role the server keeps them from", () => {
    const hidden = portalState({
      identification: {},
      identification_updated_at: null,
      identification_hidden: true,
      identity_documents: [],
    });
    expect(render(hidden)).toBe("");
  });

  it("reads in German too", () => {
    const html = render(portalState(), { acts_on_own_account: true }, "de");
    for (const text of [
      "Angaben des Patienten",
      "vom Patienten · 05.10.2026 11:20",
      "Frau",
      "Ukraine",
      "Österreich",
      "Reisepass",
      "Ausstellende Behörde",
      "Gültig bis",
      "Wirtschaftliches Interesse",
      "Rechtliche Fragen",
      "Richtigkeit bestätigt am 05.10.2026 11:30",
    ]) {
      expect(html).toContain(text);
    }
    expect(statement(html, "lead-gwg-answer-high_risk_country")).toContain("Iran");
    expect(render(portalState({ identification: { birth_place: "Kyiv" } }), null, "de")).toContain(
      "Richtigkeit bestätigt: noch nicht",
    );
  });
});
