import { apiFetch, apiFetchFile } from "@/lib/api";

import type {
  AppointmentOption,
  CategoriesResponse,
  DocumentItem,
  DocumentShare,
  DocumentTextExtraction,
  FrameworkContractOption,
  GenerateDocumentResponse,
  OrderOption,
  PatientOption,
  ProviderOption,
  StaffOption,
  TemplateCatalogResponse,
  TemplateTextBlock,
  TranslationRequest,
  UploadDocumentResponse,
} from "../model/types";

type JsonPayload = Record<string, unknown>;

const DOCUMENT_LOOKUPS_CACHE_TTL_MS = 60_000;
const DOCUMENT_STATIC_META_CACHE_TTL_MS = 300_000;

export type DocumentLookups = {
  patients: PatientOption[];
  providers: ProviderOption[];
  staff: StaffOption[];
  categories: CategoriesResponse["categories"];
  arts: string[];
  templates: TemplateCatalogResponse["templates"];
  textBlocks: TemplateTextBlock[];
};

export type PatientDocumentContext = {
  orders: OrderOption[];
  appointments: AppointmentOption[];
  frameworkContracts: FrameworkContractOption[] | null;
};

export type DocumentDetailBundle = {
  detail: DocumentItem;
  shares: DocumentShare[];
  versions: DocumentItem[];
  translationRequests: TranslationRequest[];
  textExtraction: DocumentTextExtraction | null;
};

