/**
 * Pure helpers of the sanctions screening UI (no React, unit-tested).
 */
import { countryLabel } from "@/components/ui/country-select";
import { formatAppDate } from "@/lib/app-time-zone";
import { formatUiText, type Translations } from "@/lib/i18n";

import type {
  LeadSanctionsFlag,
  LeadSanctionsStatus,
  ListBirthDate,
  ListEntry,
  ListRegulation,
  LiveCheckInput,
  SanctionsHit,
  SubjectData,
  SubjectKind,
} from "./api";

/** FiSaLis (Justizportal): searched by hand only, never with data in the URL. */
export const FISALIS_URL = "https://www.finanz-sanktionsliste.de/fisalis/";

/** Debounce of the wizard live check. */
export const LIVE_CHECK_DEBOUNCE_MS = 700;

type Lang = "ru" | "de";

/** The live check runs once first and last name have two letters each. */
export function liveCheckInput(input: {
  firstName: string;
  lastName: string;
  middleName?: string;
  birthDate?: string;
  citizenships?: readonly string[];
  leadId?: string | null;
}): LiveCheckInput | null {
  const first = input.firstName.trim();
  const last = input.lastName.trim();
  if (first.length < 2 || last.length < 2) return null;
  const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(input.birthDate?.trim() ?? "")
    ? input.birthDate!.trim()
    : null;
  return {
    first_name: first,
    last_name: last,
    middle_name: input.middleName?.trim() || null,
    date_of_birth: birthDate,
    citizenships: [...(input.citizenships ?? [])],
    lead_id: input.leadId ?? null,
  };
}

/** Same request, same answer: the key that decides whether to ask again. */
export function liveCheckKey(input: LiveCheckInput | null): string {
  if (!input) return "";
  return JSON.stringify([
    input.first_name.toLocaleLowerCase(),
    (input.middle_name ?? "").toLocaleLowerCase(),
    input.last_name.toLocaleLowerCase(),
    input.date_of_birth ?? "",
    [...(input.citizenships ?? [])].sort(),
  ]);
}

