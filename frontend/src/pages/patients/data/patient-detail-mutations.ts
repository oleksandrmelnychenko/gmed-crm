import { apiFetch, downloadApiFile } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import type { RelationItem } from "../model/detail-tab-types";

export const PATIENT_RELATIONS_UPDATED_EVENT = "gmed:patient-relations-updated";

export function fetchPatientRelations(patientId: string) {
  return apiFetch<RelationItem[]>(`/patients/${patientId}/relations`);
}

export async function upsertPatientRelation(
  patientId: string,
  payload: Record<string, unknown>,
  relationId?: string | null,
): Promise<RelationItem> {
  try {
    return await apiFetch<RelationItem>(
      relationId
        ? `/patients/${patientId}/relations/${relationId}/update`
        : `/patients/${patientId}/relations`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  } catch (error) {
    throw relationMutationError(error);
  }
}

export async function uploadPatientDocument(formData: FormData) {
  return apiFetch("/documents/upload", {
    method: "POST",
    body: formData,
  });
}

export async function completePatientWorkflowChecklistItem(patientId: string, itemId: string) {
  return apiFetch(`/patients/${patientId}/workflow-checklist/${itemId}/complete`, {
    method: "POST",
  });
}

export async function createPatientWorkflowChecklistItem(
  patientId: string,
  payload: Record<string, unknown>,
) {
  return apiFetch(`/patients/${patientId}/workflow-checklist`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Released invoices are addressed to this relative (§ 14 UStG, GoBD): the
 * relation can be edited but not deleted or linked to another person.
 */
export function relationMutationError(error: unknown): unknown {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (code !== "relation_used_by_released_invoice") return error;
  return new Error(
    getLang() === "de"
      ? "An diese Person sind ausgestellte Rechnungen adressiert. Sie kann nicht gelöscht oder mit einer anderen Person verknüpft werden."
      : "На этого человека выставлены выпущенные счета: его нельзя удалить или связать с другим пациентом.",
  );
}

export async function deletePatientRelation(patientId: string, relationId: string) {
  try {
    return await apiFetch(`/patients/${patientId}/relations/${relationId}/delete`, {
      method: "POST",
    });
  } catch (error) {
    throw relationMutationError(error);
  }
}

export type CreatedFrameworkContract = {
  id: string;
  contract_number?: string;
  status?: string;
  idempotent_replay?: boolean;
};

export async function createFrameworkContract(payload: Record<string, unknown>) {
  return apiFetch<CreatedFrameworkContract>("/framework-contracts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateFrameworkContractStatus(
  contractId: string,
  payload: Record<string, unknown>,
) {
  return apiFetch(`/framework-contracts/${contractId}/status`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateInvoiceStatus(invoiceId: string, payload: Record<string, unknown>) {
  return apiFetch(`/invoices/${invoiceId}/status`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createInvoiceDunningEvent<T>(
  invoiceId: string,
  payload: Record<string, unknown>,
) {
  return apiFetch<T>(`/invoices/${invoiceId}/dunning`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function exportPatientComplianceArchive(patientId: string, filename: string) {
  return downloadApiFile(`/admin/compliance/patient/${patientId}/export?format=zip`, filename);
}

export async function fetchPatientLabelPayload<T>(patientId: string, format: string) {
  return apiFetch<T>(`/patients/${patientId}/label?format=${encodeURIComponent(format)}`);
}

export async function updatePatientMedicalOrderLifecycle(
  patientId: string,
  medicalOrderId: string,
  status: "completed" | "cancelled",
) {
  return apiFetch(`/patients/${patientId}/medical-orders/${medicalOrderId}/update`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export async function revokePatientAssignment(patientId: string, userId: string) {
  return apiFetch(`/patients/${patientId}/revoke`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}
