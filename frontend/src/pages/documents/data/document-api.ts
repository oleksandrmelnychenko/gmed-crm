import { apiFetch, apiFetchFile } from "@/lib/api";

import type {
  AppointmentOption,
  CategoriesResponse,
  DocumentItem,
  DocumentShare,
  DocumentTextExtraction,
  FrameworkContractOption,
  DocumentTranslation,
  DocumentTranslationPreview,
  GenerateDocumentResponse,
  MachineTranslationCapability,
  MachineTranslationDraft,
  OrderOption,
  PatientOption,
  ProviderOption,
  StaffOption,
  TemplateCatalogResponse,
  TemplateTextBlock,
  TranslationRequest,
  UploadDocumentResponse,
} from "../model/types";
import type { DocumentRelationSource } from "../model/document-bindings";

type JsonPayload = Record<string, unknown>;

const DOCUMENT_LOOKUPS_CACHE_TTL_MS = 60_000;
const DOCUMENT_STATIC_META_CACHE_TTL_MS = 300_000;
const OBJECT_URL_REVOCATION_DELAY_MS = 60_000;

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
  profile: PatientDocumentProfile | null;
  /** The default payer and the parents prefill their templates (QA B3-06, B3-09). */
  relations: DocumentRelationSource[];
};

export type PatientDocumentProfile = {
  /** The child consent forms are offered only for a minor. */
  birth_date?: string | null;
  /** "female" / "male" / …: gendered wording of the letters (QA B3-08). */
  gender?: string | null;
  address_city?: string | null;
  address_country?: string | null;
  address_street?: string | null;
  address_zip?: string | null;
  email?: string | null;
  intake_profile?: {
    trusted_contacts?: unknown;
  } | null;
  nationality?: string | null;
  phone_primary?: string | null;
  residence_country?: string | null;
};

export type DocumentDetailBundle = {
  detail: DocumentItem;
  shares: DocumentShare[];
  versions: DocumentItem[];
  translationRequests: TranslationRequest[];
  textExtraction: DocumentTextExtraction | null;
};

export type DocumentPreviewObjectUrl = {
  contentType: string;
  url: string;
};

function normalizedMime(contentType?: string | null) {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

// The only types a preview may hand to the browser for rendering. None of them
// can run script: no HTML, no SVG, no XML of any kind. Everything else is
// shown as plain text or offered as a download.
const INLINE_PREVIEW_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/avif",
  "image/tiff",
  "image/heic",
  "image/heif",
]);

function isTextualPreviewType(mime: string) {
  return (
    mime.startsWith("text/") ||
    mime.endsWith("/xml") ||
    mime.endsWith("+xml") ||
    mime === "application/json" ||
    mime === "application/javascript" ||
    mime === "application/ecmascript"
  );
}

/**
 * The `sandbox` attribute of an iframe that shows a preview blob. Chromium's
 * built-in PDF viewer cannot start inside a sandboxed frame, so a PDF (whose
 * blob type is forced by `safePreviewBlob`) stays unsandboxed. Images and
 * plain text are fully sandboxed; a file that cannot be shown may only be
 * downloaded.
 */
export function documentPreviewSandbox(contentType?: string) {
  const mime = normalizedMime(contentType);
  if (mime === "application/pdf") return undefined;
  return mime === "text/plain" || INLINE_PREVIEW_IMAGE_TYPES.has(mime) ? "" : "allow-downloads";
}

/** A copy of the blob typed as PDF, or `null` when the bytes are not a PDF. */
export async function pdfPreviewBlob(blob: Blob): Promise<Blob | null> {
  // PDF readers accept the header anywhere in the first 1024 bytes.
  const head = await blob.slice(0, 1024).text();
  return head.includes("%PDF-") ? new Blob([blob], { type: "application/pdf" }) : null;
}

