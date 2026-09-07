import { apiFetch } from "@/lib/api";

export type MedicationNameField = "handelsname" | "wirkstoff";
export type MedicationNameSuggestions = { items: string[]; has_more: boolean };

export async function fetchMedicationNames(
  field: MedicationNameField,
  query = "",
  related?: string,
  signal?: AbortSignal,
): Promise<MedicationNameSuggestions> {
  const params = new URLSearchParams({ field, q: query });
  if (related) params.set("related", related);
  const result = await apiFetch<MedicationNameSuggestions>(`/medication-names?${params}`, {
    cache: "no-store", signal,
  });
  if (!result || !Array.isArray(result.items) || typeof result.has_more !== "boolean"
      || result.items.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("Invalid medication name suggestions");
  }
  return result;
}

export function uniqueMedicationCounterpart(result: MedicationNameSuggestions) {
  return !result.has_more && result.items.length === 1 ? result.items[0] : null;
}
