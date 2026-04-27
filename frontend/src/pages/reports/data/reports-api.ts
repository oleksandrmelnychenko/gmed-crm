import { apiFetch, buildApiUrl, getAccessToken } from "@/lib/api";

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
  const token = getAccessToken();
  const params = new URLSearchParams({ section });
  if ((section === "doctors" || section === "provider_costs") && selectedClinicId) {
    params.set("provider_id", selectedClinicId);
  }

  const response = await fetch(buildApiUrl(`/stats/reports/export?${params.toString()}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error((await response.text()) || exportError);
  }

  const blob = await response.blob();
  const filename =
    response.headers
      .get("Content-Disposition")
      ?.match(/filename="?([^";]+)"?/)?.[1] ?? `${section}.csv`;

  return { blob, filename };
}
