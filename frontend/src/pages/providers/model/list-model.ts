import type {
  DoctorFormState,
  DoctorSummary,
  LinkedPatient,
  ProviderDetail,
  ProviderFilters,
  ProviderFormState,
  ProviderPermissions,
  ProviderSummary,
  ProviderType,
  ServiceFormState,
  ServiceItem,
} from "./types";
import {
  formatEnumLabelFromKeys,
  getLang,
  t as translateCatalog,
  type TranslationKey,
} from "@/lib/i18n";

const PROVIDER_TYPE_LABEL_KEYS = {
  medical: "providers_type_medical",
  non_medical: "providers_type_non_medical",
} satisfies Partial<Record<string, TranslationKey>>;

const PROVIDER_CODE_LABEL_KEYS = {
  appointment: "appointments_title",
  leistung: "providers_leistungen",
  concierge_service: "services_title",
  medical: "providers_type_medical",
  non_medical: "providers_type_non_medical",
  internal: "operations_status_internal",
  planned: "operations_status_planned",
  booked: "operations_status_booked",
  confirmed: "operations_status_confirmed",
  in_progress: "operations_status_in_progress",
  in_service: "operations_status_in_service",
  completed: "common_completed",
  cancelled: "invoices_workspace_status_cancelled",
  draft: "invoices_workspace_status_draft",
  delivered: "operations_status_delivered",
  approved: "operations_status_approved",
  hotel: "services_type_hotel",
  transfer: "services_type_transfer",
  vip_terminal: "services_type_vip_terminal",
  flight: "services_type_flight",
  chauffeur: "services_type_chauffeur",
  translation_support: "services_type_translation_support",
  other: "services_type_other",
} satisfies Partial<Record<string, TranslationKey>>;

const COMPACT_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const COMPACT_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string) {
  const normalizedCurrency = currency || "EUR";
  const cached = moneyFormatters.get(normalizedCurrency);
  if (cached) return cached;
  const formatter = Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: normalizedCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  moneyFormatters.set(normalizedCurrency, formatter);
  return formatter;
}

export const DEFAULT_FILTERS: ProviderFilters = {
  search: "",
  providerType: "",
  activeOnly: "true",
  city: "",
  country: "",
  fachbereich: "",
  doctorName: "",
  doctorFachbereich: "",
  serviceName: "",
  hasContract: "",
  ratingGte: "",
};

export function providerPermissions(role?: string): ProviderPermissions {
  switch (role) {
    case "ceo":
    case "patient_manager":
      return { canViewPage: true, canManageRegistry: true, forceNonMedical: false };
    case "concierge":
      return { canViewPage: true, canManageRegistry: false, forceNonMedical: true };
    case "billing":
    case "sales":
      return { canViewPage: true, canManageRegistry: false, forceNonMedical: false };
    default:
      return { canViewPage: false, canManageRegistry: false, forceNonMedical: false };
  }
}

export function blankProviderForm(providerType: ProviderType = "medical"): ProviderFormState {
  return {
    name: "",
    providerType,
    legalName: "",
    taxId: "",
    addressStreet: "",
    addressCity: "",
    addressZip: "",
    addressCountry: "",
    phone: "",
    email: "",
    website: "",
    fachbereich: "",
    contractText: "",
    notes: "",
  };
}

export function blankDoctorForm(): DoctorFormState {
  return {
    id: "",
    name: "",
    title: "",
    fachbereich: "",
    languages: "",
    phone: "",
    email: "",
    licenseNumber: "",
    licensingCountry: "",
    licensingValidUntil: "",
    notes: "",
  };
}

export function blankServiceForm(): ServiceFormState {
  return {
    id: "",
    serviceName: "",
    description: "",
    price: "",
    currency: "EUR",
    validFrom: new Date().toLocaleDateString("en-CA"),
    validTo: "",
  };
}

