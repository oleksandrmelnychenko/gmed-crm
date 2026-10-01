import type {
  ClinicalDocumentImportCandidate,
  ClinicalDocumentImportTarget,
} from "./clinical-document-import";

/**
 * Manual "constructor" for the clinical document import: typed forms that
 * build review candidates in exactly the shape the parser produces, so they
 * go through the same review and apply path as recognized blocks.
 */

type Localized = { ru: string; de: string };

export type ConstructorFieldKind = "text" | "textarea" | "date" | "number" | "select";

export type ConstructorFieldSpec = {
  key: string;
  label: Localized;
  kind: ConstructorFieldKind;
  required?: boolean;
  options?: { value: string; label: Localized }[];
  placeholder?: Localized;
  /** Receives the text selected in the document when the form opens from a selection. */
  primary?: boolean;
};

export type ConstructorFields = Record<string, string>;

const VITAL_FIELDS = [
  ["bp_systolic", { ru: "АД систолическое", de: "RR systolisch" }],
  ["bp_diastolic", { ru: "АД диастолическое", de: "RR diastolisch" }],
  ["heart_rate", { ru: "Пульс", de: "Herzfrequenz" }],
  ["temperature_c", { ru: "Температура, °C", de: "Temperatur, °C" }],
  ["oxygen_saturation", { ru: "SpO₂, %", de: "SpO₂, %" }],
  ["respiratory_rate", { ru: "Частота дыхания", de: "Atemfrequenz" }],
  ["weight_kg", { ru: "Вес, кг", de: "Gewicht, kg" }],
  ["height_cm", { ru: "Рост, см", de: "Größe, cm" }],
] as const satisfies readonly (readonly [string, Localized])[];

export const constructorFieldSpecs: Record<ClinicalDocumentImportTarget, ConstructorFieldSpec[]> = {
  diagnosis: [
    { key: "label", label: { ru: "Диагноз", de: "Diagnose" }, kind: "textarea", required: true, primary: true },
    {
      key: "certainty",
      label: { ru: "Достоверность", de: "Sicherheit" },
      kind: "select",
      options: [
        { value: "bestaetigt", label: { ru: "Подтверждён", de: "Gesichert" } },
        { value: "verdacht", label: { ru: "Подозрение", de: "Verdacht" } },
      ],
    },
    {
      key: "kind",
      label: { ru: "Вид", de: "Art" },
      kind: "select",
      options: [
        { value: "secondary", label: { ru: "Сопутствующий", de: "Nebendiagnose" } },
        { value: "main", label: { ru: "Основной", de: "Hauptdiagnose" } },
      ],
    },
    { key: "icd_code", label: { ru: "МКБ-10", de: "ICD-10" }, kind: "text", placeholder: { ru: "C61", de: "C61" } },
    { key: "diagnosed_on", label: { ru: "Дата диагноза", de: "Diagnosedatum" }, kind: "date" },
  ],
  anamnesis: [
    { key: "text", label: { ru: "Анамнез", de: "Anamnese" }, kind: "textarea", required: true, primary: true },
  ],
  examination: [
    { key: "title", label: { ru: "Обследование", de: "Untersuchung" }, kind: "text", required: true, placeholder: { ru: "МРТ простаты", de: "MRT der Prostata" } },
    { key: "performed_on", label: { ru: "Дата", de: "Datum" }, kind: "date" },
    { key: "result", label: { ru: "Результат", de: "Ergebnis" }, kind: "textarea", required: true, primary: true },
  ],
  lab_result: [
    { key: "analyte_name", label: { ru: "Показатель", de: "Parameter" }, kind: "text", required: true, primary: true },
    { key: "result_text", label: { ru: "Значение", de: "Wert" }, kind: "text", required: true },
    { key: "unit", label: { ru: "Единица", de: "Einheit" }, kind: "text" },
    { key: "reference_text", label: { ru: "Референс", de: "Referenz" }, kind: "text" },
    { key: "measured_on", label: { ru: "Дата забора", de: "Abnahmedatum" }, kind: "date", required: true },
  ],
  vital: [
    { key: "measured_at", label: { ru: "Дата измерения", de: "Messdatum" }, kind: "date", required: true },
    ...VITAL_FIELDS.map(([key, label]): ConstructorFieldSpec => ({ key, label, kind: "number" })),
    { key: "notes", label: { ru: "Примечание", de: "Hinweis" }, kind: "text", primary: true },
  ],
  medication: [
    { key: "wirkstoff", label: { ru: "Действующее вещество", de: "Wirkstoff" }, kind: "text", required: true, primary: true },
    { key: "handelsname", label: { ru: "Торговое название", de: "Handelsname" }, kind: "text" },
    { key: "staerke", label: { ru: "Дозировка", de: "Stärke" }, kind: "text", placeholder: { ru: "500 мг", de: "500 mg" } },
    { key: "dose_morgens", label: { ru: "Утро", de: "Morgens" }, kind: "text" },
    { key: "dose_mittags", label: { ru: "День", de: "Mittags" }, kind: "text" },
    { key: "dose_abends", label: { ru: "Вечер", de: "Abends" }, kind: "text" },
    { key: "dose_nachts", label: { ru: "Ночь", de: "Nachts" }, kind: "text" },
    { key: "einheit", label: { ru: "Единица приёма", de: "Einheit" }, kind: "text", placeholder: { ru: "таблетка", de: "Stück" } },
    { key: "grund", label: { ru: "Показание", de: "Grund" }, kind: "text" },
    { key: "hinweis", label: { ru: "Примечание", de: "Hinweis" }, kind: "text" },
  ],
  recommendation: [
    { key: "title", label: { ru: "Заголовок", de: "Titel" }, kind: "text" },
    { key: "description", label: { ru: "Рекомендация", de: "Empfehlung" }, kind: "textarea", required: true, primary: true },
  ],
};

