import { describe, expect, it } from "vitest";

import { de as appDe } from "@/lib/i18n/de";
import { ru as appRu } from "@/lib/i18n/ru";

import { leadRequestText } from "./lead-request-text";
import { leadPortalFeatureLabels, leadShellNavLabel, leadShellText, type LeadShellText } from "./lead-shell-text";

/**
 * The shell around the lead cabinet (side bar, top bar, locked-entry dialog) speaks the cabinet
 * language in DE, EN, UA and RU (QA 2026-10-24, A-7). DE and RU repeat the app catalogs, so a
 * German or Russian cabinet reads as before; EN and UA are translations of their own.
 */
const LANGS = ["de", "en", "uk", "ru"] as const;
type CabinetLang = (typeof LANGS)[number];

function flatten(value: unknown, path = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof value === "string") {
    out[path] = value;
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) flatten(item, path ? `${path}.${key}` : key, out);
  }
  return out;
}

const texts = Object.fromEntries(LANGS.map((lang) => [lang, flatten(leadShellText(lang))])) as Record<
  CabinetLang,
  Record<string, string>
>;

/** Names and German legal terms that stay as they are in every language. */
const KEPT_WORDS = new Set(["GMED", "Impressum"]);

describe("lead cabinet shell texts", () => {
  it("has every key in all four languages, none empty", () => {
    const keys = Object.keys(texts.de).sort();
    expect(keys.length).toBeGreaterThan(30);
    for (const lang of LANGS) {
      expect(Object.keys(texts[lang]).sort(), lang).toEqual(keys);
      for (const [path, text] of Object.entries(texts[lang])) expect(text.trim(), `${lang} ${path}`).not.toBe("");
    }
  });

  it("translates EN and UA: no German sentence left, no Latin word in Ukrainian", () => {
    const found: string[] = [];
    for (const lang of ["en", "uk"] as const) {
      for (const [path, text] of Object.entries(texts[lang])) {
        // Longer than one word and the same as German: forgotten. "Dashboard" and "Chat" read the
        // same in German and English.
        if (/\s/.test(text.trim()) && text === texts.de[path]) found.push(`${lang} ${path}: ${text} (German)`);
        if (lang === "uk") {
          if (/\s/.test(text.trim()) && text === texts.en[path]) found.push(`${lang} ${path}: ${text} (English)`);
          const latin = (text.match(/[A-Za-zÄÖÜäöüß]+/g) ?? []).filter((word) => word.length > 1 && !KEPT_WORDS.has(word));
          if (latin.length) found.push(`${lang} ${path}: ${text} (Latin: ${latin.join(", ")})`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("writes Ukrainian without Russian letters and Russian without Ukrainian letters", () => {
    expect(Object.entries(texts.uk).filter(([, text]) => /[ыэъёЫЭЪЁ]/.test(text))).toEqual([]);
    expect(Object.entries(texts.ru).filter(([, text]) => /[іїєґІЇЄҐ]/.test(text))).toEqual([]);
  });

  it("repeats the app catalogs in German and Russian, so those shells read as before", () => {
    const catalogs = { de: appDe, ru: appRu } as const;
    // "after_request" is the cabinet's own entry (owner 2026-10-26, C1): no catalog key.
    const navKeys: Record<Exclude<keyof LeadShellText["nav"], "after_request">, keyof typeof appDe> = {
      lead_request: "nav_my_request",
      account: "nav_account",
      legal: "nav_legal_notice",
      dashboard: "nav_dashboard",
      notifications: "nav_my_notifications",
      chat: "nav_chat",
      appointments: "nav_my_appointments",
      recommendations: "nav_my_recommendations",
      documents: "nav_my_documents",
      subscriptions: "nav_my_subscriptions",
      invoices: "nav_my_invoices",
      feedback: "nav_my_feedback",
      privacy: "nav_my_privacy",
    };
    for (const lang of ["de", "ru"] as const) {
      const shell = leadShellText(lang);
      const catalog = catalogs[lang];
      expect(shell.portalName, lang).toBe(catalog.portal_dashboard_patient_portal);
      expect(shell.signOut, lang).toBe(catalog.nav_logout);
      expect(shell.toggleSidebar, lang).toBe(catalog.ui_toggle_sidebar);
      expect(shell.planDialog.close, lang).toBe(catalog.common_close);
      for (const [id, key] of Object.entries(navKeys)) {
        expect(shell.nav[id as keyof LeadShellText["nav"]], `${lang} ${id}`).toBe(catalog[key]);
      }
    }
    // No second product name under the lead's own name (labels audit 2026-10-26, B1).
    expect(leadShellText("de")).not.toHaveProperty("accountCaption");
    expect(leadShellText("de").nav.after_request).toBe("Was nach der Anfrage kommt");
    expect(leadShellText("ru").nav.after_request).toBe("Что будет после заявки");
    expect(leadShellText("uk").nav.after_request).toBe("Що буде після заявки");
    expect(leadShellText("en").nav.after_request).toBe("What comes after your request");
    expect(leadPortalFeatureLabels("de")).toEqual([
      "Dashboard", "Meine Benachrichtigungen", "Chat", "Meine Termine", "Meine Empfehlungen",
      "Meine Dokumente", "Meine Abonnements", "Meine Rechnungen", "Mein Feedback", "Datenschutz",
    ]);
    expect(leadShellText("de").locked).toBe("Gesperrt");
    expect(leadShellText("ru").locked).toBe("Закрыто");
  });

  it("names the request entry like the cabinet's own title and signs out like its ended-access page in DE, EN and UA", () => {
    for (const lang of LANGS) {
      expect(leadShellText(lang).nav.lead_request, lang).toBe(leadRequestText(lang).title);
    }
    // The Russian side bar keeps the catalog's "Выход"; the cabinet's own button says "Выйти".
    for (const lang of ["de", "en", "uk"] as const) {
      expect(leadShellText(lang).signOut, lang).toBe(leadRequestText(lang).signOut);
    }
  });

  it("reads an unknown or portal language like the cabinet and falls back for an unknown nav id", () => {
    expect(leadShellText("ua")).toBe(leadShellText("uk"));
    expect(leadShellText("en-GB")).toBe(leadShellText("en"));
    expect(leadShellText(null)).toBe(leadShellText("ru"));
    expect(leadShellNavLabel(leadShellText("en"), "services", "Meine Leistungen")).toBe("Meine Leistungen");
    expect(leadShellNavLabel(leadShellText("en"), "account", "Konto")).toBe("Account");
  });
});
