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
};

export const CASE_WORKSPACE_SECTIONS: readonly CaseSectionDefinition[] = [
  {
    key: "overview",
    group: "clinical",
    icon: FileText,
  },
  {
    key: "preconditions",
    group: "clinical",
    icon: Stethoscope,
  },
  {
    key: "allergies",
    group: "clinical",
    icon: Ban,
  },
  {
    key: "surgeries",
    group: "clinical",
    icon: Scissors,
  },
  {
    key: "medications",
    group: "clinical",
    icon: Pill,
  },
  {
    key: "pain",
    group: "clinical",
    icon: Zap,
  },
  {
    key: "symptoms",
    group: "clinical",
    icon: Activity,
  },
  {
    key: "vegetative",
    group: "clinical",
    icon: Thermometer,
  },
  {
    key: "cardiology",
    group: "specialty",
    icon: HeartPulse,
  },
  {
    key: "gastroenterology",
    group: "specialty",
    icon: Scan,
  },
  {
    key: "orthopedics",
    group: "specialty",
    icon: Bone,
  },
  {
    key: "neurology",
    group: "specialty",
    icon: Brain,
  },
  {
    key: "pulmonology",
    group: "specialty",
    icon: Wind,
  },
  {
    key: "urology",
    group: "specialty",
    icon: Droplets,
  },
  {
    key: "history",
    group: "meta",
    icon: History,
  },
];

const CASE_SECTION_KEYS = new Set<CaseSectionKey>(
  CASE_WORKSPACE_SECTIONS.map((item) => item.key),
);

const DEFAULT_CASE_SECTION: CaseSectionKey = "overview";

function normalizeLang(lang: string): Lang {
  return lang === "de" ? "de" : "ru";
}

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