const LAB_SELECTION_RE =
  /^(?<analyte>[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9 .\-/()]*?)(?:-Wert)?\s*(?:von|:|=)?\s*(?<result>(?:<=|>=|<|>)?\s*\d+(?:[.,]\d+)?)\s*(?<unit>[A-Za-zµ%/][A-Za-zµ%/0-9.^]*)?\s*(?:\((?:Referenz|Norm|Ref\.?)?:?\s*(?<reference>[^)]+)\))?\.?$/;

/** Fields of a new form; the selected document text goes into the primary field. */
export function prefillConstructorFields(
  target: ClinicalDocumentImportTarget,
  selection: string,
): ConstructorFields {
  const text = selection.trim();
  const fields: ConstructorFields = {};
  if (target === "diagnosis") {
    fields.certainty = /\b(?:V\.\s*a\.|Verdacht|suspected|подозрени)/i.test(text) ? "verdacht" : "bestaetigt";
    fields.kind = "secondary";
  }
  if (!text) return fields;
  if (target === "lab_result") {
    const match = LAB_SELECTION_RE.exec(text.replace(/\s+/g, " "));
    if (match?.groups) {
      fields.analyte_name = match.groups.analyte.trim();
      fields.result_text = match.groups.result.replace(/\s+/g, "");
      if (match.groups.unit) fields.unit = match.groups.unit;
      if (match.groups.reference) fields.reference_text = match.groups.reference.trim();
      return fields;
    }
  }
  const primary = constructorFieldSpecs[target].find((spec) => spec.primary);
  if (primary) fields[primary.key] = text;
  return fields;
}

export function missingConstructorFields(
  target: ClinicalDocumentImportTarget,
  fields: ConstructorFields,
): string[] {
  const missing = constructorFieldSpecs[target]
    .filter((spec) => spec.required && !fields[spec.key]?.trim())
    .map((spec) => spec.key);
  if (target === "vital" && !VITAL_FIELDS.some(([key]) => fields[key]?.trim())) {
    missing.push("bp_systolic");
  }
  return missing;
}

