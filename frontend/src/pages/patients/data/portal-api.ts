import { apiFetch, downloadApiFile } from "@/lib/api";

import type {
  PortalAppointmentItem,
  PortalAppointmentRequestItem,
  PortalConciergeServiceItem,
  PortalDocumentAlertsSummary,
  PortalDocumentItem,
  PortalFeedbackItem,
  PortalFollowupMilestoneItem,
  PortalInvoiceItem,
  PortalPrivacyRequest,
  PortalUploadedDocumentItem,
} from "@/pages/patients/model/portal-shared";

type JsonPayload = Record<string, unknown>;

const PORTAL_CACHE_TTL_MS = 15_000;

function postJson(path: string, payload?: JsonPayload) {
  const init: RequestInit = { method: "POST" };
  if (payload !== undefined) {
    init.body = JSON.stringify(payload);
  }
  return apiFetch(path, init);
}

export async function fetchPatientPortalWorkspace() {
  const [
    appointments,
    services,
    documents,
    invoices,
    privacyRequests,
    feedback,
    documentAlerts,
  ] = await Promise.all([
    apiFetch<PortalAppointmentItem[]>("/me/appointments", {
      cacheTtlMs: PORTAL_CACHE_TTL_MS,
    }).catch(() => []),
    apiFetch<PortalConciergeServiceItem[]>("/me/concierge-services", {
      cacheTtlMs: PORTAL_CACHE_TTL_MS,
    }).catch(
      () => [],
    ),
    apiFetch<PortalDocumentItem[]>("/me/documents", {
      cacheTtlMs: PORTAL_CACHE_TTL_MS,
    }).catch(() => []),
    apiFetch<PortalInvoiceItem[]>("/me/invoices", {
      cacheTtlMs: PORTAL_CACHE_TTL_MS,
    }).catch(() => []),
    apiFetch<PortalPrivacyRequest[]>("/me/privacy-requests", {
      cacheTtlMs: PORTAL_CACHE_TTL_MS,
    }).catch(() => []),
    apiFetch<PortalFeedbackItem[]>("/me/feedback", {
      cacheTtlMs: PORTAL_CACHE_TTL_MS,
    }).catch(() => []),
    apiFetch<PortalDocumentAlertsSummary>("/me/document-alerts", {
      cacheTtlMs: PORTAL_CACHE_TTL_MS,
    }).catch(
      () => null,
    ),
  ]);

  return {
    appointments,
    services,
    documents,
    invoices,
    privacyRequests,
    feedback,
    documentAlerts,
  };
}

export function downloadPatientPortalExport() {
  return downloadApiFile(
    "/me/export?format=zip",
    `patient-export-${new Date().toISOString().slice(0, 10)}.zip`,
  );
}

export async function fetchPortalAppointmentsWorkspace() {
  const [appointments, requests, followupMilestones] = await Promise.all([
    apiFetch<PortalAppointmentItem[]>("/me/appointments", {
      cacheTtlMs: PORTAL_CACHE_TTL_MS,
    }),
    apiFetch<PortalAppointmentRequestItem[]>("/me/appointment-requests", {
      cacheTtlMs: PORTAL_CACHE_TTL_MS,
    }),
    apiFetch<PortalFollowupMilestoneItem[]>("/me/followup-milestones", {
      cacheTtlMs: PORTAL_CACHE_TTL_MS,
    }).catch(
      () => [],
    ),
  ]);

  return { appointments, requests, followupMilestones };
}

export function createPortalAppointmentRequest(payload: JsonPayload) {
  return postJson("/me/appointment-requests", payload);
}

export async function fetchPortalDocumentsWorkspace() {
  const [releasedDocuments, uploadedDocuments, documentAlerts] = await Promise.all([
    apiFetch<PortalDocumentItem[]>("/me/documents", {
      cacheTtlMs: PORTAL_CACHE_TTL_MS,
    }),
    apiFetch<PortalUploadedDocumentItem[]>("/me/documents/uploads", {
      cacheTtlMs: PORTAL_CACHE_TTL_MS,
    }),
    apiFetch<PortalDocumentAlertsSummary>("/me/document-alerts", {
      cacheTtlMs: PORTAL_CACHE_TTL_MS,
    }).catch(
      () => null,
    ),
  ]);

  return { releasedDocuments, uploadedDocuments, documentAlerts };
}

export function uploadPortalDocument(formData: FormData) {
  return apiFetch("/me/documents/upload", {
    method: "POST",
    body: formData,
  });
}

export function confirmPortalDocument(documentId: string) {
  return postJson(`/me/documents/${documentId}/confirm`);
}

export function fetchPortalServices() {
  return apiFetch<PortalConciergeServiceItem[]>("/me/concierge-services", {
    cacheTtlMs: PORTAL_CACHE_TTL_MS,
  });
}

export function createPortalServiceRequest(payload: JsonPayload) {
  return postJson("/me/concierge-services", payload);
}

export function cancelPortalService(serviceId: string) {
  return postJson(`/me/concierge-services/${serviceId}/cancel`);
}

export function fetchPortalInvoices() {
  return apiFetch<PortalInvoiceItem[]>("/me/invoices", {
    cacheTtlMs: PORTAL_CACHE_TTL_MS,
  });
}

export function fetchPortalInvoiceDetail(invoiceId: string) {
  return apiFetch<PortalInvoiceItem>(`/me/invoices/${invoiceId}`);
}

export function uploadPortalPaymentProof(formData: FormData) {
  return uploadPortalDocument(formData);
}

export function fetchPortalPrivacyRequests() {
  return apiFetch<PortalPrivacyRequest[]>("/me/privacy-requests", {
    cacheTtlMs: PORTAL_CACHE_TTL_MS,
  });
}

export function createPortalPrivacyRequest(payload: JsonPayload) {
  return postJson("/me/privacy-requests", payload);
}
