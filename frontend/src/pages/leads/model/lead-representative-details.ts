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

/** Whether one field of the form holds the same value in both (spacing and the citizenship order aside). */
function sameDetail(key: keyof RepresentativeDetails, a: RepresentativeDetails, b: RepresentativeDetails): boolean {
  return key === "citizenships"
    ? normalizeCitizenships(a.citizenships).join() === normalizeCitizenships(b.citizenships).join()
    : oneLine(a[key]) === oneLine(b[key]);
}

/** Whether staff changed anything against what the form loaded. */
export function representativeDetailsChanged(draft: RepresentativeDetails, loaded: RepresentativeDetails): boolean {
  return TEXT_KEYS.some((key) => !sameDetail(key, draft, loaded)) || !sameDetail("citizenships", draft, loaded);
}

/**
 * A newer server state (`fresh`) while staff edit: a field staff left as
 * loaded takes the fresh value (and the fresh value becomes its base, so the
 * save does not write it); a field staff typed in keeps the typed value with
 * its old base (DEV 2026-10-24: the save sent the old values of the untouched
 * fields with the new base and the server wrote the cabinet's change back).
 * `conflict` is true when the server changed a field staff typed in too.
 */
export function mergeRepresentativeDetails(
  draft: RepresentativeDetails,
  loaded: RepresentativeDetails,
  fresh: RepresentativeDetails,
): { draft: RepresentativeDetails; loaded: RepresentativeDetails; changedMeanwhile: boolean; conflict: boolean } {
  const nextDraft = { ...draft };
  const nextLoaded = { ...loaded };
  let changedMeanwhile = false;
  let conflict = false;
  for (const key of [...TEXT_KEYS, "citizenships"] as const) {
    const serverChanged = !sameDetail(key, loaded, fresh);
    if (serverChanged) changedMeanwhile = true;
    if (sameDetail(key, draft, loaded)) {
      (nextDraft as Record<string, unknown>)[key] = fresh[key];
      (nextLoaded as Record<string, unknown>)[key] = fresh[key];
    } else if (serverChanged) {
      conflict = true;
    }
  }
  return { draft: nextDraft, loaded: nextLoaded, changedMeanwhile, conflict };
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

/** Nothing entered yet: the form of a parent who is not on file. */
export const EMPTY_REPRESENTATIVE_DETAILS: RepresentativeDetails = {
  birth_place: "",
  birth_country: "",
  citizenships: [],
  street: "",
  zip: "",
  city: "",
  country: "",
};

export type PendingRepresentativeDetails = { id: string; values: RepresentativeDetails; base: RepresentativeDetails };

/**
 * The details staff entered on a parent's card before the server knew the
 * parent (a new card, mode «Заполняю сам»; walk-through 2026-10-24): those
 * whose parent is now on file are written as a change against what the
 * server has. A parent still missing stays pending; an entry without a
 * change is nothing to write.
 */
export function pendingRepresentativeDetailsReady(
  pending: ReadonlyMap<string, RepresentativeDetails>,
  representatives: readonly LeadRepresentative[],
): PendingRepresentativeDetails[] {
  const ready: PendingRepresentativeDetails[] = [];
  for (const [id, values] of pending) {
    const person = representatives.find((item) => item.id === id);
    if (!person) continue;
    const base = representativeDetailsOf(person);
    if (!representativeDetailsChanged(values, base)) continue;
    ready.push({ id, values, base });
  }
  return ready;
}
