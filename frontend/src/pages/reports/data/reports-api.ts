import { apiFetch, apiFetchFile } from "@/lib/api";

const REPORTS_WORKSPACE_CACHE_TTL_MS = 30_000;

export async function fetchReportsWorkspace<TWorkspace, TForecast>() {
  const [payload, forecastPayload] = await Promise.all([
    apiFetch<TWorkspace>("/stats/reports/workspace", {
      cacheTtlMs: REPORTS_WORKSPACE_CACHE_TTL_MS,
    }),
    apiFetch<TForecast>("/stats/forecasting", {
      cacheTtlMs: REPORTS_WORKSPACE_CACHE_TTL_MS,
    }),
  ]);
  return { payload, forecastPayload };
}

export async function fetchReportsExport(
  section: string,
  selectedClinicId: string,
  exportError: string,
) {
  const params = new URLSearchParams({ section });
  if ((section === "doctors" || section === "provider_costs") && selectedClinicId) {
    params.set("provider_id", selectedClinicId);
  }

  const { blob, filename } = await apiFetchFile(
    `/stats/reports/export?${params.toString()}`,
  ).catch((error) => {
    throw error instanceof Error ? error : new Error(exportError);
  });

  return { blob, filename: filename ?? `${section}.csv` };
}
