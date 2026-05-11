import { apiFetch } from "@/lib/api";

import type {
  CreateResponse,
  ProviderDetail,
  ProviderSummary,
} from "../model/types";

type JsonPayload = Record<string, unknown>;

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeProviderDetail(raw: ProviderDetail): ProviderDetail {
  return {
    ...raw,
    doctors: arrayOrEmpty<ProviderDetail["doctors"][number]>(raw.doctors),
    services: arrayOrEmpty<ProviderDetail["services"][number]>(raw.services).map((service) => ({
      ...service,
      price: String(service.price ?? ""),
      currency: service.currency || "EUR",
    })),
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
    return rows as ProviderSummary[];
  });
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
