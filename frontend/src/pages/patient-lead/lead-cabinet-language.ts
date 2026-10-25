import { useSyncExternalStore } from "react";

import type { Lang } from "@/lib/i18n";

import { asLeadCabinetLang, resolveLeadCabinetLang, type LeadCabinetLang } from "./lead-request-text";

/**
 * The language of the lead cabinet, shared with the shell around it (QA 2026-10-24, A-7).
 *
 * The cabinet speaks DE, EN, UA and RU; the app's own catalogs only DE and RU. The request page
 * resolves the language (`resolveLeadCabinetLang`) and publishes it here, so the side bar, the
 * top bar and the locked-module dialog speak the same language, UA and EN included. Before the
 * page has published anything (first render, a reload on the account page) the shell derives the
 * same starting value the page would: the remembered choice, else the account language, else the
 * portal language. Kept per login for the browser tab, like the account label, and never for
 * another login.
 */
const STORAGE_KEY = "gmed_lead_cabinet_lang";

type Entry = { userId: string; lang: LeadCabinetLang };

const listeners = new Set<() => void>();
let entry: Entry | null = null;

/** The choice remembered in this browser, if it is a cabinet language. */
export function readStoredLeadCabinetLang(): LeadCabinetLang | null {
  try {
    return asLeadCabinetLang(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Remembers the choice in this browser; without storage it lasts for the visit only. */
export function storeLeadCabinetLang(lang: LeadCabinetLang): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // The choice then lasts for this visit only.
  }
}

/** The request page tells the shell which language the login `userId` reads the cabinet in. */
export function publishLeadCabinetLang(userId: string, lang: LeadCabinetLang): void {
  if (entry?.userId === userId && entry.lang === lang) return;
  entry = { userId, lang };
  listeners.forEach((listener) => listener());
}

function currentEntry(): Entry | null {
  return entry;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The language the shell of the lead cabinet speaks for the login `user`: what the request page
 * published, else the same starting value the page computes before its requests are loaded.
 *
 * `settled`: whether that language is final. It is not while nothing was published, nothing is
 * remembered and the account has no language of its own: the page then takes the language of the
 * request over once it is loaded (a German request on a Russian portal), and the shell would
 * show the portal language for a moment first (QA 2026-10-25, E-13: the Russian side bar before
 * the German cabinet). The side bar shows a neutral skeleton until then.
 */
export function useLeadCabinetLangState(
  user: { id?: string | null; preferred_language?: string | null } | null | undefined,
  portalLang: Lang,
): { lang: LeadCabinetLang; settled: boolean } {
  const current = useSyncExternalStore(subscribe, currentEntry, currentEntry);
  if (user?.id && current?.userId === user.id) return { lang: current.lang, settled: true };
  const chosen = readStoredLeadCabinetLang() ?? asLeadCabinetLang(user?.preferred_language);
  return { lang: resolveLeadCabinetLang(chosen, null, portalLang), settled: chosen !== null };
}

/** The language alone (`useLeadCabinetLangState`). */
export function useLeadCabinetLang(
  user: { id?: string | null; preferred_language?: string | null } | null | undefined,
  portalLang: Lang,
): LeadCabinetLang {
  return useLeadCabinetLangState(user, portalLang).lang;
}
