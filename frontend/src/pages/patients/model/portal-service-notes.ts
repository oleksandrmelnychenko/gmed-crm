import type { PortalConciergeServiceItem } from "./portal-shared";

export type PortalServiceNote = {
  /** `own`: what the patient wrote in the request; `care_team`: what staff wrote for the patient. */
  kind: "own" | "care_team";
  text: string;
};

/**
 * The notes of a service the patient reads on the portal, own note first.
 * The portal API carries only these two notes; the internal staff note never
 * reaches it (release QA S2-1, owner decision 2026-11-11).
 */
export function portalServiceNotes(
  item: Pick<PortalConciergeServiceItem, "patient_note" | "patient_visible_note">,
): PortalServiceNote[] {
  const notes: PortalServiceNote[] = [];
  const own = item.patient_note?.trim();
  if (own) notes.push({ kind: "own", text: own });
  const careTeam = item.patient_visible_note?.trim();
  if (careTeam) notes.push({ kind: "care_team", text: careTeam });
  return notes;
}
