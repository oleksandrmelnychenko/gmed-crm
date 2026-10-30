import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NO_CONSENT_FORM_CHOICES, hasCoreConsents, type LeadRequest } from "./lead-request-api";
import {
  ConsentFormChoicesSection,
  choiceOnlyByGuardian,
  choosesForChild,
  consentFormChanged,
  savedDisclosureAllowed,
} from "./lead-request-consent-form";
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
  it("ticks nothing in advance and explains automatic saving of an explicit choice", () => {
    const markup = renderToStaticMarkup(
      <ConsentFormChoicesSection
        request={request({ version: "2026-10-12", choices: null, chosen_at: null })}
        lang="de"
        enqueue={queue}
        onChange={() => undefined}
      />,
    );
    // No document number in the title, no save-state sentence of its own (labels audit 2026-10-26, B8).
    expect(markup).toContain("Einwilligung zur Datenübermittlung");
    expect(markup).not.toContain("Anlage 1");
    // Three core consents and three channels: the cabinet no longer offers Threema (owner polish 2026-10-29).
    expect(markup.match(/type="checkbox"/g)).toHaveLength(6);
    expect(markup).not.toContain('data-consent-option="channel_threema"');
    expect(markup).not.toContain('checked=""');
    expect(markup).not.toContain("Noch keine Auswahl gespeichert.");
    expect(markup).toContain("ist nur angekreuzt, was Sie hier wählen.");
    // An empty choice is no consent: the three are marked with the `*` of every required field,
    // the word only for screen readers.
    expect(markup.match(/data-consent-required=""/g)).toHaveLength(3);
    expect(markup.match(/aria-required="true"/g)).toHaveLength(3);
    expect(markup).not.toMatch(/>\(erforderlich\)</);
    expect(markup).toContain('data-testid="lead-request-consent-form-core-hint"');
    expect(markup).toContain("Diese drei Einwilligungen brauchen wir für Ihre Anfrage.");
    expect(markup).not.toContain("lead-request-consent-form-save");
    // Every checkbox is named by its visible text, not by the value «on» (S1).
    expect(markup).toContain('aria-label="Meine Unterlagen dürfen im EDV-System von GMED gespeichert und verarbeitet werden."');
  });

  it("never shows Threema, not even an old tick (owner 2026-10-30)", () => {
    const markup = renderToStaticMarkup(
      <ConsentFormChoicesSection
        request={request({ version: "2026-10-12", choices: { ...CORE, channel_threema: true }, chosen_at: "2026-10-20T10:00:00Z" })}
        lang="uk"
        enqueue={queue}
        onChange={() => undefined}
      />,
    );
    expect(markup).not.toContain('data-consent-option="channel_threema"');
    expect(markup.match(/type="checkbox"/g)).toHaveLength(6);
    expect(markup).not.toContain("Threema");
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

  it("shows the saved choice without a receipt of its own (labels audit 2026-10-26, B8)", () => {
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
    expect(markup).not.toContain("Ваш выбор от 12.10.2026");
    expect(markup).not.toContain("сотрудник GMED");
  });

  it("lets a minor's own login choose nothing (QA 2026-10-12, A3-01)", () => {
    expect(choiceOnlyByGuardian({ access_kind: "self", minor: true })).toBe(true);
    expect(choiceOnlyByGuardian({ access_kind: "self", minor: false })).toBe(false);
    expect(choiceOnlyByGuardian({ access_kind: "guardian", minor: true })).toBe(false);
    const markup = renderToStaticMarkup(
      <ConsentFormChoicesSection
        request={request(
          { version: "2026-10-12", choices: null, chosen_at: null },
          { access_kind: "self", minor: true },
        )}
        lang="ru"
        enqueue={queue}
        onChange={() => undefined}
      />,
    );
    expect(markup).toContain('data-testid="lead-request-consent-form-by-guardian"');
    expect(markup).toContain("родители или опекун выбирают");
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).not.toContain("lead-request-consent-form-save");
    for (const lang of ["de", "en", "uk", "ru"]) {
      expect(consentFormText(lang).byGuardianOnly.trim()).not.toBe("");
      expect(consentFormText(lang).savedByOtherAt("12.10.2026")).toContain("12.10.2026");
    }
  });

  it("names a choice the other parent saved as theirs, not the viewer's (QA 2026-10-12, A3-01)", () => {
    const markup = renderToStaticMarkup(
      <ConsentFormChoicesSection
        request={request(
          { version: "2026-10-12", choices: CORE, chosen_at: "2026-10-12T08:05:00Z", chosen_by_me: false },
          { access_kind: "guardian", minor: true },
        )}
        lang="ru"
        enqueue={queue}
        onChange={() => undefined}
      />,
    );
    expect(markup).toContain("сохранил другой родитель или представитель");
    expect(markup).not.toContain("Ваш выбор от");
    expect(markup).not.toContain("lead-request-consent-form-save");
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
      expect(text.disclosureLabel.trim(), lang).not.toBe("");
      expect(text.title, lang).not.toMatch(/Anlage|Annex|додаток|приложение/);
    }
    expect(consentFormText("uk").title).toBe("Згода на передачу даних");
    // One line for the step-4 answer, with the count of the named persons (owner 2026-10-26, C3).
    expect(consentFormText("de").disclosureYes(1)).toBe("Ja, 1 Person");
    expect(consentFormText("ru").disclosureYes(2)).toBe("Да, 2 человека");
    expect(consentFormText("ru").disclosureYes(5)).toBe("Да, 5 человек");
    expect(consentFormText("uk").disclosureYes(3)).toBe("Так, 3 особи");
    expect(consentFormText("uk").disclosureYes(11)).toBe("Так, 11 осіб");
    expect(consentFormText("en").disclosureYes(2)).toBe("Yes, 2 people");
  });
});

