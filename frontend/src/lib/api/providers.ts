import { get, post, postNoBody } from "./client";
import type {
  ProviderListItem,
  ProviderDetail,
  DoctorDetail,
  CreateResponse,
  UpsertProviderBody,
  UpsertDoctorBody,
  UpsertServiceBody,
  ProviderOption,
} from "./types";

export interface ProviderSearchParams {
  search?: string;
  provider_type?: string;
  city?: string;
  country?: string;
  fachbereich?: string;
  doctor_name?: string;
  doctor_fachbereich?: string;
  service_name?: string;
  has_contract?: string;
}

export function fetchProviders(params?: ProviderSearchParams): Promise<ProviderListItem[]> {
  const q = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) q.set(k, v);
    }
  }
  const qs = q.toString();
  return get<ProviderListItem[]>(`/providers${qs ? `?${qs}` : ""}`);
}

/** Simplified provider list for dropdowns */
export function fetchProviderOptions(): Promise<ProviderOption[]> {
  return get<ProviderOption[]>("/providers");
}

export function fetchProviderDetail(id: string): Promise<ProviderDetail> {
  return get<ProviderDetail>(`/providers/${id}`);
}

export function createProvider(body: UpsertProviderBody): Promise<CreateResponse> {
  return post<CreateResponse>("/providers", body);
}

export function updateProvider(id: string, body: UpsertProviderBody): Promise<unknown> {
  return post(`/providers/${id}/update`, body);
}

export function toggleProviderActive(id: string): Promise<void> {
  return postNoBody(`/providers/${id}/toggle-active`);
}

export function deleteProvider(id: string): Promise<void> {
  return postNoBody(`/providers/${id}/delete`);
}

// -- Doctors --

export function fetchDoctorDetail(
  providerId: string,
  doctorId: string
): Promise<DoctorDetail> {
  return get<DoctorDetail>(`/providers/${providerId}/doctors/${doctorId}`);
}

export function createDoctor(
  providerId: string,
  body: UpsertDoctorBody
): Promise<CreateResponse> {
  return post<CreateResponse>(`/providers/${providerId}/doctors`, body);
}

export function updateDoctor(
  providerId: string,
  doctorId: string,
  body: UpsertDoctorBody
): Promise<unknown> {
  return post(`/providers/${providerId}/doctors/${doctorId}/update`, body);
}

export function deleteDoctor(providerId: string, doctorId: string): Promise<void> {
  return postNoBody(`/providers/${providerId}/doctors/${doctorId}/delete`);
}

// -- Services --

export function createService(
  providerId: string,
  body: UpsertServiceBody
): Promise<CreateResponse> {
  return post<CreateResponse>(`/providers/${providerId}/services`, body);
}

export function updateService(
  providerId: string,
  serviceId: string,
  body: UpsertServiceBody
): Promise<unknown> {
  return post(`/providers/${providerId}/services/${serviceId}/update`, body);
}

export function deleteService(providerId: string, serviceId: string): Promise<void> {
  return postNoBody(`/providers/${providerId}/services/${serviceId}/delete`);
}
