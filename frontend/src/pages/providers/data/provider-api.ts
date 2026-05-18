import { apiFetch } from "@/lib/api";

import type {
  CreateResponse,
  ProviderDetail,
  ProviderStaffRoleItem,
  ProviderSummary,
  SpecializationItem,
} from "../model/types";

type JsonPayload = Record<string, unknown>;

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeSpecializationItem<T extends SpecializationItem>(item: T): T {
  return {
    ...item,
    is_active: item.is_active ?? true,
    sort_order: item.sort_order ?? 1000,
  };
}

function normalizeProviderDetail(raw: ProviderDetail): ProviderDetail {
  return {
    ...raw,
    organization_level: raw.organization_level || "organization",
    parent_provider_id: raw.parent_provider_id ?? null,
    parent_provider_name: raw.parent_provider_name ?? null,
    specializations: arrayOrEmpty<ProviderDetail["specializations"][number]>(raw.specializations).map(normalizeSpecializationItem),
    contacts: arrayOrEmpty<ProviderDetail["contacts"][number]>(raw.contacts),
    doctors: arrayOrEmpty<ProviderDetail["doctors"][number]>(raw.doctors).map((doctor) => ({
      ...doctor,
      first_name: doctor.first_name ?? null,
      last_name: doctor.last_name ?? null,
      display_name: doctor.display_name ?? doctor.name ?? null,
      role_code: doctor.role_code ?? null,
      role_label: doctor.role_label ?? null,
      gender: doctor.gender === "male" || doctor.gender === "female" ? doctor.gender : "unknown",
      opening_hours: doctor.opening_hours ?? null,
      specializations: arrayOrEmpty<ProviderDetail["doctors"][number]["specializations"][number]>(doctor.specializations).map(normalizeSpecializationItem),
      contacts: arrayOrEmpty<ProviderDetail["doctors"][number]["contacts"][number]>(doctor.contacts),
      relationships: arrayOrEmpty<ProviderDetail["doctors"][number]["relationships"][number]>(doctor.relationships),
    })),
    services: arrayOrEmpty<ProviderDetail["services"][number]>(raw.services).map((service) => ({
      ...service,
      price: String(service.price ?? ""),
      price_type: service.price_type || "fixed",
      price_from: service.price_from === null || service.price_from === undefined ? null : String(service.price_from),
      price_to: service.price_to === null || service.price_to === undefined ? null : String(service.price_to),
      currency: service.currency || "EUR",
    })),
    staff: arrayOrEmpty<ProviderDetail["staff"][number]>(raw.staff).map((staff) => ({
      ...staff,
      first_name: staff.first_name ?? null,
      last_name: staff.last_name ?? null,
      department: staff.department ?? null,
      gender: staff.gender === "male" || staff.gender === "female" ? staff.gender : "unknown",
      opening_hours: staff.opening_hours ?? null,
      contacts: arrayOrEmpty<ProviderDetail["staff"][number]["contacts"][number]>(staff.contacts),
    })),
    children: arrayOrEmpty<ProviderDetail["children"][number]>(raw.children),
    linked_patients: arrayOrEmpty<ProviderDetail["linked_patients"][number]>(raw.linked_patients),
    interactions: arrayOrEmpty<ProviderDetail["interactions"][number]>(raw.interactions),
  };
}

