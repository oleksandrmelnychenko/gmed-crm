import {
  Activity,
  Ban,
  Bone,
  Brain,
  Droplets,
  FileText,
  HeartPulse,
  History,
  type LucideIcon,
  Pill,
  Scan,
  Scissors,
  Stethoscope,
  Thermometer,
  Wind,
  Zap,
} from "lucide-react";

export type CaseSectionKey =
  | "overview"
  | "preconditions"
  | "allergies"
  | "surgeries"
  | "medications"
  | "pain"
  | "symptoms"
  | "vegetative"
  | "cardiology"
  | "gastroenterology"
  | "orthopedics"
  | "neurology"
  | "pulmonology"
  | "urology"
  | "history";

export type CaseSectionGroup = "clinical" | "specialty" | "meta";

export type CaseSectionDefinition = {
  key: CaseSectionKey;
  group: CaseSectionGroup;
  icon: LucideIcon;
  labels: { de: string; ru: string };
};

export const CASE_WORKSPACE_SECTIONS: readonly CaseSectionDefinition[] = [
  {
    key: "overview",
    group: "clinical",
    icon: FileText,
    labels: { de: "Übersicht", ru: "Обзор" },
  },
  {
    key: "preconditions",
    group: "clinical",
    icon: Stethoscope,
    labels: { de: "Vorerkrankungen", ru: "Предзаболевания" },
  },
  {
    key: "allergies",
    group: "clinical",
    icon: Ban,
    labels: { de: "Allergien", ru: "Аллергии" },
  },
  {
    key: "surgeries",
    group: "clinical",
    icon: Scissors,
    labels: { de: "Operationen", ru: "Операции" },
  },
  {
    key: "medications",
    group: "clinical",
    icon: Pill,
    labels: { de: "Medikamente", ru: "Медикаменты" },
  },
  {
    key: "pain",
    group: "clinical",
    icon: Zap,
    labels: { de: "Schmerz", ru: "Боль" },
  },
  {
    key: "symptoms",
    group: "clinical",
    icon: Activity,
    labels: { de: "Symptome", ru: "Симптомы" },
  },
  {
    key: "vegetative",
    group: "clinical",
    icon: Thermometer,
    labels: {
      de: "Vegetative Anamnese",
      ru: "Вегетативный анамнез",
    },
  },
  {
    key: "cardiology",
    group: "specialty",
    icon: HeartPulse,
    labels: { de: "Kardiologie", ru: "Кардиология" },
  },
  {
    key: "gastroenterology",
    group: "specialty",
    icon: Scan,
    labels: {
      de: "Gastroenterologie",
      ru: "Гастроэнтерология",
    },
  },
  {
    key: "orthopedics",
    group: "specialty",
    icon: Bone,
    labels: { de: "Orthopädie", ru: "Ортопедия" },
  },
  {
    key: "neurology",
    group: "specialty",
    icon: Brain,
    labels: { de: "Neurologie", ru: "Неврология" },
  },
  {
    key: "pulmonology",
    group: "specialty",
    icon: Wind,
    labels: { de: "Pulmonologie", ru: "Пульмонология" },
  },
  {
    key: "urology",
    group: "specialty",
    icon: Droplets,
    labels: { de: "Urologie", ru: "Урология" },
  },
  {
    key: "history",
    group: "meta",
    icon: History,
    labels: { de: "Verlauf", ru: "История" },
  },
];

const CASE_SECTION_KEYS = new Set<CaseSectionKey>(
  CASE_WORKSPACE_SECTIONS.map((item) => item.key),
);

export const DEFAULT_CASE_SECTION: CaseSectionKey = "overview";

export function normalizeCaseSectionKey(value: string | null | undefined): CaseSectionKey {
  if (value && CASE_SECTION_KEYS.has(value as CaseSectionKey)) {
    return value as CaseSectionKey;
  }
  return DEFAULT_CASE_SECTION;
}

export function caseSectionLabel(
  section: CaseSectionDefinition,
  lang: string,
): string {
  return lang === "de" ? section.labels.de : section.labels.ru;
}

export function caseSectionGroupLabel(
  group: CaseSectionGroup,
  lang: string,
): string {
  if (group === "clinical") {
    return lang === "de" ? "Klinisch" : "Клиническая часть";
  }
  if (group === "specialty") {
    return lang === "de" ? "Fachgebiete" : "Специализации";
  }
  return lang === "de" ? "Metadaten" : "Метаданные";
}
