/**
 * Severity of an allergy (QA 2026-10-12 B3-03): a fixed choice stored as a
 * code and shown in the UI language; the server prints it in the document
 * language (`patient_clinical_pdf::allergy_severity`). Entries made before
 * the choice carry free text — the known words in German or Russian are read
 * as their code, any other text is shown as it was entered.
 */

export const ALLERGY_SEVERITIES = ["mild", "moderate", "severe", "life_threatening"] as const;
export type AllergySeverity = (typeof ALLERGY_SEVERITIES)[number];

const SEVERITY_LABELS: Record<AllergySeverity, { ru: string; de: string }> = {
  mild: { ru: "Лёгкая", de: "Leicht" },
  moderate: { ru: "Средняя", de: "Mittel" },
  severe: { ru: "Тяжёлая", de: "Schwer" },
  life_threatening: { ru: "Жизнеугрожающая", de: "Lebensbedrohlich" },
};

const SEVERITY_WORDS: Record<string, AllergySeverity> = {
  mild: "mild",
  leicht: "mild",
  "лёгкая": "mild",
  "легкая": "mild",
  "слабая": "mild",
  moderate: "moderate",
  mittel: "moderate",
  mittelschwer: "moderate",
  "средняя": "moderate",
  "умеренная": "moderate",
  severe: "severe",
  schwer: "severe",
  "тяжёлая": "severe",
  "тяжелая": "severe",
  life_threatening: "life_threatening",
  lebensbedrohlich: "life_threatening",
  "жизнеугрожающая": "life_threatening",
  "угрожающая жизни": "life_threatening",
};

/** The code of a stored severity, or null for an unknown free text. */
export function allergySeverityCode(raw: string | null | undefined): AllergySeverity | null {
  const key = raw?.trim().toLowerCase();
  return key ? (SEVERITY_WORDS[key] ?? null) : null;
}

/** The severity in the UI language; an unknown free text as entered. */
export function allergySeverityLabel(raw: string | null | undefined, lang: "ru" | "de"): string {
  const code = allergySeverityCode(raw);
  return code ? SEVERITY_LABELS[code][lang] : (raw?.trim() ?? "");
}
