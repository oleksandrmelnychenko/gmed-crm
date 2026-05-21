import { apiFetch, apiFetchFile } from "@/lib/api";

const REPORTS_WORKSPACE_CACHE_TTL_MS = 30_000;
const PROVIDER_REPORT_EXPORT_SECTIONS = new Set([
  "clinics",
  "medical_providers",
  "provider_costs",
  "doctors",
  "non_medical_providers",
]);

export async function fetchReportsWorkspace<TWorkspace, TForecast>(
  taxonomyNodeId?: string,
) {
  const params = new URLSearchParams();
  const trimmedTaxonomyNodeId = taxonomyNodeId?.trim();
  if (trimmedTaxonomyNodeId) {
    params.set("taxonomy_node_id", trimmedTaxonomyNodeId);
  }
  const query = params.toString();
  const workspacePath = query
    ? `/stats/reports/workspace?${query}`
    : "/stats/reports/workspace";

  const [payload, forecastPayload] = await Promise.all([
    apiFetch<TWorkspace>(workspacePath, {
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
  taxonomyNodeId?: string,
) {
  const params = new URLSearchParams({ section });
  if ((section === "doctors" || section === "provider_costs") && selectedClinicId) {
    params.set("provider_id", selectedClinicId);
  }
  const trimmedTaxonomyNodeId = taxonomyNodeId?.trim();
  if (trimmedTaxonomyNodeId && PROVIDER_REPORT_EXPORT_SECTIONS.has(section)) {
    params.set("taxonomy_node_id", trimmedTaxonomyNodeId);
  }

  const { blob, filename } = await apiFetchFile(
    `/stats/reports/export?${params.toString()}`,
  ).catch((error) => {
    throw error instanceof Error ? error : new Error(exportError);
  });

  return { blob, filename: filename ?? `${section}.csv` };
}
