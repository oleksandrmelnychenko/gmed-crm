import { describe, expect, it } from "vitest";

import { PAYER_FIELDS, PAYER_STEPS } from "./payer-link-model";
import { PAYER_LINK_TEXTS, fieldLabel, missingLabel, payerLinkText, stepTitle, type PayerLinkText } from "./payer-link-text";

/** Every leaf of a text object as "path → kind" (functions are called with sample arguments). */
function shape(value: unknown, path = ""): Record<string, string> {
  if (typeof value === "function") {
    const sample = (value as (...args: unknown[]) => unknown)("Mia Muster", 8);
    return { [path]: Array.isArray(sample) ? `function→array(${sample.length})` : `function→${typeof sample}` };
  }
  if (Array.isArray(value)) return { [path]: `array(${value.length})` };
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => Object.entries(shape(item, path ? `${path}.${key}` : key))));
  }
  return { [path]: typeof value };
}

/** Every string a text object can produce, functions called with sample arguments. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    const fn = value as (...args: unknown[]) => unknown;
    return [fn("Mia Muster", 8), fn(null), fn(1), fn(0)].flatMap(strings);
  }
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

const LANGS = ["de", "en", "uk", "ru"] as const;

describe("payer page texts", () => {
  it("has the same keys in all four languages", () => {
    const german = shape(PAYER_LINK_TEXTS.de);
    expect(Object.keys(german).length).toBeGreaterThan(150);
    for (const lang of LANGS) {
      expect(shape(PAYER_LINK_TEXTS[lang]), lang).toEqual(german);
    }
  });

  it("leaves no text empty and nothing untranslated by accident", () => {
    for (const lang of LANGS) {
      for (const value of strings(PAYER_LINK_TEXTS[lang])) {
        expect(value.trim(), lang).not.toBe("");
      }
    }
    // The other languages are not German copies (except names and shared words like "E-Mail").
    const german = new Set(strings(PAYER_LINK_TEXTS.de).filter((value) => value.length > 20));
    for (const lang of ["en", "uk", "ru"] as const) {
      const copies = strings(PAYER_LINK_TEXTS[lang]).filter((value) => german.has(value));
      expect(copies, lang).toEqual([]);
    }
  });

  it("labels every field and every step in every language", () => {
    for (const lang of LANGS) {
      const text = payerLinkText(lang);
      for (const field of PAYER_FIELDS) {
        expect(fieldLabel(text, field, "person"), `${lang} ${field}`).toBeTruthy();
        expect(fieldLabel(text, field, "company"), `${lang} ${field}`).toBeTruthy();
      }
      for (const step of PAYER_STEPS) expect(stepTitle(text, step, "person")).toBeTruthy();
    }
  });

  it("uses no medical words", () => {
    const medical: Record<(typeof LANGS)[number], RegExp> = {
      de: /behandl|medizin|ärzt|arzt|klinik|krankheit|diagnos|therap|gesundheit|befund/i,
      en: /treatment|medical|clinic|doctor|health|diagnos|therap|hospital|illness/i,
      uk: /лікуван|медичн|клінік|лікар|здоров|діагно|терап|хвороб/i,
      ru: /лечени|медицин|клиник|врач|здоров|диагно|терап|болезн/i,
    };
    for (const lang of LANGS) {
      for (const value of strings(PAYER_LINK_TEXTS[lang])) {
        expect(value, lang).not.toMatch(medical[lang]);
      }
    }
  });

  it("speaks the German of the contract", () => {
    const de = payerLinkText("de");
    expect(de.pageTitle).toBe("Angaben zur Kostenübernahme");
    expect(de.namedYou("Mia Muster")).toBe("Mia Muster hat Sie als zahlende Person für eine Anfrage bei GMED benannt.");
    expect(de.codeWillBeSent("v***r@example.com")).toBe("Wir senden einen Bestätigungscode an v***r@example.com.");
    expect(de.sendCode).toBe("Code senden");
    expect(de.confirmCode).toBe("Bestätigen");
    expect(de.resendIn(60)).toBe("Code erneut senden (in 60 s)");
    expect(de.linkRevoked).toBe("Dieser Link ist nicht mehr gültig. Bitte wenden Sie sich an GMED.");
    expect(de.privacyAck).toBe("Ich habe die Datenschutzhinweise gelesen.");
    expect(de.contactQuestion).toBe("Wie dürfen wir Sie kontaktieren?");
    expect(de.fields.habitual_residence_country).toBe("Gewöhnlicher Aufenthalt (falls abweichend)");
    expect(de.fields.beneficial_owners_none).toBe("Es gibt keine natürliche Person mit mehr als 25 %");
    expect(de.fields.relationship_kind).toBe("Beziehung zur Patientin / zum Patienten");
    expect(de.confirmLabel).toBe("Ich bestätige, dass meine Angaben vollständig und richtig sind.");
    expect(de.submit).toBe("Absenden");
    expect(`${de.thanksTitle} ${de.thanksBody}`).toBe("Vielen Dank. Ihre Angaben sind bei GMED eingegangen.");
    expect(de.steps.funds).toBe("Beziehung und Herkunft der Mittel");
    expect(de.organisationSteps.identity).toBe("Ausweisdokument der vertretungsberechtigten Person");
    expect(de.privacyNotice("Mia Muster").join(" ")).toMatch(/§§ 10–12 GwG.*Art\. 6 Abs\. 1 lit\. b und c DSGVO.*§ 8 Abs\. 4 GwG/);
  });

  it("addresses the payer formally", () => {
    for (const value of strings(PAYER_LINK_TEXTS.de)) expect(value).not.toMatch(/\b(du|dein|deine|dich|dir)\b/i);
    for (const value of strings(PAYER_LINK_TEXTS.uk)) expect(value).not.toMatch(/(^|\s)(ти|твій|твоя|тебе)(\s|$)/i);
    for (const value of strings(PAYER_LINK_TEXTS.ru)) expect(value).not.toMatch(/(^|\s)(ты|твой|твоя|тебя)(\s|$)/i);
  });

  it("falls back to German and reads UA as Ukrainian", () => {
    expect(payerLinkText("fr")).toBe(PAYER_LINK_TEXTS.de);
    expect(payerLinkText(null)).toBe(PAYER_LINK_TEXTS.de);
    expect(payerLinkText("ua")).toBe(PAYER_LINK_TEXTS.uk);
    expect(payerLinkText("en-GB")).toBe(PAYER_LINK_TEXTS.en);
  });

  it("names the organisation's fields for what they are", () => {
    const de: PayerLinkText = payerLinkText("de");
    expect(fieldLabel(de, "organisation_name", "company")).toBe("Firma");
    expect(fieldLabel(de, "organisation_name", "organisation")).toBe("Name der Organisation");
    expect(stepTitle(de, "details", "person")).toBe("Angaben zur Person");
    expect(stepTitle(de, "details", "insurance")).toBe("Angaben zur Organisation");
    expect(missingLabel(de, "street", "person")).toBe("Straße und Hausnummer");
    expect(missingLabel(de, "street", "organisation")).toBe("Sitz: Straße und Hausnummer");
    expect(missingLabel(de, "pep_related_details", "person")).toBe("Politisch exponierte nahestehende Person: Angaben");
  });

  it("asks an organisation about its representatives and beneficial owners, not about the one who types", () => {
    const de = payerLinkText("de");
    for (const type of ["company", "organisation", "insurance"] as const) {
      expect(fieldLabel(de, "pep_self", type)).toBe(
        "Üben die vertretungsberechtigten Personen oder wirtschaftlich Berechtigten ein hochrangiges öffentliches Amt aus oder haben sie es in den letzten 12 Monaten ausgeübt?",
      );
      for (const question of ["pep_self", "pep_related", "high_risk_country", "sanctions_links"] as const) {
        expect(fieldLabel(de, question, type)).toContain("vertretungsberechtigten Personen oder wirtschaftlich Berechtigten");
        expect(fieldLabel(de, question, type)).not.toMatch(/\b(Sie|Ihnen|Ihre?)\b/);
      }
      expect(fieldLabel(de, "payment_method", type)).toBe("Wie erfolgt die Zahlung?");
    }
    // A private person is asked as before.
    expect(fieldLabel(de, "pep_self", "person")).toBe(de.fields.pep_self);
    expect(fieldLabel(de, "high_risk_country", "person")).toMatch(/^Haben Sie/);
    expect(fieldLabel(de, "payment_method", "person")).toBe("Wie werden Sie bezahlen?");
    // Every language words the organisation's questions on their own.
    for (const lang of LANGS) {
      const text = payerLinkText(lang);
      for (const [field, label] of Object.entries(text.organisationFields)) {
        expect(label, `${lang} ${field}`).not.toBe(text.fields[field as keyof typeof text.fields]);
      }
      expect(text.declarationsIntroOrganisation).not.toBe(text.declarationsIntro);
    }
  });
});
