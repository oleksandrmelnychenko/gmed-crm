export type LocalizedNames = {
  name_de?: string | null;
  name_ru?: string | null;
  name_en?: string | null;
  name_es?: string | null;
};

const LANGUAGE_FIELDS = [
  ["RU", "name_ru"],
  ["EN", "name_en"],
  ["ES", "name_es"],
] as const;

function sameName(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

/**
 * The names of a specialization or work type as «DE: … · RU: …», with only
 * the languages whose name differs from the German one (owner 2026-11-12):
 * the catalogue repeats the German name as English and has no Spanish, so
 * «EN: Kardiologie · ES: -» said nothing. Empty names are left out; without a
 * German name every filled language is listed.
 */
export function differingLanguageNames(item: LocalizedNames) {
  const german = item.name_de?.trim() ?? "";
  const parts = german ? [`DE: ${german}`] : [];
  for (const [label, field] of LANGUAGE_FIELDS) {
    const name = item[field]?.trim() ?? "";
    if (name && !(german && sameName(name, german))) parts.push(`${label}: ${name}`);
  }
  return parts;
}

/** A second name under the shown one, or null when it would only repeat it. */
export function secondaryName(shown: string, other: string | null | undefined) {
  const name = other?.trim() ?? "";
  return name && !sameName(name, shown.trim()) ? name : null;
}
