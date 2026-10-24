import { describe, expect, it } from "vitest";

import { PAYER_LINK_TEXTS } from "../payer-link/payer-link-text";
import { consentFormText } from "./lead-request-consent-form-text";
import { leadRequestText } from "./lead-request-text";
import { trustedPersonsText } from "./lead-trusted-persons-text";

/**
 * The language check of every text a lead, a parent or a payer reads (QA 2026-10-23): the lead
 * cabinet, its "Auskunft an Dritte" and consent-form blocks and the payer's own link, in DE, EN,
 * UA and RU. Each dictionary is flattened to "path → string"; functions are called with sample
 * arguments. Every test lists all offenders at once.
 */
const LANGS = ["de", "en", "uk", "ru"] as const;
type CabinetLang = (typeof LANGS)[number];

function flatten(value: unknown, path = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof value === "string") {
    out[path] = value;
  } else if (typeof value === "function") {
    flatten((value as (...args: unknown[]) => unknown)("Mia Muster", 2), `${path}()`, out);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${path}[${index}]`, out));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) flatten(item, path ? `${path}.${key}` : key, out);
  }
  return out;
}

const DICTIONARIES: Record<string, (lang: CabinetLang) => Record<string, string>> = {
  cabinet: (lang) => flatten(leadRequestText(lang)),
  disclosure: (lang) => flatten(trustedPersonsText(lang)),
  consentForm: (lang) => flatten(consentFormText(lang)),
  consentFormChild: (lang) => flatten(consentFormText(lang, true)),
  payerLink: (lang) => flatten(PAYER_LINK_TEXTS[lang]),
};

/** Every text of the languages as "dictionary lang path: text" lines that match `bad`. */
function offenders(langs: readonly CabinetLang[], bad: (text: string, path: string, lang: CabinetLang) => boolean): string[] {
  const found: string[] = [];
  for (const [name, dictionary] of Object.entries(DICTIONARIES)) {
    for (const lang of langs) {
      for (const [path, text] of Object.entries(dictionary(lang))) {
        if (bad(text, path, lang)) found.push(`${name} ${lang} ${path}: ${text}`);
      }
    }
  }
  return found;
}

/** Names, brands, codes and German legal terms that stay as they are in every language. */
const KEPT_WORDS = new Set([
  "GMED", "Mia", "Muster", "E-mail", "e-mail", "WhatsApp", "Threema", "Telegram", "Skribble", "PDF", "JPG", "PNG",
  "ID", "IBAN", "USt-IdNr", "DSGVO", "GDPR", "Betreuer", "Betreuerausweis", "Auskunft", "an", "Dritte", "Anna",
  "Ivanova", "Hanna", "Ivanenko", "name", "example", "de", "EUR",
]);

/** Words that tell a lead or payer about an internal check (tipping-off): never in their texts. */
const TIPPING_OFF =
  /risik|risk|ризик|риск|verstärkt|enhanced|посилен|усилен|blacklist|schwarze liste|чорн\S* спис|черн\S* спис|geldwäsch|laundering|відмиван|отмыван|\bgwg\b|verdacht|suspic|підозр|подозр|sanktionsliste|sanctions? list|санкційн\S* спис|санкционн\S* спис|hochrisiko|high-risk|trigger|тригер|триггер|score|screening|скринінг|скрининг|\bpep\b|\bedd\b|due diligence|abgleich|збіг|совпаден/i;

describe("lead cabinet and payer link: language", () => {
  it("has the same texts in every language", () => {
    for (const [name, dictionary] of Object.entries(DICTIONARIES)) {
      const keys = Object.keys(dictionary("de")).sort();
      expect(keys.length, name).toBeGreaterThan(10);
      for (const lang of LANGS) expect(Object.keys(dictionary(lang)).sort(), `${name} ${lang}`).toEqual(keys);
    }
  });

  it("translates every text: no empty text, no key, no German or English left in another language", () => {
    const german = Object.fromEntries(Object.entries(DICTIONARIES).map(([name, dictionary]) => [name, dictionary("de")]));
    const english = Object.fromEntries(Object.entries(DICTIONARIES).map(([name, dictionary]) => [name, dictionary("en")]));
    const found: string[] = [];
    for (const [name, dictionary] of Object.entries(DICTIONARIES)) {
      for (const lang of ["en", "uk", "ru"] as const) {
        for (const [path, text] of Object.entries(dictionary(lang))) {
          const where = `${name} ${lang} ${path}: ${text}`;
          if (!text.trim() || (lang !== "en" && text === path)) found.push(where);
          // Longer than one word and the same as German (or as English in UA/RU): forgotten.
          // "Person 1" of a beneficial owner reads the same in German and English.
          if (/\s/.test(text.trim()) && text === german[name][path] && path !== "ownerHeading()") found.push(`${where} (German)`);
          if (lang !== "en" && /\s/.test(text.trim()) && text === english[name][path]) found.push(`${where} (English)`);
          if (lang !== "en") {
            // Single letters stay: "lit. b und f", "A–Z".
            const latin = (text.match(/[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*/g) ?? []).filter(
              (word) => word.length > 1 && !KEPT_WORDS.has(word),
            );
            if (latin.length) found.push(`${where} (Latin: ${latin.join(", ")})`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("writes Ukrainian without Russian letters and Russian without Ukrainian letters", () => {
    expect(offenders(["uk"], (text) => /[ыэъёЫЭЪЁ]/.test(text))).toEqual([]);
    expect(offenders(["ru"], (text) => /[іїєґІЇЄҐ]/.test(text))).toEqual([]);
  });

  it("writes the Ukrainian apostrophe as ’ and the DSGVO reference in one form per language", () => {
    expect(offenders(["uk"], (text) => /\p{L}'\p{L}/u.test(text))).toEqual([]);
    const reference: Record<CabinetLang, RegExp> = {
      de: /Art\. 6 Abs\. 1 lit\. b und f DSGVO/,
      en: /Art\. 6\(1\)\(b\) and \(f\) GDPR/,
      uk: /ст\. 6 абз\. 1 літ\. b і f DSGVO \(GDPR\)/,
      ru: /ст\. 6 абз\. 1 лит\. b и f DSGVO \(GDPR\)/,
    };
    expect(offenders(LANGS, (text, _path, lang) => /(Art\.|ст\.) 6\b/.test(text) && !reference[lang].test(text))).toEqual([]);
    expect(offenders(["ru"], (text) => /Ответственн(ый|ая) за обработку/.test(text))).toEqual([]);
  });

  it("names the other parent one way in Ukrainian: «другий з батьків», as the captions say", () => {
    expect(offenders(["uk"], (text) => /інш\S* з(і)? батьків/i.test(text))).toEqual([]);
  });

  it("names the source of funds one way in Russian: «происхождение средств», as Ukrainian and the payer link do", () => {
    expect(offenders(["ru"], (text) => /источник\S* средств/i.test(text))).toEqual([]);
  });

  it("quotes per language: „…“ in German, “…” in English, «…» in Ukrainian and Russian", () => {
    const wrong: Record<CabinetLang, RegExp> = { de: /["«»]/, en: /["«»„]/, uk: /["„“”]/, ru: /["„“”]/ };
    expect(offenders(LANGS, (text, _path, lang) => wrong[lang].test(text))).toEqual([]);
  });

  it("puts a dash (—) between Ukrainian and Russian clauses and no space or three dots for an ellipsis", () => {
    expect(offenders(["uk", "ru"], (text) => /\p{L}\s[–-]\s\p{L}/u.test(text))).toEqual([]);
    expect(offenders(LANGS, (text) => /\s…|\.\.\./.test(text))).toEqual([]);
  });

  it("addresses the reader formally everywhere, with a lower-case «ви/вы» inside a sentence", () => {
    const informal: Partial<Record<CabinetLang, RegExp>> = {
      de: /\b(du|dich|dir|dein\w*)\b/i,
      uk: /(^|[^\p{L}'’])(ти|тебе|тобі|твій|твоя|твої|твого)(?![\p{L}'’])/iu,
      ru: /(^|[^\p{L}])(ты|тебя|тебе|твой|твоя|твои|твоего)(?!\p{L})/iu,
    };
    expect(offenders(LANGS, (text, _path, lang) => informal[lang]?.test(text) ?? false)).toEqual([]);
    // A capital "Вы/Ваш" after a word (not at the start of a sentence) mixes two styles of address.
    expect(offenders(["uk", "ru"], (text) => /[\p{L},]\s+(Ви|Вас|Вам|Вами|Ваш\p{L}*|Вы)(?!\p{L})/u.test(text))).toEqual([]);
  });

  it("never tells a lead, a parent or a payer about an internal check (no tipping-off)", () => {
    // `channelsRisk` names the risk of e-mail and messengers for sensitive data, not a check.
    expect(offenders(LANGS, (text, path) => path !== "channelsRisk" && TIPPING_OFF.test(text))).toEqual([]);
  });

  it("gives the refusals the cabinet can receive a message of their own in every language", () => {
    for (const lang of LANGS) {
      const errors = leadRequestText(lang).errors;
      for (const code of [
        "upload_reviewed",
        "upload_in_use",
        "too_many_documents",
        "unsupported_file_type",
        "file_too_large",
        "file_rejected",
        "personal_data_incomplete",
        "consent_version_outdated",
        "lead_converted",
        "request_failed",
      ]) {
        expect(errors[code], `${lang} ${code}`).toBeTruthy();
      }
    }
  });
});