function postJson<T>(path: string, payload: JsonPayload, timeoutMs?: number) {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(payload),
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

// Machine translation may OCR a scanned PDF and runs on CPU; the default
// 20 s API timeout would abort a request the server is still completing.
const MACHINE_TRANSLATION_TIMEOUT_MS = 180_000;

function post(path: string) {
  return apiFetch<{ ok: boolean }>(path, { method: "POST" });
}

export async function fetchDocumentBlob(id: string, noStore = false) {
  return apiFetchFile(
    `/documents/${id}/download`,
    noStore ? { cache: "no-store" } : {},
  );
}

// Allow-list: a PDF (checked by its header), raster images and plain text keep
// a type the browser renders; any other textual type is shown as plain text and
// the rest is re-typed to a download. The blob type is always set here, never
// taken from the response, so the browser has nothing to sniff.
async function safePreviewBlob(blob: Blob, contentType: string, filename?: string | null) {
  const mime = normalizedMime(contentType);
  if (mime === "application/pdf") {
    return (await pdfPreviewBlob(blob)) ?? new Blob([blob], { type: "application/octet-stream" });
  }
  if (INLINE_PREVIEW_IMAGE_TYPES.has(mime)) return new Blob([blob], { type: mime });
  // Plain-text files (e.g. saved translations) are UTF-8; without an explicit
  // charset the browser iframe would decode Cyrillic as Latin-1.
  const charset = mime === "text/plain" ? /charset=([\w-]+)/i.exec(contentType)?.[1] : undefined;
  if (charset) return new Blob([blob], { type: `text/plain;charset=${charset.toLowerCase()}` });
  const invoiceXmlDownload = mime === "application/octet-stream"
    && filename?.toLowerCase().endsWith(".xml");
  if (isTextualPreviewType(mime) || invoiceXmlDownload) {
    return new Blob([await blob.text()], { type: "text/plain;charset=utf-8" });
  }
  return new Blob([blob], { type: "application/octet-stream" });
}

function openBlobPreviewWindow(previewWindow: Window | null, blob: Blob) {
  // `window.open` with "noopener" returns null by specification, so the tab is
  // opened plainly and detached from this page before it is navigated.
  const openedWindow = previewWindow ?? window.open("", "_blank");
  if (!openedWindow) return false;
  openedWindow.opener = null;
  const objectUrl = URL.createObjectURL(blob);
  openedWindow.location.href = objectUrl;
  window.setTimeout(
    () => URL.revokeObjectURL(objectUrl),
    OBJECT_URL_REVOCATION_DELAY_MS,
  );
  return true;
}

function downloadFilename(filename: string, contentType: string) {
  const normalizedFilename = filename.trim() || "document";
  const normalizedContentType = contentType
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (normalizedContentType !== "application/pdf") return normalizedFilename;
  if (/\.pdf$/i.test(normalizedFilename)) return normalizedFilename;

  const filenameWithoutExtension = normalizedFilename.replace(
    /\.[a-z0-9]{1,10}$/i,
    "",
  );
  return `${filenameWithoutExtension || "document"}.pdf`;
}

export async function downloadDocumentFile(id: string, filename: string) {
  const { blob, contentType } = await fetchDocumentBlob(id, true);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = downloadFilename(filename, contentType);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(
    () => URL.revokeObjectURL(url),
    OBJECT_URL_REVOCATION_DELAY_MS,
  );
}

export async function openDocumentPreview(
  id: string,
  popupBlockedMessage: string,
  previewWindow?: Window | null,
) {
  const { blob, contentType, filename } = await fetchDocumentBlob(id, true);
  const opened = openBlobPreviewWindow(
    previewWindow ?? null,
    await safePreviewBlob(blob, contentType, filename ?? undefined),
  );
  if (!opened) {
    if (previewWindow) previewWindow.close();
    throw new Error(popupBlockedMessage);
  }
}

export async function createDocumentPreviewObjectUrl(
  id: string,
): Promise<DocumentPreviewObjectUrl> {
  const { blob, contentType, filename } = await fetchDocumentBlob(id, true);
  const previewBlob = await safePreviewBlob(blob, contentType, filename ?? undefined);

  return {
    contentType: previewBlob.type || "application/octet-stream",
    url: URL.createObjectURL(previewBlob),
  };
}

export function revokeDocumentPreviewObjectUrl(url: string) {
  URL.revokeObjectURL(url);
}

export async function fetchDocumentLookups(
  canManage: boolean,
): Promise<DocumentLookups> {
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

export function fetchDocumentCategories() {
  return apiFetch<CategoriesResponse>("/documents/meta/categories", {
    cacheTtlMs: DOCUMENT_STATIC_META_CACHE_TTL_MS,
  });
}

export function fetchDocuments(path: string) {
  return apiFetch<DocumentItem[]>(path);
}

/** Documents the server reads per page of the document list. */
export const DOCUMENT_LIST_PAGE_SIZE = 300;

export type DocumentListPage = {
  items: DocumentItem[];
  offset: number;
  has_more: boolean;
};

/**
 * One page of the document list: `offset` counts the documents the caller
 * may see, `has_more` says whether older ones follow (QA 2026-11-12 A-01).
 */
export async function fetchDocumentListPage(
  path: string,
  offset: number,
): Promise<DocumentListPage> {
  const separator = path.includes("?") ? "&" : "?";
  const params = new URLSearchParams({
    paged: "true",
    offset: String(offset),
    limit: String(DOCUMENT_LIST_PAGE_SIZE),
  });
  const page = await apiFetch<DocumentListPage | DocumentItem[]>(
    `${path}${separator}${params.toString()}`,
  );
  // A server without paging answers the plain list.
  if (Array.isArray(page)) return { items: page, offset, has_more: false };
  return {
    items: Array.isArray(page.items) ? page.items : [],
    offset: page.offset ?? offset,
    has_more: page.has_more === true,
  };
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
      apiFetch<DocumentTextExtraction>(
        `/documents/${id}/text-extraction`,
      ).catch(() => null),
    ]);
  return { detail, shares, versions, translationRequests, textExtraction };
}

