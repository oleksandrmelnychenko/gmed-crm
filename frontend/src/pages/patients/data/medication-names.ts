import { apiFetch } from "@/lib/api";

export type MedicationNameField = "handelsname" | "wirkstoff";
export type MedicationNameSuggestions = { items: string[]; has_more: boolean };

export type MedicationPairConfirmation = { handelsname: string; wirkstoff: string };
export type MedicationPairReview = {
  known_pair: boolean;
  handelsname: { exact: string | null; similar: string[] };
  wirkstoff: { exact: string | null; similar: string[] };
};

export async function checkMedicationPair(pair: MedicationPairConfirmation, signal?: AbortSignal) {
  const result = await apiFetch<MedicationPairReview>(`/medication-name-pairs/check?${new URLSearchParams(pair)}`, { cache: "no-store", signal });
  if (!result || typeof result.known_pair !== "boolean" || [result.handelsname, result.wirkstoff].some(field =>
    !field || (field.exact !== null && typeof field.exact !== "string") || !Array.isArray(field.similar)
      || field.similar.some(name => typeof name !== "string" || !name.trim()))) {
    throw new Error("Invalid medication pair review");
  }
  return result;
}

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
