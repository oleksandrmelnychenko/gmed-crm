import type { PortalDocumentItem } from "./portal-shared";

export type PortalDocumentCategoryKey =
  | "all"
  | "correspondence"
  | "analyses"
  | "conclusions"
  | "invoices"
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
      de: "Korrespondenz",
      ru: "Переписка",
      en: "Correspondence",
    },
  },
  {
    key: "analyses",
    label: {
      de: "Analysen",
      ru: "Анализы",
      en: "Analyses",
    },
  },
  {
    key: "conclusions",
    label: {
      de: "Befunde / Schluesse",
      ru: "Заключения",
      en: "Conclusions",
    },
  },
  {
    key: "invoices",
    label: {
      de: "Rechnungen",
      ru: "Счета",
      en: "Invoices",
    },
  },
  {
    key: "translations",
    label: {
      de: "Uebersetzungen",
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
    raw.includes("uebersetzung") ||
    raw.includes("ubersetzung")
  ) {
    return "translations";
  }

  if (
    raw.includes("invoice") ||
    raw.includes("rechnung") ||
    raw.includes("billing") ||
    raw.includes("payment") ||
    raw.includes("finance")
  ) {
    return "invoices";
  }

  if (
    raw.includes("lab") ||
    raw.includes("labor") ||
    raw.includes("analysis") ||
    raw.includes("analyse") ||
    raw.includes("pathology") ||
    raw.includes("diagnostic")
  ) {
    return "analyses";
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
    raw.includes("conclusion") ||
    raw.includes("summary") ||
    raw.includes("report") ||
    raw.includes("befund") ||
    raw.includes("treatment_plan")
  ) {
    return "conclusions";
  }

  return "correspondence";
}
