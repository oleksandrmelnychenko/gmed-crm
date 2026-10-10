import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { normalizeLeadPayerLinkState, type LeadPayerLinkState } from "../data/lead-payer-link-api";
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
    // An unanswered legal question is left out while block L was not asked (QA 2026-10-10) …
    expect(html).not.toContain('data-testid="lead-gwg-answer-sanctions_links"');
    // … and reads "not answered" once the lead is asked it.
    const asked = renderToStaticMarkup(
      <LeadGwgStatements intake={portalState()} payer={{ acts_on_own_account: true }} askedBlocks={["L"]} tx={ru} lang="ru" today={TODAY} />,
    );
    const sanctions = statement(asked, "lead-gwg-answer-sanctions_links");
    expect(sanctions).not.toContain('data-warning="true"');
    expect(sanctions).toContain("Не отвечено");
  });

  it("leaves out the birth data a lead was never asked (block K)", () => {
    const base = portalState().identification!;
    const intake = { ...portalState(), identification: { ...base, former_names: null, birth_place: null, birth_country: null } };
    const html = render(intake);
    expect(html).not.toContain('data-testid="lead-gwg-birth_place"');
    expect(html).not.toContain("Фамилия при рождении");
    const asked = renderToStaticMarkup(
      <LeadGwgStatements intake={intake} payer={{ acts_on_own_account: true }} askedBlocks={["K"]} tx={ru} lang="ru" today={TODAY} />,
    );
    expect(asked).toContain('data-testid="lead-gwg-birth_place"');
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

  it("says in amber when the lead changed answers after sending, and nothing without the key", () => {
    const changed = render(portalState({ changed_since_submit: true }));
    expect(changed).toContain('data-testid="lead-gwg-changed-since-submit"');
    expect(changed).toContain("Пациент изменил данные после отправки — ещё не отправлено повторно");
    expect(render(portalState({ changed_since_submit: true }), null, "de")).toContain(
      "Die Patientin / der Patient hat Angaben nach dem Senden geändert – noch nicht erneut gesendet",
    );
    // Also while the lead entered no statements yet.
    expect(render(portalState({ identification: {}, identity_documents: [], changed_since_submit: true }))).toContain(
      "lead-gwg-changed-since-submit",
    );
    expect(render(portalState({ changed_since_submit: false }))).not.toContain("lead-gwg-changed-since-submit");
    // An older server does not send the key.
    expect(render(portalState())).not.toContain("lead-gwg-changed-since-submit");
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

const ANNA_ID = "11111111-1111-4111-8111-111111111111";
const BEN_ID = "22222222-2222-4222-8222-222222222222";

/** The mother filled in her data in the cabinet; the father is only a trusted contact. */
const PARENTS = [
  {
    id: ANNA_ID,
    slot: "rep1",
    role: "legal_representative",
    relation: "parent",
    first_name: "Anna",
    last_name: "Muster",
    date_of_birth: "1985-03-02",
    birth_place: "Kyiv",
    birth_country: "UA",
    citizenships: ["UA", "DE"],
    street: "Musterweg 1",
    zip: "10115",
    city: "Berlin",
    country: "DE",
    email: "anna.muster@example.com",
    phone: "+49 30 100001",
    id_document_type: "passport",
    id_document_number: "FA7654321",
    id_issuing_authority: "Passamt 8031",
    id_issuing_country: "UA",
    id_issued_on: "2021-05-01",
    id_valid_until: "2026-10-04",
    identity_documents: [{ id: "doc-a1", file_name: "anna-pass.pdf", uploaded_at: "2026-10-05T09:10:00Z", reviewed: true }],
    authority_documents: [{ id: "doc-a2", file_name: "sorgerecht.pdf", uploaded_at: "2026-10-04T08:00:00Z", reviewed: false }],
    has_login: true,
    has_data: true,
    contact_origin: "staff",
  },
  {
    id: BEN_ID,
    slot: "rep2",
    role: "legal_representative",
    relation: "parent",
    first_name: "Ben",
    last_name: "Muster",
    email: "ben.muster@example.com",
    has_login: false,
    has_data: false,
    contact_origin: "staff",
  },
];

function minorState(representation: Record<string, unknown>, patch: Record<string, unknown> = {}): LeadPortalIntake {
  return portalState({
    minor: true,
    representation: { has_representative: null, under_guardianship: null, custody: "joint", custody_stated: false, ...representation },
    representation_updated_at: "2026-10-05T09:40:00Z",
    ...patch,
  });
}

/** The markup of the representation group, or of one person in it. */
function part(html: string, testId: string, closing: string): string {
  const start = html.indexOf(`data-testid="${testId}"`);
  if (start < 0) return "";
  return html.slice(start, html.indexOf(closing, start));
}

describe("LeadGwgStatements: who acts for the lead", () => {
  it("lists the legal representatives of a minor after the identity document", () => {
    const html = render(minorState({ representatives: PARENTS }));
    expect(html).toContain("Законные представители");
    // 09:40 UTC is 11:40 in Berlin.
    expect(part(html, "lead-gwg-representation-updated", "</span>")).toContain("изменено в кабинете · 05.10.2026 11:40");
    expect(html.indexOf("lead-gwg-identity-documents")).toBeLessThan(html.indexOf('data-testid="lead-gwg-representation"'));
    expect(html.indexOf('data-testid="lead-gwg-representation"')).toBeLessThan(html.indexOf("lead-gwg-own-account"));
    // Nobody stated the custody: both parents represent the child, and both are on file.
    expect(statement(html, "lead-gwg-custody")).toContain("не указано — оба родителя");
    expect(html).not.toContain("lead-gwg-representation-warning");

    const anna = part(html, `lead-gwg-representative-${ANNA_ID}`, `lead-gwg-representative-${BEN_ID}"`);
    for (const text of [
      "Anna Muster",
      "Родитель",
      "есть доступ в кабинет",
      "02.03.1985",
      "Kyiv, Украина",
      "Украина, Германия",
      "Musterweg 1, 10115 Berlin, Германия",
      "anna.muster@example.com",
      "+49 30 100001",
      "Паспорт",
      "FA7654321",
      "Passamt 8031, Украина",
      "01.05.2021",
      "anna-pass.pdf",
      " · 05.10.2026 · просмотрен",
      "sorgerecht.pdf",
      " · 04.10.2026",
    ]) {
      expect(anna).toContain(text);
    }
    expect(anna).not.toContain("в кабинете ещё не заполнено");
    // Her passport ran out the day before.
    const expired = statement(html, `lead-gwg-representative-valid-until-${ANNA_ID}`);
    expect(expired).toContain('data-warning="true"');
    expect(expired).toContain("04.10.2026 · срок истёк");

    const ben = html.slice(html.indexOf(`data-testid="lead-gwg-representative-${BEN_ID}"`), html.indexOf("lead-gwg-own-account"));
    expect(ben).toContain("Ben Muster");
    expect(ben).toContain("в кабинете ещё не заполнено");
    expect(ben).not.toContain("есть доступ в кабинет");
    expect(statement(html, `lead-gwg-representative-valid-until-${BEN_ID}`)).toContain("не указано");
    expect(statement(html, `lead-gwg-representative-identity-documents-${BEN_ID}`)).toContain("—");
    // Still nothing can be edited.
    expect(html).not.toMatch(/<(input|textarea|select|button)\b/);
  });

  it("warns when the number of representatives does not fit the custody", () => {
    const sole = render(minorState({ custody: "sole_parent", custody_stated: true, representatives: PARENTS }));
    expect(statement(sole, "lead-gwg-custody")).toContain("Один родитель (единоличная опека)");
    expect(part(sole, "lead-gwg-representation-warning", "</p>")).toContain('data-warning="single_custody_several"');
    expect(sole).toContain("Ребёнка представляет один человек, но указано несколько представителей");

    const joint = render(minorState({ custody: "joint", custody_stated: true, representatives: [PARENTS[0]] }));
    expect(statement(joint, "lead-gwg-custody")).toContain("Оба родителя совместно");
    expect(part(joint, "lead-gwg-representation-warning", "</p>")).toContain('data-warning="joint_custody_incomplete"');
    expect(joint).toContain("Ребёнка представляют оба родителя, но указан только один");

    const guardian = render(minorState({ custody: "guardian", custody_stated: true, representatives: [{ ...PARENTS[0], relation: "guardian" }] }));
    expect(statement(guardian, "lead-gwg-custody")).toContain("Опекун или попечитель");
    expect(guardian).toContain("Опекун");
    expect(guardian).not.toContain("lead-gwg-representation-warning");
  });

  it("asks for a parent or guardian when a minor has none, instead of an empty list", () => {
    const html = render(minorState({ representatives: [] }));
    expect(part(html, "lead-gwg-representation-warning", "</p>")).toContain("Добавьте родителя или законного представителя");
    expect(html).not.toContain("lead-gwg-representative-");
    expect(render(minorState({ representatives: [] }), null, "de")).toContain(
      "Bitte einen Elternteil oder eine gesetzliche Vertreterin / einen gesetzlichen Vertreter hinzufügen",
    );
  });

  it("names the parents of a minor even while nobody opened the cabinet", () => {
    const html = render(
      minorState(
        { representatives: [PARENTS[1]] },
        { identification: {}, identification_updated_at: null, identity_documents: [], representation_updated_at: null },
      ),
    );
    expect(html).toContain("Пациент ещё не заполнил эти данные в кабинете");
    expect(html).toContain("Законные представители");
    expect(html).toContain("Ben Muster");
    expect(html).toContain("Ребёнка представляют оба родителя, но указан только один");
    expect(html).not.toContain("lead-gwg-representation-updated");
    // The lead's own statements are not claimed.
    expect(html).not.toContain("Юридические вопросы");
  });

  it("shows an adult the two answers and the person a yes names", () => {
    const html = render(
      portalState({
        minor: false,
        representation: {
          has_representative: true,
          under_guardianship: false,
          custody: null,
          custody_stated: false,
          representatives: [{ ...PARENTS[0], slot: "agent", role: "authorised_representative", relation: "representative", has_login: false }],
        },
        representation_updated_at: "2026-10-05T09:40:00Z",
      }),
    );
    expect(html).toContain("Представительство");
    expect(html).not.toContain("Законные представители");
    const acts = statement(html, "lead-gwg-has-representative");
    expect(acts).toContain("Да");
    expect(acts).toContain('data-warning="true"');
    const guardianship = statement(html, "lead-gwg-under-guardianship");
    expect(guardianship).toContain("Нет");
    expect(guardianship).not.toContain('data-warning="true"');
    expect(html).toContain("Уполномоченный представитель");
    expect(html).toContain("sorgerecht.pdf");
    expect(html).not.toContain("lead-gwg-custody");
    expect(html).not.toContain("lead-gwg-representation-warning");
    expect(html).not.toContain("есть доступ в кабинет");
  });

  it("keeps an adult who answered nothing to the two open questions", () => {
    const html = render(
      portalState({
        representation: { has_representative: null, under_guardianship: null, custody: null, custody_stated: false, representatives: [] },
      }),
    );
    expect(statement(html, "lead-gwg-has-representative")).toContain("Не отвечено");
    // The cabinet asks the guardianship question again (owner 2026-10-10): open is "not answered".
    expect(statement(html, "lead-gwg-under-guardianship")).toContain("Не отвечено");
    expect(html).not.toContain("lead-gwg-representative-");
  });

  it("shows nothing of it to a role the server keeps it from", () => {
    const html = render(portalState({ minor: true, representation: null }));
    expect(html).not.toContain("lead-gwg-representation");
    expect(html).not.toContain("Законные представители");
    // The rest of the statements stays.
    expect(html).toContain("Личность");
  });

  it("reads in German too", () => {
    const html = render(minorState({ custody: "sole_parent", custody_stated: true, representatives: PARENTS }), null, "de");
    for (const text of [
      "Gesetzliche Vertreter",
      "im Portal geändert · 05.10.2026 11:40",
      "Wer vertritt das Kind",
      "Ein Elternteil allein (alleiniges Sorgerecht)",
      "Elternteil",
      "hat Zugang zum Portal",
      "Musterweg 1, 10115 Berlin, Deutschland",
      "Ukraine, Deutschland",
      "04.10.2026 · abgelaufen",
      "Dateien: Ausweis",
      "Dateien: Vertretungsnachweis",
      "im Portal noch nicht ausgefüllt",
      "Das Kind wird von einer Person allein vertreten",
    ]) {
      expect(html).toContain(text);
    }
  });
});

/** Sections 7–8 of a self-payer who pays by transfer from a German account. */
const TRANSFER = {
  invoice_to: "self",
  invoice_email: "anna.muster@example.com",
  invoice_vat_id: null,
  invoice_tax_number: null,
  payment_route_by: "patient",
  payment_method: "bank_transfer",
  account_country: "DE",
  account_holder: "Anna Muster",
  bank_name: "Musterbank",
  via_third_party: false,
  compliance_flags: [],
};

/** Another address, cash, and a payment through a third party: two flags. */
const CASH = {
  invoice_to: "other",
  invoice_name: "Beispiel GmbH",
  invoice_street: "Beispielstraße 2",
  invoice_zip: "10117",
  invoice_city: "Berlin",
  invoice_country: "DE",
  invoice_email: "rechnung@example.com",
  invoice_vat_id: "DE123456789",
  invoice_tax_number: null,
  payment_route_by: "patient",
  payment_method: "cash",
  via_third_party: true,
  via_third_party_details: "My brother brings the money",
  compliance_flags: ["cash_payment", "third_party_payment"],
};

function billingState(billing: Record<string, unknown> | null, patch: Record<string, unknown> = {}): LeadPortalIntake {
  return portalState({ billing, billing_updated_at: billing ? "2026-10-06T09:40:00Z" : null, ...patch });
}

describe("LeadGwgStatements: invoice recipient and payment route", () => {
  it("shows the group after the economic interest, with the time of the last change", () => {
    const html = render(billingState(TRANSFER));
    const group = part(html, "lead-gwg-billing", 'data-testid="lead-gwg-answer-pep_self"');
    expect(group).toContain("Счёт и оплата (разделы 7–8 анкеты)");
    // 09:40 UTC is 11:40 in Berlin.
    expect(part(group, "lead-gwg-billing-updated", "</span>")).toContain("от пациента · 06.10.2026 11:40");
    expect(html.indexOf("lead-gwg-own-account")).toBeLessThan(html.indexOf('data-testid="lead-gwg-billing"'));
    expect(html.indexOf('data-testid="lead-gwg-billing"')).toBeLessThan(html.indexOf("Юридические вопросы"));
    expect(statement(html, "lead-gwg-billing-invoice_to")).toContain("пациенту");
    expect(statement(html, "lead-gwg-billing-invoice_email")).toContain("anna.muster@example.com");
    expect(group).not.toContain("lead-gwg-billing-invoice_name");
    expect(group).not.toContain("lead-gwg-billing-invoice_tax");
    const method = statement(html, "lead-gwg-billing-payment_method");
    expect(method).toContain("Банковский перевод");
    expect(method).not.toContain('data-warning="true"');
    expect(statement(html, "lead-gwg-billing-account_country")).toContain("Германия");
    expect(statement(html, "lead-gwg-billing-account_holder")).toContain("Anna Muster");
    expect(statement(html, "lead-gwg-billing-bank_name")).toContain("Musterbank");
    const third = statement(html, "lead-gwg-billing-via_third_party");
    expect(third).toContain("Нет");
    expect(third).not.toContain('data-warning="true"');
    expect(group).not.toContain("lead-gwg-billing-flag");
    expect(group).not.toContain("lead-gwg-billing-by-payer");
    // Still nothing can be edited.
    expect(html).not.toMatch(/<(input|textarea|select|button)\b/);
  });

  it("flags cash and a payment through a third party in amber, names the other address and the staff fields", () => {
    const html = render(billingState(CASH));
    expect(statement(html, "lead-gwg-billing-invoice_to")).toContain("по другому адресу");
    expect(statement(html, "lead-gwg-billing-invoice_name")).toContain("Beispiel GmbH");
    expect(statement(html, "lead-gwg-billing-invoice_address")).toContain("Beispielstraße 2, 10117 Berlin, Германия");
    expect(statement(html, "lead-gwg-billing-invoice_tax")).toContain("USt-IdNr. DE123456789");
    const method = statement(html, "lead-gwg-billing-payment_method");
    expect(method).toContain('data-warning="true"');
    expect(method).toContain("Наличные");
    // No account rows for cash.
    expect(html).not.toContain("lead-gwg-billing-account_country");
    expect(html).not.toContain("lead-gwg-billing-bank_name");
    const third = statement(html, "lead-gwg-billing-via_third_party");
    expect(third).toContain('data-warning="true"');
    expect(third).toContain("Да");
    expect(third).toContain("My brother brings the money");
    const flag = part(html, "lead-gwg-billing-flag", "</p>");
    expect(flag).toContain("Требуется проверка комплаенса: наличные, платёж через третье лицо");
    expect(flag).toContain("text-amber-700");
  });

  it("notes that the third-party payer states the payment route himself", () => {
    const html = render(billingState({ ...TRANSFER, invoice_to: "payer", invoice_email: null, payment_route_by: "payer", payment_method: null, account_country: null, account_holder: null, bank_name: null, via_third_party: null }));
    expect(statement(html, "lead-gwg-billing-invoice_to")).toContain("плательщику");
    expect(part(html, "lead-gwg-billing-by-payer", "</p>")).toContain("Способ оплаты укажет плательщик (собственная ссылка — следующий этап)");
    for (const key of ["payment_method", "account_country", "account_holder", "bank_name", "via_third_party", "flag"]) {
      expect(html).not.toContain(`lead-gwg-billing-${key}`);
    }
  });

  it("stays out while the server does not send the sections", () => {
    const html = render(billingState(null));
    expect(html).not.toContain("lead-gwg-billing");
    expect(html).not.toContain("Счёт и оплата");
    // The rest of the statements stays.
    expect(html).toContain("Юридические вопросы");
  });

  it("shows the sections even when the lead answered nothing else yet", () => {
    const html = render(
      billingState({ ...TRANSFER, invoice_vat_id: "DE123456789" }, { identification: {}, identification_updated_at: null, identity_documents: [] }),
    );
    expect(html).not.toContain("Пациент ещё не заполнил эти данные в кабинете");
    expect(statement(html, "lead-gwg-billing-invoice_tax")).toContain("USt-IdNr. DE123456789");
    // Only staff typed something: that is not a statement of the lead.
    const staffOnly = render(
      portalState({
        identification: {},
        identification_updated_at: null,
        identity_documents: [],
        billing: { invoice_vat_id: "DE123456789", payment_route_by: "patient", compliance_flags: [] },
        billing_updated_at: null,
      }),
    );
    expect(staffOnly).toContain("Пациент ещё не заполнил эти данные в кабинете");
    expect(staffOnly).not.toContain("lead-gwg-billing");
  });

  it("reads in German too", () => {
    const html = render(billingState(CASH), null, "de");
    for (const text of [
      "Rechnung und Zahlung (Abschnitte 7–8)",
      "vom Patienten · 06.10.2026 11:40",
      "Rechnung geht an",
      "an eine andere Adresse",
      "Name auf der Rechnung",
      "Rechnungsanschrift",
      "Beispielstraße 2, 10117 Berlin, Deutschland",
      "E-Mail für Rechnungen",
      "USt-IdNr. / Steuernummer",
      "Zahlungsweg",
      "Bar",
      "Zahlung über Dritte / Zahlungsdienstleister",
      "Compliance-Prüfung erforderlich: Barzahlung, Zahlung über Dritte",
    ]) {
      expect(html).toContain(text);
    }
    expect(render(billingState({ payment_route_by: "payer", compliance_flags: [] }), null, "de")).toContain(
      "Den Zahlungsweg gibt der Zahler selbst an (eigener Link folgt)",
    );
  });
});

/**
 * The payer's answers through the own link (phase 3a): a PEP (a hint) and a
 * black-list citizenship (owner rule 2026-10-07: level 2), no proof of funds yet.
 */
const PAYER_LINK = normalizeLeadPayerLinkState({
  mode: "link",
  can_send: true,
  blocked_reason: null,
  mail_available: true,
  link: { status: "submitted", email: "viktor.zahler@example.com", sent_at: "2026-10-06T08:00:00Z" },
  estimated_total_eur: "12000.00",
  questionnaire: {
    source: "link",
    payer_type: "person",
    state: "submitted",
    email: "viktor.zahler@example.com",
    email_confirmed_at: "2026-10-06T08:05:00Z",
    privacy: { acknowledged_at: "2026-10-06T08:06:00Z", text_version: "payer-privacy-2026-10-06", contact_channels: ["email"], ip: "203.0.113.7" },
    answers: {
      first_name: "Viktor",
      last_name: "Zahler",
      date_of_birth: "1970-03-02",
      id_valid_until: "2030-01-14",
      funds_sources: ["savings"],
      pep_self: true,
      pep_self_details: "Bürgermeister 2019–2024",
      pep_related: false,
      high_risk_country: false,
      sanctions_links: false,
    },
    identity_documents: [{ id: "doc-payer-id", file_name: "viktor-pass.pdf", uploaded_at: "2026-10-06T08:10:00Z", reviewed: false }],
    funds_proof_documents: [],
    funds_proof_required: true,
    missing_for_submit: [],
    submitted_at: "2026-10-06T08:30:00Z",
    check_level: 2,
    check_reasons: ["payer_citizenship_blacklist"],
  },
});

function renderWithPayer(intake: LeadPortalIntake, payerLink: LeadPayerLinkState | null, lang: "ru" | "de" = "ru") {
  return renderToStaticMarkup(
    <LeadGwgStatements intake={intake} payer={{ acts_on_own_account: true }} payerLink={payerLink} tx={lang === "de" ? de : ru} lang={lang} today={TODAY} />,
  );
}

describe("LeadGwgStatements: the payer's answers", () => {
  const byPayer = { ...TRANSFER, invoice_to: "payer", payment_route_by: "payer", payment_method: "bank_transfer", account_holder: "Viktor Zahler" };

  it("follows the invoice and payment group, amber for a PEP and for the missing proof of level 2", () => {
    const html = renderWithPayer(billingState(byPayer, { payer_link: { mode: "link", status: "submitted", submitted_at: "2026-10-06T08:30:00Z", check_level: 2 } }), PAYER_LINK, "de");
    const group = part(html, "lead-gwg-payer", 'data-testid="lead-gwg-payer-privacy"');
    expect(group).toContain("Angaben des Zahlers");
    // 08:30 UTC is 10:30 in Berlin.
    expect(group).toContain("vom Zahler am 06.10.2026 10:30");
    expect(html.indexOf('data-testid="lead-gwg-billing"')).toBeLessThan(html.indexOf('data-testid="lead-gwg-payer"'));
    // Before the lead's own legal questions.
    expect(html.indexOf('data-testid="lead-gwg-payer"')).toBeLessThan(html.indexOf('data-testid="lead-gwg-answer-pep_self"'));
    expect(statement(html, "lead-gwg-payer-name")).toContain("Viktor Zahler");
    expect(statement(html, "lead-gwg-payer-identity_documents")).toContain("viktor-pass.pdf");
    const pep = statement(html, "lead-gwg-payer-answer-pep_self");
    expect(pep).toContain('data-warning="true"');
    expect(pep).toContain("Bürgermeister 2019–2024");
    expect(statement(html, "lead-gwg-payer-answer-pep_related")).not.toContain('data-warning="true"');
    expect(part(html, "lead-gwg-payer-check-level", "</p>")).toContain(
      "Prüfstufe: 2 — Staatsangehörigkeit des Zahlers auf der Blacklist",
    );
    expect(part(html, "lead-payer-funds-proof-missing", "</p>")).toContain("Prüfstufe 2: Der Nachweis der Herkunft der Mittel fehlt noch");
    expect(part(html, "lead-gwg-payer-privacy", "</p>")).toContain("Datenschutzhinweis bestätigt am 06.10.2026 10:06 · Version payer-privacy-2026-10-06 · IP 203.0.113.7");
    // The payer stated section 8: the line says when, and the rows are shown.
    expect(part(html, "lead-gwg-billing-by-payer", "</p>")).toContain("Zahlungsweg: angegeben vom Zahler am 06.10.2026 10:30");
    expect(statement(html, "lead-gwg-billing-payment_method")).toContain("Überweisung");
    expect(html).not.toMatch(/<(input|textarea|select|button)\b/);
  });

  it("says the payer states the route through the link until the answers are in", () => {
    const html = renderWithPayer(
      billingState({ ...byPayer, payment_method: null, account_holder: null }, { payer_link: { mode: "link", status: "sent", submitted_at: null, check_level: 1 } }),
      null,
    );
    expect(part(html, "lead-gwg-billing-by-payer", "</p>")).toContain("Способ оплаты: укажет плательщик по ссылке");
    expect(html).not.toContain("lead-gwg-billing-payment_method");
    expect(html).not.toContain('data-testid="lead-gwg-payer"');
  });

  it("shows no proof line once a proof is uploaded, nor a level-2 line at level 1", () => {
    const withProof = normalizeLeadPayerLinkState({
      ...JSON.parse(JSON.stringify(PAYER_LINK)),
      questionnaire: {
        ...JSON.parse(JSON.stringify(PAYER_LINK!.questionnaire)),
        funds_proof_documents: [{ id: "doc-proof", file_name: "kontoauszug.pdf", uploaded_at: "2026-10-06T08:20:00Z", reviewed: false }],
      },
    });
    const html = renderWithPayer(billingState(byPayer), withProof, "de");
    expect(html).not.toContain("lead-payer-funds-proof-missing");
    expect(statement(html, "lead-gwg-payer-funds_proof_documents")).toContain("kontoauszug.pdf");
    const level1 = normalizeLeadPayerLinkState({
      ...JSON.parse(JSON.stringify(PAYER_LINK)),
      questionnaire: { ...JSON.parse(JSON.stringify(PAYER_LINK!.questionnaire)), check_level: 1, check_reasons: [], funds_proof_required: false },
    });
    const plain = renderWithPayer(billingState(byPayer), level1, "de");
    expect(part(plain, "lead-gwg-payer-check-level", "</p>")).toContain("Prüfstufe: 1");
    expect(plain).not.toContain("lead-payer-funds-proof-missing");
  });

  it("shows the payer's answers even while the lead entered nothing else", () => {
    const html = renderWithPayer(portalState({ identification: {}, identification_updated_at: null, identity_documents: [] }), PAYER_LINK);
    expect(html).toContain("Пациент ещё не заполнил эти данные в кабинете");
    expect(html).toContain("Анкета плательщика");
  });
});

describe("LeadGwgStatements: the extra step «Дополнительные сведения»", () => {
  const details = (patch: Record<string, unknown> = {}, answers: Record<string, unknown> = {}, asks: Record<string, unknown> = {}) => ({
    required: true,
    check_required: false,
    asks: {
      payment_background: false,
      payer_funds: false,
      funds: true,
      occupation: true,
      sector: true,
      funds_proof: false,
      payer_states_funds: false,
      ...asks,
    },
    answers: {
      funds_source: "income",
      funds_description: "Gehalt als Ingenieurin",
      payer_funds_source: null,
      payer_funds_description: null,
      occupation: "Ingenieurin",
      sector: "Maschinenbau",
      ...answers,
    },
    funds_proof_documents: [{ id: "doc-7", file_name: "gehaltsnachweis.pdf", uploaded_at: "2026-10-07T08:00:00Z", reviewed: false }],
    updated_at: "2026-10-07T08:05:00Z",
    ...patch,
  });

  it("lists the source, the words, profession, sector and the proof after the economic interest", () => {
    const html = render(portalState({ enhanced_details: details() }));
    const group = part(html, "lead-gwg-enhanced-details", "</dl>");
    expect(group).toContain("Дополнительные сведения");
    expect(group).toContain("от пациента · 07.10.2026 10:05");
    expect(statement(html, "lead-gwg-self-funds-sources")).toContain("Доход");
    expect(statement(html, "lead-gwg-self-funds-description")).toContain("Gehalt als Ingenieurin");
    expect(statement(html, "lead-gwg-enhanced-occupation")).toContain("Ingenieurin");
    expect(statement(html, "lead-gwg-enhanced-sector")).toContain("Maschinenbau");
    const proof = statement(html, "lead-gwg-self-funds-proof");
    expect(proof).toContain("Подтверждение источника средств · необязательно");
    expect(proof).toContain("gehaltsnachweis.pdf");
    expect(html).not.toContain("lead-self-funds-proof-missing");
    expect(html.indexOf("lead-gwg-own-account")).toBeLessThan(html.indexOf("lead-gwg-enhanced-details"));
    expect(html).not.toMatch(/<(input|textarea|select|button)\b/);
  });

  it("warns in amber while the enhanced check requires the proof and none is uploaded", () => {
    const html = render(
      portalState({ enhanced_details: details({ check_required: true, funds_proof_documents: [] }, {}, { funds_proof: true }) }),
      undefined,
      "de",
    );
    expect(statement(html, "lead-gwg-self-funds-proof")).toContain('data-warning="true"');
    expect(statement(html, "lead-gwg-self-funds-proof")).toContain("Nachweis der Mittelherkunft · erforderlich");
    expect(part(html, "lead-self-funds-proof-missing", "</p>")).toContain(
      "Verstärkte Prüfung erforderlich: Der Nachweis der Herkunft der Mittel des Patienten fehlt noch",
    );
    expect(html).toContain("verstärkte Prüfung erforderlich");
    expect(statement(html, "lead-gwg-self-funds-sources")).toContain("Einkommen");
  });

  it("shows what the patient knows of a third party's funds as the patient's words", () => {
    const html = render(
      portalState({
        enhanced_details: details(
          { funds_proof_documents: [] },
          { funds_source: null, funds_description: null, payer_funds_source: "savings", payer_funds_description: "Rente meines Bruders" },
          { funds: false, payer_funds: true, payer_states_funds: true, occupation: false, sector: false },
        ),
      }),
    );
    const payerFunds = statement(html, "lead-gwg-enhanced-payer-funds");
    expect(payerFunds).toContain("Средства плательщика — со слов пациента");
    expect(payerFunds).toContain("Сбережения");
    expect(payerFunds).toContain("Rente meines Bruders");
    expect(html).toContain("lead-gwg-enhanced-payer-states-funds");
    // No own funds asked or answered: no proof row, no amber line.
    expect(html).not.toContain("lead-gwg-self-funds-proof");
    expect(html).not.toContain("lead-self-funds-proof-missing");
  });

  it("shows nothing while the step is not asked and nothing was answered, and counts answers on their own", () => {
    const none = render(
      portalState({
        enhanced_details: details(
          { required: false, funds_proof_documents: [], updated_at: null },
          { funds_source: null, funds_description: null, occupation: null, sector: null },
          { funds: false, occupation: false, sector: false },
        ),
      }),
    );
    expect(none).not.toContain("lead-gwg-enhanced-details");
    const alone = render(
      portalState({ identification: {}, identification_updated_at: null, identity_documents: [], enhanced_details: details() }),
    );
    expect(alone).not.toContain("lead-gwg-statements-empty");
    expect(alone).toContain("lead-gwg-enhanced-details");
  });
});

describe("LeadGwgStatements: trigger flow additions", () => {
  it("labels the identity document data with the staff member who entered them", () => {
    const html = render(
      portalState({
        identification: {
          id_document_type: "passport",
          id_document_number: "FA1234567",
          id_valid_until: "2031-04-30",
          id_document_unreadable: true,
          id_data_entered_by_name: "Ben Muster",
          id_data_entered_at: "2026-10-07T10:00:00Z",
        },
      }),
      undefined,
      "de",
    );
    const line = part(html, "lead-gwg-id-entered-by", "</p>");
    expect(line).toContain("Erfasst von: Ben Muster · 07.10.2026 12:00");
    expect(line).toContain("Ausweis unleserlich");
  });

  it("shows the follow-up answers F, B, H and J only when given", () => {
    const html = render(
      portalState({
        identification: {
          residence_since: "2019",
          former_citizenships: ["ru"],
          stay_reason: "work",
          stay_reason_details: "Projekt in Wien",
          relationship_since: "2010",
          pep_office: "Bürgermeister",
          pep_country: "at",
          sanctions_link_name: "Beispiel GmbH",
          sanctions_link_kind: "business",
        },
      }),
    );
    expect(statement(html, "lead-gwg-residence-since")).toContain("2019");
    expect(html).toContain("Россия");
    expect(html).toContain("работа — Projekt in Wien");
    expect(statement(html, "lead-gwg-relationship-since")).toContain("2010");
    expect(statement(html, "lead-gwg-pep-office")).toContain("Bürgermeister");
    expect(html).toContain("Австрия");
    expect(statement(html, "lead-gwg-sanctions-link-name")).toContain("Beispiel GmbH");
    expect(html).toContain("деловая");
    expect(render(portalState())).not.toContain("lead-gwg-follow-up-answers");
    // A citizen of the country or a person born there (QA 2026-10-10).
    const citizen = (lang?: "de") =>
      render(portalState({ identification: { residence_since: "1990", stay_reason: "citizenship_or_birth" } }), undefined, lang);
    expect(citizen()).toContain("гражданство / рождение в этой стране");
    expect(citizen("de")).toContain("Staatsangehörigkeit / dort geboren");
  });
});

