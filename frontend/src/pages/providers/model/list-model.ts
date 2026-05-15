import type {
  DoctorFormState,
  DoctorSummary,
  LinkedPatient,
  PersonContactFormState,
  ProviderDetail,
  ProviderFilters,
  ProviderFormState,
  ProviderPermissions,
  ProviderSummary,
  ProviderType,
  ServiceFormState,
  ServiceItem,
  StaffFormState,
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

type ContactPayload = {
  contact_kind: "phone" | "email";
  contact_type: "work" | "private" | "other";
  value: string;
  is_primary: boolean;
  notes?: string | null;
};

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
    specializations: "",
    parentProviderId: "",
    organizationLevel: "organization",
    contractText: "",
    notes: "",
  };
}

export function blankDoctorForm(): DoctorFormState {
  return {
    id: "",
    name: "",
    firstName: "",
    lastName: "",
    title: "",
    fachbereich: "",
    specializations: "",
    languages: "",
    phone: "",
    email: "",
    privatePhone: "",
    privateEmail: "",
    contacts: [],
    licenseNumber: "",
    licensingCountry: "",
    licensingValidUntil: "",
    notes: "",
  };
}

export function blankServiceForm(priceType: ServiceFormState["priceType"] = "fixed"): ServiceFormState {
  return {
    id: "",
    serviceName: "",
    description: "",
    price: "",
    priceType,
    priceFrom: "",
    priceTo: "",
    priceNote: "",
    currency: "EUR",
    validFrom: new Date().toLocaleDateString("en-CA"),
    validTo: "",
  };
}

