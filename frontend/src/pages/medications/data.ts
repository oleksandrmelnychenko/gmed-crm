import { apiFetch } from "@/lib/api";

export type MedicationCatalogItem = {
  id: string;
  handelsname: string;
  wirkstoff: string;
  version: number;
};

export type MedicationCatalogPage = {
  items: MedicationCatalogItem[];
  total: number;
  page: number;
  page_size: number;
};

export function fetchMedicationCatalog(q: string, page: number, signal?: AbortSignal) {
  const params = new URLSearchParams({ q, page: String(page), page_size: "50" });
  return apiFetch<MedicationCatalogPage>(`/medication-name-pairs?${params}`, { cache: "no-store", signal });
}

export function saveMedicationCatalogItem(item: MedicationCatalogItem) {
  const creating = item.id === "new";
  return apiFetch<MedicationCatalogItem>(`/medication-name-pairs${creating ? "" : `/${encodeURIComponent(item.id)}`}`, {
    method: creating ? "POST" : "PATCH",
    body: JSON.stringify({ handelsname: item.handelsname, wirkstoff: item.wirkstoff, ...(!creating && { version: item.version }) }),
  });
}

export function deleteMedicationCatalogItem(item: MedicationCatalogItem) {
  return apiFetch<void>(`/medication-name-pairs/${encodeURIComponent(item.id)}`, {
    method: "DELETE",
    body: JSON.stringify({ version: item.version }),
  });
}
