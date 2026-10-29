import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalizeLeadPortalIntake, type LeadPortalIntake } from "../data/lead-portal-intake-api";
import { normalizeConsentRecipients, normalizeLeadPortalConsentForm, normalizeLeadPortalDisclosure } from "../model/lead-portal-consents";
import { CabinetPersonRow } from "./lead-cabinet-person-row";
import { PortalConsentChoiceView } from "./lead-portal-consent-choices";
import { PortalHealthConsentLine, PortalInquiryConsentLine } from "./lead-wizard-portal-intake";

const tx = (ru: string) => ru;
const de = (_ru: string, text: string) => text;
const state = (extra: Partial<LeadPortalIntake> = {}) => ({ ...normalizeLeadPortalIntake({ lead_id: "test-lead" })!, ...extra });
const savedForm = normalizeLeadPortalConsentForm({
  version: "2026-10-12", chosen_at: "2026-10-12T10:00:00Z", chosen_by: "synthetic-user",
  chosen_by_name: "Anna Muster", chosen_by_role: "Vormund", access_kind: "guardian",
  choices: { agency_processing: true, doctors_to_agency: true, data_system: true, named_recipients: false,
    channel_email: false, channel_threema: true, channel_whatsapp: false, channel_telegram: false },
});

/** One person of the list «Лица и учреждения», where the trusted persons are shown since 2026-10-26 (owner). */
const personRow = (person: Parameters<typeof CabinetPersonRow>[0]["person"], translate: typeof tx = tx, lang = "ru") =>
  renderToStaticMarkup(<ul><CabinetPersonRow person={person} tx={translate} lang={lang} /></ul>);
/** A chip with a lucide icon followed by the text. */
const chip = (icon: string, text: string) =>
  new RegExp(`lucide-${icon}[^>]*>(?:(?!</span>).)*</svg>${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</span>`);