export async function fetchPatientDocumentContext(
  patientId: string,
): Promise<PatientDocumentContext> {
  const [orders, appointments, frameworkContracts, profile, relations] = await Promise.all(
    [
      apiFetch<OrderOption[]>(`/orders?patient_id=${patientId}`).catch(
        () => [],
      ),
      apiFetch<AppointmentOption[]>(
        `/appointments?patient_id=${patientId}`,
      ).catch(() => []),
      apiFetch<FrameworkContractOption[]>(
        `/patients/${patientId}/framework-contracts`,
      ).catch(() => null),
      apiFetch<PatientDocumentProfile>(`/patients/${patientId}`).catch(
        () => null,
      ),
      apiFetch<DocumentRelationSource[]>(`/patients/${patientId}/relations`).catch(
        () => [] as DocumentRelationSource[],
      ),
    ],
  );
  return {
    orders,
    appointments,
    frameworkContracts,
    profile,
    relations: Array.isArray(relations) ? relations : [],
  };
}

export function uploadDocument(formData: FormData) {
  return apiFetch<UploadDocumentResponse>("/documents/upload", {
    method: "POST",
    body: formData,
    // Uploads include malware scanning and can legitimately take longer when
    // several documents are submitted together. The generic 20 second API
    // timeout can otherwise report a failure after the server accepted the
    // document, inviting a duplicate retry.
    timeoutMs: 120_000,
  });
}

export function updateDocument(id: string, payload: JsonPayload) {
  return postJson<{ ok: boolean }>(`/documents/${id}/update`, payload);
}

export type DocumentComplianceKind =
  | "dsgvo"
  | "confidentiality_release"
  | "identity"
  | "framework_contract"
  | "enhanced_due_diligence"
  | "cost_coverage_declaration"
  | "other";

export type MarkDocumentSignedResponse = {
  ok: boolean;
  document_id: string;
  signed_at: string;
  compliance_kind: DocumentComplianceKind;
  patient_id: string | null;
  lead_id?: string | null;
  compliance_updated: boolean;
};

