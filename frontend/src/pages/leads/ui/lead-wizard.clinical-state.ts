import type { ClinicalNarrative } from "@/pages/patients/data/patient-clinical";

/** Editing a previous episode's anamnesis must create a version for this episode. */
export function narrativeForIntakeSave(narrative: ClinicalNarrative, caseId: string): ClinicalNarrative {
  if (narrative.case_id === caseId) return narrative;
  return {
    ...narrative,
    id: null,
    case_id: caseId,
    source_document_id: null,
    source_document_name: null,
    source_import_id: null,
    anamnese_at: new Date().toISOString(),
    is_active: true,
    created_at: null,
    updated_at: null,
  };
}
