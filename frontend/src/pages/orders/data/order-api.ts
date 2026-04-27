import { apiFetch } from "@/lib/api";

import type {
  CreateResponse,
  DoctorOption,
  OrderDebtQueueItem,
  OrderDetail,
  OrderSummary,
  PatientAssignmentOption,
  PatientOption,
  PatientOrderRecheck,
  ProviderDetailResponse,
  ProviderOption,
  SupportingDocumentOption,
  WorkflowChecklistResponse,
} from "../model/types";

type JsonPayload = Record<string, unknown>;

const ORDER_LOOKUPS_CACHE_TTL_MS = 60_000;

export type OrderDirectory = {
  patients: PatientOption[];
  providers: ProviderOption[];
};

export type OrderWorkspacePayload = {
  detail: OrderDetail;
  documents: SupportingDocumentOption[];
  workflow: WorkflowChecklistResponse | null;
  assignments: PatientAssignmentOption[];
};

function postJson<T>(path: string, payload: JsonPayload) {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function post(path: string) {
  return apiFetch<void>(path, { method: "POST" });
}

export async function fetchProviderDoctors(providerId: string): Promise<DoctorOption[]> {
  const detail = await apiFetch<ProviderDetailResponse>(`/providers/${providerId}`, {
    cacheTtlMs: ORDER_LOOKUPS_CACHE_TTL_MS,
  });
  return detail.doctors ?? [];
}

export async function fetchOrderDirectory(): Promise<OrderDirectory> {
  const [patients, providers] = await Promise.all([
    apiFetch<PatientOption[]>("/patients", {
      cacheTtlMs: ORDER_LOOKUPS_CACHE_TTL_MS,
    }),
    apiFetch<ProviderOption[]>("/providers", {
      cacheTtlMs: ORDER_LOOKUPS_CACHE_TTL_MS,
    }),
  ]);
  return { patients, providers };
}

export function fetchPatientOrderRecheck(patientId: string) {
  return apiFetch<PatientOrderRecheck>(`/patients/${patientId}/recheck`);
}

export function fetchOrders(path: string) {
  return apiFetch<OrderSummary[]>(path);
}

export function fetchOrderDebtQueue() {
  return apiFetch<OrderDebtQueueItem[]>("/orders/debt-management");
}

export async function fetchOrderWorkspace(
  orderId: string,
): Promise<OrderWorkspacePayload> {
  const [detail, documents, workflow] = await Promise.all([
    apiFetch<OrderDetail>(`/orders/${orderId}`),
    apiFetch<SupportingDocumentOption[]>(`/documents?order_id=${orderId}`).catch(() => []),
    apiFetch<WorkflowChecklistResponse>(`/orders/${orderId}/workflow-checklist`).catch(
      () => null,
    ),
  ]);
  const assignments = await apiFetch<PatientAssignmentOption[]>(
    `/patients/${detail.patient_id}/assignments`,
  ).catch(() => []);

  return { detail, documents, workflow, assignments };
}

export function createOrder(payload: JsonPayload) {
  return postJson<CreateResponse>("/orders", payload);
}

export function updateOrderPhase(orderId: string, phase: string) {
  return postJson<void>(`/orders/${orderId}/phase`, { phase });
}

export function updateOrderDebtManagement(orderId: string, payload: JsonPayload) {
  return postJson<void>(`/orders/${orderId}/debt-management`, payload);
}

export function updateOrderProcessGates(orderId: string, payload: JsonPayload) {
  return postJson<void>(`/orders/${orderId}/process-gates`, payload);
}

export function updateOrderPlanningPreparation(orderId: string, payload: JsonPayload) {
  return postJson<void>(`/orders/${orderId}/planning-preparation`, payload);
}

export function updateOrderExecutionFlow(orderId: string, payload: JsonPayload) {
  return postJson<void>(`/orders/${orderId}/execution-flow`, payload);
}

export function updateOrderFollowupFlow(orderId: string, payload: JsonPayload) {
  return postJson<void>(`/orders/${orderId}/followup-flow`, payload);
}

export function createOrderLeistung(orderId: string, payload: JsonPayload) {
  return postJson<void>(`/orders/${orderId}/leistungen`, payload);
}

export function approveOrderLeistung(orderId: string, leistungId: string) {
  return post(`/orders/${orderId}/leistungen/${leistungId}/approve`);
}

export function createExternalInvoice(orderId: string, payload: JsonPayload) {
  return postJson<void>(`/orders/${orderId}/external-invoices`, payload);
}

export function updateExternalInvoice(orderId: string, invoiceId: string, payload: JsonPayload) {
  return postJson<void>(`/orders/${orderId}/external-invoices/${invoiceId}/update`, payload);
}

export function createWorkflowChecklistItem(orderId: string, payload: JsonPayload) {
  return postJson<void>(`/orders/${orderId}/workflow-checklist`, payload);
}

export function completeWorkflowChecklistItem(orderId: string, itemId: string) {
  return post(`/orders/${orderId}/workflow-checklist/${itemId}/complete`);
}
