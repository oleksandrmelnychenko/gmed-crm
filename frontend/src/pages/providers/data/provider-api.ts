import { apiFetch } from "@/lib/api";

import type {
  AppointmentItem,
  CreateResponse,
  ProviderDetail,
  ProviderRouteDetail,
  ProviderSummary,
} from "../model/types";

type JsonPayload = Record<string, unknown>;

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
  return apiFetch<ProviderSummary[]>(path);
}

export function fetchProviderDetail(id: string) {
  return apiFetch<ProviderDetail>(`/providers/${id}`);
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

export function fetchProviderRouteDetail(id: string) {
  return apiFetch<ProviderRouteDetail>(`/providers/${id}`);
}

export function fetchProviderAppointments(providerId: string) {
  return apiFetch<AppointmentItem[]>(
    `/appointments?provider_id=${encodeURIComponent(providerId)}`,
  );
}

export function createProviderTemplate(providerId: string, payload: JsonPayload) {
  return postJson<{ id: string }>(`/providers/${providerId}/templates`, payload);
}

export function updateProviderTemplate(
  providerId: string,
  templateId: string,
  payload: JsonPayload,
) {
  return postJson<void>(`/providers/${providerId}/templates/${templateId}/update`, payload);
}