function toOptional(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseCommaList(value: string) {
  return value.split(",").flatMap((item) => {
    const trimmed = item.trim();
    return trimmed ? [trimmed] : [];
  });
}

export function providerTypeLabel(value: string, tr: Record<string, string>) {
  const translations = translateCatalog(getLang());
  return formatEnumLabelFromKeys(value, PROVIDER_TYPE_LABEL_KEYS, {
    ...translations,
    providers_type_medical:
      tr.providers_type_medical ?? translations.providers_type_medical,
    providers_type_non_medical:
      tr.providers_type_non_medical ?? translations.providers_type_non_medical,
  });
}

export function compactDateTime(
  value?: string | null,
  fallback = translateCatalog(getLang()).common_not_set,
) {
  if (!value) return fallback;
  try {
    return COMPACT_DATE_TIME_FORMATTER.format(new Date(value));
  } catch {
    return value;
  }
}

export function compactDate(
  value?: string | null,
  fallback = translateCatalog(getLang()).common_not_set,
) {
  if (!value) return fallback;
  try {
    return COMPACT_DATE_FORMATTER.format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

function stringifyContract(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "summary" in value) {
    const summary = (value as { summary?: unknown }).summary;
    if (typeof summary === "string") return summary;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function parseContract(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  return { summary: trimmed };
}

export function buildProvidersQuery(filters: ProviderFilters, forceNonMedical: boolean) {
  const params = new URLSearchParams();
  const providerType = forceNonMedical ? "non_medical" : filters.providerType;
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (providerType) params.set("provider_type", providerType);
  if (filters.activeOnly) params.set("active_only", filters.activeOnly);
  if (filters.city.trim()) params.set("city", filters.city.trim());
  if (filters.country.trim()) params.set("country", filters.country.trim());
  if (filters.fachbereich.trim()) params.set("fachbereich", filters.fachbereich.trim());
  if (filters.doctorName.trim()) params.set("doctor_name", filters.doctorName.trim());
  if (filters.doctorFachbereich.trim()) {
    params.set("doctor_fachbereich", filters.doctorFachbereich.trim());
  }
  if (filters.serviceName.trim()) params.set("service_name", filters.serviceName.trim());
  if (filters.hasContract) params.set("has_contract", filters.hasContract);
  if (filters.ratingGte) params.set("rating_gte", filters.ratingGte);
  const query = params.toString();
  return query ? `/providers?${query}` : "/providers";
}

export function providerToForm(detail: ProviderDetail): ProviderFormState {
  return {
    name: detail.name,
    providerType: detail.provider_type,
    legalName: detail.legal_name ?? "",
    taxId: detail.tax_id ?? "",
    addressStreet: detail.address_street ?? "",
    addressCity: detail.address_city ?? "",
    addressZip: detail.address_zip ?? "",
    addressCountry: detail.address_country ?? "",
    phone: detail.phone ?? "",
    email: detail.email ?? "",
    website: detail.website ?? "",
    fachbereich: detail.fachbereich ?? "",
    contractText: stringifyContract(detail.kooperationsvertrag),
    notes: detail.notes ?? "",
  };
}

export function doctorToForm(doctor: DoctorSummary): DoctorFormState {
  return {
    id: doctor.id,
    name: doctor.name,
    title: doctor.title ?? "",
    fachbereich: doctor.fachbereich ?? "",
    languages: doctor.languages?.join(", ") ?? "",
    phone: doctor.phone ?? "",
    email: doctor.email ?? "",
    licenseNumber: doctor.license_number ?? "",
    licensingCountry: doctor.licensing_country ?? "",
    licensingValidUntil: doctor.licensing_valid_until ?? "",
    notes: doctor.notes ?? "",
  };
}

export function serviceToForm(service: ServiceItem): ServiceFormState {
  return {
    id: service.id,
    serviceName: service.service_name,
    description: service.description ?? "",
    price: service.price,
    currency: service.currency || "EUR",
    validFrom: service.valid_from || new Date().toLocaleDateString("en-CA"),
    validTo: service.valid_to ?? "",
  };
}

export function toProviderPayload(form: ProviderFormState, forceNonMedical: boolean) {
  return {
    name: form.name.trim(),
    provider_type: forceNonMedical ? "non_medical" : form.providerType,
    legal_name: toOptional(form.legalName),
    tax_id: toOptional(form.taxId),
    address_street: toOptional(form.addressStreet),
    address_city: toOptional(form.addressCity),
    address_zip: toOptional(form.addressZip),
    address_country: toOptional(form.addressCountry),
    phone: toOptional(form.phone),
    email: toOptional(form.email),
    website: toOptional(form.website),
    fachbereich: toOptional(form.fachbereich),
    kooperationsvertrag: parseContract(form.contractText),
    notes: toOptional(form.notes),
  };
}

export function toDoctorPayload(form: DoctorFormState) {
  return {
    name: form.name.trim(),
    title: toOptional(form.title),
    fachbereich: toOptional(form.fachbereich),
    languages: parseCommaList(form.languages),
    phone: toOptional(form.phone),
    email: toOptional(form.email),
    license_number: toOptional(form.licenseNumber),
    licensing_country: toOptional(form.licensingCountry),
    licensing_valid_until: toOptional(form.licensingValidUntil),
    notes: toOptional(form.notes),
  };
}

export function toServicePayload(form: ServiceFormState) {
  return {
    service_name: form.serviceName.trim(),
    description: toOptional(form.description),
    price: Number.parseFloat(form.price || "0"),
    currency: toOptional(form.currency) ?? "EUR",
    valid_from: toOptional(form.validFrom),
    valid_to: toOptional(form.validTo),
  };
}

export function humanizeCode(value: string) {
  const translations = translateCatalog(getLang());
  return formatEnumLabelFromKeys(value, PROVIDER_CODE_LABEL_KEYS, translations);
}

export function moneyLabel(price: string, currency: string) {
  const numeric = Number.parseFloat(price);
  if (!Number.isFinite(numeric)) return `${price} ${currency}`.trim();
  try {
    return moneyFormatter(currency).format(numeric);
  } catch {
    return `${numeric.toFixed(2)} ${currency}`.trim();
  }
}

export function patientLabel(patient: LinkedPatient) {
  return `${patient.patient_id} · ${patient.first_name} ${patient.last_name}`;
}

export function providerMeta(provider: ProviderSummary | ProviderDetail) {
  return [provider.address_city, provider.address_country].filter(Boolean).join(", ");
}
