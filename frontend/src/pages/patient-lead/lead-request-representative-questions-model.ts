import type { RepresentativeCountryAnswers, RepresentativeCountryPatch } from "./lead-request-api";

export const REPRESENTATIVE_COUNTRY_FIELDS = [
  "birth_place", "birth_country",
  "residence_since", "stay_reason", "stay_reason_details", "pep_self", "pep_related", "sanctions_links",
  "pep_office", "pep_country", "pep_period", "pep_relationship", "pep_wealth_origin",
  "sanctions_link_name", "sanctions_link_kind", "sanctions_link_since_extent",
] as const satisfies readonly (keyof RepresentativeCountryAnswers)[];

export type RepresentativeCountryField = (typeof REPRESENTATIVE_COUNTRY_FIELDS)[number];
export type RepresentativeCountryDraft = Record<RepresentativeCountryField, string>;
export const REPRESENTATIVE_QUESTIONS = ["pep_self", "pep_related", "sanctions_links"] as const;

export function representativeCountryDraft(answers: Partial<RepresentativeCountryAnswers> = {}): RepresentativeCountryDraft {
  return Object.fromEntries(REPRESENTATIVE_COUNTRY_FIELDS.map((field) => {
    const value = answers[field];
    return [field, typeof value === "boolean" ? value ? "yes" : "no" : value ?? ""];
  })) as RepresentativeCountryDraft;
}

/** Hide and clear details when their explicit answer no longer requires them. */
export function updateRepresentativeCountryDraft(draft: RepresentativeCountryDraft, field: RepresentativeCountryField, value: string): RepresentativeCountryDraft {
  const next = { ...draft, [field]: value };
  if (next.stay_reason !== "other") next.stay_reason_details = "";
  if (next.pep_related === "no") next.pep_relationship = "";
  if (next.pep_self === "no" && next.pep_related === "no") {
    for (const key of ["pep_office", "pep_country", "pep_period", "pep_relationship", "pep_wealth_origin"] as const) next[key] = "";
  }
  if (next.sanctions_links === "no") {
    for (const key of ["sanctions_link_name", "sanctions_link_kind", "sanctions_link_since_extent"] as const) next[key] = "";
  }
  return next;
}

export function representativeCountryPatch(before: RepresentativeCountryDraft, after: RepresentativeCountryDraft): RepresentativeCountryPatch {
  return Object.fromEntries(REPRESENTATIVE_COUNTRY_FIELDS.flatMap((field) => before[field] === after[field] ? [] : [[
    field, (REPRESENTATIVE_QUESTIONS as readonly string[]).includes(field)
      ? after[field] === "yes" ? true : after[field] === "no" ? false : null
      : after[field] || null,
  ]])) as RepresentativeCountryPatch;
}

/**
 * Birth place and country GMED already knows of the person (the representative's identity, as staff or the
 * person entered it) fill the empty answers of the questionnaire; the autosave then stores them for the
 * questionnaire as well (QA 2026-10-25, R-2: the birth country was prefilled, the birth place was not).
 */
export function withKnownBirth(
  draft: RepresentativeCountryDraft,
  known: { birth_place?: string | null; birth_country?: string | null } | null | undefined,
): RepresentativeCountryDraft {
  if (!known) return draft;
  return {
    ...draft,
    birth_place: draft.birth_place || known.birth_place?.trim() || "",
    birth_country: draft.birth_country || known.birth_country?.trim() || "",
  };
}