/** The name the CEO pastes into FiSaLis: given names and surname. */
export function fisalisSearchText(subject: Pick<SubjectData, "first_name" | "middle_name" | "last_name">): string {
  return [subject.first_name, subject.middle_name, subject.last_name]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

/** `subject_ref` of the bank a third party pays through. */
export const PAYER_BANK_REF = "payer-bank";

/**
 * Why a patient's relation is screened (`relation` of a `patient_relation` subject): the default
 * payer, the payer an order or invoice names, a minor's parent or guardian.
 */
export const PATIENT_RELATION_ROLES = ["default_payer", "invoice_payer", "legal_representative"] as const;

/**
 * What the hit is about. A bank says whose payment route it is: the payer's
 * bank (`subject_ref` "payer-bank") or the patient's. A patient's relation
 * says why it is screened (`relation`).
 */
export function subjectKindLabel(
  kind: SubjectKind,
  t: Translations,
  subjectRef?: string | null,
  relation?: string | null,
): string {
  if (kind === "lead_bank") {
    return subjectRef === PAYER_BANK_REF ? t.sanctions_kind_payer_bank : t.sanctions_kind_patient_bank;
  }
  if (kind === "patient_relation") {
    switch (relation) {
      case "default_payer":
        return t.sanctions_kind_relation_default_payer;
      case "invoice_payer":
        return t.sanctions_kind_relation_invoice_payer;
      case "legal_representative":
        return t.sanctions_kind_relation_legal_representative;
      default:
        return t.sanctions_kind_patient_relation;
    }
  }
  return {
    lead_patient: t.sanctions_kind_lead_patient,
    lead_guardian: t.sanctions_kind_lead_guardian,
    lead_payer: t.sanctions_kind_lead_payer,
    lead_recipient: t.sanctions_kind_lead_recipient,
    patient: t.sanctions_kind_patient,
  }[kind];
}

export function hitStatusLabel(status: SanctionsHit["status"], t: Translations): string {
  return {
    open: t.sanctions_status_open,
    false_positive: t.sanctions_status_false_positive,
    confirmed: t.sanctions_status_confirmed,
  }[status];
}

export function countryList(codes: readonly string[] | undefined, lang: Lang): string {
  return (codes ?? []).map((code) => countryLabel(code, lang)).join(", ");
}

export function subjectName(subject: SubjectData): string {
  return fisalisSearchText(subject);
}

/** All distinct names of a list entry, the strongest (first) first. */
export function listEntryNames(entry: ListEntry): string[] {
  const names: string[] = [];
  for (const name of entry.names) {
    const display =
      name.whole_name?.trim() ||
      [name.first_name, name.middle_name, name.last_name].filter(Boolean).join(" ");
    if (display && !names.includes(display)) names.push(display);
  }
  return names;
}

export function formatListBirthDate(birth: ListBirthDate, t: Translations): string {
  const value = birth.date ? formatAppDate(birth.date) : birth.year ? String(birth.year) : "";
  if (!value) return "";
  const place = [birth.place, birth.country].filter(Boolean).join(", ");
  return [birth.circa ? `${t.sanctions_circa} ${value}` : value, place ? `(${place})` : ""]
    .filter(Boolean)
    .join(" ");
}

/** How our birth date compares with the list's, e.g. "(дата совпадает)". */
export function dobMatchLabel(dob: SanctionsHit["match_details"]["dob"], t: Translations): string {
  if (!dob) return "";
  const label = {
    exact: t.sanctions_dob_exact,
    year: t.sanctions_dob_year,
    conflict: t.sanctions_dob_conflict,
    unknown: t.sanctions_dob_unknown,
  }[dob];
  return label ? `(${label})` : "";
}

/** A tab label with its count; no count (or zero) leaves the bare label. */
export function labelWithCount(label: string, count: number | null | undefined): string {
  return typeof count === "number" && count > 0 ? `${label} (${count})` : label;
}

/**
 * Whose data a live check's possible match is about: a lead that does not
 * exist yet, screened fields of a lead that are not saved yet, or the lead's
 * saved data.
 */
export type LiveMatchSubject = "new_lead" | "unsaved" | "saved";

export type LivePossibleMatch = {
  text: string;
  tone: "pending" | "confirmed" | "cleared";
};

/**
 * The live check's line for a possible match (QA 2026-10-11 N-14, A-39b). The
 * check itself stores nothing: a lead not created yet, or screened data not
 * saved yet, reach the CEO only after the save. For saved data the lead's
 * stored screening says whether the CEO still has to decide or already
 * decided; a false positive leaves the screening `clear`. `screening` is null
 * when the stored state is unknown.
 */
export function livePossibleMatch(
  subject: LiveMatchSubject,
  screening: LeadSanctionsStatus["screening"] | null,
  t: Translations,
): LivePossibleMatch {
  if (subject === "new_lead") return { text: t.sanctions_live_possible_new_lead, tone: "pending" };
  if (subject === "unsaved") return { text: t.sanctions_live_possible_unsaved, tone: "pending" };
  switch (screening) {
    case "review_pending":
      return { text: t.sanctions_live_possible_review, tone: "pending" };
    case "confirmed":
      return { text: t.sanctions_live_confirmed, tone: "confirmed" };
    case "clear":
      return { text: t.sanctions_live_false_positive, tone: "cleared" };
    default:
      return { text: t.sanctions_live_possible, tone: "pending" };
  }
}

export function regulationLabel(regulation: ListRegulation): string {
  return [regulation.number_title, regulation.programme ? `[${regulation.programme}]` : ""]
    .filter(Boolean)
    .join(" ");
}

/** Only official EUR-Lex links are rendered as links. */
export function safeLegalActUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.hostname === "eur-lex.europa.eu" || parsed.hostname.endsWith(".europa.eu")
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export function scorePercent(score: number): string {
  return `${Math.round(Math.max(0, Math.min(1, score)) * 100)} %`;
}

/** Whether the data changed after the match (names, birth date, citizenships). */
export function subjectChanged(hit: SanctionsHit): boolean {
  const current = hit.current_subject;
  if (!current) return false;
  const snapshot = hit.subject_snapshot;
  const norm = (value: string | null | undefined) => (value ?? "").trim().toLocaleLowerCase();
  return (
    norm(current.first_name) !== norm(snapshot.first_name) ||
    norm(current.middle_name) !== norm(snapshot.middle_name) ||
    norm(current.last_name) !== norm(snapshot.last_name) ||
    (current.date_of_birth ?? "") !== (snapshot.date_of_birth ?? "") ||
    [...current.citizenships].sort().join(",") !== [...snapshot.citizenships].sort().join(",")
  );
}

export type BannerModel =
  | { kind: "confirmed"; text: string }
  | { kind: "review"; text: string }
  | { kind: "country"; text: string; countries: string[] }
  | { kind: "country_lifted"; text: string }
  | { kind: "stale"; text: string };

/** The banners of wizard and lead card, most severe first. */
export function leadBanners(status: LeadSanctionsStatus | null, t: Translations, lang: Lang): BannerModel[] {
  if (!status) return [];
  const banners: BannerModel[] = [];
  if (status.sanctions_block?.code === "sanctions_confirmed") {
    banners.push({ kind: "confirmed", text: t.sanctions_banner_confirmed });
  } else if (status.sanctions_block?.code === "sanctions_review_pending") {
    banners.push({ kind: "review", text: t.sanctions_banner_review });
  }
  if (status.country.blocking.length > 0) {
    banners.push({
      kind: "country",
      countries: status.country.blocking,
      text: formatUiText(t.sanctions_banner_country, {
        countries: countryList(status.country.blocking, lang),
      }),
    });
  } else if (status.country.found.length > 0 && status.country.lift) {
    const lift = status.country.lift;
    banners.push({
      kind: "country_lifted",
      text: formatUiText(t.sanctions_banner_country_lifted, {
        countries: countryList(lift.countries, lang),
        name: lift.lifted_by_name ?? "—",
        date: formatAppDate(lift.lifted_at),
        reason: lift.reason,
      }),
    });
  }
  if (status.list_available && status.list_stale) {
    banners.push({ kind: "stale", text: t.sanctions_banner_list_stale });
  }
  return banners;
}

export function leadFlagBadge(
  flag: LeadSanctionsFlag["flag"],
  t: Translations,
): { label: string; tone: "error" | "warning" | "neutral" } {
  switch (flag) {
    case "confirmed":
      return { label: t.sanctions_badge_confirmed, tone: "error" };
    case "review_pending":
      return { label: t.sanctions_badge_review_pending, tone: "warning" };
    case "blocked_country":
      return { label: t.sanctions_badge_blocked_country, tone: "warning" };
    default:
      return { label: t.sanctions_badge_country_lifted, tone: "neutral" };
  }
}

/** Errors the gate answers with (the wizard shows its own banner for them). */
export function isSanctionsGateError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "sanctions_confirmed" || code === "sanctions_review_pending" || code === "blocked_country";
}

export const MIN_REASON_CHARS = 10;

export function reasonIsValid(reason: string): boolean {
  return reason.trim().length >= MIN_REASON_CHARS;
}
