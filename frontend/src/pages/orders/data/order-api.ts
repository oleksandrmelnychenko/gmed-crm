import { apiFetch } from "@/lib/api";
import { fetchProviderTaxonomy } from "@/pages/providers/data/provider-api";
import type { ProviderTaxonomyNode } from "@/pages/providers/model/types";

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
  taxonomyNodes: ProviderTaxonomyNode[];
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function nullableStringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function booleanValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function normalizePatientOrderRecheck(value: unknown): PatientOrderRecheck {
  const payload = asRecord(value);
  const documentAlerts = asRecord(payload.document_alerts);
  const debtManagement = asRecord(payload.debt_management);
  const latestWorkflow = asRecord(debtManagement.latest_workflow);
  const checks = Array.isArray(payload.checks)
    ? payload.checks.map((item) => {
        const check = asRecord(item);
        return {
          key: stringValue(check.key, "unknown"),
          label: stringValue(check.label),
          passed: booleanValue(check.passed),
          blocking_for: stringValue(check.blocking_for),
        };
      })
    : [];
  const missingDocuments = Array.isArray(documentAlerts.missing_documents)
    ? documentAlerts.missing_documents.map((item) => {
        const document = asRecord(item);
        return {
          key: stringValue(document.key, "unknown"),
          label: stringValue(document.label),
        };
      })
    : [];

  return {
    requires_recheck: booleanValue(payload.requires_recheck),
    can_create_order: booleanValue(payload.can_create_order),
    reason: nullableStringValue(payload.reason),
    base_data_ready: booleanValue(payload.base_data_ready),
    compliance_ready: booleanValue(payload.compliance_ready),
    identity_ready: booleanValue(payload.identity_ready),
    document_pack_ready: booleanValue(payload.document_pack_ready),
    contract_ready: booleanValue(payload.contract_ready),
    debt_hold: booleanValue(payload.debt_hold),
    overdue_invoice_count: numberValue(payload.overdue_invoice_count),
    outstanding_balance: nullableStringValue(payload.outstanding_balance),
    debt_management:
      payload.debt_management && typeof payload.debt_management === "object"
        ? {
            blocking: booleanValue(debtManagement.blocking),
            blocking_reason: nullableStringValue(debtManagement.blocking_reason),
            overdue_invoice_count: numberValue(debtManagement.overdue_invoice_count),
            outstanding_balance: stringValue(debtManagement.outstanding_balance, "0"),
            latest_workflow:
              debtManagement.latest_workflow && typeof debtManagement.latest_workflow === "object"
                ? {
                    order_id: stringValue(latestWorkflow.order_id),
                    order_number: stringValue(latestWorkflow.order_number),
                    status: stringValue(latestWorkflow.status),
                    effective_status: stringValue(latestWorkflow.effective_status),
                    blocking: booleanValue(latestWorkflow.blocking),
                    note: nullableStringValue(latestWorkflow.note),
                    owner_user_id: nullableStringValue(latestWorkflow.owner_user_id),
                    owner_name: nullableStringValue(latestWorkflow.owner_name),
                    next_review_at: nullableStringValue(latestWorkflow.next_review_at),
                    last_contact_at: nullableStringValue(latestWorkflow.last_contact_at),
                    resolution_note: nullableStringValue(latestWorkflow.resolution_note),
                    resolved_at: nullableStringValue(latestWorkflow.resolved_at),
                    resolved_by: nullableStringValue(latestWorkflow.resolved_by),
                    resolved_by_name: nullableStringValue(latestWorkflow.resolved_by_name),
                    updated_at: nullableStringValue(latestWorkflow.updated_at),
                    overdue_invoice_count: numberValue(latestWorkflow.overdue_invoice_count),
                    outstanding_balance: stringValue(latestWorkflow.outstanding_balance, "0"),
                  }
                : null,
          }
        : null,
    base_data_missing_fields: stringArray(payload.base_data_missing_fields),
    blocking_reasons: stringArray(payload.blocking_reasons),
    checks,
    document_alerts: {
      missing_documents: missingDocuments,
      missing_count: numberValue(documentAlerts.missing_count, missingDocuments.length),
      out_of_sync: booleanValue(documentAlerts.out_of_sync),
      stored_document_pack_complete:
        typeof documentAlerts.stored_document_pack_complete === "boolean"
          ? documentAlerts.stored_document_pack_complete
          : undefined,
    },
    latest_framework_contract:
      payload.latest_framework_contract && typeof payload.latest_framework_contract === "object"
        ? {
            id: stringValue(asRecord(payload.latest_framework_contract).id),
            contract_number: stringValue(asRecord(payload.latest_framework_contract).contract_number),
            status: stringValue(asRecord(payload.latest_framework_contract).status),
            signed_at: nullableStringValue(asRecord(payload.latest_framework_contract).signed_at),
            valid_from: nullableStringValue(asRecord(payload.latest_framework_contract).valid_from),
            valid_to: nullableStringValue(asRecord(payload.latest_framework_contract).valid_to),
          }
        : null,
  };
}

export async function fetchProviderDoctors(providerId: string): Promise<DoctorOption[]> {
  const detail = await apiFetch<ProviderDetailResponse>(`/providers/${providerId}`, {
    cacheTtlMs: ORDER_LOOKUPS_CACHE_TTL_MS,
  });
  return detail.doctors ?? [];
}

export async function fetchOrderDirectory(): Promise<OrderDirectory> {
  const [patients, providers, taxonomy] = await Promise.all([
    apiFetch<PatientOption[]>("/patients", {
      cacheTtlMs: ORDER_LOOKUPS_CACHE_TTL_MS,
    }),
    apiFetch<ProviderOption[]>("/providers", {
      cacheTtlMs: ORDER_LOOKUPS_CACHE_TTL_MS,
    }),
    fetchProviderTaxonomy(),
  ]);
  return { patients, providers, taxonomyNodes: taxonomy.nodes };
}

export async function fetchPatientOrderRecheck(patientId: string) {
  const payload = await apiFetch<unknown>(`/patients/${patientId}/recheck`);
  return normalizePatientOrderRecheck(payload);
}

export function fetchOrders(path: string) {
  return apiFetch<OrderSummary[]>(path);
}

export function fetchOrderDebtQueue(providerTaxonomyNodeId = "") {
  const params = new URLSearchParams();
  const trimmedTaxonomyNodeId = providerTaxonomyNodeId.trim();
  if (trimmedTaxonomyNodeId) {
    params.set("provider_taxonomy_node_id", trimmedTaxonomyNodeId);
  }
  const query = params.toString();
  return apiFetch<OrderDebtQueueItem[]>(
    `/orders/debt-management${query ? `?${query}` : ""}`,
  );
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