export function blankStaffForm(): StaffFormState {
  return {
    id: "",
    firstName: "",
    lastName: "",
    displayName: "",
    role: "staff",
    department: "",
    status: "active",
    phone: "",
    email: "",
    privatePhone: "",
    privateEmail: "",
    contacts: [],
    notes: "",
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

function specializationsToText(items?: { name_en?: string | null; code?: string }[], fallback = "") {
  const labels = (items ?? [])
    .map((item) => item.name_en || item.code || "")
    .filter(Boolean);
  return labels.length ? labels.join(", ") : fallback;
}

function contactValue(
  contacts: { contact_kind: string; contact_type: string; value: string; is_primary?: boolean }[] | undefined,
  kind: "phone" | "email",
  type: "work" | "private",
  fallback = "",
) {
  const typed = contacts?.find((contact) => contact.contact_kind === kind && contact.contact_type === type);
  const primary = contacts?.find((contact) => contact.contact_kind === kind && contact.is_primary);
  return typed?.value ?? primary?.value ?? fallback;
}

function makeContactFormId(prefix = "contact") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toContactForms(
  contacts: {
    id?: string | null;
    contact_kind: string;
    contact_type: string;
    value: string;
    is_primary?: boolean;
    notes?: string | null;
  }[] | undefined,
  fallbackPhone = "",
  fallbackEmail = "",
) {
  const normalized = (contacts ?? []).flatMap((contact, index): PersonContactFormState[] => {
    const contactKind = contact.contact_kind === "email" ? "email" : "phone";
    const contactType =
      contact.contact_type === "private" || contact.contact_type === "other"
        ? contact.contact_type
        : "work";
    const value = contact.value?.trim() ?? "";
    if (!value) return [];
    return [{
      id: contact.id ?? makeContactFormId(`contact-${index}`),
      contactKind,
      contactType,
      value,
      isPrimary: Boolean(contact.is_primary),
      notes: contact.notes ?? "",
    }];
  });

  if (normalized.length > 0) {
    return ensureContactPrimary(normalized);
  }

  return ensureContactPrimary([
    fallbackPhone && {
      id: makeContactFormId("legacy-phone"),
      contactKind: "phone" as const,
      contactType: "work" as const,
      value: fallbackPhone,
      isPrimary: true,
      notes: "",
    },
    fallbackEmail && {
      id: makeContactFormId("legacy-email"),
      contactKind: "email" as const,
      contactType: "work" as const,
      value: fallbackEmail,
      isPrimary: true,
      notes: "",
    },
  ].filter(Boolean) as PersonContactFormState[]);
}

function ensureContactPrimary<T extends PersonContactFormState>(contacts: T[]) {
  return contacts.map((contact, _index, all) => {
    const sameKind = all.filter((item) => item.contactKind === contact.contactKind);
    const firstPrimary = sameKind.find((item) => item.isPrimary);
    if (firstPrimary) {
      return { ...contact, isPrimary: contact.id === firstPrimary.id };
    }
    return { ...contact, isPrimary: sameKind[0]?.id === contact.id };
  });
}

function buildDynamicContacts(contacts: PersonContactFormState[]): ContactPayload[] {
  return contacts.flatMap((contact): ContactPayload[] => {
    const value = toOptional(contact.value);
    if (!value) return [];
    return [{
      contact_kind: contact.contactKind,
      contact_type: contact.contactType,
      value,
      is_primary: contact.isPrimary,
      notes: toOptional(contact.notes),
    }];
  });
}

function buildDoctorContacts(form: DoctorFormState): ContactPayload[] {
  const contacts = buildDynamicContacts(form.contacts);

  if (contacts.length > 0) {
    return contacts;
  }

  return buildContacts(form);
}

function buildStaffContacts(form: StaffFormState): ContactPayload[] {
  const contacts = buildDynamicContacts(form.contacts);

  if (contacts.length > 0) {
    return contacts;
  }

  return buildContacts(form);
}

function primaryContact(
  contacts: ContactPayload[],
  kind: "phone" | "email",
) {
  return (
    contacts.find((contact) => contact.contact_kind === kind && contact.is_primary)?.value ??
    contacts.find((contact) => contact.contact_kind === kind)?.value ??
    null
  );
}

function buildContacts(form: {
  phone: string;
  email: string;
  privatePhone: string;
  privateEmail: string;
}): ContactPayload[] {
  const phone = toOptional(form.phone);
  const email = toOptional(form.email);
  const privatePhone = toOptional(form.privatePhone);
  const privateEmail = toOptional(form.privateEmail);
  const contacts: Array<ContactPayload | null> = [
    phone ? {
      contact_kind: "phone",
      contact_type: "work",
      value: phone,
      is_primary: true,
      notes: null,
    } : null,
    email ? {
      contact_kind: "email",
      contact_type: "work",
      value: email,
      is_primary: true,
      notes: null,
    } : null,
    privatePhone ? {
      contact_kind: "phone",
      contact_type: "private",
      value: privatePhone,
      is_primary: !phone,
      notes: null,
    } : null,
    privateEmail ? {
      contact_kind: "email",
      contact_type: "private",
      value: privateEmail,
      is_primary: !email,
      notes: null,
    } : null,
  ];
  return contacts.filter((contact): contact is ContactPayload => Boolean(contact));
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
    specializations: specializationsToText(detail.specializations, detail.fachbereich ?? ""),
    parentProviderId: detail.parent_provider_id ?? "",
    organizationLevel: detail.organization_level ?? "organization",
    contractText: stringifyContract(detail.kooperationsvertrag),
    notes: detail.notes ?? "",
  };
}

export function doctorToForm(doctor: DoctorSummary): DoctorFormState {
  return {
    id: doctor.id,
    name: doctor.name,
    firstName: doctor.first_name ?? "",
    lastName: doctor.last_name ?? "",
    title: doctor.title ?? "",
    fachbereich: doctor.fachbereich ?? "",
    specializations: specializationsToText(doctor.specializations, doctor.fachbereich ?? ""),
    languages: doctor.languages?.join(", ") ?? "",
    phone: contactValue(doctor.contacts, "phone", "work", doctor.phone ?? ""),
    email: contactValue(doctor.contacts, "email", "work", doctor.email ?? ""),
    privatePhone: contactValue(doctor.contacts, "phone", "private"),
    privateEmail: contactValue(doctor.contacts, "email", "private"),
    contacts: toContactForms(doctor.contacts, doctor.phone ?? "", doctor.email ?? ""),
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
    priceType: service.price_type || "fixed",
    priceFrom: service.price_from ?? service.price ?? "",
    priceTo: service.price_to ?? service.price ?? "",
    priceNote: service.price_note ?? "",
    currency: service.currency || "EUR",
    validFrom: service.valid_from || new Date().toLocaleDateString("en-CA"),
    validTo: service.valid_to ?? "",
  };
}

export function staffToForm(staff: {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  role: string;
  department: string | null;
  status: StaffFormState["status"];
  phone?: string | null;
  email?: string | null;
  contacts?: { contact_kind: string; contact_type: string; value: string; is_primary?: boolean }[];
  notes: string | null;
}): StaffFormState {
  const contacts = toContactForms(staff.contacts, staff.phone ?? "", staff.email ?? "");
  return {
    id: staff.id,
    firstName: staff.first_name ?? "",
    lastName: staff.last_name ?? "",
    displayName: staff.display_name ?? "",
    role: staff.role ?? "staff",
    department: staff.department ?? "",
    status: staff.status ?? "active",
    phone: contactValue(staff.contacts, "phone", "work", staff.phone ?? ""),
    email: contactValue(staff.contacts, "email", "work", staff.email ?? ""),
    privatePhone: contactValue(staff.contacts, "phone", "private"),
    privateEmail: contactValue(staff.contacts, "email", "private"),
    contacts,
    notes: staff.notes ?? "",
  };
}

export function toProviderPayload(form: ProviderFormState, forceNonMedical: boolean) {
  const providerType = forceNonMedical ? "non_medical" : form.providerType;
  const isMedical = providerType === "medical";
  return {
    name: form.name.trim(),
    provider_type: providerType,
    legal_name: toOptional(form.legalName),
    tax_id: toOptional(form.taxId),
    address_street: toOptional(form.addressStreet),
    address_city: toOptional(form.addressCity),
    address_zip: toOptional(form.addressZip),
    address_country: toOptional(form.addressCountry),
    phone: toOptional(form.phone),
    email: toOptional(form.email),
    website: toOptional(form.website),
    fachbereich: isMedical ? toOptional(form.fachbereich) : null,
    specializations: isMedical ? parseCommaList(form.specializations || form.fachbereich) : [],
    parent_provider_id: toOptional(form.parentProviderId),
    organization_level: form.organizationLevel,
    kooperationsvertrag: parseContract(form.contractText),
    notes: toOptional(form.notes),
  };
}

export function toDoctorPayload(form: DoctorFormState) {
  const nameFromParts = [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(" ");
  const name = form.name.trim() || nameFromParts;
  const contacts = buildDoctorContacts(form);
  return {
    name,
    first_name: toOptional(form.firstName),
    last_name: toOptional(form.lastName),
    display_name: name,
    title: toOptional(form.title),
    fachbereich: toOptional(form.fachbereich),
    specializations: parseCommaList(form.specializations || form.fachbereich),
    languages: parseCommaList(form.languages),
    phone: primaryContact(contacts, "phone"),
    email: primaryContact(contacts, "email"),
    contacts,
    license_number: toOptional(form.licenseNumber),
    licensing_country: toOptional(form.licensingCountry),
    licensing_valid_until: toOptional(form.licensingValidUntil),
    notes: toOptional(form.notes),
  };
}

export function toServicePayload(form: ServiceFormState, forceRange = false) {
  const priceType = forceRange ? "range" : form.priceType || "fixed";
  const fixedPrice = Number.parseFloat(form.price || form.priceFrom || "0");
  const priceFrom = Number.parseFloat(form.priceFrom || form.price || "0");
  const priceTo = Number.parseFloat(form.priceTo || form.priceFrom || form.price || "0");
  return {
    service_name: form.serviceName.trim(),
    description: toOptional(form.description),
    price: priceType === "on_request" ? 0 : priceType === "range" ? priceFrom : fixedPrice,
    price_type: priceType,
    price_from: priceType === "on_request" && !form.priceFrom.trim() ? null : priceFrom,
    price_to: priceType === "on_request" && !form.priceTo.trim() ? null : priceTo,
    price_note: toOptional(form.priceNote),
    currency: toOptional(form.currency) ?? "EUR",
    valid_from: toOptional(form.validFrom),
    valid_to: toOptional(form.validTo),
  };
}

export function toStaffPayload(form: StaffFormState) {
  const displayName =
    form.displayName.trim() ||
    [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(" ");
  return {
    first_name: toOptional(form.firstName),
    last_name: toOptional(form.lastName),
    display_name: displayName,
    role: toOptional(form.role) ?? "staff",
    department: toOptional(form.department),
    status: form.status,
    notes: toOptional(form.notes),
    contacts: buildStaffContacts(form),
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

export function servicePriceLabel(service: ServiceItem) {
  if (service.price_type === "on_request") {
    return (
      service.price_note ||
      translateCatalog(getLang()).uiText.providers_price_on_request ||
      "providers_price_on_request"
    );
  }
  if (service.price_type === "range") {
    const from = moneyLabel(service.price_from ?? service.price, service.currency);
    const to = moneyLabel(service.price_to ?? service.price_from ?? service.price, service.currency);
    return from === to ? from : `${from} - ${to}`;
  }
  return moneyLabel(service.price, service.currency);
}

export function patientLabel(patient: LinkedPatient) {
  return `${patient.patient_id} · ${patient.first_name} ${patient.last_name}`;
}

export function providerMeta(provider: ProviderSummary | ProviderDetail) {
  return [provider.address_city, provider.address_country].filter(Boolean).join(", ");
}
