import type { LeadPortalIntake, LeadUploadSlotKind } from "../data/lead-portal-intake-api";
import type { Tx } from "./lead-payer";
import { representativeName } from "./lead-gwg-statements";

/** A slot a cabinet file can be moved to: its kind, the person, the label. */
export type UploadMoveTarget = {
  /** `kind` or `kind:representativeId`, unique in the list. */
  value: string;
  kind: LeadUploadSlotKind;
  representativeId: string | null;
  label: string;
};

/**
 * The slots of the request a cabinet file can be moved to by staff (owner
 * 2026-10-24: a child's ID uploaded as a parent's): the lead's identity
 * copy, each representative's identity copy and proof of authority, the
 * proof of funds and the proof of the relationship to the payer.
 */
export function uploadMoveTargets(intake: Pick<LeadPortalIntake, "representation"> | null, tx: Tx): UploadMoveTarget[] {
  const targets: UploadMoveTarget[] = [
    { value: "identity", kind: "identity", representativeId: null, label: tx("Документ пациента", "Ausweis des Patienten") },
  ];
  for (const person of intake?.representation?.representatives ?? []) {
    const name = representativeName(person) || tx("представитель", "Vertreter/in");
    targets.push(
      {
        value: `representative_identity:${person.id}`,
        kind: "representative_identity",
        representativeId: person.id,
        label: `${tx("Документ", "Ausweis")} – ${name}`,
      },
      {
        value: `representative_authority:${person.id}`,
        kind: "representative_authority",
        representativeId: person.id,
        label: `${tx("Подтверждение полномочий", "Vertretungsnachweis")} – ${name}`,
      },
    );
  }
  targets.push(
    { value: "self_funds_proof", kind: "self_funds_proof", representativeId: null, label: tx("Подтверждение источника средств", "Nachweis der Mittelherkunft") },
    { value: "relationship_proof", kind: "relationship_proof", representativeId: null, label: tx("Подтверждение связи с плательщиком", "Nachweis der Beziehung zum Zahler") },
  );
  return targets;
}
