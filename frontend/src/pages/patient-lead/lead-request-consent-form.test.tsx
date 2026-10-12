import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NO_CONSENT_FORM_CHOICES, hasCoreConsents, type LeadRequest } from "./lead-request-api";
import { ConsentFormChoicesSection, choosesForChild, consentFormChanged } from "./lead-request-consent-form";
import { consentFormText } from "./lead-request-consent-form-text";

const queue = <Result,>(task: () => Promise<Result>) => task();

function request(
  consentForm: LeadRequest["consent_form"],
  extra: Partial<Pick<LeadRequest, "access_kind" | "minor">> = {},
): LeadRequest {
  return { lead_id: "lead-1", access_kind: "self", minor: false, consent_form: consentForm, ...extra } as unknown as LeadRequest;
}

const CORE = {
  ...NO_CONSENT_FORM_CHOICES,
  agency_processing: true,
  doctors_to_agency: true,
  data_system: true,
};

describe("consent form choices in the lead cabinet", () => {
  it("ticks nothing in advance and asks the person to save an own choice", () => {
    const markup = renderToStaticMarkup(
      <ConsentFormChoicesSection
        request={request({ version: "2026-10-12", choices: null, chosen_at: null })}
        lang="de"
        enqueue={queue}
        onChange={() => undefined}
      />,
    );
    expect(markup).toContain("Einwilligung zur Datenübermittlung (Anlage 1)");
    expect(markup.match(/type="checkbox"/g)).toHaveLength(8);
    expect(markup).not.toContain('checked=""');
    expect(markup).toContain("Noch keine Auswahl gespeichert.");
    expect(markup).toContain("GMED kreuzt nichts für Sie an");
    // QA 2026-10-12, A2-02: an empty choice is no consent; "save" waits for the three.
    expect(markup.match(/\(erforderlich\)/g)).toHaveLength(3);
    expect(markup).toContain('data-testid="lead-request-consent-form-core-hint"');
    const saveButton = (markup.match(/<button[^>]*>/g) ?? []).find((tag) => tag.includes("lead-request-consent-form-save"));
    expect(saveButton).toContain('disabled=""');
  });

  it("knows the three consents the service runs on", () => {
    expect(hasCoreConsents(NO_CONSENT_FORM_CHOICES)).toBe(false);
    expect(hasCoreConsents({ ...CORE, data_system: false })).toBe(false);
    expect(hasCoreConsents(CORE)).toBe(true);
    expect(hasCoreConsents({ ...CORE, channel_whatsapp: true })).toBe(true);
  });

  it("speaks of the child's data to a parent of a minor (QA 2026-10-12, A2-06)", () => {
    expect(choosesForChild({ access_kind: "guardian", minor: true })).toBe(true);
    expect(choosesForChild({ access_kind: "guardian", minor: false })).toBe(false);
    expect(choosesForChild({ access_kind: "self", minor: true })).toBe(false);
    const markup = renderToStaticMarkup(
      <ConsentFormChoicesSection
        request={request({ version: "2026-10-12", choices: null, chosen_at: null }, { access_kind: "guardian", minor: true })}
        lang="ru"
        enqueue={queue}
        onChange={() => undefined}
      />,
    );
    expect(markup).toContain("данные и документы моего ребёнка");
    expect(markup).toContain("за своего ребёнка");
    expect(markup).not.toContain("мои персональные");
    for (const lang of ["de", "en", "uk", "ru"]) {
      const child = consentFormText(lang, true);
      const adult = consentFormText(lang, false);
      expect(child.title).toBe(adult.title);
      for (const key of Object.keys(NO_CONSENT_FORM_CHOICES) as (keyof typeof NO_CONSENT_FORM_CHOICES)[]) {
        expect(child.options[key].trim(), `${lang} ${key}`).not.toBe("");
      }
      expect(child.options.agency_processing).not.toBe(adult.options.agency_processing);
    }
    expect(consentFormText("de", true).options.data_system).toContain("meines Kindes");
  });

  it("shows the saved choice with its date", () => {
    const markup = renderToStaticMarkup(
      <ConsentFormChoicesSection
        request={request({
          version: "2026-10-12",
          choices: { ...NO_CONSENT_FORM_CHOICES, agency_processing: true, channel_whatsapp: true },
          chosen_at: "2026-10-12T08:05:00Z",
        })}
        lang="ru"
        enqueue={queue}
        onChange={() => undefined}
      />,
    );
    expect(markup.match(/checked=""/g)).toHaveLength(2);
    expect(markup).toContain("Ваш выбор от 12.10.2026");
    // Staff make the new form; nothing is re-created by itself (QA 2026-10-12).
    expect(markup).toContain("уже созданную форму сотрудник GMED тогда создаст заново");
    expect(markup).not.toContain("будет создана заново");
  });

  it("is hidden for an older server without the consent form", () => {
    const markup = renderToStaticMarkup(
      <ConsentFormChoicesSection request={request(undefined)} lang="de" enqueue={queue} onChange={() => undefined} />,
    );
    expect(markup).toBe("");
  });

  it("knows unsaved changes and has every text in the four cabinet languages", () => {
    expect(consentFormChanged(NO_CONSENT_FORM_CHOICES, null)).toBe(false);
    expect(consentFormChanged({ ...NO_CONSENT_FORM_CHOICES, data_system: true }, null)).toBe(true);
    const saved = { ...NO_CONSENT_FORM_CHOICES, channel_email: true };
    expect(consentFormChanged(saved, saved)).toBe(false);
    for (const lang of ["de", "en", "uk", "ru"]) {
      const text = consentFormText(lang);
      for (const key of Object.keys(NO_CONSENT_FORM_CHOICES) as (keyof typeof NO_CONSENT_FORM_CHOICES)[]) {
        expect(text.options[key].trim(), `${lang} ${key}`).not.toBe("");
      }
      expect(text.savedAt("12.10.2026")).toContain("12.10.2026");
    }
    expect(consentFormText("uk").title).toBe("Згода на передачу даних (додаток 1)");
  });
});