function constructorNumber(value: string | undefined): number | null {
  const compact = value?.trim().replace(/\s/g, "");
  if (!compact) return null;
  const normalized = compact.includes(",") ? compact.replace(/\./g, "").replace(",", ".") : compact;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function optional(value: string | undefined): string | null {
  return value?.trim() || null;
}

const MANUAL_REVIEW = {
  semantic_role: "manual_review",
  auto_select: true,
  review_reasons: [] as string[],
  confidence_kind: "manual_user_entry",
};

export type ConstructorCandidateContext = {
  id: string;
  sourcePage: number | null;
  sourceText: string;
  sourceSection: string;
  sourceCountry: string;
  laboratoryPanel: string;
};

/** Builds a review candidate from a completed constructor form. */
export function buildConstructorCandidate(
  target: ClinicalDocumentImportTarget,
  fields: ConstructorFields,
  context: ConstructorCandidateContext,
): ClinicalDocumentImportCandidate {
  const field = (key: string) => fields[key]?.trim() ?? "";
  let value: string;
  let normalized: Record<string, unknown>;
  switch (target) {
    case "diagnosis":
      value = field("label");
      normalized = {
        label: value,
        kind: field("kind") === "main" ? "main" : "secondary",
        certainty: field("certainty") === "verdacht" ? "verdacht" : "bestaetigt",
        assertion: field("certainty") === "verdacht" ? "suspected" : "confirmed",
        icd_code: optional(fields.icd_code)?.toUpperCase() ?? null,
        diagnosed_on: optional(fields.diagnosed_on),
        source_mode: "extern",
        ...MANUAL_REVIEW,
      };
      break;
    case "anamnesis":
      value = field("text");
      normalized = { anamnese_aktuelle: value, section_role: "manual", assertion: "reported", ...MANUAL_REVIEW };
      break;
    case "examination":
      value = field("result");
      normalized = {
        kind: "other",
        title: field("title"),
        result: value,
        performed_on: optional(fields.performed_on),
        status: "final",
        section_role: "manual",
        assertion: "reported",
        ...MANUAL_REVIEW,
      };
      break;
    case "lab_result": {
      const resultText = field("result_text");
      const comparator = /^(<=|>=|<|>|=)/.exec(resultText)?.[1] ?? null;
      const unit = optional(fields.unit);
      const reference = optional(fields.reference_text);
      value = `${field("analyte_name")}: ${resultText}${unit ? ` ${unit}` : ""}${reference ? ` (Referenz: ${reference})` : ""}`;
      normalized = {
        panel: context.laboratoryPanel,
        analyte_name: field("analyte_name"),
        result_text: resultText,
        numeric_result: constructorNumber(resultText.replace(/^(?:<=|>=|<|>|=)\s*/, "")),
        comparator,
        unit,
        reference_text: reference,
        reference_low: null,
        reference_high: null,
        abnormal_flag: "unknown",
        measured_on: field("measured_on"),
        ...MANUAL_REVIEW,
        semantic_role: "laboratory_observation",
      };
      break;
    }
    case "vital": {
      value = field("notes");
      normalized = {
        measured_at: field("measured_at"),
        units: {},
        assertion: "documented",
        ...MANUAL_REVIEW,
        semantic_role: "vital_measurement",
      };
      for (const [key] of VITAL_FIELDS) normalized[key] = constructorNumber(fields[key]);
      break;
    }
    case "medication":
      value = [field("wirkstoff"), field("staerke")].filter(Boolean).join(" ");
      normalized = {
        wirkstoff: field("wirkstoff"),
        handelsname: field("handelsname"),
        staerke: optional(fields.staerke),
        form: null,
        einnahmeform: null,
        dose_morgens: optional(fields.dose_morgens),
        dose_mittags: optional(fields.dose_mittags),
        dose_abends: optional(fields.dose_abends),
        dose_nachts: optional(fields.dose_nachts),
        einheit: optional(fields.einheit),
        hinweis: optional(fields.hinweis),
        grund: optional(fields.grund),
        verordnet_am: null,
        einnahme_von: null,
        einnahme_bis: null,
        source_date: null,
        status: "aktiv",
        on_hold: false,
        hold_from: null,
        hold_until: null,
        hold_note: null,
        as_needed: false,
        source_country: context.sourceCountry,
        assertion: "reported",
        ...MANUAL_REVIEW,
        medication_review_decision: "include",
      };
      break;
    case "recommendation":
      value = field("description");
      normalized = {
        title: optional(fields.title),
        description: value,
        section_role: "manual",
        assertion: "reported",
        ...MANUAL_REVIEW,
      };
      break;
  }
  return {
    id: context.id,
    target,
    value,
    normalized,
    confidence: 1,
    selected: true,
    source: {
      page: context.sourcePage,
      section: context.sourceSection,
      text: context.sourceText.trim() || value,
    },
  };
}

/** Moves a block one step up or down among the blocks of the same type. */
export function moveCandidate(
  candidates: ClinicalDocumentImportCandidate[],
  id: string,
  direction: -1 | 1,
): ClinicalDocumentImportCandidate[] {
  const index = candidates.findIndex((item) => item.id === id);
  if (index < 0) return candidates;
  const target = candidates[index].target;
  let swapWith = index + direction;
  while (swapWith >= 0 && swapWith < candidates.length && candidates[swapWith].target !== target) {
    swapWith += direction;
  }
  if (swapWith < 0 || swapWith >= candidates.length) return candidates;
  const next = [...candidates];
  [next[index], next[swapWith]] = [next[swapWith], next[index]];
  return next;
}

export type CandidatePageGroup = {
  page: number | null;
  items: ClinicalDocumentImportCandidate[];
};

/** Blocks grouped by source page in page order; blocks without a page come last. */
export function groupCandidatesByPage(
  candidates: ClinicalDocumentImportCandidate[],
): CandidatePageGroup[] {
  const groups = new Map<number | null, ClinicalDocumentImportCandidate[]>();
  for (const candidate of candidates) {
    const page = candidate.source.page && candidate.source.page > 0 ? candidate.source.page : null;
    groups.set(page, [...(groups.get(page) ?? []), candidate]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER))
    .map(([page, items]) => ({ page, items }));
}
