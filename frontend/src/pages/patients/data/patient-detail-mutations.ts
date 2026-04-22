import { apiFetch, downloadApiFile } from "@/lib/api";

export async function upsertPatientRelation(
  patientId: string,
  payload: Record<string, unknown>,
  relationId?: string | null,
) {
  return apiFetch(
    relationId
      ? `/patients/${patientId}/relations/${relationId}/update`
      : `/patients/${patientId}/relations`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
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

export async function deletePatientRelation(patientId: string, relationId: string) {
  return apiFetch(`/patients/${patientId}/relations/${relationId}/delete`, {
    method: "POST",
  });
}

export async function createFrameworkContract(payload: Record<string, unknown>) {
  return apiFetch("/framework-contracts", {
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
