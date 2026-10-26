import { describe, expect, it } from "vitest";

import { PAYER_FIELDS, PAYER_STEPS } from "./payer-link-model";
import { PAYER_LINK_TEXTS, fieldLabel, missingLabel, payerLinkText, stepTitle, type PayerLinkText } from "./payer-link-text";
import { leadRequestText } from "@/pages/patient-lead/lead-request-text";

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
    // An organisation is addressed as the invitation does (QA 2026-10-11 A-36a), in every language.
    expect(de.namedYou("Mia Muster", true)).toBe(
      "Mia Muster hat Ihre Organisation als zahlende Partei für eine Anfrage bei GMED benannt.",
    );
    // Art. 14: the source of the data, without repeating "named you" of the header (labels audit 2026-10-26, B14).
    expect(de.privacyNotice("Mia Muster", true)[0]).toBe("Name und Kontaktdaten Ihrer Organisation haben wir von Mia Muster erhalten.");
    expect(de.privacyNotice("Mia Muster")[0]).toBe("Ihren Namen und Ihre Kontaktdaten haben wir von Mia Muster erhalten.");
    for (const lang of ["de", "en", "uk", "ru"]) {
      const text = payerLinkText(lang);
      expect(text.namedYou("Mia Muster", true)).not.toBe(text.namedYou("Mia Muster"));
      expect(text.privacyNotice("Mia Muster", true)[0]).not.toBe(text.privacyNotice("Mia Muster")[0]);
    }
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
    expect(de.confirmLabel).toMatch(/^Ich versichere, dass ich die vorstehenden Angaben nach bestem Wissen und Gewissen gemacht habe/);
    expect(de.confirmLabel).toContain("nicht aus strafbaren Handlungen stammen");
    // Owner 2026-10-26: lawful origin in RU/UK/EN, and the company may refuse or end the cooperation.
    expect(de.confirmLabel).toMatch(/strafbaren Handlungen stammen\. Mir ist bekannt, dass die GMED – Agentur für Patientenbetreuung berechtigt ist, die Zusammenarbeit abzulehnen oder zu beenden, wenn die Angaben nicht oder nur unzureichend gemacht werden\.$/);
    expect(payerLinkText("ru").confirmLabel).toContain("Я подтверждаю, что средства для оплаты имеют законное происхождение. Мне известно, что GMED – Agentur für Patientenbetreuung вправе отказать в сотрудничестве или прекратить его");
    expect(payerLinkText("uk").confirmLabel).toContain("Я підтверджую, що кошти для оплати мають законне походження. Мені відомо, що GMED – Agentur für Patientenbetreuung має право відмовити у співпраці");
    expect(payerLinkText("en").confirmLabel).toContain("are of lawful origin. I am aware that GMED – Agentur für Patientenbetreuung is entitled to refuse or end the cooperation");
    for (const lang of ["de", "en", "uk", "ru"]) {
      expect(leadRequestText(lang).declarationLabel, lang).toBe(payerLinkText(lang).confirmLabel);
    }
    expect(de.submit).toBe("Absenden");
    expect(`${de.thanksTitle} ${de.thanksBody}`).toBe("Vielen Dank. Ihre Angaben sind bei GMED eingegangen.");
    expect(de.steps.funds).toBe("Beziehung und Herkunft der Mittel");
    expect(de.organisationSteps.identity).toBe("Ausweisdokument der vertretungsberechtigten Person");
    // A voluntary check under GMED's own rules, no legal AML duty (owner 2026-10-22).
    expect(de.privacyNotice("Mia Muster").join(" ")).toMatch(/freiwillig.*Art\. 6 Abs\. 1 lit\. b und f DSGVO.*nach den Regeln von GMED fünf Jahre/);
    for (const lang of ["de", "en", "uk", "ru"] as const) {
      const text = payerLinkText(lang);
      expect(`${text.privacyNotice("Mia Muster").join(" ")} ${text.confirmLabel}`).not.toMatch(/GwG|Geldwäsche|laundering|відмив|отмыв|lit\. c|\(c\) GDPR|Meldepflicht/i);
    }
  });

  it("says where the documents for signing stand in the contract's German and in every language", () => {
    const de = payerLinkText("de");
    expect(de.signatureSent("06.10.2026")).toBe(
      "Unterlagen zur Unterschrift: Wir haben Ihnen am 06.10.2026 die Dokumente zur qualifizierten elektronischen Signatur gesendet. Die Einladung kommt per E-Mail von unserem Partner Skribble; dort bestätigen Sie auch Ihre Identität.",
    );
    expect(de.signatureSigned("08.10.2026")).toBe("Vielen Dank – die unterschriebenen Unterlagen sind am 08.10.2026 bei GMED eingegangen.");
    for (const lang of LANGS) {
      const text = payerLinkText(lang);
      expect(text.signatureSent("06.10.2026"), lang).toMatch(/06\.10\.2026.*Skribble/);
      expect(text.signatureSigned("08.10.2026"), lang).toContain("08.10.2026");
      // Without a date the sentence still reads.
      expect(text.signatureSent(""), lang).not.toMatch(/ {2}/);
      expect(text.signatureSigned(""), lang).not.toMatch(/ {2}| \./);
    }
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
    // The source of funds is asked only by a trigger (2026-10-19): the step names no question it does not ask.
    expect(stepTitle(de, "funds", "person")).toBe("Beziehung und Herkunft der Mittel");
    expect(stepTitle(de, "funds", "person", false)).toBe("Beziehung und Tätigkeit");
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
      for (const question of ["pep_self", "pep_related", "sanctions_links"] as const) {
        expect(fieldLabel(de, question, type)).toContain("vertretungsberechtigten Personen oder wirtschaftlich Berechtigten");
        expect(fieldLabel(de, question, type)).not.toMatch(/\b(Sie|Ihnen|Ihre?)\b/);
      }
      expect(fieldLabel(de, "payment_method", type)).toBe("Welche Zahlungsart für Rechnungen bevorzugt die Organisation?");
    }
    // A private person is asked as before.
    expect(fieldLabel(de, "pep_self", "person")).toBe(de.fields.pep_self);
    // No question about a high-risk third country, in no language (owner 2026-10-22): GMED checks the country itself.
    for (const lang of LANGS) {
      expect(JSON.stringify(payerLinkText(lang)), lang).not.toMatch(/high_risk|Drittstaat|hohem Risiko|high-risk|высокого риска|високого ризику/i);
    }
    expect(fieldLabel(de, "payment_method", "person")).toBe("Welche Zahlungsart für Rechnungen bevorzugen Sie?");
    // Every language words the organisation's questions on their own.
    for (const lang of LANGS) {
      const text = payerLinkText(lang);
      for (const [field, label] of Object.entries(text.organisationFields)) {
        expect(label, `${lang} ${field}`).not.toBe(text.fields[field as keyof typeof text.fields]);
      }
      // Whom the questions concern, no filler about the law or "yes or no" (QA 2026-10-10).
      expect(text.declarationsIntroOrganisation).not.toMatch(/Geldwäsche|money laundering|відмиванню|отмыванию|Ja oder Nein|yes or no/i);
    }
  });
});
