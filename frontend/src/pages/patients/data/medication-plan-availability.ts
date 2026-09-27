import { appDateKey } from "@/lib/app-time-zone";
import type { ClinicalMedication } from "./patient-clinical";

type PlanMedication = Pick<ClinicalMedication, "status" | "on_hold" | "einnahme_von" | "einnahme_bis">;

export function hasCurrentPlanMedications(medications: readonly PlanMedication[], now = new Date()): boolean {
  // Match get_patient_medikationsplan_pdf: inclusive intake dates in Berlin,
  // active status only, and no medication currently on hold.
  const today = appDateKey(now);
  return medications.some((medication) => {
    const from = medication.einnahme_von?.trim();
    const until = medication.einnahme_bis?.trim();
    return medication.status === "aktiv" && !medication.on_hold
      && (!from || from <= today) && (!until || until >= today);
  });
}
