import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalizeLeadPortalIntake, type LeadPortalIntake } from "../data/lead-portal-intake-api";
import { normalizeLeadPortalConsentForm } from "../model/lead-portal-consents";
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
        { name: "Olga Muster", relation: "spouse", contact: "+49 151 000000" },
        { name: "Praxis Dr. Beispiel", relation: "family_doctor" },
        { name: " ", relation: "other" },
      ],
    });
    const html = renderToStaticMarkup(<PortalConsentChoiceView intake={state({ consent_form: named })} tx={tx} />);
    expect(html).toContain("Olga Muster");
    expect(html).toContain("супруг(а) / партнёр");
    expect(html).toContain("+49 151 000000");
    expect(html).toContain("Praxis Dr. Beispiel");
    expect(html.match(/<li/g)).toHaveLength(2);
  });

  it("respects restricted and older payloads and never presets unanswered choices", () => {
    expect(renderToStaticMarkup(<PortalConsentChoiceView intake={state({ consent_form: savedForm, identification_hidden: true })} tx={tx} />)).toBe("");
    expect(renderToStaticMarkup(<PortalConsentChoiceView intake={state()} tx={tx} />)).toBe("");
    const html = renderToStaticMarkup(<PortalConsentChoiceView intake={state({ consent_form: normalizeLeadPortalConsentForm({ version: "v1", choices: null }) })} tx={tx} />);
    expect(html).toContain("Выбор ещё не сохранён");
    expect(html.match(/>Не отвечено</g)).toHaveLength(8);
    expect(html).not.toContain(">Разрешено<");
  });
});
