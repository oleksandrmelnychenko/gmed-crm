import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FORM_PRIVACY_SECTIONS } from "../form-privacy-content";
import { AgencyContactLine, HealthConsentText, retentionNoticeHref, splitRetentionPhrase } from "./health-consent-text";
import { leadRequestText } from "./lead-request-text";

// The endings of `health_consent_text` (lead_portal_intake.rs), word for word.
const CONSENT_ENDINGS = {
  de: "werden die Anfrage und die Unterlagen nach Ablauf der angegebenen Frist gelöscht.",
  ru: "заявка и документы удаляются по истечении указанного срока.",
  uk: "заявку та документи буде видалено після закінчення зазначеного строку.",
  en: "the request and the documents are deleted when the stated deadline has passed.",
} as const;
const PHRASES = { de: "angegebenen Frist", ru: "указанного срока", uk: "зазначеного строку", en: "stated deadline" } as const;

describe("health consent deadline link", () => {
  it("links the deadline phrase to the retention section and keeps the wording unchanged", () => {
    for (const lang of ["de", "ru", "uk", "en"] as const) {
      const text = `Einleitung. ${CONSENT_ENDINGS[lang]}`;
      const html = renderToStaticMarkup(<HealthConsentText text={text} lang={lang} />);
      expect(html, lang).toContain(
        `<a href="/legal?notice=form&amp;lang=${lang}#form-privacy-section-9" target="_blank" rel="noreferrer"`,
      );
      expect(html, lang).toContain(`>${PHRASES[lang]}</a>`);
      expect(html.replace(/<[^>]+>/g, ""), lang).toBe(text);
    }
  });

  it("shows a text without the phrase as it is", () => {
    expect(splitRetentionPhrase("Ohne Frist.")).toBeNull();
    expect(renderToStaticMarkup(<HealthConsentText text="Ohne Frist." lang="de" />)).toBe("Ohne Frist.");
  });

  it("points at the retention section of the privacy notice in both languages", () => {
    expect(retentionNoticeHref("ru")).toBe("/legal?notice=form&lang=ru#form-privacy-section-9");
    expect(FORM_PRIVACY_SECTIONS.de.find((section) => section.number === 9)?.title).toBe("Speicherdauer");
    expect(FORM_PRIVACY_SECTIONS.ru.find((section) => section.number === 9)?.title).toBe("Срок хранения");
  });
});

describe("GMED contact under the health consent", () => {
  const label = leadRequestText("ru").healthConsentContact;

  it("shows the company e-mail and phone from the legal settings", () => {
    const html = renderToStaticMarkup(
      <AgencyContactLine contact={{ email: "info@example.test", phone: "+49 30 1234 567" }} label={label} />,
    );
    expect(html).toContain('href="mailto:info@example.test"');
    expect(html).toContain('href="tel:+49301234567"');
    expect(html).toContain("+49 30 1234 567");
    expect(html).toContain(label);
  });

  it("shows only what exists, and nothing without any contact", () => {
    const html = renderToStaticMarkup(<AgencyContactLine contact={{ email: "info@example.test", phone: "" }} label={label} />);
    expect(html).not.toContain("tel:");
    expect(html).not.toContain(" · ");
    expect(renderToStaticMarkup(<AgencyContactLine contact={null} label={label} />)).toBe("");
  });

  it("has the lead-in in every cabinet language", () => {
    for (const lang of ["de", "ru", "uk", "en"] as const) {
      expect(leadRequestText(lang).healthConsentContact, lang).toContain("GMED");
    }
  });
});
