import type { TranslationKey, Translations } from "@/lib/i18n";

const AGENCY_SERVICE_NAME_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  treatment_organization: "revenue_agency_service_catalog_treatment_organization",
  interpreter_hours: "revenue_agency_service_catalog_interpreter_hours",
  airport_transfer: "revenue_agency_service_catalog_airport_transfer",
  concierge_companion: "revenue_agency_service_catalog_concierge_companion",
};

// Names the seeded catalogue items carry or carried (English demo texts, the
// German catalogue names since 2026-10-11 and the UI labels): order, quote and
// invoice lines keep the name they were created with.
const AGENCY_SERVICE_NAME_TO_KEY: Partial<Record<string, string>> = {
  "treatment organization": "treatment_organization",
  "termin organization fee": "treatment_organization",
  "organisation der behandlung": "treatment_organization",
  "behandlungsorganisation": "treatment_organization",
  "организация лечения": "treatment_organization",
  "interpreter support": "interpreter_hours",
  "dolmetscherbetreuung": "interpreter_hours",
  "услуги переводчика": "interpreter_hours",
  "airport transfer coordination": "airport_transfer",
  "flughafentransfer": "airport_transfer",
  "трансфер из аэропорта": "airport_transfer",
  "companion support": "concierge_companion",
  "concierge-begleitung": "concierge_companion",
  "сопровождение консьержа": "concierge_companion",
};

// Descriptions of the seeded catalogue items in every language they were
// stored in (see migration 20261011213000).
const AGENCY_SERVICE_DESCRIPTION_TO_KEY: Partial<Record<string, string>> = {
  "agency coordination and treatment scheduling.": "treatment_organization",
  "agenturkoordination und behandlungsplanung.": "treatment_organization",
  "координация агентства и планирование лечения.": "treatment_organization",
  "medical interpretation billed per hour.": "interpreter_hours",
  "medizinische verdolmetschung mit abrechnung pro stunde.": "interpreter_hours",
  "медицинский перевод с почасовой оплатой.": "interpreter_hours",
  "airport pickup or hotel transfer handled by concierge.": "airport_transfer",
  "abholung am flughafen oder hoteltransfer durch den concierge-service.": "airport_transfer",
  "встреча в аэропорту или трансфер в отель через консьерж-сервис.": "airport_transfer",
  "additional family coordination and on-site support.": "concierge_companion",
  "zusätzliche familienkoordination und begleitung vor ort.": "concierge_companion",
  "дополнительная координация семьи и сопровождение на месте.": "concierge_companion",
};

const AGENCY_SERVICE_DESCRIPTION_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  treatment_organization: "revenue_agency_service_catalog_treatment_organization_description",
  interpreter_hours: "revenue_agency_service_catalog_interpreter_hours_description",
  airport_transfer: "revenue_agency_service_catalog_airport_transfer_description",
  concierge_companion: "revenue_agency_service_catalog_concierge_companion_description",
};

const AGENCY_SERVICE_UNIT_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  unit: "revenue_unit_default",
  einheit: "revenue_unit_default",
  "ед.": "revenue_unit_default",
  package: "revenue_unit_package",
  paket: "revenue_unit_package",
  hour: "revenue_unit_hour",
  stunde: "revenue_unit_hour",
  ride: "revenue_unit_ride",
  fahrt: "revenue_unit_ride",
  day: "revenue_unit_day",
  tag: "revenue_unit_day",
  appointment: "revenue_unit_appointment",
  termin: "revenue_unit_appointment",
  item: "revenue_unit_item",
  items: "revenue_unit_item",
  piece: "revenue_unit_item",
  pcs: "revenue_unit_item",
  "stk.": "revenue_unit_item",
  stk: "revenue_unit_item",
  "stück": "revenue_unit_item",
  "шт.": "revenue_unit_item",
  "шт": "revenue_unit_item",
};