function postJson<T>(path: string, payload: JsonPayload) {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function post(path: string) {
  return apiFetch<void>(path, { method: "POST" });
}

export function fetchProviders(path: string) {
  return apiFetch<unknown>(path).then((rows) => {
    if (!Array.isArray(rows)) {
      throw new Error("Invalid providers response");
    }
    return (rows as ProviderSummary[]).map((provider) => ({
      ...provider,
      organization_level: provider.organization_level || "organization",
      parent_provider_id: provider.parent_provider_id ?? null,
      parent_provider_name: provider.parent_provider_name ?? null,
      specializations: arrayOrEmpty<ProviderSummary["specializations"][number]>(provider.specializations).map(normalizeSpecializationItem),
    }));
  });
}

export function fetchSpecializations() {
  return apiFetch<SpecializationItem[]>("/providers/specializations").then((items) =>
    items.map(normalizeSpecializationItem),
  );
}

export function fetchSpecializationsForAdmin() {
  return apiFetch<SpecializationItem[]>("/providers/specializations?include_inactive=true").then((items) =>
    items.map(normalizeSpecializationItem),
  );
}

export function createSpecialization(payload: JsonPayload) {
  return postJson<CreateResponse>("/providers/specializations", payload);
}

export function updateSpecialization(specializationId: string, payload: JsonPayload) {
  return postJson<void>(`/providers/specializations/${specializationId}/update`, payload);
}

export function setSpecializationActive(specializationId: string, active: boolean) {
  return post(`/providers/specializations/${specializationId}/${active ? "activate" : "deactivate"}`);
}

export function deleteSpecialization(specializationId: string) {
  return post(`/providers/specializations/${specializationId}/delete`);
}

export function fetchProviderStaffRoles(includeInactive = false) {
  const path = includeInactive
    ? "/providers/staff-roles?include_inactive=true"
    : "/providers/staff-roles";
  return apiFetch<ProviderStaffRoleItem[]>(path);
}

export function fetchProviderDetail(id: string) {
  return apiFetch<ProviderDetail>(`/providers/${id}`).then(normalizeProviderDetail);
}

export function createProvider(payload: JsonPayload) {
  return postJson<CreateResponse>("/providers", payload);
}

export function updateProvider(id: string, payload: JsonPayload) {
  return postJson<void>(`/providers/${id}/update`, payload);
}

export function setProviderActive(id: string, active: boolean) {
  return post(`/providers/${id}/${active ? "activate" : "deactivate"}`);
}

export function deleteProvider(id: string) {
  return post(`/providers/${id}/delete`);
}

export function saveProviderDoctor(
  providerId: string,
  doctorId: string,
  payload: JsonPayload,
) {
  const path = doctorId
    ? `/providers/${providerId}/doctors/${doctorId}/update`
    : `/providers/${providerId}/doctors`;
  return postJson<void>(path, payload);
}

export function deleteProviderDoctor(providerId: string, doctorId: string) {
  return post(`/providers/${providerId}/doctors/${doctorId}/delete`);
}

export function saveProviderDoctorRelationship(
  providerId: string,
  doctorId: string,
  relationshipId: string,
  payload: JsonPayload,
) {
  const path = relationshipId
    ? `/providers/${providerId}/doctors/${doctorId}/relationships/${relationshipId}/update`
    : `/providers/${providerId}/doctors/${doctorId}/relationships`;
  return postJson<CreateResponse | void>(path, payload);
}

export function deleteProviderDoctorRelationship(
  providerId: string,
  doctorId: string,
  relationshipId: string,
) {
  return post(`/providers/${providerId}/doctors/${doctorId}/relationships/${relationshipId}/delete`);
}

export function saveProviderStaff(
  providerId: string,
  staffId: string,
  payload: JsonPayload,
) {
  const path = staffId
    ? `/providers/${providerId}/staff/${staffId}/update`
    : `/providers/${providerId}/staff`;
  return postJson<void>(path, payload);
}

export function deleteProviderStaff(providerId: string, staffId: string) {
  return post(`/providers/${providerId}/staff/${staffId}/delete`);
}

export function createProviderStaffRole(payload: JsonPayload) {
  return postJson<CreateResponse>("/providers/staff-roles", payload);
}

export function updateProviderStaffRole(roleId: string, payload: JsonPayload) {
  return postJson<void>(`/providers/staff-roles/${roleId}/update`, payload);
}

export function setProviderStaffRoleActive(roleId: string, active: boolean) {
  return post(`/providers/staff-roles/${roleId}/${active ? "activate" : "deactivate"}`);
}

export function saveProviderService(
  providerId: string,
  serviceId: string,
  payload: JsonPayload,
) {
  const path = serviceId
    ? `/providers/${providerId}/services/${serviceId}/update`
    : `/providers/${providerId}/services`;
  return postJson<void>(path, payload);
}

export function deleteProviderService(providerId: string, serviceId: string) {
  return post(`/providers/${providerId}/services/${serviceId}/delete`);
}