function postJson<T>(path: string, payload: JsonPayload) {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function post(path: string) {
  return apiFetch<{ ok: boolean }>(path, { method: "POST" });
}

async function fetchDocumentBlob(id: string) {
  return apiFetchFile(`/documents/${id}/download`);
}

function writePreviewWindow(previewWindow: Window | null, html?: string) {
  if (!previewWindow || !html) return false;
  previewWindow.document.open();
  previewWindow.document.write(html);
  previewWindow.document.close();
  return true;
}

function openBlobPreviewWindow(previewWindow: Window | null, blob: Blob) {
  const openedWindow =
    previewWindow ?? window.open("", "_blank", "noopener,noreferrer");
  if (!openedWindow) return false;
  const objectUrl = URL.createObjectURL(blob);
  openedWindow.location.href = objectUrl;
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return true;
}

export async function downloadDocumentFile(id: string, filename: string) {
  const { blob } = await fetchDocumentBlob(id);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "document";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function openDocumentPreview(
  id: string,
  popupBlockedMessage: string,
  previewWindow?: Window | null,
) {
  const { blob, contentType } = await fetchDocumentBlob(id);
  if (contentType.startsWith("text/html")) {
    const html = await blob.text();
    const opened = writePreviewWindow(
      previewWindow ?? window.open("", "_blank", "noopener,noreferrer"),
      html,
    );
    if (!opened) {
      if (previewWindow) previewWindow.close();
      throw new Error(popupBlockedMessage);
    }
    return;
  }

  const opened = openBlobPreviewWindow(previewWindow ?? null, blob);
  if (!opened) {
    if (previewWindow) previewWindow.close();
    throw new Error(popupBlockedMessage);
  }
}

export async function fetchDocumentLookups(canManage: boolean): Promise<DocumentLookups> {
  const [
    patients,
    providers,
    staff,
    categoriesResponse,
    templateCatalogResponse,
  ] = await Promise.all([
    apiFetch<PatientOption[]>("/patients?active_only=true", {
      cacheTtlMs: DOCUMENT_LOOKUPS_CACHE_TTL_MS,
    }).catch(() => []),
    canManage
      ? apiFetch<ProviderOption[]>("/providers?active_only=true", {
          cacheTtlMs: DOCUMENT_LOOKUPS_CACHE_TTL_MS,
        }).catch(() => [])
      : Promise.resolve([]),
    apiFetch<StaffOption[]>("/documents/meta/staff", {
      cacheTtlMs: DOCUMENT_STATIC_META_CACHE_TTL_MS,
    }).catch(() => []),
    apiFetch<CategoriesResponse>("/documents/meta/categories", {
      cacheTtlMs: DOCUMENT_STATIC_META_CACHE_TTL_MS,
    }).catch(() => ({
      categories: [],
      arts: [],
    })),
    canManage
      ? apiFetch<TemplateCatalogResponse>("/documents/templates", {
          cacheTtlMs: DOCUMENT_STATIC_META_CACHE_TTL_MS,
        }).catch(() => ({
          templates: [],
          text_blocks: [],
        }))
      : Promise.resolve({ templates: [], text_blocks: [] }),
  ]);
  return {
    patients,
    providers,
    staff,
    categories: categoriesResponse.categories,
    arts: categoriesResponse.arts,
    templates: templateCatalogResponse.templates,
    textBlocks: templateCatalogResponse.text_blocks,
  };
}

export function fetchDocuments(path: string) {
  return apiFetch<DocumentItem[]>(path);
}

export function fetchDocumentIntakeQueue() {
  return apiFetch<DocumentItem[]>("/documents/intake-queue");
}

export async function fetchDocumentDetailBundle(
  id: string,
  canViewShares: boolean,
): Promise<DocumentDetailBundle> {
  const [detail, shares, versions, translationRequests, textExtraction] =
    await Promise.all([
      apiFetch<DocumentItem>(`/documents/${id}`),
      canViewShares
        ? apiFetch<DocumentShare[]>(`/documents/${id}/shares`).catch(() => [])
        : Promise.resolve([]),
      apiFetch<DocumentItem[]>(`/documents/${id}/versions`).catch(() => []),
      apiFetch<TranslationRequest[]>(
        `/documents/${id}/translation-requests`,
      ).catch(() => []),
      apiFetch<DocumentTextExtraction>(`/documents/${id}/text-extraction`).catch(
        () => null,
      ),
    ]);
  return { detail, shares, versions, translationRequests, textExtraction };
}

export async function fetchPatientDocumentContext(
  patientId: string,
): Promise<PatientDocumentContext> {
  const [orders, appointments, frameworkContracts] = await Promise.all([
    apiFetch<OrderOption[]>(`/orders?patient_id=${patientId}`).catch(() => []),
    apiFetch<AppointmentOption[]>(`/appointments?patient_id=${patientId}`).catch(
      () => [],
    ),
    apiFetch<FrameworkContractOption[]>(
      `/patients/${patientId}/framework-contracts`,
    ).catch(() => null),
  ]);
  return { orders, appointments, frameworkContracts };
}

export function uploadDocument(formData: FormData) {
  return apiFetch<UploadDocumentResponse>("/documents/upload", {
    method: "POST",
    body: formData,
  });
}

export function updateDocument(id: string, payload: JsonPayload) {
  return postJson<{ ok: boolean }>(`/documents/${id}/update`, payload);
}

export function generateDocument(payload: JsonPayload) {
  return postJson<GenerateDocumentResponse>("/documents/generate", payload);
}

export function fetchDocument(id: string) {
  return apiFetch<DocumentItem>(`/documents/${id}`);
}

export function fetchDocumentShares(id: string) {
  return apiFetch<DocumentShare[]>(`/documents/${id}/shares`);
}

export function fetchDocumentVersions(id: string) {
  return apiFetch<DocumentItem[]>(`/documents/${id}/versions`);
}

export function fetchTranslationRequests(documentId: string) {
  return apiFetch<TranslationRequest[]>(`/documents/${documentId}/translation-requests`);
}

export function fetchTranslationRequestQueue() {
  return apiFetch<TranslationRequest[]>(
    "/documents/translation-requests?status=pending,in_progress",
  );
}

export function createTranslationRequest(documentId: string, payload: JsonPayload) {
  return postJson<void>(`/documents/${documentId}/translation-requests`, payload);
}

export function runDocumentTextExtraction(documentId: string) {
  return postJson<DocumentTextExtraction>(
    `/documents/${documentId}/text-extraction/run`,
    {},
  );
}

export function updateTranslationRequest(requestId: string, payload: JsonPayload) {
  return postJson<void>(`/documents/translation-requests/${requestId}/update`, payload);
}

export function createBulkDocumentShares(documentIds: string[], payload: JsonPayload) {
  return postJson<{ ok: boolean }>("/documents/shares/bulk", {
    document_ids: documentIds,
    ...payload,
  });
}

export function createDocumentShare(documentId: string, payload: JsonPayload) {
  return postJson<{ ok: boolean }>(`/documents/${documentId}/shares`, payload);
}

export function revokeDocumentShare(documentId: string, shareId: string) {
  return post(`/documents/${documentId}/shares/${shareId}/revoke`);
}

export function confirmDocumentShare(documentId: string, shareId: string) {
  return post(`/documents/${documentId}/shares/${shareId}/confirm`);
}

export function releaseDocumentToPortal(documentId: string) {
  return postJson<void>(`/documents/${documentId}/portal-release`, {
    channel: "patient_portal",
    requires_confirmation: true,
  });
}

export function revokeDocumentPortalRelease(documentId: string) {
  return post(`/documents/${documentId}/portal-release/revoke`);
}

export function deleteStoredDocumentFile(documentId: string, reason: string) {
  return postJson<{ ok: boolean; document: DocumentItem }>(
    `/documents/${documentId}/delete`,
    { reason },
  );
}
