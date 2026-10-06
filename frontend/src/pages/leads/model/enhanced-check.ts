/**
 * The enhanced check of a lead (verstärkte Sorgfaltspflichten, § 15 GwG) by
 * the owner's rule of 2026-10-07: required only by a black-list residence or
 * citizenship of the patient or of the third-party payer, or by a confirmed
 * sanctions match of either. The server decides it
 * (`GET /leads/{id}/enhanced-check`, `crates/server/src/routes/lead_enhanced_check.rs`);
 * a PEP or a country of the longer high-risk list is a hint for staff only.
 */
import type { Tx } from "./lead-payer";

/**
 * The black list (FATF call for action): mirror of `BLACK_LIST_COUNTRY_CODES`
 * on the server; `enhanced-check.test.ts` keeps both equal.
 */
export const ENHANCED_CHECK_BLACKLIST_COUNTRY_CODES = ["KP", "IR", "MM"] as const;

/** The keys that make the check required, in the server's order. */
export const ENHANCED_CHECK_TRIGGER_REASONS = [
  "patient_residence_blacklist",
  "patient_citizenship_blacklist",
  "payer_residence_blacklist",
  "payer_citizenship_blacklist",
  "patient_sanctioned",
  "payer_sanctioned",
] as const;

/** Information only: a possible sanctions match waits for the CEO's decision. */
export const SANCTIONS_REVIEW_PENDING = "sanctions_review_pending";

export type LeadEnhancedCheck = {
  required: boolean;
  /** Trigger keys, and `sanctions_review_pending` as information. */
  reasons: string[];
  /** The black-list codes that triggered. */
  countries: string[];
};

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** The server's answer; null for anything that is not one (an older server, a proxy reply, a test mock). */
export function normalizeLeadEnhancedCheck(value: unknown): LeadEnhancedCheck | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.required !== "boolean") return null;
  return {
    required: raw.required,
    reasons: stringList(raw.reasons),
    countries: stringList(raw.countries).map((code) => code.toUpperCase()),
  };
}

const BLACKLIST = new Set<string>(ENHANCED_CHECK_BLACKLIST_COUNTRY_CODES);

/** Whether an ISO code is on the black list. */
export function isBlacklistCountry(code: string | null | undefined): boolean {
  return BLACKLIST.has((code ?? "").trim().toUpperCase());
}

/** The black-list codes among ISO codes, once each, in their order. */
export function blacklistCountries(codes: Iterable<string | null | undefined>): string[] {
  const found: string[] = [];
  for (const code of codes) {
    const normalized = (code ?? "").trim().toUpperCase();
    if (BLACKLIST.has(normalized) && !found.includes(normalized)) found.push(normalized);
  }
  return found;
}

/** The trigger keys of a check, without the information-only ones. */
export function enhancedCheckTriggers(check: LeadEnhancedCheck | null | undefined): string[] {
  return (check?.reasons ?? []).filter((reason) => reason !== SANCTIONS_REVIEW_PENDING);
}

/**
 * Whether the check is required: the server's answer, or a black-list country
 * the wizard shows but has not saved yet (the server follows on the next load).
 */
export function enhancedCheckRequired(
  check: LeadEnhancedCheck | null | undefined,
  unsavedBlacklistCountries: readonly string[] = [],
): boolean {
  return Boolean(check?.required) || unsavedBlacklistCountries.length > 0;
}

/** One reason as a short label. */
export function enhancedCheckReasonLabel(reason: string, tx: Tx): string {
  switch (reason) {
    case "patient_residence_blacklist":
      return tx("страна проживания пациента в чёрном списке", "Wohnsitzland des Patienten auf der Blacklist");
    case "patient_citizenship_blacklist":
      return tx("гражданство пациента в чёрном списке", "Staatsangehörigkeit des Patienten auf der Blacklist");
    case "payer_residence_blacklist":
      return tx("страна проживания плательщика в чёрном списке", "Wohnsitzland des Zahlers auf der Blacklist");
    case "payer_citizenship_blacklist":
      return tx("гражданство плательщика в чёрном списке", "Staatsangehörigkeit des Zahlers auf der Blacklist");
    case "patient_sanctioned":
      return tx("пациент в санкционном списке (подтверждено)", "Patient auf einer Sanktionsliste (bestätigt)");
    case "payer_sanctioned":
      return tx("плательщик в санкционном списке (подтверждено)", "Zahler auf einer Sanktionsliste (bestätigt)");
    case SANCTIONS_REVIEW_PENDING:
      return tx(
        "возможное совпадение с санкционным списком ждёт решения",
        "möglicher Sanktionstreffer wartet auf die Entscheidung",
      );
    default:
      return reason;
  }
}

/** The reasons as one line, e.g. "гражданство пациента в чёрном списке, …". */
export function enhancedCheckReasonsText(reasons: readonly string[], tx: Tx): string {
  return reasons.map((reason) => enhancedCheckReasonLabel(reason, tx)).join(", ");
}

/** The hint for a PEP answer: § 15 GwG usually asks for the check, staff decide. */
export function pepEnhancedCheckHint(tx: Tx): string {
  return tx(
    "PEP: по § 15 GwG обычно требуется усиленная проверка — решение за сотрудником",
    "PEP: nach § 15 GwG ist in der Regel eine verstärkte Prüfung erforderlich – Entscheidung des Mitarbeiters",
  );
}

/** The hint for a country of the longer high-risk list: information, no requirement. */
export function highRiskCountryHint(countries: string, tx: Tx): string {
  return tx(
    `Страна повышенного риска (${countries}): только для сведения, усиленная проверка не обязательна`,
    `Drittstaat mit erhöhtem Risiko (${countries}): nur zur Information, keine verstärkte Prüfung vorgeschrieben`,
  );
}

export type EnhancedCheckRiskTier = "blacklist" | "sanctions" | "high_risk" | "pep" | "individual";

/**
 * The risk tier the EDD document prints: the black list or a confirmed match
 * when the rule requires the check, else what staff see (a country of the
 * high-risk list, a PEP), else an individual review.
 */
export function enhancedCheckRiskTier(input: {
  check: LeadEnhancedCheck | null | undefined;
  blacklistHit: boolean;
  highRiskHint: boolean;
  pep: boolean;
}): EnhancedCheckRiskTier {
  const triggers = enhancedCheckTriggers(input.check);
  if (input.blacklistHit || triggers.some((reason) => reason.endsWith("_blacklist"))) return "blacklist";
  if (triggers.some((reason) => reason.endsWith("_sanctioned"))) return "sanctions";
  if (input.highRiskHint) return "high_risk";
  if (input.pep) return "pep";
  return "individual";
}
