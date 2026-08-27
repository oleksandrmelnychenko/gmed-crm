import { apiFetch } from "@/lib/api";
import type { PatientLabResult } from "@/pages/patients/model/detail-resource-types";

export type PatientLabResultCorrectionPayload = {
  measured_at: string;
  panel: string | null;
  laboratory_name: string | null;
  analyte_name: string;
  result_text: string;
  numeric_result: number | null;
  comparator: "<" | "<=" | "=" | ">=" | ">" | null;
  unit: string | null;
  reference_text: string | null;
  reference_low: number | null;
  reference_high: number | null;
  interpretation_note: string | null;
  abnormal_flag: PatientLabResult["abnormal_flag"];
  correction_note: string;
};

export async function updatePatientLabResult(
  patientId: string,
  labResultId: string,
  payload: PatientLabResultCorrectionPayload,
): Promise<PatientLabResult> {
  const response = await apiFetch<{ ok: true; item: PatientLabResult }>(
    `/patients/${patientId}/lab-results/${labResultId}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
  return response.item;
}

export async function deletePatientLabResult(
  patientId: string,
  labResultId: string,
  deletionNote: string,
): Promise<void> {
  await apiFetch<{ ok: true; id: string }>(
    `/patients/${patientId}/lab-results/${labResultId}`,
    {
      method: "DELETE",
      body: JSON.stringify({ deletion_note: deletionNote }),
    },
  );
}
