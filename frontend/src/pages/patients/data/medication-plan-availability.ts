import type { ClinicalMedication } from "./patient-clinical";

type PlanMedication = Pick<ClinicalMedication, "status" | "on_hold" | "einnahme_von" | "einnahme_bis">;

export function hasCurrentPlanMedications(medications: readonly PlanMedication[], now = new Date()): boolean {
  // Match get_patient_medikationsplan_pdf: inclusive intake dates in Berlin,
  // active status only, and no medication currently on hold.
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  return medications.some((medication) => {
    const from = medication.einnahme_von?.trim();
    const until = medication.einnahme_bis?.trim();
    return medication.status === "aktiv" && !medication.on_hold
      && (!from || from <= today) && (!until || until >= today);
  });
}
