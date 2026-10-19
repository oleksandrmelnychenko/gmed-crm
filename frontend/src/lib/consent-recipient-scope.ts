/**
 * What a trusted person (Anlage 1, "named recipients") may be told — chosen from fixed options
 * since 2026-10-19 (owner), replacing the free-text "Umfang der Auskunft". `all` covers the other
 * three. The server (`consent_choices::RECIPIENT_SCOPES`) validates the same codes and prints them
 * in German words on the consent form.
 */
export const CONSENT_RECIPIENT_SCOPES = ["all", "medical", "organisational", "financial"] as const;
export type ConsentRecipientScope = (typeof CONSENT_RECIPIENT_SCOPES)[number];
export const PARTIAL_RECIPIENT_SCOPES = CONSENT_RECIPIENT_SCOPES.filter((code) => code !== "all");

type ScopeLabels = Record<ConsentRecipientScope, string>;

/** Option labels of the cabinet with a short explanation of each category. */
const CABINET_OPTIONS: Record<"de" | "en" | "uk" | "ru", ScopeLabels> = {
  de: {
    all: "Alle Informationen",
    medical: "Medizinische Informationen (Befunde, Behandlung)",
    organisational: "Organisatorische Informationen (Termine, Reise, Organisation)",
    financial: "Finanzielle Informationen (Kostenvoranschläge, Rechnungen, Zahlungen)",
  },
  en: {
    all: "All information",
    medical: "Medical information (findings, treatment)",
    organisational: "Organisational information (appointments, travel, organisation)",
    financial: "Financial information (cost estimates, invoices, payments)",
  },
  uk: {
    all: "Уся інформація",
    medical: "Медична інформація (висновки, лікування)",
    organisational: "Організаційна інформація (прийоми, поїздки, організація)",
    financial: "Фінансова інформація (кошториси, рахунки, платежі)",
  },
  ru: {
    all: "Вся информация",
    medical: "Медицинская информация (заключения, лечение)",
    organisational: "Организационная информация (приёмы, поездки, организация)",
    financial: "Финансовая информация (сметы, счета, платежи)",
  },
};

/** Short labels for summaries in the cabinet. */
const CABINET_SHORT: Record<"de" | "en" | "uk" | "ru", ScopeLabels> = {
  de: { all: "Alle Informationen", medical: "Medizinische Informationen", organisational: "Organisatorische Informationen", financial: "Finanzielle Informationen" },
  en: { all: "All information", medical: "Medical information", organisational: "Organisational information", financial: "Financial information" },
  uk: { all: "Уся інформація", medical: "Медична інформація", organisational: "Організаційна інформація", financial: "Фінансова інформація" },
  ru: { all: "Вся информация", medical: "Медицинская информация", organisational: "Организационная информация", financial: "Финансовая информация" },
};

/** Read-only labels of the staff app (de/ru). */
const STAFF_SHORT: Record<"de" | "ru", ScopeLabels> = {
  ru: { all: "вся информация", medical: "медицинская", organisational: "организационная", financial: "финансовая" },
  de: { all: "alle Informationen", medical: "medizinische", organisational: "organisatorische", financial: "finanzielle" },
};

const cabinetLang = (lang: string): "de" | "en" | "uk" | "ru" =>
  lang === "de" || lang === "en" || lang === "uk" ? lang : "ru";

/** Known codes only, in offer order, without repeats; `["all"]` when `all` is among them. */
export function normalizeScopeCodes(value: unknown): ConsentRecipientScope[] {
  if (!Array.isArray(value)) return [];
  const chosen = new Set(value.filter((code): code is string => typeof code === "string").map((code) => code.trim()));
  if (chosen.has("all")) return ["all"];
  return CONSENT_RECIPIENT_SCOPES.filter((code) => chosen.has(code));
}

/** The ticked options: with `all` every option is ticked. */
export function checkedScopeCodes(codes: readonly ConsentRecipientScope[]): ConsentRecipientScope[] {
  return codes.includes("all") ? [...CONSENT_RECIPIENT_SCOPES] : normalizeScopeCodes(codes);
}

/**
 * One click on an option. Ticking `all` ticks everything, unticking it clears the choice;
 * unticking one of the others while `all` is chosen keeps the remaining two.
 */
export function toggleScopeCode(codes: readonly ConsentRecipientScope[], code: ConsentRecipientScope): ConsentRecipientScope[] {
  const current = normalizeScopeCodes(codes);
  if (code === "all") return current.includes("all") ? [] : ["all"];
  if (current.includes("all")) return PARTIAL_RECIPIENT_SCOPES.filter((other) => other !== code);
  return current.includes(code) ? current.filter((other) => other !== code) : normalizeScopeCodes([...current, code]);
}

export function scopeOptionLabel(code: ConsentRecipientScope, lang: string): string {
  return CABINET_OPTIONS[cabinetLang(lang)][code];
}

/** The chosen scope as the cabinet shows it ("Medizinische Informationen, Finanzielle Informationen"). */
export function cabinetScopeSummary(codes: readonly ConsentRecipientScope[], lang: string): string {
  const labels = CABINET_SHORT[cabinetLang(lang)];
  return normalizeScopeCodes(codes).map((code) => labels[code]).join(", ");
}

/** The chosen scope as staff views show it ("медицинская, финансовая"). */
export function staffScopeSummary(codes: readonly ConsentRecipientScope[], lang: string): string {
  const labels = STAFF_SHORT[lang === "de" ? "de" : "ru"];
  return normalizeScopeCodes(codes).map((code) => labels[code]).join(", ");
}