describe("read-only disclosure decision", () => {
  it("preserves legacy choices without interpreting them as new explicit consent", () => {
    const item = request({ version: "v1", chosen_at: null, choices: { ...CORE, named_recipients: true }, recipients: [{ name: "Old Recipient", relation: "friend" }] });
    expect(savedDisclosureAllowed(item)).toBe(true);
    const html = renderToStaticMarkup(<ConsentFormChoicesSection request={item} lang="en" enqueue={queue} onChange={() => undefined} />);
    // One line, not the step-4 answer repeated as a block (owner 2026-10-26, C3).
    expect(html).toContain("Information for third parties: not answered yet");
    expect(html).toContain("An earlier choice is on record");
    expect(html).not.toContain("Old Recipient");
    expect(html).not.toContain('data-consent-option="named_recipients"');
    expect(html).toContain('href="/request?lead=lead-1&amp;step=disclosure"');
    expect(consentFormChanged({ ...CORE, named_recipients: true }, CORE)).toBe(false);
  });
  it("uses explicit disclosure even before the core consents are saved and shows each person's scope", () => {
    const item = { ...request({ version: "v1", chosen_at: null, choices: null }), trusted_persons: [{ name: "Current Friend", relation: "friend" as const, scope: "Invoices only" }], disclosure: { allow_disclosure: true, consent_given: true, version: "2026-10-14", language: "en", chosen_at: "2026-10-14T08:00:00Z", chosen_by: "guardian", access_kind: "guardian" as const, company_name: "Example Clinic" } };
    expect(savedDisclosureAllowed(item)).toBe(true);
    const html = renderToStaticMarkup(<ConsentFormChoicesSection request={item} lang="en" enqueue={queue} onChange={() => undefined} />);
    expect(html).toContain("Information for third parties: Yes, 1 person");
    expect(html).not.toContain("Invoices only");
    expect(html).toContain(">change</a>");
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain('data-consent-option="named_recipients"');
    expect(savedDisclosureAllowed({ ...item, disclosure: { ...item.disclosure, allow_disclosure: false, consent_given: false } })).toBe(false);
  });
});
