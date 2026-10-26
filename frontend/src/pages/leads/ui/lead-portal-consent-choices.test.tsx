import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalizeLeadPortalIntake, type LeadPortalIntake } from "../data/lead-portal-intake-api";
import { normalizeConsentRecipients, normalizeLeadPortalConsentForm, normalizeLeadPortalDisclosure } from "../model/lead-portal-consents";
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

describe("portal consent facts in the staff wizard", () => {
  it("shows the stored trusted list independently of a consent choice and does not grant permission", () => {
    const intake = state({ trusted_persons: [{ name: "Eva Muster", relation: "friend", contact: "eva@example.com" }] });
    const html = renderToStaticMarkup(<PortalConsentChoiceView intake={intake} tx={tx} />);
    expect(html).toContain("Получатели информации (Auskunft an Dritte)");
    expect(html).toContain("друг / знакомый");
    expect(html).toContain("Eva Muster");
    expect(html).not.toContain(">Разрешено<");
    expect(renderToStaticMarkup(<PortalConsentChoiceView intake={intake} tx={de} />)).toContain("Freund/in / Bekannte/r");
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
    const html = renderToStaticMarkup(<PortalConsentChoiceView intake={state({ trusted_persons: persons })} tx={de} />);
    expect(html).toContain("geb. 03.04.1975");
    expect(html).toContain("Tel. +49 151 000000");
    expect(html).toContain("Tel. +49 40 1234567");
    expect(html).toContain("oma@example.test");
    expect(renderToStaticMarkup(<PortalConsentChoiceView intake={state({ trusted_persons: persons })} tx={tx} />)).toContain("род. 03.04.1975");
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
    expect(receiptHtml).toContain("GMED GmbH · версия 2026-10-14 · DE");
    expect(receiptHtml).toContain("Original consent text. &lt;script&gt;");
    expect(receiptHtml).toContain("Объём информации: Только даты приёмов");
    expect(receiptHtml).not.toContain("Anna Muster");
    expect(formHtml).toContain("Anna Muster (Vormund)");
    expect(formHtml).toContain("12.10.2026");
    expect(receiptHtml).toMatch(/data-testid="portal-disclosure-decision" class="[^"]*border-emerald-200/);
    expect(receiptHtml).toMatch(/data-testid="portal-disclosure-consent" class="[^"]*border-emerald-200/);
    expect(html).not.toMatch(/<(?:button|input|script)\b/);
    expect(renderToStaticMarkup(<PortalConsentChoiceView intake={intake} tx={de} />)).toContain("Auskunftsumfang: Только даты приёмов");
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
    const html = renderToStaticMarkup(<PortalConsentChoiceView intake={intake} tx={tx} />);
    expect(html).toContain("Объём информации: медицинская, финансовая");
    expect(html).toContain("Объём информации: вся информация");
    expect(renderToStaticMarkup(<PortalConsentChoiceView intake={intake} tx={de} />)).toContain("Auskunftsumfang: medizinische, finanzielle");
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
    expect(html).toContain("Выбор зафиксирован: Пациент");
    expect(html).not.toMatch(/data-testid="portal-disclosure-decision" class="[^"]*border-amber-200/);
    expect(html).not.toContain("border-amber-200");
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
    expect(receiptHtml).toContain("Объём информации: Не указан");
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
    expect(html).toContain("Выбор зафиксирован: Родитель / представитель");
    expect(html).not.toContain("border-emerald-200");
  });
});
