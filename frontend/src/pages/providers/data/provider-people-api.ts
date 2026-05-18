import { apiFetch } from "@/lib/api";

import {
  DEFAULT_PROVIDER_PEOPLE_FILTERS,
  type ProviderPeopleCounts,
  type ProviderPeopleFilters,
  type ProviderPeoplePatientOption,
  type ProviderPeoplePersonType,
  type ProviderPeopleResponse,
  type ProviderPeopleRow,
} from "../model/people-types";
import type {
  PersonContact,
  ProviderPersonGender,
  ProviderType,
  SpecializationItem,
} from "../model/types";

const COUNT_FIELDS = [
  "patient_count",
  "appointment_count",
  "leistung_count",
  "concierge_count",
  "service_count",
  "order_count",
  "interaction_count",
] as const;

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : String(value ?? fallback);
}

function nullableString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberValue(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function normalizePersonType(value: unknown): ProviderPeoplePersonType {
  return value === "staff" ? "staff" : "doctor";
}

function normalizeProviderType(value: unknown): ProviderType {
  return value === "non_medical" ? "non_medical" : "medical";
}

function normalizeGender(value: unknown): ProviderPersonGender {
  return value === "male" || value === "female" || value === "unknown"
    ? value
    : "unknown";
}

function normalizeStaffStatus(value: unknown): ProviderPeopleRow["status"] {
  return value === "inactive" || value === "external" || value === "unknown"
    ? value
    : "active";
}

function normalizeContact(value: unknown): PersonContact | null {
  const raw = objectOrEmpty(value);
  const contactValue = nullableString(raw.value);
  if (!contactValue) return null;

  return {
    id: nullableString(raw.id),
    contact_kind: raw.contact_kind === "email" ? "email" : "phone",
    contact_type:
      raw.contact_type === "private" || raw.contact_type === "other"
        ? raw.contact_type
        : "work",
    value: contactValue,
    is_primary: Boolean(raw.is_primary),
    notes: nullableString(raw.notes),
  };
}

function normalizeSpecialization(value: unknown): SpecializationItem | null {
  if (typeof value === "string") {
    const label = value.trim();
    if (!label) return null;
    return {
      id: label,
      code: label,
      name_en: label,
      name_de: null,
      name_ru: null,
      is_active: true,
      sort_order: 1000,
    };
  }

  const raw = objectOrEmpty(value);
  const code = nullableString(raw.code);
  const id = nullableString(raw.id) ?? code;
  const nameEn = nullableString(raw.name_en) ?? code;
  if (!id || !code || !nameEn) return null;

  return {
    id,
    code,
    name_en: nameEn,
    name_de: nullableString(raw.name_de),
    name_ru: nullableString(raw.name_ru),
    is_active: raw.is_active === undefined ? true : Boolean(raw.is_active),
    sort_order: numberValue(raw.sort_order) ?? 1000,
    is_primary: raw.is_primary === undefined ? undefined : Boolean(raw.is_primary),
  };
}

function normalizeCounts(rawCounts: unknown, row: Record<string, unknown>): ProviderPeopleCounts {
  const source = objectOrEmpty(rawCounts);
  const counts: ProviderPeopleCounts = {};

  for (const [key, value] of Object.entries(source)) {
    const numeric = numberValue(value);
    if (numeric !== undefined) counts[key] = numeric;
  }

  for (const key of COUNT_FIELDS) {
    if (counts[key] !== undefined) continue;
    const numeric = numberValue(row[key]);
    if (numeric !== undefined) counts[key] = numeric;
  }

  return counts;
}

function normalizeProviderPeopleRow(value: unknown): ProviderPeopleRow {
  const raw = objectOrEmpty(value);
  const provider = objectOrEmpty(raw.provider);
  const personId =
    nullableString(raw.person_id) ??
    nullableString(raw.id) ??
    nullableString(raw.doctor_id) ??
    nullableString(raw.staff_id) ??
    "";

  return {
    person_type: normalizePersonType(raw.person_type),
    person_id: personId,
    provider_id: stringValue(raw.provider_id ?? provider.id),
    provider_name: stringValue(raw.provider_name ?? provider.name),
    provider_type: normalizeProviderType(raw.provider_type ?? provider.provider_type),
    name: stringValue(raw.name),
    first_name: nullableString(raw.first_name),
    last_name: nullableString(raw.last_name),
    display_name: nullableString(raw.display_name),
    title: nullableString(raw.title),
    role_code: nullableString(raw.role_code ?? raw.role),
    role_label: nullableString(raw.role_label),
    subrole: nullableString(raw.subrole),
    gender: normalizeGender(raw.gender),
    opening_hours: nullableString(raw.opening_hours),
    fachbereich: nullableString(raw.fachbereich),
    specializations: arrayOrEmpty(raw.specializations).flatMap((item) => {
      const specialization = normalizeSpecialization(item);
      return specialization ? [specialization] : [];
    }),
    languages: arrayOrEmpty(raw.languages).flatMap((item) => {
      const language = nullableString(item);
      return language ? [language] : [];
    }),
    phone: nullableString(raw.phone),
    email: nullableString(raw.email),
    contacts: arrayOrEmpty(raw.contacts).flatMap((item) => {
      const contact = normalizeContact(item);
      return contact ? [contact] : [];
    }),
    department: nullableString(raw.department),
    status: normalizeStaffStatus(raw.status),
    license_number: nullableString(raw.license_number),
    licensing_country: nullableString(raw.licensing_country),
    licensing_valid_until: nullableString(raw.licensing_valid_until),
    notes: nullableString(raw.notes),
    counts: normalizeCounts(raw.counts, raw),
    last_interaction_at: nullableString(raw.last_interaction_at),
  };
}

function normalizeProviderPeopleResponse(raw: unknown): ProviderPeopleResponse {
  if (Array.isArray(raw)) {
    return raw.map(normalizeProviderPeopleRow);
  }

  const envelope = objectOrEmpty(raw);
  const rows = envelope.rows ?? envelope.items ?? envelope.data;
  if (Array.isArray(rows)) {
    return rows.map(normalizeProviderPeopleRow);
  }

  throw new Error("Invalid provider people response");
}

function normalizePatientOption(value: unknown): ProviderPeoplePatientOption | null {
  const raw = objectOrEmpty(value);
  const id = nullableString(raw.id);
  const patientId = nullableString(raw.patient_id);
  if (!id || !patientId) return null;

  return {
    id,
    patient_id: patientId,
    first_name: stringValue(raw.first_name),
    last_name: stringValue(raw.last_name),
  };
}

function setQueryParam(params: URLSearchParams, key: string, value: string) {
  const trimmed = value.trim();
  if (trimmed) params.set(key, trimmed);
}

export function buildProviderPeopleQuery(filters: Partial<ProviderPeopleFilters> = {}) {
  const next = { ...DEFAULT_PROVIDER_PEOPLE_FILTERS, ...filters };
  const params = new URLSearchParams();

  setQueryParam(params, "search", next.search);
  setQueryParam(params, "person_type", next.personType);
  setQueryParam(params, "provider_id", next.providerId);
  setQueryParam(params, "provider_type", next.providerType);
  setQueryParam(params, "gender", next.gender);
  setQueryParam(params, "fachbereich", next.fachbereich);
  setQueryParam(params, "specialization", next.specialization);
  setQueryParam(params, "role", next.role);
  setQueryParam(params, "patient_id", next.patientId);

  const query = params.toString();
  return query ? `/provider-people?${query}` : "/provider-people";
}

export function fetchProviderPeople(
  filtersOrPath: Partial<ProviderPeopleFilters> | string = DEFAULT_PROVIDER_PEOPLE_FILTERS,
) {
  const path =
    typeof filtersOrPath === "string"
      ? filtersOrPath
      : buildProviderPeopleQuery(filtersOrPath);

  return apiFetch<unknown>(path).then(normalizeProviderPeopleResponse);
}

export function fetchProviderPeoplePatients() {
  return apiFetch<unknown[]>("/patients", { cacheTtlMs: 60_000 }).then((rows) =>
    rows.flatMap((row) => {
      const patient = normalizePatientOption(row);
      return patient ? [patient] : [];
    }),
  );
}
