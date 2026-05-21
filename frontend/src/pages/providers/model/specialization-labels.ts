export type SpecializationLabelLang = "de" | "ru";

export type SpecializationLabelItem = {
  code?: string | null;
  name_de?: string | null;
  name_en?: string | null;
  name_ru?: string | null;
};

type KnownSpecializationLabels = Record<SpecializationLabelLang, string>;

const KNOWN_SPECIALIZATIONS: [string[], KnownSpecializationLabels][] = [
  [["allergology", "allergologie", "аллергология"], { de: "Allergologie", ru: "Аллергология" }],
  [["anesthesiology", "anaesthesiology", "anästhesiologie", "anaesthesiologie", "анестезиология"], { de: "Anästhesiologie", ru: "Анестезиология" }],
  [["cardiology", "kardiologie", "кардиология"], { de: "Kardiologie", ru: "Кардиология" }],
  [["dermatology", "dermatologie", "дерматология"], { de: "Dermatologie", ru: "Дерматология" }],
  [["endocrinology", "endokrinologie", "эндокринология"], { de: "Endokrinologie", ru: "Эндокринология" }],
  [["gastroenterology", "gastroenterologie", "гастроэнтерология"], { de: "Gastroenterologie", ru: "Гастроэнтерология" }],
  [["gynecology", "gynaecology", "gynäkologie", "gynaekologie", "гинекология"], { de: "Gynäkologie", ru: "Гинекология" }],
  [["hematology", "haematology", "hämatologie", "haematologie", "гематология"], { de: "Hämatologie", ru: "Гематология" }],
  [["internal_medicine", "internal medicine", "innere medizin", "внутренняя медицина"], { de: "Innere Medizin", ru: "Внутренняя медицина" }],
  [["neurology", "neurologie", "неврология"], { de: "Neurologie", ru: "Неврология" }],
  [["oncology", "onkologie", "онкология"], { de: "Onkologie", ru: "Онкология" }],
  [["orthopedics", "orthopaedics", "orthopädie", "orthopaedie", "ортопедия"], { de: "Orthopädie", ru: "Ортопедия" }],
  [["pediatrics", "paediatrics", "pädiatrie", "paediatrie", "педиатрия"], { de: "Pädiatrie", ru: "Педиатрия" }],
  [["psychiatry", "psychiatrie", "психиатрия"], { de: "Psychiatrie", ru: "Психиатрия" }],
  [["radiology", "radiologie", "радиология"], { de: "Radiologie", ru: "Радиология" }],
  [["surgery", "chirurgie", "хирургия"], { de: "Chirurgie", ru: "Хирургия" }],
  [["urology", "urologie", "урология"], { de: "Urologie", ru: "Урология" }],
];

const KNOWN_SPECIALIZATION_LABELS = new Map<string, KnownSpecializationLabels>(
  KNOWN_SPECIALIZATIONS.flatMap(([keys, labels]) =>
    keys.map((key) => [normalizeSpecializationLabelKey(key), labels] as const),
  ),
);

export function normalizeSpecializationLabelKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function knownSpecializationLabelsForValue(value: string | null | undefined) {
  if (!value) return null;
  return KNOWN_SPECIALIZATION_LABELS.get(normalizeSpecializationLabelKey(value)) ?? null;
}

function knownSpecializationLabelsForItem(item: SpecializationLabelItem) {
  return (
    knownSpecializationLabelsForValue(item.code) ??
    knownSpecializationLabelsForValue(item.name_ru) ??
    knownSpecializationLabelsForValue(item.name_de) ??
    knownSpecializationLabelsForValue(item.name_en)
  );
}

export function specializationLabelForItem(
  item: SpecializationLabelItem,
  lang: SpecializationLabelLang,
) {
  const knownLabels = knownSpecializationLabelsForItem(item);
  if (knownLabels) return knownLabels[lang];

  if (lang === "de") {
    return item.name_de || item.name_ru || item.name_en || item.code || "";
  }
  return item.name_ru || item.name_de || item.name_en || item.code || "";
}

export function specializationLabelForValue(
  value: string,
  items: readonly SpecializationLabelItem[],
  lang: SpecializationLabelLang,
) {
  const key = normalizeSpecializationLabelKey(value);
  const match = items.find((item) =>
    [item.code, item.name_en, item.name_de, item.name_ru].some(
      (candidate) => candidate && normalizeSpecializationLabelKey(candidate) === key,
    ),
  );
  if (match) return specializationLabelForItem(match, lang);

  const knownLabels = knownSpecializationLabelsForValue(value);
  return knownLabels ? knownLabels[lang] : value;
}

export function specializationSummaryForItems(
  items: readonly SpecializationLabelItem[] | null | undefined,
  fallback: string | null | undefined,
  lang: SpecializationLabelLang,
  empty = "",
) {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const item of items ?? []) {
    const label = specializationLabelForItem(item, lang).trim();
    const key = normalizeSpecializationLabelKey(label);
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }

  if (labels.length > 0) return labels.join(", ");
  return fallback?.trim()
    ? specializationLabelForValue(fallback, items ?? [], lang)
    : empty;
}

export function doctorSpecialtyLabel(
  doctor: {
    fachbereich?: string | null;
    specializations?: readonly SpecializationLabelItem[] | null;
  },
  lang: SpecializationLabelLang,
  empty = "",
) {
  return specializationSummaryForItems(
    doctor.specializations,
    doctor.fachbereich,
    lang,
    empty,
  );
}
