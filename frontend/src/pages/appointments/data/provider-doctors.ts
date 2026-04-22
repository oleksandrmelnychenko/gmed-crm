import { apiFetch } from "@/lib/api";
import type { DoctorOption } from "@/pages/appointments/model/types";

const MAX_PROVIDER_DOCTORS_CACHE = 24;
const providerDoctorsCache = new Map<string, DoctorOption[]>();
const providerDoctorsInFlight = new Map<string, Promise<DoctorOption[]>>();

function rememberProviderDoctors(providerId: string, rows: DoctorOption[]) {
  if (providerDoctorsCache.has(providerId)) {
    providerDoctorsCache.delete(providerId);
  }
  providerDoctorsCache.set(providerId, rows);
  if (providerDoctorsCache.size > MAX_PROVIDER_DOCTORS_CACHE) {
    const oldestKey = providerDoctorsCache.keys().next().value;
    if (oldestKey) providerDoctorsCache.delete(oldestKey);
  }
}

export async function getProviderDoctors(providerId: string) {
  const cached = providerDoctorsCache.get(providerId);
  if (cached) {
    rememberProviderDoctors(providerId, cached);
    return cached;
  }

  const inFlight = providerDoctorsInFlight.get(providerId);
  if (inFlight) return inFlight;

  const request = apiFetch<DoctorOption[]>(`/providers/${providerId}/doctors`)
    .then((rows) => {
      rememberProviderDoctors(providerId, rows);
      providerDoctorsInFlight.delete(providerId);
      return rows;
    })
    .catch((error) => {
      providerDoctorsInFlight.delete(providerId);
      throw error;
    });

  providerDoctorsInFlight.set(providerId, request);
  return request;
}
