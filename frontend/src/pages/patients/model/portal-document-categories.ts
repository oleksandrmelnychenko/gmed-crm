import type { PortalDocumentItem } from "./portal-shared";

export type PortalDocumentCategoryKey =
  | "all"
  | "correspondence"
  | "lab_analysis"
  | "medical_reports"
  | "translations";

export const PORTAL_DOCUMENT_CATEGORY_TABS: Array<{
  key: PortalDocumentCategoryKey;
  label: { de: string; ru: string; en: string };
}> = [
  {
    key: "all",
    label: { de: "Alle", ru: "Все", en: "All" },
  },
  {
    key: "correspondence",
    label: {
      de: "Klinikkorrespondenz",
      ru: "Переписка с клиникой",
      en: "Clinic correspondence",
    },
  },
  {
    key: "lab_analysis",
    label: {
      de: "Labor / Analyse",
      ru: "Лаборатория / анализы",
      en: "Lab / analysis",
    },
  },
  {
    key: "medical_reports",
    label: {
      de: "Medizinische Berichte",
      ru: "Медицинские отчеты",
      en: "Medical reports",
    },
  },
  {
    key: "translations",
    label: {
      de: "Übersetzungen",
      ru: "Переводы",
      en: "Translations",
    },
  },
];

export function portalDocumentCategoryKey(
  item: Pick<PortalDocumentItem, "art" | "category" | "is_medical">,
): Exclude<PortalDocumentCategoryKey, "all"> {
  const raw = `${item.category ?? ""} ${item.art ?? ""}`.toLowerCase();

  if (
    raw.includes("translation") ||
    raw.includes("translated") ||
    raw.includes("übersetzung")
  ) {
    return "translations";
  }

  if (
    raw.includes("lab") ||
    raw.includes("labor") ||
    raw.includes("analysis") ||
    raw.includes("analyse") ||
    raw.includes("pathology") ||
    raw.includes("diagnostic")
  ) {
    return "lab_analysis";
  }

  if (
    raw.includes("correspondence") ||
    raw.includes("clinic_correspondence") ||
    raw.includes("clinic_form") ||
    raw.includes("letter") ||
    raw.includes("message")
  ) {
    return "correspondence";
  }

  if (
    item.is_medical ||
    raw.includes("medical_report") ||
    raw.includes("report") ||
    raw.includes("befund") ||
    raw.includes("treatment_plan")
  ) {
    return "medical_reports";
  }

  return "correspondence";
}
