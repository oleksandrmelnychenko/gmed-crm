import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NO_CONSENT_FORM_CHOICES, type LeadRequest } from "./lead-request-api";
import { ConsentFormChoicesSection, consentFormChanged } from "./lead-request-consent-form";
import { consentFormText } from "./lead-request-consent-form-text";

const queue = <Result,>(task: () => Promise<Result>) => task();

function request(consentForm: LeadRequest["consent_form"]): LeadRequest {
  return { lead_id: "lead-1", consent_form: consentForm } as unknown as LeadRequest;
}

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
