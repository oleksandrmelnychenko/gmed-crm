import type { ClinicalDiagnosis } from "@/pages/patients/data/patient-clinical";
import type { SpecializationItem } from "@/pages/providers/model/types";

export type SpecializedClinicalRecord = {
  specialization_ids?: string[];
  specializations?: SpecializationItem[];
};

export function diagnosesForCase(
  diagnoses: readonly ClinicalDiagnosis[],
  caseId: string,
): ClinicalDiagnosis[] {
  return diagnoses.filter((diagnosis) => diagnosis.case_id === caseId);
}

/**
 * Build the case-workspace specialization navigation from the patient's
 * diagnoses. A specialization can be assigned to many diagnoses, but it is
 * shown only once in the rail.
 */
export function collectDiagnosisSpecializations(
  diagnoses: readonly ClinicalDiagnosis[],
): SpecializationItem[] {
  return collectClinicalSpecializations(diagnoses);
}

export function collectClinicalSpecializations(
  records: readonly SpecializedClinicalRecord[],
): SpecializationItem[] {
  const items = new Map<string, SpecializationItem>();

  for (const record of records) {
    for (const specialization of record.specializations ?? []) {
      if (!items.has(specialization.id)) {
        items.set(specialization.id, specialization);
      }
    }
  }

  return [...items.values()].sort((left, right) => {
    const orderDifference = (left.sort_order ?? 0) - (right.sort_order ?? 0);
    if (orderDifference !== 0) return orderDifference;
    return left.code.localeCompare(right.code);
  });
}

export function diagnosesForSpecialization(
  diagnoses: readonly ClinicalDiagnosis[],
  specializationId: string,
): ClinicalDiagnosis[] {
  return diagnoses.filter((diagnosis) =>
    clinicalRecordHasSpecialization(diagnosis, specializationId),
  );
}

export function clinicalRecordHasSpecialization(
  record: SpecializedClinicalRecord,
  specializationId: string,
): boolean {
  return (
    record.specialization_ids?.includes(specializationId) ||
    record.specializations?.some(
      (specialization) => specialization.id === specializationId,
    ) ||
    false
  );
}
