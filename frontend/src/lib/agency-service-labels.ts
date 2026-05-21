import type { TranslationKey, Translations } from "@/lib/i18n";

const AGENCY_SERVICE_NAME_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  treatment_organization: "revenue_agency_service_catalog_treatment_organization",
  interpreter_hours: "revenue_agency_service_catalog_interpreter_hours",
  airport_transfer: "revenue_agency_service_catalog_airport_transfer",
  concierge_companion: "revenue_agency_service_catalog_concierge_companion",
};

const AGENCY_SERVICE_NAME_TO_KEY: Partial<Record<string, string>> = {
  "treatment organization": "treatment_organization",
  "termin organization fee": "treatment_organization",
  "interpreter support": "interpreter_hours",
  "airport transfer coordination": "airport_transfer",
  "companion support": "concierge_companion",
};

const AGENCY_SERVICE_DESCRIPTION_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  treatment_organization: "revenue_agency_service_catalog_treatment_organization_description",
  interpreter_hours: "revenue_agency_service_catalog_interpreter_hours_description",
  airport_transfer: "revenue_agency_service_catalog_airport_transfer_description",
  concierge_companion: "revenue_agency_service_catalog_concierge_companion_description",
};

const AGENCY_SERVICE_UNIT_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  package: "revenue_unit_package",
  hour: "revenue_unit_hour",
  ride: "revenue_unit_ride",
  day: "revenue_unit_day",
  appointment: "revenue_unit_appointment",
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