function normalizedKey(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function translatedValue(
  key: string | undefined,
  translations: Translations,
) {
  return key ? translations[key as TranslationKey] : undefined;
}

export function agencyServiceNameLabel(
  serviceKey: string | null | undefined,
  serviceName: string | null | undefined,
  translations: Translations,
) {
  const normalizedServiceName = normalizedKey(serviceName);
  const inferredServiceKey =
    normalizedKey(serviceKey) || AGENCY_SERVICE_NAME_TO_KEY[normalizedServiceName] || "";

  return (
    translatedValue(AGENCY_SERVICE_NAME_LABEL_KEYS[inferredServiceKey], translations) ??
    serviceName?.trim() ??
    serviceKey?.trim() ??
    translations.common_not_set
  );
}

/**
 * The text stored on an order line (and copied to quotes, invoices and credit
 * notes) when a catalog service is picked: the catalog's own name, never the
 * label of the current UI language. A Russian UI must not put "Организация
 * лечения" on a German invoice; display code still localizes known names.
 */
export function agencyServiceStoredName(
  serviceKey: string | null | undefined,
  serviceName: string | null | undefined,
  translations: Translations,
) {
  return serviceName?.trim() || agencyServiceNameLabel(serviceKey, serviceName, translations);
}

export function agencyServiceDescriptionLabel(
  serviceKey: string | null | undefined,
  description: string | null | undefined,
  translations: Translations,
) {
  return (
    translatedValue(AGENCY_SERVICE_DESCRIPTION_LABEL_KEYS[normalizedKey(serviceKey)], translations) ??
    description?.trim() ??
    translations.common_not_set
  );
}

export function agencyServiceUnitLabel(
  unitLabel: string | null | undefined,
  translations: Translations,
) {
  return (
    translatedValue(AGENCY_SERVICE_UNIT_LABEL_KEYS[normalizedKey(unitLabel)], translations) ??
    unitLabel?.trim() ??
    translations.common_not_set
  );
}

type LocalizedCatalogItem = {
  service_key?: string | null;
  service_name?: string | null;
  description?: string | null;
  name_ru?: string | null;
  description_ru?: string | null;
};

/**
 * A catalogue item's name in the UI language (QA 2026-10-11: the lead wizard
 * picker showed "INTERPRETER SUPPORT"): the Russian name the agency entered,
 * else the label of a seeded item, else the catalogue's own (German) name.
 */
export function agencyCatalogItemName(
  service: LocalizedCatalogItem,
  translations: Translations,
  lang: "de" | "ru",
) {
  const russian = service.name_ru?.trim();
  if (lang === "ru" && russian) return russian;
  return agencyServiceNameLabel(service.service_key, service.service_name, translations);
}

/** A catalogue item's description in the UI language, like [`agencyCatalogItemName`]. */
export function agencyCatalogItemDescription(
  service: LocalizedCatalogItem,
  translations: Translations,
  lang: "de" | "ru",
) {
  const russian = service.description_ru?.trim();
  if (lang === "ru" && russian) return russian;
  return agencyServiceLineDescription(service.service_key, service.description, translations);
}

/**
 * The name of an order, quote or invoice line in the UI language. The line
 * stores the catalogue's (German) name, or an English demo name for older
 * lines; a known name becomes the label of the UI language, text the staff
 * typed themselves stays as typed.
 */
export function agencyServiceLineName(
  serviceKey: string | null | undefined,
  description: string | null | undefined,
  translations: Translations,
) {
  const text = description?.trim() ?? "";
  const key = AGENCY_SERVICE_NAME_TO_KEY[normalizedKey(text)];
  if (!key || (normalizedKey(serviceKey) && normalizedKey(serviceKey) !== key)) return text;
  return translatedValue(AGENCY_SERVICE_NAME_LABEL_KEYS[key], translations) ?? text;
}

/** A line's catalogue description in the UI language; own texts stay as they are. */
export function agencyServiceLineDescription(
  serviceKey: string | null | undefined,
  description: string | null | undefined,
  translations: Translations,
) {
  const text = description?.trim() ?? "";
  const key = AGENCY_SERVICE_DESCRIPTION_TO_KEY[normalizedKey(text)];
  if (!key || (normalizedKey(serviceKey) && normalizedKey(serviceKey) !== key)) return text;
  return translatedValue(AGENCY_SERVICE_DESCRIPTION_LABEL_KEYS[key], translations) ?? text;
}

/**
 * The UI name of a line picked from `service`: the item's name in the UI
 * language while the line still carries the catalogue's name, else the
 * line's own text (localized when it is a known catalogue name).
 */
export function agencyServiceLineDisplayName(
  description: string | null | undefined,
  service: LocalizedCatalogItem | null | undefined,
  translations: Translations,
  lang: "de" | "ru",
) {
  const text = description?.trim() ?? "";
  if (service && (!text || normalizedKey(text) === normalizedKey(service.service_name))) {
    return agencyCatalogItemName(service, translations, lang);
  }
  return agencyServiceLineName(service?.service_key, text, translations);
}

/**
 * The UI description of a line picked from `service`: the item's Russian
 * description while the line still carries the catalogue's text, else
 * `resolvedText` (the line's description with its placeholders filled),
 * localized when it is a known catalogue description.
 */
export function agencyServiceLineDisplayDescription(
  resolvedText: string,
  lineCatalogDescription: string | null | undefined,
  service: LocalizedCatalogItem | null | undefined,
  translations: Translations,
  lang: "de" | "ru",
) {
  const russian = service?.description_ru?.trim();
  if (
    lang === "ru"
    && russian
    && normalizedKey(lineCatalogDescription ?? service?.description) === normalizedKey(service?.description)
  ) {
    return russian;
  }
  return agencyServiceLineDescription(service?.service_key, resolvedText, translations) || resolvedText;
}

const GERMAN_DOCUMENT_UNITS: Partial<Record<string, string>> = {
  unit: "Einheit", units: "Einheit", einheit: "Einheit", "ед.": "Einheit", "ед": "Einheit",
  item: "Stück", items: "Stück", piece: "Stück", pieces: "Stück", pcs: "Stück", "stk.": "Stück",
  stk: "Stück", "stück": "Stück", "шт.": "Stück", "шт": "Stück",
  hour: "Std.", hours: "Std.", "std.": "Std.", std: "Std.", stunde: "Std.", stunden: "Std.",
  "час": "Std.", "ч.": "Std.", "ч": "Std.",
  ride: "Fahrt", rides: "Fahrt", fahrt: "Fahrt", "поездка": "Fahrt",
  day: "Tag", days: "Tag", tag: "Tag", "день": "Tag",
  night: "Nacht", nights: "Nacht", nacht: "Nacht", "ночь": "Nacht",
  package: "Paket", paket: "Paket", "пакет": "Paket",
  appointment: "Termin", termin: "Termin", "приём": "Termin", "прием": "Termin",
};

/**
 * The German unit a document prints ("Stück", "Std."), whatever technical or
 * UI-language unit the catalogue stores; mirrors `german_unit_label` in
 * crates/server/src/order_document_texts.rs.
 */
export function germanDocumentUnitLabel(unitLabel: string | null | undefined) {
  const trimmed = unitLabel?.trim() ?? "";
  return GERMAN_DOCUMENT_UNITS[trimmed.toLowerCase()] ?? trimmed;
}
