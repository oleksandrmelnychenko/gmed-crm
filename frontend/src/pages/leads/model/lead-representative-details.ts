import { normalizeCitizenships } from "@/components/ui/citizenship-multi-select";
import { PERSON_CITY_MAX, oneLine } from "@/lib/person-fields";

import type { LeadRepresentative } from "../data/lead-portal-intake-api";
import type { RepresentativeDetails } from "../data/lead-representation-api";

/**
 * A representative's birth data, citizenships and address as staff edit them
 * in the wizard (owner 2026-10-24): the parts the GwG sheet and the consent
 * form print. The server writes only what staff changed since loading.
 */
export function representativeDetailsOf(person: Pick<LeadRepresentative, "birth_place" | "birth_country" | "citizenships" | "street" | "zip" | "city" | "country">): RepresentativeDetails {
  return {
    birth_place: person.birth_place ?? "",
    birth_country: person.birth_country ?? "",
    citizenships: normalizeCitizenships(person.citizenships ?? []),
    street: person.street ?? "",
    zip: person.zip ?? "",
    city: person.city ?? "",
    country: person.country ?? "",
  };
}

const TEXT_KEYS = ["birth_place", "birth_country", "street", "zip", "city", "country"] as const;

/** Whether staff changed anything against what the form loaded. */
export function representativeDetailsChanged(draft: RepresentativeDetails, loaded: RepresentativeDetails): boolean {
  return TEXT_KEYS.some((key) => oneLine(draft[key]) !== oneLine(loaded[key]))
    || normalizeCitizenships(draft.citizenships).join() !== normalizeCitizenships(loaded.citizenships).join();
}

/** What the shared rules refuse in a changed value (the server checks the same). */
export function representativeDetailsErrors(draft: RepresentativeDetails, loaded: RepresentativeDetails): Partial<Record<keyof RepresentativeDetails, "too_long">> {
  const errors: Partial<Record<keyof RepresentativeDetails, "too_long">> = {};
  if (oneLine(draft.city) !== oneLine(loaded.city) && oneLine(draft.city).length > PERSON_CITY_MAX) errors.city = "too_long";
  if (oneLine(draft.birth_place) !== oneLine(loaded.birth_place) && oneLine(draft.birth_place).length > 200) errors.birth_place = "too_long";
  if (oneLine(draft.street) !== oneLine(loaded.street) && oneLine(draft.street).length > 200) errors.street = "too_long";
  if (oneLine(draft.zip) !== oneLine(loaded.zip) && oneLine(draft.zip).length > 20) errors.zip = "too_long";
  return errors;
}
