import type { DatevModule, DatevProfile } from "./setup-api";

export const DATEV_PORTAL = "https://www.datev.de/web/de/berufsgruppenuebergreifend/mydatev/cloud-anwendungen/datev-unternehmen-online";
export const DATEV_EXPORT_DOCS = "https://developer.datev.de/en/use-cases/details/lz85bfgyb2m809rvuie5yuq3";
export const DATEV_MODULE_NAMES: Record<DatevModule, string> = {
  belege: "Belege online",
  belegfreigabe: "Belegfreigabe online",
  bank: "Bank online",
  kassenbuch: "Kassenbuch online",
  auswertungspakete: "Auswertungspakete Rechnungswesen online",
  liquiditaetsmonitor: "Liquiditätsmonitor online",
};

export function profileNumbersValid(profile: DatevProfile) {
  return (!profile.consultant_number && !profile.client_number)
    || (/^\d{1,7}$/.test(profile.consultant_number) && /^\d{1,5}$/.test(profile.client_number));
}

// A preparation document for the accountant, never an authorization or an API export.
export function datevSetupBrief(profile: DatevProfile) {
  const exportLabel = { unknown: "Noch zu klären", not_ordered: "Nicht bestellt", ordered: "Laut eigener Angabe bestellt; API-Zugriff nicht geprüft" }[profile.export_service];
  return [
    "GMED / DATEV Unternehmen online – Vorbereitung des Lesezugriffs",
    "",
    `Unternehmen: ${profile.company_name || "Noch zu klären"}`,
    `Beraternummer: ${profile.consultant_number || "Noch zu klären"}`,
    `Mandantennummer: ${profile.client_number || "Noch zu klären"}`,
    `Belege-online-Version: ${profile.belege_version || "Noch zu klären"}`,
    "",
    "Genutzte Module (Angaben aus GMED; keine verifizierten API-Berechtigungen):",
    ...(profile.modules.length ? profile.modules.map((id) => `- ${DATEV_MODULE_NAMES[id]}`) : ["- Keine ausgewählt"]),
    "",
    `DATEV Datenservice Export Rechnungswesen: ${exportLabel}`,
    "",
    "Mit der Steuerberatung zu klären:",
    "1. Berater-/Mandantenzuordnung und eingesetzte Version von Belege online bestätigen.",
    "2. Prüfen, ob DATEV Datenservice Export Rechnungswesen für den Bestand aktiviert ist und aktuelle Rechnungswesendaten im DATEV-Rechenzentrum bereitstehen.",
    "3. Separat klären, wie Originalrechnungen (PDF/XML) aus Belege online bereitgestellt werden können. Upload-Schnittstellen sind kein Nachweis für einen Download-Zugriff.",
    "4. Für Belegfreigaben, Bankumsätze, Kassenbuch, PDF-Auswertungspakete und Liquiditätsprognosen verfügbare Leseschnittstellen bzw. Exporte prüfen.",
    "",
    "Durch die GMED-Integration vorzubereiten:",
    "- DATEV-Developer-Organisation, App und API-Abonnements einrichten.",
    "- Für Rechnungswesendaten accounting:clients und accounting:dataexchange prüfen; Sandbox und Freigabe für Produktion getrennt behandeln.",
    "- Erst nach Einrichtung der App: Autorisierung auf der offiziellen DATEV-Seite und Prüfung des tatsächlich freigegebenen Bestands.",
    "",
    "Aktueller Stand: Keine DATEV-Verbindung. Keine Synchronisation. Das Speichern dieses Profils erteilt keine Zugriffsrechte.",
    "Umfang der ersten Stufe: Daten lesen. Keine Belege hochladen, keine Buchungen ändern, keine Rechnungen freigeben und keine Zahlungen auslösen.",
    "",
    "Offizielle Quellen:", DATEV_PORTAL, DATEV_EXPORT_DOCS,
    "https://developer.datev.de/en/product-detail/accounting-dataexchange/1/documentation",
    "",
  ].join("\n");
}
