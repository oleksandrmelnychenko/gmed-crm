import { apiFetch } from "@/lib/api";
import type { DoctorOption } from "@/pages/appointments/model/types";

const PROVIDER_DOCTORS_CACHE_TTL_MS = 120_000;

export async function getProviderDoctors(providerId: string) {
  return apiFetch<DoctorOption[]>(`/providers/${providerId}/doctors`, {
    cacheTtlMs: PROVIDER_DOCTORS_CACHE_TTL_MS,
  });
}
