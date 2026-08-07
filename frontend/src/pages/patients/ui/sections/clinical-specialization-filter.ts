import type {
  ClinicalDiagnosis,
  ClinicalExamination,
  ClinicalNarrative,
} from "@/pages/patients/data/patient-clinical";
import type { SpecializationItem } from "@/pages/providers/model/types";

export type SpecializedClinicalRecord = {
  id?: string | null;
  cid?: string;
  specialization_ids?: string[];
  specializations?: SpecializationItem[];
};

export function clinicalRecordSpecializationIds(record: SpecializedClinicalRecord): string[] {
  return Array.from(
    new Set([
      ...(record.specialization_ids ?? []),
      ...(record.specializations ?? []).map((item) => item.id),
    ]),
  );
}

export function collectAttachedClinicalSpecializations(
  records: Array<SpecializedClinicalRecord | null | undefined>,
  directory: SpecializationItem[],
): SpecializationItem[] {
  const directoryById = new Map(directory.map((item) => [item.id, item]));
  const attached = new Map<string, SpecializationItem>();
  for (const record of records) {
    if (!record) continue;
    for (const item of record.specializations ?? []) attached.set(item.id, item);
    for (const id of record.specialization_ids ?? []) {
      const item = directoryById.get(id);
      if (item && !attached.has(id)) attached.set(id, item);
    }
  }
  return Array.from(attached.values()).sort(
    (a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code),
  );
}

export function recordMatchesClinicalSpecialization(
  record: SpecializedClinicalRecord,
  specializationId: string | null,
): boolean {
  if (!specializationId) return true;
  const ids = clinicalRecordSpecializationIds(record);
  return ids.includes(specializationId);
}

export function clinicalSpecializationFilterAllowsEditing(
  specializationId: string | null,
): boolean {
  return specializationId === null;
}

export function filterClinicalRecords<T extends SpecializedClinicalRecord>(
  records: T[],
  specializationId: string | null,
): T[] {
  return records.filter((record) =>
    recordMatchesClinicalSpecialization(record, specializationId),
  );
}

export function filterClinicalDiagnosisTree(
  diagnoses: ClinicalDiagnosis[],
  specializationId: string | null,
): ClinicalDiagnosis[] {
  if (!specializationId) return diagnoses;
  const keyOf = (item: ClinicalDiagnosis) => item.id ?? item.cid ?? null;
  const byKey = new Map(
    diagnoses
      .map((item) => [keyOf(item), item] as const)
      .filter((entry): entry is [string, ClinicalDiagnosis] => Boolean(entry[0])),
  );
  const included = new Set<string>();
  for (const item of diagnoses) {
    if (!clinicalRecordSpecializationIds(item).includes(specializationId)) continue;
    let current: ClinicalDiagnosis | undefined = item;
    while (current) {
      const key = keyOf(current);
      if (!key || included.has(key)) break;
      included.add(key);
      const parentKey: string | null = current.parent_id ?? current.parent_cid ?? null;
      current = parentKey ? byKey.get(parentKey) : undefined;
    }
  }
  return diagnoses.filter((item) => {
    const key = keyOf(item);
    return Boolean(key && included.has(key));
  });
}

export function mergeFilteredClinicalRecords<T extends SpecializedClinicalRecord>(
  allRecords: T[],
  visibleRecords: T[],
  nextVisibleRecords: T[],
): T[] {
  const key = (record: T) => record.id ?? record.cid ?? null;
  const visibleKeys = new Set(visibleRecords.map(key).filter(Boolean));
  const nextByKey = new Map(
    nextVisibleRecords
      .map((record) => [key(record), record] as const)
      .filter((entry): entry is [string, T] => Boolean(entry[0])),
  );
  const merged: T[] = [];
  for (const record of allRecords) {
    const recordKey = key(record);
    if (!recordKey || !visibleKeys.has(recordKey)) {
      merged.push(record);
      continue;
    }
    const replacement = nextByKey.get(recordKey);
    if (replacement) merged.push(replacement);
  }
  const existingKeys = new Set(allRecords.map(key).filter(Boolean));
  merged.push(...nextVisibleRecords.filter((record) => {
    const recordKey = key(record);
    return !recordKey || !existingKeys.has(recordKey);
  }));
  return merged;
}

export function filterClinicalNarrative(
  narrative: ClinicalNarrative | null,
  specializationId: string | null,
): ClinicalNarrative | null {
  if (!narrative || !specializationId) return narrative;
  const specializations = (narrative.specializations ?? []).filter(
    (item) => item.id === specializationId,
  );
  return {
    ...narrative,
    specialization_ids: specializations.map((item) => item.id),
    specializations,
  };
}

export function mergeFilteredClinicalNarrative(
  original: ClinicalNarrative | null,
  next: ClinicalNarrative,
  specializationId: string | null,
): ClinicalNarrative {
  if (!original || !specializationId) return next;
  const hidden = (original.specializations ?? []).filter(
    (item) => item.id !== specializationId,
  );
  const specializations = [...hidden, ...(next.specializations ?? [])];
  return {
    ...next,
    specialization_ids: specializations.map((item) => item.id),
    specializations,
  };
}

export function patientSpecializationRecords({
  diagnoses,
  examinations,
  narrative,
}: {
  diagnoses: ClinicalDiagnosis[];
  examinations: ClinicalExamination[];
  narrative: ClinicalNarrative | null;
}): Array<SpecializedClinicalRecord | null> {
  return [...diagnoses, ...examinations, narrative];
}