/**
 * Record a document as the signed evidence for a compliance requirement and,
 * atomically, flip the matching flag on the linked patient's legal_status (#13).
 */
export function markDocumentSigned(
  id: string,
  complianceKind: DocumentComplianceKind,
  signedAt?: string,
) {
  return postJson<MarkDocumentSignedResponse>(`/documents/${id}/mark-signed`, {
    compliance_kind: complianceKind,
    ...(signedAt ? { signed_at: signedAt } : {}),
  });
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
  return apiFetch<TranslationRequest[]>(
    `/documents/${documentId}/translation-requests`,
  );
}

export type TranslationQueueStatusFilter = "open" | "completed" | "cancelled" | "all";

const translationQueueStatusParams: Record<TranslationQueueStatusFilter, string> = {
  open: "pending,in_progress",
  completed: "completed",
  cancelled: "cancelled",
  all: "pending,in_progress,completed,cancelled",
};

export function fetchTranslationRequestQueue(status: TranslationQueueStatusFilter = "open") {
  return apiFetch<TranslationRequest[]>(
    `/documents/translation-requests?status=${translationQueueStatusParams[status]}`,
  );
}

/**
 * Whether «Загрузить» may be offered: the concierge needs the CEO's "all
 * documents · upload" rule (owner 2026-11-12). The upload route checks again.
 */
export function fetchDocumentUploadAccess() {
  return apiFetch<{ can_upload: boolean }>("/documents/meta/upload-access", {
    cache: "no-store",
  });
}

export function createTranslationRequest(
  documentId: string,
  payload: JsonPayload,
) {
  return postJson<void>(
    `/documents/${documentId}/translation-requests`,
    payload,
  );
}

export function runDocumentTextExtraction(documentId: string) {
  return postJson<DocumentTextExtraction>(
    `/documents/${documentId}/text-extraction/run`,
    {},
  );
}

export function updateTranslationRequest(
  requestId: string,
  payload: JsonPayload,
) {
  return postJson<TranslationRequest>(
    `/documents/translation-requests/${requestId}/update`,
    payload,
  );
}

export function fetchDocumentTranslations(documentId: string) {
  return apiFetch<DocumentTranslation[]>(`/documents/${documentId}/translations`, {
    cache: "no-store",
  });
}

export function previewDocumentTranslation(
  documentId: string,
  payload: { source_language: string | null; target_language: string },
) {
  return postJson<DocumentTranslationPreview>(
    `/documents/${documentId}/translations/preview`,
    payload,
    MACHINE_TRANSLATION_TIMEOUT_MS,
  );
}

export function createDocumentTranslation(
  documentId: string,
  payload: {
    source_language: string | null;
    target_language: string;
    source_text: string | null;
    translated_text: string;
    provider: "local" | "manual";
    auto_name?: string | null;
  },
) {
  return postJson<DocumentTranslation>(
    `/documents/${documentId}/translations`,
    payload,
  );
}

export function renderDocumentTranslationPdf(
  documentId: string,
  payload: { translated_text?: string } = {},
) {
  return postJson<{ id: string; translation_id: string; replaces_document_id: string; auto_name: string; original_filename: string }>(
    `/documents/${documentId}/translations/render-pdf`,
    payload,
  );
}

export function fetchMachineTranslationCapability() {
  return apiFetch<MachineTranslationCapability>(
    "/documents/translation-requests/machine-translation",
  );
}

export function createMachineTranslationDraft(
  requestId: string,
  payload: { source_text: string | null; source_language: string | null },
) {
  return postJson<MachineTranslationDraft>(
    `/documents/translation-requests/${requestId}/machine-draft`,
    payload,
    MACHINE_TRANSLATION_TIMEOUT_MS,
  );
}

export function createBulkDocumentShares(
  documentIds: string[],
  payload: JsonPayload,
) {
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
