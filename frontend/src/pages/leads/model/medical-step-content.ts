/**
 * Whether the wizard tab «Медицинская характеристика» has anything in it
 * (owner 2026-10-22): its tick shows only then, an empty tab stays neutral.
 * Nothing in the tab is required — the readiness for the conversion still
 * counts it as ready —, so this decides the tick of the tab bar only.
 */

type TextRecord = Record<string, unknown> | null | undefined;

export type MedicalStepContent = {
  referrer: string;
  concern: string;
  anamnese?: string;
  narrative: TextRecord;
  diagnoses: readonly unknown[];
  medications: readonly unknown[];
  allergies: readonly unknown[];
  caves: readonly unknown[];
  /** "У клиента есть медицинские документы" is checked (or files are on file). */
  hasMedicalRecords: boolean;
  medicalDocumentCount: number;
};

/** The texts of the anamnesis a staff member writes (ids and flags are not content). */
const NARRATIVE_TEXT_KEYS = [
  "anamnese_aktuelle",
  "anamnese_vorgeschichte",
  "anamnese_vegetative",
  "anamnese_sozial",
  "anamnese_familie",
  "beurteilung",
  "red_flags",
] as const;

const filled = (value: unknown) => typeof value === "string" && value.trim().length > 0;

export function medicalStepHasContent(content: MedicalStepContent): boolean {
  if (filled(content.referrer) || filled(content.concern) || filled(content.anamnese)) return true;
  const narrative = content.narrative;
  if (narrative && NARRATIVE_TEXT_KEYS.some((key) => filled(narrative[key]))) return true;
  const specializations = narrative?.specialization_ids;
  if (Array.isArray(specializations) && specializations.length > 0) return true;
  if (
    content.diagnoses.length > 0
    || content.medications.length > 0
    || content.allergies.length > 0
    || content.caves.length > 0
  ) return true;
  return content.hasMedicalRecords || content.medicalDocumentCount > 0;
}
