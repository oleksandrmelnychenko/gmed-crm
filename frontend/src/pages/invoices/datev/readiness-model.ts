import type { DatevProfile } from "./setup-api";

export const DATEV_COMPATIBILITY_DOCS = "https://www.datev.de/web/de/berufsgruppenuebergreifend/service-und-support/umstellungen/auf-neue-version-datev-belege-online/fragen-und-antworten";
export type ReadinessCheck = { id: "company" | "numbers" | "modules" | "version" | "export"; complete: boolean };

export function profileNumbersValid(profile: DatevProfile) {
  return (!profile.consultant_number && !profile.client_number)
    || (/^\d{1,7}$/.test(profile.consultant_number) && /^\d{1,5}$/.test(profile.client_number));
}

// These checks describe declared preparation, never externally granted access.
export function datevReadiness(profile: DatevProfile): ReadinessCheck[] {
  return [
    { id: "company", complete: Boolean(profile.company_name.trim()) },
    { id: "numbers", complete: Boolean(profile.consultant_number.trim() && profile.client_number.trim() && profileNumbersValid(profile)) },
    { id: "modules", complete: profile.modules.length > 0 },
    ...(profile.modules.includes("belege") ? [{ id: "version" as const, complete: Boolean(profile.belege_version.trim()) }] : []),
    { id: "export", complete: profile.export_service !== "unknown" },
  ];
}

export const READINESS_LABELS_DE: Record<ReadinessCheck["id"], string> = {
  company: "Unternehmen angegeben",
  numbers: "Berater- und Mandantennummer angegeben",
  modules: "Genutzte Module ausgewählt",
  version: "Belege-online-Version angegeben",
  export: "Bestellstatus von Export Rechnungswesen geklärt",
};