describe("portal consent facts in the staff wizard", () => {
  it("shows the stored trusted list independently of a consent choice and does not grant permission", () => {
    const intake = state({ trusted_persons: [{ name: "Eva Muster", relation: "friend", contact: "eva@example.com" }] });
    const html = renderToStaticMarkup(<PortalConsentChoiceView intake={intake} tx={tx} />);
    // The persons are listed once, in «Лица и учреждения»; here only a pointer (owner 2026-10-26).
    expect(html).toContain("в списке «Лица и учреждения» ниже");
    expect(html).not.toContain("Eva Muster");
    expect(html).not.toContain(">Разрешено<");
    const row = renderToStaticMarkup(<ul><CabinetPersonRow person={intake.trusted_persons![0]} tx={tx} lang="ru" /></ul>);
    expect(row).toContain("друг / знакомый");
    expect(row).toContain("Eva Muster");
    expect(row).toContain("Указал клиент в кабинете");
    expect(renderToStaticMarkup(<ul><CabinetPersonRow person={intake.trusted_persons![0]} tx={de} lang="de" /></ul>)).toContain("Freund/in / Bekannte/r");
    expect(renderToStaticMarkup(<PortalConsentChoiceView intake={{ ...intake, identification_hidden: true }} tx={tx} />)).toBe("");
  });
  it("shows the date of birth and the phone a trusted person calls from, so staff can check a caller (owner 2026-10-26)", () => {
    const persons = normalizeConsentRecipients([
      { name: "Olga Muster", relation: "spouse", phone: " +49 151 000000 ", birth_date: "1975-04-03", scope_codes: ["all"] },
      { name: "Praxis Nord", relation: "clinic", phone: "+49 40 1234567", birth_date: "not a date", scope_codes: ["medical"] },
      { name: "Oma Legacy", relation: "relative", contact: "oma@example.test", scope_codes: ["medical"] },
    ]);
    expect(persons[0]).toMatchObject({ phone: "+49 151 000000", birth_date: "1975-04-03" });
    expect(persons[1].birth_date).toBeUndefined();
    // Since 2026-10-26 (owner) the date of birth and the phone are chips with a calendar and a phone icon.
    const [olga, praxis, oma] = persons.map((person) => personRow(person, de, "de"));
    expect(olga).toMatch(chip("calendar-days", "03.04.1975"));
    expect(olga).toMatch(chip("phone", "+49 151 000000"));
    expect(praxis).toMatch(chip("phone", "+49 40 1234567"));
    expect(praxis).not.toContain("lucide-calendar-days");
    expect(praxis).not.toContain("not a date");
    expect(oma).toContain("lucide-mail");
    expect(oma).toContain("oma@example.test");
    expect(personRow(persons[0], tx, "ru")).toMatch(chip("calendar-days", "03.04.1975"));
  });
  it("shows medical consent independently of files, with grant and revocation dates", () => {
    const intake = state({ uploads: [], consents: [{ id: "health", type: "health_data_processing", given_at: "2026-10-11T09:00:00Z", revoked_at: "2026-10-12T09:00:00Z", version: "v1", access_kind: "guardian" }] });
    const html = renderToStaticMarkup(<PortalHealthConsentLine intake={intake} tx={tx} />);
    expect(html).toContain("ст. 9 DSGVO");
    expect(html).toContain("Дано:");
    expect(html).toContain("Отозвано:");
    expect(html).toContain("11.10.2026");
    expect(html).toContain("12.10.2026");
    expect(html).toContain("родитель / представитель");
    expect(renderToStaticMarkup(<PortalHealthConsentLine intake={{ ...intake, uploads_hidden: true }} tx={tx} />)).toBe("");
  });

  it("keeps a revoked inquiry consent visible and makes the missing consent explicit", () => {
    const revoked = state({ consents: [{ id: "inquiry", type: "lead_inquiry_processing", given_at: "2026-10-11T09:00:00Z", revoked_at: "2026-10-12T09:00:00Z", version: "v1", access_kind: "self" }] });
    expect(renderToStaticMarkup(<PortalInquiryConsentLine intake={revoked} tx={tx} />)).toContain("Отозвано:");
    expect(renderToStaticMarkup(<PortalInquiryConsentLine intake={state()} tx={tx} />)).toContain("Не дано");
    expect(renderToStaticMarkup(<PortalInquiryConsentLine intake={null} tx={tx} />)).toBe("");
  });

  it("renders all three core choices, named recipients and every channel read-only, with the chooser", () => {
    const html = renderToStaticMarkup(<PortalConsentChoiceView intake={state({ consent_form: savedForm })} tx={tx} />);
    expect(html).toContain("Anlage 1");
    expect(html).toContain("GMED: получение");
    expect(html).toContain("Лечащие врачи и учреждения");
    expect(html).toContain("Хранение и обработка в системе GMED");
    expect(html).toContain("Передача лицам и учреждениям");
    for (const channel of ["E-Mail", "Threema", "WhatsApp", "Telegram"]) expect(html).toContain(channel);
    expect(html).toContain("Anna Muster (Vormund)");
    expect(html).toContain("12.10.2026");
    expect(html.match(/>Разрешено</g)).toHaveLength(4);
    expect(html.match(/>Не разрешено</g)).toHaveLength(4);
    expect(html).not.toMatch(/<(?:button|input)\b/);
    expect(renderToStaticMarkup(<PortalConsentChoiceView intake={state({ consent_form: savedForm })} tx={de} />)).toContain("Zuletzt geändert:");
  });

  it("lists the persons the client named for the transfer", () => {
    const named = normalizeLeadPortalConsentForm({
      version: "2026-10-12", chosen_at: "2026-10-12T10:00:00Z", access_kind: "self",
      choices: { agency_processing: true, doctors_to_agency: true, data_system: true, named_recipients: true },
      recipients: [
        { name: "Olga Muster", relation: "spouse", contact: "+49 151 000000", scope: "Только даты приёмов" },
        { name: "Praxis Dr. Beispiel", relation: "family_doctor" },
        { name: " ", relation: "other" },
      ],
    });
    const html = renderToStaticMarkup(<PortalConsentChoiceView intake={state({ consent_form: named })} tx={tx} />);
    expect(html).toContain("Olga Muster");
    expect(html).toContain("супруг(а) / партнёр");
    expect(html).toContain("+49 151 000000");
    expect(html).toContain("Только даты приёмов");
    expect(html).toContain("Praxis Dr. Beispiel");
    expect(html.match(/<li/g)).toHaveLength(2);
  });

  it("respects restricted and older payloads and never presets unanswered choices", () => {
    expect(renderToStaticMarkup(<PortalConsentChoiceView intake={state({ consent_form: savedForm, identification_hidden: true })} tx={tx} />)).toBe("");
    expect(renderToStaticMarkup(<PortalConsentChoiceView intake={state()} tx={tx} />)).toBe("");
    const html = renderToStaticMarkup(<PortalConsentChoiceView intake={state({ consent_form: normalizeLeadPortalConsentForm({ version: "v1", choices: null }) })} tx={tx} />);
    expect(html).toContain("Выбор ещё не сохранён");
    expect(html.split('data-testid="portal-consent-choices"')[1].match(/>Не отвечено</g)).toHaveLength(8);
    expect(html).not.toContain(">Разрешено<");
  });

  it("shows scoped disclosure with its original receipt actor independently of the later form chooser", () => {
    const intake = state({
      disclosure: normalizeLeadPortalDisclosure({
        allow_disclosure: true, consent_given: true, version: "2026-10-14", language: "de",
        chosen_at: "2026-10-11T10:00:00Z", chosen_by: "original-parent", chosen_by_name: "Original Parent",
        access_kind: "guardian", company_name: "GMED GmbH", consent_text: "Original consent text. <script>untrusted()</script>",
      }),
      consent_form: savedForm,
      trusted_persons: [{ name: "Eva Muster", relation: "friend", contact: "eva@example.com", scope: "Только даты приёмов" }],
    });
    const html = renderToStaticMarkup(<PortalConsentChoiceView intake={intake} tx={tx} />);
    const [receiptHtml, formHtml] = html.split('data-testid="portal-consent-choices"');
    expect(receiptHtml).toContain("Original Parent (Родитель / представитель)");
    expect(receiptHtml).toContain("11.10.2026");
    // Company, version and language are separate chips since 2026-10-26 (owner).
    expect(receiptHtml).toContain("<span>GMED GmbH</span>");
    expect(receiptHtml).toContain("<span>версия 2026-10-14</span>");
    expect(receiptHtml).toMatch(chip("languages", "DE"));
    expect(receiptHtml).toContain("Original consent text. &lt;script&gt;");
    // The person and the scope stand once, in «Лица и учреждения»; the receipt only points there.
    expect(receiptHtml).toContain("portal-trusted-persons-pointer");
    expect(receiptHtml).not.toContain("Eva Muster");
    expect(personRow(intake.trusted_persons![0])).toMatch(/Объём информации:<\/span><span[^>]*>Только даты приёмов<\/span>/);
    expect(receiptHtml).not.toContain("Anna Muster");
    expect(formHtml).toContain("Anna Muster (Vormund)");
    expect(formHtml).toContain("12.10.2026");
    expect(receiptHtml).toMatch(/data-testid="portal-disclosure-decision" class="[^"]*border-emerald-200/);
    expect(receiptHtml).toMatch(/data-testid="portal-disclosure-consent" class="[^"]*border-emerald-200/);
    expect(html).not.toMatch(/<(?:button|input|script)\b/);
    expect(personRow(intake.trusted_persons![0], de, "de")).toMatch(/Auskunftsumfang:<\/span><span[^>]*>Только даты приёмов<\/span>/);
    expect(renderToStaticMarkup(<PortalConsentChoiceView intake={{ ...intake, identification_hidden: true }} tx={tx} />)).toBe("");
  });

  it("shows a chosen scope in the staff language (owner 2026-10-19)", () => {
    const intake = state({
      disclosure: normalizeLeadPortalDisclosure({ allow_disclosure: true, consent_given: true, access_kind: "self", chosen_at: "2026-10-19T10:00:00Z" }),
      trusted_persons: normalizeConsentRecipients([
        { name: "Eva Muster", relation: "friend", scope_codes: ["financial", "medical"] },
        { name: "Max Muster", relation: "friend", scope_codes: ["all"], scope: "ignored legacy" },
      ]),
    });
    // One chip per chosen scope, in the persons list (owner 2026-10-26).
    const [eva, max] = intake.trusted_persons!.map((person) => personRow(person));
    expect(eva).toMatch(/Объём информации:<\/span><span[^>]*>медицинская<\/span><span[^>]*>финансовая<\/span>/);
    expect(max).toMatch(/Объём информации:<\/span><span[^>]*>вся информация<\/span><\/div>/);
    expect(max).not.toContain("ignored legacy");
    expect(personRow(intake.trusted_persons![0], de, "de")).toMatch(/Auskunftsumfang:<\/span><span[^>]*>medizinische<\/span><span[^>]*>finanzielle<\/span>/);
  });

  it("renders an explicit No as the person's neutral choice, never as a missing consent", () => {
    const intake = state({ disclosure: normalizeLeadPortalDisclosure({
      allow_disclosure: false, consent_given: false, access_kind: "self", chosen_at: "2026-10-14T10:00:00Z",
    }) });
    const html = renderToStaticMarkup(<PortalConsentChoiceView intake={intake} tx={tx} />);
    expect(html).toContain(">Нет — не разрешено</span>");
    expect(html).not.toContain("Не дано");
    expect(html).not.toContain("portal-disclosure-consent");
    expect(html).toContain("Это допустимый ответ");
    // Who chose is a chip of the receipt since 2026-10-26 (owner).
    expect(html.slice(html.indexOf("portal-disclosure-audit"))).toMatch(chip("user-round", "<span>Пациент"));
    expect(html).not.toMatch(/data-testid="portal-disclosure-decision" class="[^"]*border-amber-200/);
    // The decision area has no amber status; the only amber chip is the chooser of the receipt (style, owner 2026-10-26).
    const receiptAt = html.indexOf('data-testid="portal-disclosure-receipt"');
    expect(receiptAt).toBeGreaterThan(0);
    expect(html.slice(0, receiptAt)).not.toContain("border-amber-200");
    expect(html.match(/border-amber-200/g)).toHaveLength(1);
    expect(html.slice(html.indexOf("portal-disclosure-audit"))).toMatch(/^portal-disclosure-audit"><span class="[^"]*border-amber-200/);
    expect(html).not.toContain("portal-trusted-persons");
    expect(html).not.toContain("portal-consent-choices");
    expect(renderToStaticMarkup(<PortalConsentChoiceView intake={intake} tx={de} />)).toContain(">Nein – nicht erlaubt</span>");
  });

  it("counts an unanswered disclosure as no unless an older choice named recipients (owner 2026-10-22)", () => {
    const html = renderToStaticMarkup(<PortalConsentChoiceView intake={state({ consent_form: savedForm })} tx={tx} />);
    const receiptHtml = html.split('data-testid="portal-consent-choices"')[0];
    expect(receiptHtml).toContain(">Нет — не отвечено, по умолчанию</span>");
    expect(receiptHtml).not.toContain("border-amber-200");
    expect(receiptHtml).not.toContain("portal-disclosure-consent");
    expect(renderToStaticMarkup(<PortalConsentChoiceView intake={state({ consent_form: savedForm })} tx={de} />))
      .toContain(">Nein – nicht beantwortet, Standard</span>");
  });

  it("does not invent a disclosure receipt or scope for historic recipients", () => {
    const html = renderToStaticMarkup(<PortalConsentChoiceView intake={state({
      consent_form: { ...savedForm, choices: { ...savedForm.choices!, named_recipients: true } },
      trusted_persons: [{ name: "Historic Person", relation: "friend", contact: null }],
    })} tx={tx} />);
    const receiptHtml = html.split('data-testid="portal-consent-choices"')[0];
    expect(receiptHtml).toContain(">Не отвечено</span>");
    expect(receiptHtml).toContain(">Не зафиксировано</span>");
    // No invented scope: the person is in «Лица и учреждения», with the scope "не указан".
    expect(receiptHtml).not.toContain("Historic Person");
    expect(personRow({ name: "Historic Person", relation: "friend", contact: null })).toMatch(/Объём информации:<\/span><span[^>]*>не указан<\/span>/);
    expect(receiptHtml).toMatch(/data-testid="portal-disclosure-decision" class="[^"]*border-amber-200/);
    expect(receiptHtml).not.toContain("portal-disclosure-receipt");
    expect(receiptHtml).not.toContain("Anna Muster");
  });

  it("does not mark an affirmative decision successful when consent is missing", () => {
    const html = renderToStaticMarkup(<PortalConsentChoiceView intake={state({
      disclosure: normalizeLeadPortalDisclosure({ allow_disclosure: true, access_kind: "guardian" }),
    })} tx={tx} />);
    expect(html).toContain(">Да</span>");
    expect(html).toContain(">Не зафиксировано</span>");
    expect(html.slice(html.indexOf("portal-disclosure-audit"))).toMatch(chip("user-round", "<span>Родитель / представитель"));
    expect(html).not.toContain("border-emerald-200");
  });
});
