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
  Microscope,
  NotebookPen,
  Pill,
  Scan,
  Scissors,
  Stethoscope,
  TrendingUp,
  Wind,
  Zap,
} from "lucide-react";

import {
  formatEnumLabelFromKeys,
  t as translateCatalog,
  type Lang,
} from "@/lib/i18n";
import {
  CASE_WORKSPACE_SECTION_GROUP_LABEL_KEYS,
  CASE_WORKSPACE_SECTION_LABEL_KEYS,
} from "@/lib/i18n/catalogs/cases-clinical";

export type CaseSectionKey =
  | "overview"
  | "symptoms"
  | "pain"
  | "cardiology"
  | "gastroenterology"
  | "orthopedics"
  | "neurology"
  | "pulmonology"
  | "urology"
  | "anamnese"
  | "diagnoses"
  | "medications"
  | "allergies"
  | "befunde"
  | "procedures"
  | "verlauf"
  | "history";

export type CaseSectionGroup = "episode" | "record" | "meta";

export type CaseSectionDefinition = {
  key: CaseSectionKey;
  group: CaseSectionGroup;
  icon: LucideIcon;
};

export const CASE_WORKSPACE_SECTIONS: readonly CaseSectionDefinition[] = [
  {
    key: "overview",
    group: "episode",
    icon: FileText,
  },
  {
    key: "symptoms",
    group: "episode",
    icon: Activity,
  },
  {
    key: "pain",
    group: "episode",
    icon: Zap,
  },
  {
    key: "cardiology",
    group: "episode",
    icon: HeartPulse,
  },
  {
    key: "gastroenterology",
    group: "episode",
    icon: Scan,
  },
  {
    key: "orthopedics",
    group: "episode",
    icon: Bone,
  },
  {
    key: "neurology",
    group: "episode",
    icon: Brain,
  },
  {
    key: "pulmonology",
    group: "episode",
    icon: Wind,
  },
  {
    key: "urology",
    group: "episode",
    icon: Droplets,
  },
  {
    key: "anamnese",
    group: "record",
    icon: NotebookPen,
  },
  {
    key: "diagnoses",
    group: "record",
    icon: Stethoscope,
  },
  {
    key: "medications",
    group: "record",
    icon: Pill,
  },
  {
    key: "allergies",
    group: "record",
    icon: Ban,
  },
  {
    key: "befunde",
    group: "record",
    icon: Microscope,
  },
  {
    key: "procedures",
    group: "record",
    icon: Scissors,
  },
  {
    key: "verlauf",
    group: "record",
    icon: TrendingUp,
  },
  {
    key: "history",
    group: "meta",
    icon: History,
  },
];

/**
 * Static entries shown in the case rail. Specialty entries are generated from
 * the patient's diagnoses, and patient-record sections live only in the
 * patient workspace now.
 */
export const CASE_WORKSPACE_NAV_SECTIONS: readonly CaseSectionDefinition[] =
  CASE_WORKSPACE_SECTIONS.filter((item) =>
    ["overview", "symptoms", "pain", "history"].includes(item.key),
  );

const CASE_SECTION_KEYS = new Set<CaseSectionKey>(
  CASE_WORKSPACE_SECTIONS.map((item) => item.key),
);

/** Sections whose clinical facts live on the patient record (projections). */
export const CASE_RECORD_SECTION_KEYS: readonly CaseSectionKey[] =
  CASE_WORKSPACE_SECTIONS.filter((item) => item.group === "record").map(
    (item) => item.key,
  );

const DEFAULT_CASE_SECTION: CaseSectionKey = "overview";

/**
 * Pre-Phase-4 deep links: the retired case-table sections map onto the
 * patient-record projection that replaced them.
 */
const LEGACY_SECTION_ALIASES: Record<string, CaseSectionKey> = {
  preconditions: "diagnoses",
  surgeries: "procedures",
  vegetative: "anamnese",
  impfstatus: "overview",
};

export function normalizeCaseSectionKey(value: string | null | undefined): CaseSectionKey {
  if (!value) return DEFAULT_CASE_SECTION;
  if (CASE_SECTION_KEYS.has(value as CaseSectionKey)) {
    return value as CaseSectionKey;
  }
  return LEGACY_SECTION_ALIASES[value] ?? DEFAULT_CASE_SECTION;
}

function normalizeLang(lang: string): Lang {
  return lang === "de" ? "de" : "ru";
}

export function caseSectionLabel(
  section: CaseSectionDefinition,
  lang: string,
): string {
  return formatEnumLabelFromKeys(
    section.key,
    CASE_WORKSPACE_SECTION_LABEL_KEYS,
    translateCatalog(normalizeLang(lang)),
  );
}

export function caseSectionGroupLabel(
  group: CaseSectionGroup,
  lang: string,
): string {
  return formatEnumLabelFromKeys(
    group,
    CASE_WORKSPACE_SECTION_GROUP_LABEL_KEYS,
    translateCatalog(normalizeLang(lang)),
  );
}
