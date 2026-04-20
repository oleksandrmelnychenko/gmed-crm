import {
  cloneElement,
  isValidElement,
  startTransition,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  Download,
  FileText,
  FolderPlus,
  LoaderCircle,
  RefreshCw,
  Search,
  Share2,
  Trash2,
} from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { localizeDocumentCode } from "@/lib/required-document-labels";
import {
  CountBadge,
  EmptyCell,
  ListItem,
  PageHeader,
  Section,
  TabLoader,
} from "@/components/ui-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiFetch, buildApiUrl, getAccessToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getLang, t as translateCatalog, useLang } from "@/lib/i18n";
import { PatientDocumentsPage } from "@/pages/patient-documents";
import { cn } from "@/lib/utils";

type DocumentStatus = "draft" | "active" | "archived";
type DocumentVisibility =
  | "internal"
  | "released_internal"
  | "released_external"
  | "patient_visible";

type DocumentClassificationSuggestion = {
  art: string;
  category: string;
  is_medical: boolean;
  confidence: string;
  rationale: string;
};

type DocumentItem = {
  id: string;
  patient_id: string | null;
  order_id: string | null;
  appointment_id: string | null;
  patient_pid: string | null;
  patient_name: string | null;
  order_number: string | null;
  appointment_title: string | null;
  auto_name: string;
  original_filename: string | null;
  art: string;
  category: string | null;
  status: string;
  visibility: string;
  is_medical: boolean;
  mime_type: string | null;
  file_size: number | null;
  has_stored_file: boolean;
  klinik: string | null;
  ursprung: string | null;
  notes: string | null;
  uploaded_by_name: string | null;
  version_root_document_id: string;
  replaces_document_id: string | null;
  superseded_by_document_id: string | null;
  version_number: number;
  version_count: number;
  is_latest_version: boolean;
  file_deleted_at: string | null;
  file_deleted_by: string | null;
  file_deleted_by_name: string | null;
  file_delete_reason: string | null;
  created_at: string;
  updated_at: string;
  share_count: number;
  shared_to_current: boolean;
  data_sensitivity: string;
  needs_categorization: boolean;
  classification_suggestion: DocumentClassificationSuggestion | null;
};

type DocumentShare = {
  id: string;
  shared_with_provider_id: string | null;
  shared_with_user_id: string | null;
  provider_name: string | null;
  target_user_name: string | null;
  target_user_role: string | null;
  shared_by_name: string | null;
  channel: string | null;
  message: string | null;
  requires_confirmation: boolean;
  confirmed: boolean;
  confirmed_at: string | null;
  shared_at: string;
  revoked_at: string | null;
};

type TranslationRequest = {
  id: string;
  document_id: string;
  patient_id: string | null;
  requested_language: string;
  status: string;
  note: string | null;
  source_language: string | null;
  source_text: string | null;
  translated_text: string | null;
  requested_by: string;
  requested_by_name: string | null;
  translated_by: string | null;
  translated_by_name: string | null;
  requested_at: string;
  completed_at: string | null;
  translated_at: string | null;
  updated_at: string;
};

type TranslationWorkspaceDraft = {
  note: string;
  sourceLanguage: string;
  sourceText: string;
  translatedText: string;
};

type DocumentTextExtraction = {
  status: string;
  method: string | null;
  message: string | null;
  extracted_text: string | null;
  has_text: boolean;
  extracted_at: string | null;
  extracted_by: string | null;
  extracted_by_name: string | null;
};

type StaffOption = { id: string; name: string; role: string };
type CategoryOption = { key: string; label: string };
type CategoriesResponse = { categories: CategoryOption[]; arts: string[] };
type PatientOption = {
  id: string;
  patient_id: string;
  first_name?: string;
  last_name?: string;
  languages?: string[];
};
type ProviderOption = { id: string; name: string; address_city: string | null };
type OrderOption = { id: string; order_number: string; patient_pid: string };
type AppointmentOption = {
  id: string;
  title: string;
  date: string;
  time_start: string | null;
};

type FiltersState = {
  search: string;
  patientId: string;
  orderId: string;
  appointmentId: string;
  status: string;
  visibility: string;
  art: string;
  category: string;
  dateFrom: string;
  dateTo: string;
  klinik: string;
  ursprung: string;
};

type UploadFormState = {
  file: File | null;
  patientId: string;
  orderId: string;
  appointmentId: string;
  autoName: string;
  art: string;
  category: string;
  status: DocumentStatus;
  visibility: DocumentVisibility;
  isMedical: boolean;
  klinik: string;
  ursprung: string;
  notes: string;
};

type EditFormState = {
  patientId: string;
  orderId: string;
  appointmentId: string;
  autoName: string;
  art: string;
  category: string;
  status: DocumentStatus;
  visibility: DocumentVisibility;
  isMedical: boolean;
  klinik: string;
  ursprung: string;
  notes: string;
};

type ShareFormState = {
  targetType: "user" | "provider";
  userId: string;
  providerId: string;
  channel: string;
  message: string;
  requiresConfirmation: boolean;
};

type DocumentTemplate = {
  id: string;
  template_kind?: "builtin" | "provider";
  provider_id?: string | null;
  provider_name?: string | null;
  doctor_id?: string | null;
  doctor_name?: string | null;
  label: string;
  description: string;
  art: string;
  category: string;
  default_auto_name: string;
  default_status: DocumentStatus;
  default_visibility: DocumentVisibility;
  is_medical: boolean;
  supported_languages: string[];
  text_block_keys: string[];
};

type TemplateTextBlock = {
  key: string;
  label: string;
  description: string;
};

type TemplateCatalogResponse = {
  templates: DocumentTemplate[];
  text_blocks: TemplateTextBlock[];
};

type GenerateFormState = {
  templateId: string;
  patientId: string;
  orderId: string;
  appointmentId: string;
  replaceDocumentId: string;
  autoName: string;
  status: DocumentStatus;
  visibility: DocumentVisibility;
  language: string;
  titleOverride: string;
  introduction: string;
  closingNote: string;
  klinik: string;
  ursprung: string;
  notes: string;
  textBlockKeys: string[];
};

type GenerateDocumentResponse = {
  id: string;
  auto_name: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  language?: string;
  version_number?: number;
  preview_html?: string;
};

type UploadDocumentResponse = {
  id: string;
  art: string;
  category: string | null;
  is_medical: boolean;
  needs_categorization: boolean;
  classification_suggestion?: DocumentClassificationSuggestion | null;
};

const STATUS_OPTIONS: DocumentStatus[] = ["draft", "active", "archived"];
const VISIBILITY_OPTIONS: DocumentVisibility[] = [
  "internal",
  "released_internal",
  "released_external",
  "patient_visible",
];
const selectClassName =
  "h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";
const textareaClassName =
  "min-h-[104px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

function canManageDocuments(role?: string) {
  return role === "ceo" || role === "patient_manager";
}

function canUploadDocuments(role?: string) {
  return [
    "ceo",
    "patient_manager",
    "teamlead_interpreter",
    "interpreter",
  ].includes(role ?? "");
}

function canManageDocumentIntake(role?: string) {
  return ["ceo", "patient_manager", "teamlead_interpreter"].includes(
    role ?? "",
  );
}

function canViewDocuments(role?: string) {
  return [
    "ceo",
    "ceo_assistant",
    "patient_manager",
    "teamlead_interpreter",
    "interpreter",
    "concierge",
    "billing",
  ].includes(role ?? "");
}

function canRequestTranslations(role?: string) {
  return [
    "ceo",
    "patient_manager",
    "teamlead_interpreter",
    "interpreter",
    "concierge",
  ].includes(role ?? "");
}

function canUpdateTranslations(role?: string) {
  return [
    "ceo",
    "patient_manager",
    "teamlead_interpreter",
    "concierge",
  ].includes(role ?? "");
}

function canViewDocumentShares(role?: string) {
  return ["ceo", "ceo_assistant", "patient_manager"].includes(role ?? "");
}

function buildDocumentsPath(filters: FiltersState) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.patientId) params.set("patient_id", filters.patientId);
  if (filters.orderId) params.set("order_id", filters.orderId);
  if (filters.appointmentId)
    params.set("appointment_id", filters.appointmentId);
  if (filters.status) params.set("status", filters.status);
  if (filters.visibility) params.set("visibility", filters.visibility);
  if (filters.art.trim()) params.set("art", filters.art.trim());
  if (filters.category) params.set("category", filters.category);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  if (filters.klinik.trim()) params.set("klinik", filters.klinik.trim());
  if (filters.ursprung.trim())
    params.set("ursprung", filters.ursprung.trim());
  return params.size ? `/documents?${params.toString()}` : "/documents";
}

function runtimeTranslations() {
  return translateCatalog(getLang());
}

function runtimeLocale() {
  return getLang() === "ru" ? "ru-RU" : "de-DE";
}

function formatRoleLabel(role?: string | null) {
  const tr = runtimeTranslations();
  if (!role) return getLang() === "ru" ? "пользователь" : "Benutzer";
  const translated = tr[`role_${role}` as keyof typeof tr];
  return typeof translated === "string" ? translated : role.replaceAll("_", " ");
}

function formatLanguageLabel(language?: string | null) {
  const normalized = normalizeTemplateLanguage(language) ?? language?.trim().toLowerCase();
  const isRu = getLang() === "ru";
  switch (normalized) {
    case "de":
      return isRu ? "Немецкий" : "Deutsch";
    case "en":
      return isRu ? "Английский" : "Englisch";
    case "uk":
      return isRu ? "Украинский" : "Ukrainisch";
    case "ru":
      return isRu ? "Русский" : "Russisch";
    default:
      return language ? language.toUpperCase() : runtimeTranslations().common_not_set;
  }
}

function formatSensitivityLabel(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  const isRu = getLang() === "ru";
  switch (normalized) {
    case "general":
      return isRu ? "Общие данные" : "Allgemeine Daten";
    case "patient identity":
    case "patient_identity":
      return isRu ? "Данные пациента" : "Patientendaten";
    case "medical":
      return isRu ? "Медицинские данные" : "Medizinische Daten";
    case "financial":
      return isRu ? "Финансовые данные" : "Finanzdaten";
    case "internal":
      return isRu ? "Внутренние данные" : "Interne Daten";
    case "service":
      return isRu ? "Сервисные данные" : "Servicedaten";
    default:
      return value?.replaceAll("_", " ") ?? runtimeTranslations().common_not_set;
  }
}

function formatShareChannelLabel(channel?: string | null) {
  const normalized = channel?.trim().toLowerCase();
  const isRu = getLang() === "ru";
  switch (normalized) {
    case "email":
      return isRu ? "Эл. почта" : "E-Mail";
    case "phone":
      return isRu ? "Телефон" : "Telefon";
    case "portal":
    case "patient_portal":
      return isRu ? "Портал пациента" : "Patientenportal";
    case "postal_mail":
      return isRu ? "Почта" : "Postversand";
    case "fax":
      return isRu ? "Факс" : "Fax";
    case "whatsapp":
      return "WhatsApp";
    case "other":
      return isRu ? "Другой канал" : "Anderer Kanal";
    default:
      return channel?.replaceAll("_", " ") ?? runtimeTranslations().common_not_set;
  }
}

function formatExtractionMethodLabel(method?: string | null) {
  const normalized = method?.trim().toLowerCase();
  const isRu = getLang() === "ru";
  switch (normalized) {
    case "html_text":
      return isRu ? "HTML-текст" : "HTML-Text";
    case "pdf_text":
      return isRu ? "PDF-текст" : "PDF-Text";
    case "text_utf8":
      return isRu ? "UTF-8 текст" : "UTF-8-Text";
    case "windows_ocr":
      return isRu ? "OCR Windows" : "Windows-OCR";
    case "tesseract_cli":
      return "Tesseract OCR";
    case "ocr_unavailable":
      return isRu ? "OCR недоступен" : "OCR nicht verfügbar";
    default:
      return method?.replaceAll("_", " ") ?? runtimeTranslations().common_not_set;
  }
}

function formatDateTime(value?: string | null) {
  const tr = runtimeTranslations();
  if (!value) return tr.common_not_set;
  try {
    return new Intl.DateTimeFormat(runtimeLocale(), {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDate(value?: string | null) {
  const tr = runtimeTranslations();
  if (!value) return tr.common_not_set;
  try {
    return new Intl.DateTimeFormat(runtimeLocale(), {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

function formatFileSize(value?: number | null) {
  const tr = runtimeTranslations();
  if (!value || value <= 0) return tr.common_not_set;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDocumentStatusLabel(
  status: string,
  tr: ReturnType<typeof runtimeTranslations>,
) {
  switch (status) {
    case "draft":
      return tr.documents_status_draft;
    case "active":
      return tr.documents_status_active;
    case "archived":
      return tr.documents_status_archived;
    default:
      return status.replaceAll("_", " ");
  }
}

function formatVisibilityLabel(
  visibility: string,
  tr: ReturnType<typeof runtimeTranslations>,
) {
  switch (visibility) {
    case "internal":
      return tr.documents_visibility_internal;
    case "released_internal":
      return tr.documents_visibility_released_internal;
    case "released_external":
      return tr.documents_visibility_released_external;
    case "patient_visible":
      return tr.documents_visibility_patient_visible;
    default:
      return visibility.replaceAll("_", " ");
  }
}

function formatTranslationStatusLabel(
  status: string,
  tr: ReturnType<typeof runtimeTranslations>,
) {
  switch (status) {
    case "requested":
      return tr.documents_translation_requested;
    case "in_progress":
      return tr.documents_translation_in_progress;
    case "completed":
      return tr.documents_translation_completed;
    case "cancelled":
      return tr.documents_translation_cancelled;
    default:
      return status.replaceAll("_", " ");
  }
}

function formatExtractionStatusLabel(
  status: string,
  tr: ReturnType<typeof runtimeTranslations>,
) {
  switch (status) {
    case "completed":
      return tr.documents_extraction_completed;
    case "failed":
      return tr.documents_extraction_failed;
    case "unsupported":
      return tr.documents_extraction_unsupported;
    case "not_started":
      return tr.documents_extraction_not_started;
    default:
      return status.replaceAll("_", " ");
  }
}

function statusBadge(status: string) {
  if (status === "active")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "archived")
    return "border-border/60 bg-muted/25 text-muted-foreground";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function translationStatusBadge(status: string) {
  if (status === "completed")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "in_progress")
    return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "cancelled")
    return "border-border/60 bg-muted/25 text-muted-foreground";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function textExtractionStatusBadge(status: string) {
  if (status === "completed")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "unsupported")
    return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-border/60 bg-muted/25 text-muted-foreground";
}

function visibilityBadge(visibility: string) {
  if (visibility === "released_internal")
    return "border-sky-200 bg-sky-50 text-sky-700";
  if (visibility === "released_external")
    return "border-violet-200 bg-violet-50 text-violet-700";
  if (visibility === "patient_visible")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-border/60 bg-muted/25 text-muted-foreground";
}

function sensitivityBadge(value: string) {
  if (value.toLowerCase() === "medical")
    return "border-rose-200 bg-rose-50 text-rose-700";
  if (value.toLowerCase() === "financial")
    return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function patientOptionLabel(patient: PatientOption) {
  return `${patient.patient_id} · ${[patient.first_name, patient.last_name].filter(Boolean).join(" ")}`;
}

function formatConfidenceLabel(
  value: string,
  tr: Record<string, string>,
): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high") return tr.documents_confidence_high ?? value;
  if (normalized === "medium") return tr.documents_confidence_medium ?? value;
  if (normalized === "low") return tr.documents_confidence_low ?? value;
  return value;
}

function normalizeTemplateLanguage(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (
    ["de", "de-de", "de_at", "de-at", "de_ch", "de-ch"].includes(normalized)
  ) {
    return "de";
  }
  if (["uk", "uk-ua", "ua", "ukrainian"].includes(normalized)) return "uk";
  if (["en", "en-gb", "en-us", "english"].includes(normalized)) return "en";
  if (["ru", "ru-ru", "russian"].includes(normalized)) return "ru";
  return null;
}

function resolveTemplateLanguage(
  patientId: string,
  template: DocumentTemplate | null,
  patients: PatientOption[],
) {
  if (!template) return "de";
  const patient = patients.find((item) => item.id === patientId);
  for (const language of patient?.languages ?? []) {
    const normalized = normalizeTemplateLanguage(language);
    if (normalized && template.supported_languages.includes(normalized)) {
      return normalized;
    }
  }
  return template.supported_languages[0] ?? "de";
}

function templateForDocument(
  templates: DocumentTemplate[],
  detail: DocumentItem | null,
) {
  if (!detail) return null;
  return (
    templates.find(
      (template) =>
        (template.template_kind ?? "builtin") === "builtin" &&
        template.art === detail.art && template.category === detail.category,
    ) ?? null
  );
}

function emptyUploadForm(patientId = ""): UploadFormState {
  return {
    file: null,
    patientId,
    orderId: "",
    appointmentId: "",
    autoName: "",
    art: "",
    category: "",
    status: "active",
    visibility: "internal",
    isMedical: false,
    klinik: "",
    ursprung: "",
    notes: "",
  };
}

function emptyGenerateForm(patientId = ""): GenerateFormState {
  return {
    templateId: "",
    patientId,
    orderId: "",
    appointmentId: "",
    replaceDocumentId: "",
    autoName: "",
    status: "draft",
    visibility: "patient_visible",
    language: "de",
    titleOverride: "",
    introduction: "",
    closingNote: "",
    klinik: "",
    ursprung: "",
    notes: "",
    textBlockKeys: [],
  };
}

function detailToEditForm(detail: DocumentItem): EditFormState {
  return {
    patientId: detail.patient_id ?? "",
    orderId: detail.order_id ?? "",
    appointmentId: detail.appointment_id ?? "",
    autoName: detail.auto_name,
    art: detail.art,
    category: detail.category ?? "",
    status: (detail.status as DocumentStatus) ?? "active",
    visibility: (detail.visibility as DocumentVisibility) ?? "internal",
    isMedical: detail.is_medical,
    klinik: detail.klinik ?? "",
    ursprung: detail.ursprung ?? "",
    notes: detail.notes ?? "",
  };
}

async function downloadDocument(id: string, filename: string) {
  const token = getAccessToken();
  const response = await fetch(buildApiUrl(`/documents/${id}/download`), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "document";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

async function openDocumentPreview(id: string, previewWindow?: Window | null) {
  const tr = runtimeTranslations();
  const token = getAccessToken();
  const response = await fetch(buildApiUrl(`/documents/${id}/download`), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.startsWith("text/html")) {
    const html = await response.text();
    const opened = writePreviewWindow(
      previewWindow ?? window.open("", "_blank", "noopener,noreferrer"),
      html,
    );
    if (!opened) {
      if (previewWindow) previewWindow.close();
      throw new Error(tr.documents_popup_blocked);
    }
    return;
  }

  const blob = await response.blob();
  const opened = openBlobPreviewWindow(previewWindow ?? null, blob);
  if (!opened) {
    if (previewWindow) previewWindow.close();
    throw new Error(tr.documents_popup_blocked);
  }
}

export function DocumentsPage() {
  const { user } = useAuth();

  if (user?.role === "patient") {
    return <PatientDocumentsPage />;
  }

  return <StaffDocumentsPage />;
}

function StaffDocumentsPage() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const [searchParams, setSearchParams] = useSearchParams();
  const text =
    lang === "de"
      ? {
          allPatients: "Alle Patienten",
          allStatuses: "Alle Status",
          allVisibility: "Alle Sichtbarkeiten",
          allCategories: "Alle Kategorien",
          resetFilters: "Filter zurücksetzen",
          selectedDocuments: (count: number) =>
            `${count} Dokument${count === 1 ? "" : "e"} ausgewählt`,
          current: "aktuell",
          historical: "historisch",
          needsCategorization: "Kategorisierung erforderlich",
          suggested: (art: string, category: string) =>
            `Vorgeschlagen: ${art} · ${category}`,
          suggestedClassification: "Vorgeschlagene Klassifikation:",
          newVersion: "Neue Version",
          pidFallback: "PID",
          uploadDescription:
            "Datei jetzt speichern und klassifizieren oder die Triage in der Intake-Queue abschließen lassen.",
          completedAt: (value: string) => ` · abgeschlossen ${value}`,
          revokedBadge: "Widerrufen",
          translatedByWorkspace: (name: string) => ` · Workspace ${name}`,
          noAccessTitle: "Dokumentenbereich",
          noAccessText: "Diese Rolle hat keinen Zugriff auf Dokumenten-Workflows.",
          versionOf: (current: number, total: number) => `v${current} von ${total}`,
          visibilityHeader: "Sichtbarkeit",
        }
      : {
          allPatients: "Все пациенты",
          allStatuses: "Все статусы",
          allVisibility: "Все уровни видимости",
          allCategories: "Все категории",
          resetFilters: "Сбросить фильтры",
          selectedDocuments: (count: number) =>
            `${count} документ${count === 1 ? "" : count < 5 ? "а" : "ов"} выбрано`,
          current: "текущая",
          historical: "историческая",
          needsCategorization: "Требуется категоризация",
          suggested: (art: string, category: string) =>
            `Предложено: ${art} · ${category}`,
          suggestedClassification: "Предлагаемая классификация:",
          newVersion: "Новая версия",
          pidFallback: "PID",
          uploadDescription:
            "Сохраните и классифицируйте файл сейчас или дайте intake-queue завершить триаж.",
          completedAt: (value: string) => ` · завершено ${value}`,
          revokedBadge: "Отозвано",
          translatedByWorkspace: (name: string) => ` · workspace ${name}`,
          noAccessTitle: "Раздел документов",
          noAccessText: "У этой роли нет доступа к документным workflow.",
          versionOf: (current: number, total: number) => `v${current} из ${total}`,
          visibilityHeader: "Видимость",
        };
  const documentsFailedLoadDocumentsText = t.documents_failed_load_documents;
  const documentsFailedLoadIntakeQueueText = t.documents_failed_load_intake_queue;
  const documentsFailedLoadDocumentText = t.documents_failed_load_document;
  const canView = canViewDocuments(user?.role);
  const canManage = canManageDocuments(user?.role);
  const canUpload = canUploadDocuments(user?.role);
  const canManageIntake = canManageDocumentIntake(user?.role);
  const canRequestTranslation = canRequestTranslations(user?.role);
  const canUpdateTranslation = canUpdateTranslations(user?.role);
  const canViewShares = canViewDocumentShares(user?.role);

  const [filters, setFilters] = useState<FiltersState>(() => ({
    search: searchParams.get("search") ?? "",
    patientId:
      searchParams.get("patient_id") ?? searchParams.get("patient") ?? "",
    orderId: searchParams.get("order_id") ?? searchParams.get("order") ?? "",
    appointmentId:
      searchParams.get("appointment_id") ??
      searchParams.get("appointment") ??
      "",
    status: searchParams.get("status") ?? "",
    visibility: searchParams.get("visibility") ?? "",
    art: searchParams.get("art") ?? "",
    category: searchParams.get("category") ?? "",
    dateFrom: searchParams.get("date_from") ?? "",
    dateTo: searchParams.get("date_to") ?? "",
    klinik: searchParams.get("klinik") ?? "",
    ursprung: searchParams.get("ursprung") ?? "",
  }));
  const deferredSearch = useDeferredValue(filters.search);

  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [intakeQueue, setIntakeQueue] = useState<DocumentItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [error, setError] = useState("");
  const [intakeError, setIntakeError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const [intakeActionId, setIntakeActionId] = useState("");

  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [arts, setArts] = useState<string[]>([]);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState<UploadFormState>(() =>
    emptyUploadForm(searchParams.get("patient") ?? ""),
  );
  const [uploadOrders, setUploadOrders] = useState<OrderOption[]>([]);
  const [uploadAppointments, setUploadAppointments] = useState<
    AppointmentOption[]
  >([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const [templateOpen, setTemplateOpen] = useState(false);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [templateTextBlocks, setTemplateTextBlocks] = useState<
    TemplateTextBlock[]
  >([]);
  const [generateForm, setGenerateForm] = useState<GenerateFormState>(() =>
    emptyGenerateForm(searchParams.get("patient") ?? ""),
  );
  const [generateOrders, setGenerateOrders] = useState<OrderOption[]>([]);
  const [generateAppointments, setGenerateAppointments] = useState<
    AppointmentOption[]
  >([]);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [generateError, setGenerateError] = useState("");

  const [selectedId, setSelectedId] = useState(
    searchParams.get("document") ?? "",
  );
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<DocumentItem | null>(null);
  const [detailVersions, setDetailVersions] = useState<DocumentItem[]>([]);
  const [translationRequests, setTranslationRequests] = useState<
    TranslationRequest[]
  >([]);
  const [translationDrafts, setTranslationDrafts] = useState<
    Record<string, TranslationWorkspaceDraft>
  >({});
  const translationDraftsRef = useRef<Record<string, TranslationWorkspaceDraft>>(
    {},
  );
  const [textExtraction, setTextExtraction] =
    useState<DocumentTextExtraction | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [translationBusy, setTranslationBusy] = useState(false);
  const [translationError, setTranslationError] = useState("");
  const [textExtractionBusy, setTextExtractionBusy] = useState(false);
  const [textExtractionError, setTextExtractionError] = useState("");
  const [translationForm, setTranslationForm] = useState({
    requestedLanguage: "en",
    note: "",
  });
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [detailOrders, setDetailOrders] = useState<OrderOption[]>([]);
  const [detailAppointments, setDetailAppointments] = useState<
    AppointmentOption[]
  >([]);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteReason, setDeleteReason] = useState("");

  const [shares, setShares] = useState<DocumentShare[]>([]);
  const [shareForm, setShareForm] = useState<ShareFormState>({
    targetType: "user",
    userId: "",
    providerId: "",
    channel: "email",
    message: "",
    requiresConfirmation: true,
  });
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState("");
  const [portalBusy, setPortalBusy] = useState(false);

  const selectedTemplate = useMemo(
    () =>
      templates.find((template) => template.id === generateForm.templateId) ??
      null,
    [generateForm.templateId, templates],
  );
  const currentDetailTemplate = useMemo(
    () => templateForDocument(templates, detail),
    [detail, templates],
  );
  const canReviewSelectedDocument = Boolean(
    !canManage &&
      canManageIntake &&
      detail &&
      detail.ursprung === "interpreter_upload" &&
      detail.status === "draft",
  );
  const availableTemplateBlocks = useMemo(() => {
    const allowed = new Set(selectedTemplate?.text_block_keys ?? []);
    return templateTextBlocks.filter((block) => allowed.has(block.key));
  }, [selectedTemplate, templateTextBlocks]);
  const activePortalShares = useMemo(
    () =>
      shares.filter(
        (share) => share.target_user_role === "patient" && !share.revoked_at,
      ),
    [shares],
  );
  const confirmedPortalShares = useMemo(
    () => activePortalShares.filter((share) => share.confirmed).length,
    [activePortalShares],
  );

  useEffect(() => {
    setSelectedId(searchParams.get("document") ?? "");
  }, [searchParams]);

  const documentsPath = useMemo(
    () => buildDocumentsPath({ ...filters, search: deferredSearch }),
    [deferredSearch, filters],
  );

  useEffect(() => {
    if (!canView) return;
    let active = true;
    async function loadLookups() {
      const [
        patientsResponse,
        providersResponse,
        staffResponse,
        categoriesResponse,
        templateCatalogResponse,
      ] = await Promise.all([
        apiFetch<PatientOption[]>("/patients?active_only=true").catch(() => []),
        canManage
          ? apiFetch<ProviderOption[]>("/providers?active_only=true").catch(
              () => [],
            )
          : Promise.resolve([]),
        apiFetch<StaffOption[]>("/documents/meta/staff").catch(() => []),
        apiFetch<CategoriesResponse>("/documents/meta/categories").catch(
          () => ({ categories: [], arts: [] }),
        ),
        canManage
          ? apiFetch<TemplateCatalogResponse>("/documents/templates").catch(
              () => ({ templates: [], text_blocks: [] }),
            )
          : Promise.resolve({ templates: [], text_blocks: [] }),
      ]);
      if (!active) return;
      startTransition(() => {
        setPatients(patientsResponse);
        setProviders(providersResponse);
        setStaff(staffResponse);
        setCategories(categoriesResponse.categories);
        setArts(categoriesResponse.arts);
        setTemplates(templateCatalogResponse.templates);
        setTemplateTextBlocks(templateCatalogResponse.text_blocks);
      });
    }
    void loadLookups();
    return () => {
      active = false;
    };
  }, [canManage, canView]);

  useEffect(() => {
    if (!canView) return;
    let active = true;
    async function loadDocuments() {
      setBusy(true);
      setError("");
      try {
        const rows = await apiFetch<DocumentItem[]>(documentsPath);
        if (!active) return;
        startTransition(() => setDocuments(rows));
      } catch (nextError) {
        if (!active) return;
        setDocuments([]);
        setError(
          nextError instanceof Error
            ? nextError.message
            : documentsFailedLoadDocumentsText,
        );
      } finally {
        if (active) setBusy(false);
      }
    }
    void loadDocuments();
    return () => {
      active = false;
    };
  }, [canView, documentsFailedLoadDocumentsText, documentsPath, version]);

  useEffect(() => {
    if (!canManageIntake) {
      setIntakeQueue([]);
      setIntakeBusy(false);
      setIntakeError("");
      setIntakeActionId("");
      return;
    }
    let active = true;
    async function loadIntakeQueue() {
      setIntakeBusy(true);
      setIntakeError("");
      try {
        const rows = await apiFetch<DocumentItem[]>("/documents/intake-queue");
        if (!active) return;
        startTransition(() => setIntakeQueue(rows));
      } catch (nextError) {
        if (!active) return;
        setIntakeQueue([]);
        setIntakeError(
          nextError instanceof Error
            ? nextError.message
            : documentsFailedLoadIntakeQueueText,
        );
      } finally {
        if (active) setIntakeBusy(false);
      }
    }
    void loadIntakeQueue();
    return () => {
      active = false;
    };
  }, [canManageIntake, documentsFailedLoadIntakeQueueText, version]);

  useEffect(() => {
    setSelectedDocumentIds((current) =>
      current.filter((id) => documents.some((item) => item.id === id)),
    );
  }, [documents]);

  useEffect(() => {
    if (!canView || !selectedId) {
      setDetail(null);
      setDetailVersions([]);
      setTranslationRequests([]);
      setTranslationDrafts({});
      setTextExtraction(null);
      setEditForm(null);
      setShares([]);
      return;
    }
    let active = true;
    async function loadDetail() {
      setDetailBusy(true);
      setDetailError("");
      setTranslationError("");
      setTextExtractionError("");
      try {
        const [
          documentResponse,
          shareResponse,
          versionResponse,
          translationResponse,
          extractionResponse,
        ] =
          await Promise.all([
            apiFetch<DocumentItem>(`/documents/${selectedId}`),
            canViewShares
              ? apiFetch<DocumentShare[]>(
                  `/documents/${selectedId}/shares`,
                ).catch(() => [])
              : Promise.resolve([]),
            apiFetch<DocumentItem[]>(`/documents/${selectedId}/versions`).catch(
              () => [],
            ),
            apiFetch<TranslationRequest[]>(
              `/documents/${selectedId}/translation-requests`,
            ).catch(() => []),
            apiFetch<DocumentTextExtraction>(
              `/documents/${selectedId}/text-extraction`,
            ).catch(() => null),
          ]);
        if (!active) return;
        setDetail(documentResponse);
        setDetailVersions(versionResponse);
        setTranslationRequests(translationResponse);
        setTextExtraction(extractionResponse);
        setEditForm(detailToEditForm(documentResponse));
        setShares(shareResponse);
      } catch (nextError) {
        if (!active) return;
        setDetail(null);
        setDetailVersions([]);
        setTranslationRequests([]);
        setTranslationDrafts({});
        setTextExtraction(null);
        setEditForm(null);
        setShares([]);
        setDetailError(
          nextError instanceof Error
            ? nextError.message
            : documentsFailedLoadDocumentText,
        );
      } finally {
        if (active) setDetailBusy(false);
      }
    }
    void loadDetail();
    return () => {
      active = false;
    };
  }, [canViewShares, canView, documentsFailedLoadDocumentText, selectedId]);

  useEffect(() => {
    if (!uploadOpen || !uploadForm.patientId) {
      setUploadOrders([]);
      setUploadAppointments([]);
      return;
    }
    let active = true;
    async function loadUploadContext() {
      const [orderRows, appointmentRows] = await Promise.all([
        apiFetch<OrderOption[]>(
          `/orders?patient_id=${uploadForm.patientId}`,
        ).catch(() => []),
        apiFetch<AppointmentOption[]>(
          `/appointments?patient_id=${uploadForm.patientId}`,
        ).catch(() => []),
      ]);
      if (!active) return;
      setUploadOrders(orderRows);
      setUploadAppointments(appointmentRows);
    }
    void loadUploadContext();
    return () => {
      active = false;
    };
  }, [uploadForm.patientId, uploadOpen]);

  useEffect(() => {
    const next: Record<string, TranslationWorkspaceDraft> = {};
    for (const request of translationRequests) {
      next[request.id] = {
        note: request.note ?? "",
        sourceLanguage: request.source_language ?? "",
        sourceText: request.source_text ?? "",
        translatedText: request.translated_text ?? "",
      };
    }
    translationDraftsRef.current = next;
    setTranslationDrafts(next);
  }, [translationRequests]);

  useEffect(() => {
    if (templates.length === 0) return;
    setGenerateForm((current) => {
      const fallbackTemplate = templates[0];
      const nextTemplate =
        templates.find((template) => template.id === current.templateId) ??
        fallbackTemplate;
      const allowedBlocks = new Set(nextTemplate.text_block_keys);
      return {
        ...current,
        templateId: nextTemplate.id,
        status: current.templateId
          ? current.status
          : nextTemplate.default_status,
        visibility: current.templateId
          ? current.visibility
          : nextTemplate.default_visibility,
        language: current.templateId
          ? current.language
          : resolveTemplateLanguage(current.patientId, nextTemplate, patients),
        autoName: current.autoName || nextTemplate.default_auto_name,
        textBlockKeys: current.textBlockKeys.filter((key) =>
          allowedBlocks.has(key),
        ),
      };
    });
  }, [patients, templates]);

  useEffect(() => {
    if (!templateOpen || !generateForm.patientId) {
      setGenerateOrders([]);
      setGenerateAppointments([]);
      return;
    }
    let active = true;
    async function loadGenerateContext() {
      const [orderRows, appointmentRows] = await Promise.all([
        apiFetch<OrderOption[]>(
          `/orders?patient_id=${generateForm.patientId}`,
        ).catch(() => []),
        apiFetch<AppointmentOption[]>(
          `/appointments?patient_id=${generateForm.patientId}`,
        ).catch(() => []),
      ]);
      if (!active) return;
      setGenerateOrders(orderRows);
      setGenerateAppointments(appointmentRows);
    }
    void loadGenerateContext();
    return () => {
      active = false;
    };
  }, [generateForm.patientId, templateOpen]);

  useEffect(() => {
    if (!generateForm.replaceDocumentId) return;
    if (
      detail?.id === generateForm.replaceDocumentId &&
      detail.patient_id === generateForm.patientId &&
      detail.art === selectedTemplate?.art
    ) {
      return;
    }
    setGenerateForm((current) =>
      current.replaceDocumentId
        ? { ...current, replaceDocumentId: "" }
        : current,
    );
  }, [
    detail?.art,
    detail?.id,
    detail?.patient_id,
    generateForm.patientId,
    generateForm.replaceDocumentId,
    selectedTemplate?.art,
  ]);

  useEffect(() => {
    if (!detail || !editForm?.patientId || !canManage) {
      setDetailOrders([]);
      setDetailAppointments([]);
      return;
    }
    const patientId = editForm.patientId;
    let active = true;
    async function loadDetailContext() {
      const [orderRows, appointmentRows] = await Promise.all([
        apiFetch<OrderOption[]>(`/orders?patient_id=${patientId}`).catch(
          () => [],
        ),
        apiFetch<AppointmentOption[]>(
          `/appointments?patient_id=${patientId}`,
        ).catch(() => []),
      ]);
      if (!active) return;
      setDetailOrders(orderRows);
      setDetailAppointments(appointmentRows);
    }
    void loadDetailContext();
    return () => {
      active = false;
    };
  }, [canManage, detail, editForm?.patientId]);

  function refresh() {
    startTransition(() => setVersion((current) => current + 1));
  }

  function openDocument(id: string) {
    const next = new URLSearchParams(searchParams);
    next.set("document", id);
    setSearchParams(next, { replace: true });
    setSelectedId(id);
  }

  function toggleDocumentSelection(id: string, checked: boolean) {
    setSelectedDocumentIds((current) => {
      if (checked) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((value) => value !== id);
    });
  }

  function closeDetail() {
    const next = new URLSearchParams(searchParams);
    next.delete("document");
    setSearchParams(next, { replace: true });
    setSelectedId("");
  }

  function handleUploadFileChange(event: ChangeEvent<HTMLInputElement>) {
    setUploadForm((current) => ({
      ...current,
      file: event.target.files?.[0] ?? null,
    }));
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uploadForm.file) {
      setUploadError(t.documents_file_required);
      return;
    }
    if (
      !uploadForm.patientId &&
      !uploadForm.orderId &&
      !uploadForm.appointmentId
    ) {
      setUploadError(t.documents_link_context_required);
      return;
    }
    setUploadBusy(true);
    setUploadError("");
    try {
      const constrainedUpload = !canManage;
      const formData = new FormData();
      formData.append("file", uploadForm.file);
      if (uploadForm.patientId)
        formData.append("patient_id", uploadForm.patientId);
      if (uploadForm.orderId) formData.append("order_id", uploadForm.orderId);
      if (uploadForm.appointmentId)
        formData.append("appointment_id", uploadForm.appointmentId);
      if (uploadForm.autoName.trim())
        formData.append("auto_name", uploadForm.autoName.trim());
      if (uploadForm.art.trim()) formData.append("art", uploadForm.art.trim());
      if (uploadForm.category) formData.append("category", uploadForm.category);
      formData.append(
        "status",
        constrainedUpload && user?.role === "interpreter"
          ? "draft"
          : uploadForm.status,
      );
      formData.append(
        "visibility",
        constrainedUpload ? "internal" : uploadForm.visibility,
      );
      if (uploadForm.isMedical) formData.append("is_medical", "true");
      if (uploadForm.klinik.trim())
        formData.append("klinik", uploadForm.klinik.trim());
      if (!constrainedUpload && uploadForm.ursprung.trim())
        formData.append("ursprung", uploadForm.ursprung.trim());
      if (uploadForm.notes.trim())
        formData.append("notes", uploadForm.notes.trim());
      const response = await apiFetch<UploadDocumentResponse>(
        "/documents/upload",
        {
        method: "POST",
        body: formData,
        },
      );
      setNotice(
        constrainedUpload
          ? t.documents_uploaded_internal_review
          : response.needs_categorization
            ? t.documents_uploaded_to_intake
            : t.documents_uploaded,
      );
      setUploadOpen(false);
      refresh();
      if (response.id) openDocument(response.id);
    } catch (nextError) {
      setUploadError(
        nextError instanceof Error
          ? nextError.message
          : t.documents_failed_upload,
      );
    } finally {
      setUploadBusy(false);
    }
  }

  async function handleApplyClassificationSuggestion(item: DocumentItem) {
    if (!item.classification_suggestion) return;
    setIntakeActionId(item.id);
    setNotice("");
    setError("");
    try {
      await apiFetch<{ ok: boolean }>(`/documents/${item.id}/update`, {
        method: "POST",
        body: JSON.stringify({
          art: item.classification_suggestion.art,
          category: item.classification_suggestion.category,
          is_medical: item.classification_suggestion.is_medical,
          status:
            item.ursprung === "interpreter_upload" && item.status === "draft"
              ? "active"
              : undefined,
        }),
      });
      setNotice(
        item.ursprung === "interpreter_upload" && item.status === "draft"
          ? t.documents_classification_applied_released
          : t.documents_classification_applied,
      );
      refresh();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t.documents_failed_apply_classification,
      );
    } finally {
      setIntakeActionId("");
    }
  }

  function applyGenerateTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId);
    setGenerateForm((current) => {
      if (!template) {
        return {
          ...current,
          templateId,
          replaceDocumentId: "",
          textBlockKeys: [],
        };
      }
      const previousTemplate = templates.find(
        (item) => item.id === current.templateId,
      );
      const allowedBlocks = new Set(template.text_block_keys);
      const nextLanguage = resolveTemplateLanguage(
        current.patientId,
        template,
        patients,
      );
      return {
        ...current,
        templateId,
        autoName:
          !current.autoName ||
          current.autoName === previousTemplate?.default_auto_name
            ? template.default_auto_name
            : current.autoName,
        status: template.default_status,
        visibility: template.default_visibility,
        language: template.supported_languages.includes(current.language)
          ? current.language
          : nextLanguage,
        replaceDocumentId:
          detail &&
          current.replaceDocumentId === detail.id &&
          detail.patient_id === current.patientId &&
          detail.art === template.art
            ? current.replaceDocumentId
            : "",
        textBlockKeys: current.textBlockKeys.filter((key) =>
          allowedBlocks.has(key),
        ),
      };
    });
  }

  function openReplacementTemplate(document: DocumentItem) {
    const template = templateForDocument(templates, document);
    if (!template || !document.patient_id) {
      setNotice(t.documents_not_linked_template);
      return;
    }
    setGenerateForm({
      templateId: template.id,
      patientId: document.patient_id,
      orderId: document.order_id ?? "",
      appointmentId: document.appointment_id ?? "",
      replaceDocumentId: document.id,
      autoName: document.auto_name,
      status:
        document.status === "archived"
          ? template.default_status
          : (document.status as DocumentStatus),
      visibility: (document.visibility as DocumentVisibility) ?? "patient_visible",
      language: resolveTemplateLanguage(document.patient_id, template, patients),
      titleOverride: "",
      introduction: "",
      closingNote: "",
      klinik: document.klinik ?? "",
      ursprung: document.ursprung ?? "",
      notes: document.notes ?? "",
      textBlockKeys: [],
    });
    setGenerateError("");
    setTemplateOpen(true);
  }

  async function handleGenerateDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate) {
      setGenerateError(t.documents_choose_template);
      return;
    }
    if (!generateForm.patientId) {
      setGenerateError(t.documents_patient_context_required);
      return;
    }

    const previewWindow = window.open("", "_blank", "noopener,noreferrer");
    setGenerateBusy(true);
    setGenerateError("");
    try {
      const response = await apiFetch<GenerateDocumentResponse>(
        "/documents/generate",
        {
          method: "POST",
          body: JSON.stringify({
            template_id: selectedTemplate.id,
            patient_id: generateForm.patientId,
            order_id: generateForm.orderId || null,
            appointment_id: generateForm.appointmentId || null,
            auto_name: generateForm.autoName.trim() || null,
            status: generateForm.status,
            visibility: generateForm.visibility,
            language: generateForm.language || null,
            replace_document_id: generateForm.replaceDocumentId || null,
            title_override: generateForm.titleOverride.trim() || null,
            introduction: generateForm.introduction.trim() || null,
            closing_note: generateForm.closingNote.trim() || null,
            klinik: generateForm.klinik.trim() || null,
            ursprung: generateForm.ursprung.trim() || null,
            notes: generateForm.notes.trim() || null,
            text_block_keys: generateForm.textBlockKeys,
          }),
        },
      );
      let previewOpened = false;
      if (response.mime_type.startsWith("text/html")) {
        previewOpened = writePreviewWindow(previewWindow, response.preview_html);
      } else if (response.id) {
        try {
          await openDocumentPreview(response.id, previewWindow);
          previewOpened = true;
        } catch {
          previewOpened = false;
        }
      }
      if (!previewOpened && previewWindow) {
        previewWindow.close();
      }
      setTemplateOpen(false);
      setNotice(
        previewOpened
          ? t.documents_generated_version_preview.replace(
              "{version}",
              String(response.version_number ?? 1),
            )
          : t.documents_generated_version.replace(
              "{version}",
              String(response.version_number ?? 1),
            ),
      );
      refresh();
      if (response.id) openDocument(response.id);
    } catch (nextError) {
      if (previewWindow) previewWindow.close();
      setGenerateError(
        nextError instanceof Error
          ? nextError.message
          : t.documents_failed_generate,
      );
    } finally {
      setGenerateBusy(false);
    }
  }

  async function handleOpenPreview() {
    if (!detail) return;
    try {
      await openDocumentPreview(detail.id);
      setNotice(t.documents_preview_opened);
    } catch (nextError) {
      setDetailError(
        nextError instanceof Error
          ? nextError.message
          : t.documents_failed_open_preview,
      );
    }
  }

  async function reloadTranslationRequests(documentId: string) {
    const rows = await apiFetch<TranslationRequest[]>(
      `/documents/${documentId}/translation-requests`,
    );
    setTranslationRequests(rows);
  }

  function updateTranslationDraft(
    requestId: string,
    patch: Partial<TranslationWorkspaceDraft>,
  ) {
    const nextDraft: TranslationWorkspaceDraft = {
      note: translationDraftsRef.current[requestId]?.note ?? "",
      sourceLanguage: translationDraftsRef.current[requestId]?.sourceLanguage ?? "",
      sourceText: translationDraftsRef.current[requestId]?.sourceText ?? "",
      translatedText: translationDraftsRef.current[requestId]?.translatedText ?? "",
      ...patch,
    };
    translationDraftsRef.current = {
      ...translationDraftsRef.current,
      [requestId]: nextDraft,
    };
    setTranslationDrafts((current) => ({
      ...current,
      [requestId]: nextDraft,
    }));
  }

  async function handleCreateTranslationRequest(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!detail) return;
    setTranslationBusy(true);
    setTranslationError("");
    try {
      await apiFetch(`/documents/${detail.id}/translation-requests`, {
        method: "POST",
        body: JSON.stringify({
          requested_language: translationForm.requestedLanguage,
          note: translationForm.note.trim() || null,
        }),
      });
      await reloadTranslationRequests(detail.id);
      setTranslationForm({ requestedLanguage: "en", note: "" });
      setNotice(t.documents_translation_created);
    } catch (nextError) {
      setTranslationError(
        nextError instanceof Error
          ? nextError.message
          : t.documents_failed_create_translation,
      );
    } finally {
      setTranslationBusy(false);
    }
  }

  async function handleRunTextExtraction() {
    if (!detail) return;
    setTextExtractionBusy(true);
    setTextExtractionError("");
    try {
      const response = await apiFetch<DocumentTextExtraction>(
        `/documents/${detail.id}/text-extraction/run`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      setTextExtraction(response);
      await reloadTranslationRequests(detail.id);
      setNotice(t.documents_extraction_updated);
    } catch (nextError) {
      setTextExtractionError(
        nextError instanceof Error
          ? nextError.message
          : t.documents_failed_extract,
      );
    } finally {
      setTextExtractionBusy(false);
    }
  }

  async function handleUpdateTranslationRequest(
    requestId: string,
    status: string,
    patch?: Partial<TranslationWorkspaceDraft>,
    successMessage?: string,
  ) {
    if (!detail) return;
    setTranslationBusy(true);
    setTranslationError("");
    try {
      const existingDraft = translationDraftsRef.current[requestId];
      const draft: TranslationWorkspaceDraft = {
        note: patch?.note ?? existingDraft?.note ?? "",
        sourceLanguage:
          patch?.sourceLanguage ?? existingDraft?.sourceLanguage ?? "",
        sourceText: patch?.sourceText ?? existingDraft?.sourceText ?? "",
        translatedText:
          patch?.translatedText ?? existingDraft?.translatedText ?? "",
      };
      await apiFetch(`/documents/translation-requests/${requestId}/update`, {
        method: "POST",
        body: JSON.stringify({
          status,
          note: draft.note.trim() || null,
          source_language: draft.sourceLanguage || null,
          source_text: draft.sourceText.trim() || null,
          translated_text: draft.translatedText.trim() || null,
        }),
      });
      await reloadTranslationRequests(detail.id);
      setNotice(
        successMessage ??
          t.documents_translation_marked.replace(
            "{status}",
            formatTranslationStatusLabel(status, t),
          ),
      );
    } catch (nextError) {
      setTranslationError(
        nextError instanceof Error
          ? nextError.message
          : t.documents_failed_update_translation,
      );
    } finally {
      setTranslationBusy(false);
    }
  }

  async function handleSaveTranslationWorkspace(requestId: string) {
    const request = translationRequests.find((item) => item.id === requestId);
    if (!request) return;
    await handleUpdateTranslationRequest(
      requestId,
      request.status,
      undefined,
      t.documents_translation_workspace_saved,
    );
  }

  function handleUseExtractedTextForTranslation(requestId: string) {
    if (!textExtraction?.extracted_text) return;
    updateTranslationDraft(requestId, {
      sourceText: textExtraction.extracted_text,
    });
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !editForm) {
      setSaveError(t.documents_save_data_unavailable);
      return;
    }
    if (canManage && (!editForm.autoName.trim() || !editForm.art.trim())) {
      setSaveError(t.documents_save_name_type_required);
      return;
    }
    if (!canManage && !canReviewSelectedDocument) {
      setSaveError(t.documents_save_forbidden);
      return;
    }
    if (!editForm.art.trim()) {
      setSaveError(t.documents_save_type_required);
      return;
    }
    setSaveBusy(true);
    setSaveError("");
    try {
      const payload = canManage
        ? {
            patient_id: editForm.patientId || null,
            order_id: editForm.orderId || null,
            appointment_id: editForm.appointmentId || null,
            auto_name: editForm.autoName.trim(),
            art: editForm.art.trim(),
            category: editForm.category || null,
            status: editForm.status,
            visibility: editForm.visibility,
            is_medical: editForm.isMedical,
            klinik: editForm.klinik.trim() || null,
            ursprung: editForm.ursprung.trim() || null,
            notes: editForm.notes.trim() || null,
          }
        : {
            art: editForm.art.trim(),
            category: editForm.category || null,
            is_medical: editForm.isMedical,
            status: "active",
            notes: editForm.notes.trim() || null,
          };
      await apiFetch<{ ok: boolean }>(`/documents/${detail.id}/update`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const fresh = await apiFetch<DocumentItem>(`/documents/${detail.id}`);
      setDetail(fresh);
      setEditForm(detailToEditForm(fresh));
      setNotice(
        canManage
          ? t.documents_metadata_updated_notice
          : t.documents_review_released_notice,
      );
      refresh();
    } catch (nextError) {
      setSaveError(
        nextError instanceof Error ? nextError.message : t.documents_failed_save,
      );
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleCreateShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetDocumentIds =
      selectedDocumentIds.length > 1
        ? selectedDocumentIds
        : detail
          ? [detail.id]
          : [];
    if (targetDocumentIds.length === 0) return;
    if (shareForm.targetType === "user" && !shareForm.userId) {
      setShareError(t.documents_choose_user_target);
      return;
    }
    if (shareForm.targetType === "provider" && !shareForm.providerId) {
      setShareError(t.documents_choose_provider_target);
      return;
    }
    if (shareForm.targetType === "provider" && !shareForm.message.trim()) {
      setShareError(t.documents_share_message_required);
      return;
    }
    setShareBusy(true);
    setShareError("");
    try {
      const payload =
        shareForm.targetType === "user"
          ? {
              shared_with_user_id: shareForm.userId,
              channel: shareForm.channel || null,
              message: shareForm.message.trim() || null,
              requires_confirmation: shareForm.requiresConfirmation,
            }
          : {
              shared_with_provider_id: shareForm.providerId,
              channel: shareForm.channel || null,
              message: shareForm.message.trim() || null,
              requires_confirmation: shareForm.requiresConfirmation,
            };
      if (targetDocumentIds.length > 1) {
        await apiFetch<{ ok: boolean }>("/documents/shares/bulk", {
          method: "POST",
          body: JSON.stringify({
            document_ids: targetDocumentIds,
            ...payload,
          }),
        });
      } else {
        await apiFetch<{ ok: boolean }>(
          `/documents/${targetDocumentIds[0]}/shares`,
          {
            method: "POST",
            body: JSON.stringify(payload),
          },
        );
      }
      if (detail) {
        setShares(await apiFetch<DocumentShare[]>(`/documents/${detail.id}/shares`));
      }
      setShareForm({
        targetType: "user",
        userId: "",
        providerId: "",
        channel: "email",
        message: "",
        requiresConfirmation: true,
      });
      setNotice(
        targetDocumentIds.length > 1
          ? t.documents_shared_count.replace(
              "{count}",
              String(targetDocumentIds.length),
            )
          : t.documents_share_created_notice,
      );
      refresh();
    } catch (nextError) {
      setShareError(
        nextError instanceof Error
          ? nextError.message
          : t.documents_failed_create_share,
      );
    } finally {
      setShareBusy(false);
    }
  }

  async function handleRevokeShare(shareId: string) {
    if (!detail) return;
    await apiFetch<{ ok: boolean }>(
      `/documents/${detail.id}/shares/${shareId}/revoke`,
      {
        method: "POST",
      },
    );
    setShares(
      await apiFetch<DocumentShare[]>(`/documents/${detail.id}/shares`),
    );
    setNotice(t.documents_share_revoked_notice);
    refresh();
  }

  async function handleConfirmShare(shareId: string) {
    if (!detail) return;
    await apiFetch<{ ok: boolean }>(
      `/documents/${detail.id}/shares/${shareId}/confirm`,
      {
        method: "POST",
      },
    );
    if (canManage) {
      setShares(
        await apiFetch<DocumentShare[]>(`/documents/${detail.id}/shares`),
      );
    }
    setNotice(t.documents_share_confirmed_notice);
    refresh();
  }

  async function handleReleaseToPortal() {
    if (!detail) return;
    setPortalBusy(true);
    setShareError("");
    try {
      await apiFetch(`/documents/${detail.id}/portal-release`, {
        method: "POST",
        body: JSON.stringify({
          channel: "patient_portal",
          requires_confirmation: true,
        }),
      });
      const [fresh, freshShares] = await Promise.all([
        apiFetch<DocumentItem>(`/documents/${detail.id}`),
        apiFetch<DocumentShare[]>(`/documents/${detail.id}/shares`),
      ]);
      setDetail(fresh);
      setEditForm(detailToEditForm(fresh));
      setShares(freshShares);
      setNotice(t.documents_portal_released_notice);
      refresh();
    } catch (nextError) {
      setShareError(
        nextError instanceof Error
          ? nextError.message
          : t.documents_failed_release_portal,
      );
    } finally {
      setPortalBusy(false);
    }
  }

  async function handleRevokePortalRelease() {
    if (!detail) return;
    setPortalBusy(true);
    setShareError("");
    try {
      await apiFetch(`/documents/${detail.id}/portal-release/revoke`, {
        method: "POST",
      });
      const [fresh, freshShares] = await Promise.all([
        apiFetch<DocumentItem>(`/documents/${detail.id}`),
        apiFetch<DocumentShare[]>(`/documents/${detail.id}/shares`),
      ]);
      setDetail(fresh);
      setEditForm(detailToEditForm(fresh));
      setShares(freshShares);
      setNotice(t.documents_portal_release_revoked_notice);
      refresh();
    } catch (nextError) {
      setShareError(
        nextError instanceof Error
          ? nextError.message
          : t.documents_failed_revoke_portal,
      );
    } finally {
      setPortalBusy(false);
    }
  }

  async function handleDeleteStoredFile() {
    if (!detail) return;
    if (!deleteReason.trim()) {
      setDeleteError(t.documents_delete_file_reason_required);
      return;
    }

    setDeleteBusy(true);
    setDeleteError("");
    try {
      const response = await apiFetch<{
        ok: boolean;
        document: DocumentItem;
      }>(`/documents/${detail.id}/delete`, {
        method: "POST",
        body: JSON.stringify({
          reason: deleteReason.trim(),
        }),
      });

      const [freshShares, freshVersions] = await Promise.all([
        canManage
          ? apiFetch<DocumentShare[]>(`/documents/${detail.id}/shares`).catch(
              () => [],
            )
          : Promise.resolve([]),
        apiFetch<DocumentItem[]>(`/documents/${detail.id}/versions`).catch(
          () => [],
        ),
      ]);

      setDetail(response.document);
      setEditForm(detailToEditForm(response.document));
      setShares(freshShares);
      setDetailVersions(freshVersions);
      setDeleteOpen(false);
      setDeleteReason("");
      setNotice(t.documents_file_deleted_notice);
      refresh();
    } catch (nextError) {
      setDeleteError(
        nextError instanceof Error
          ? nextError.message
          : t.documents_failed_delete_file,
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  if (!canView) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {text.noAccessTitle}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {text.noAccessText}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.documents_workspace_heading}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              onClick={refresh}
            >
              <RefreshCw className="size-3.5" />
              {t.documents_refresh}
            </Button>
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-lg gap-1.5"
                onClick={() => {
                  setGenerateForm((current) => ({
                    ...current,
                    replaceDocumentId: "",
                  }));
                  setTemplateOpen(true);
                }}
              >
                <FileText className="size-3.5" />
                {t.documents_generate_from_template}
              </Button>
            ) : null}
            {canUpload ? (
              <Button
                size="sm"
                className="h-8 rounded-lg gap-1.5"
                onClick={() => setUploadOpen(true)}
              >
                <FolderPlus className="size-3.5" />
                {t.documents_upload}
              </Button>
            ) : null}
          </>
        }
      />

      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <Banner tone="success">{notice}</Banner> : null}

      {canManageIntake &&
      (intakeBusy || intakeError || intakeQueue.length > 0) ? (
        <Section
          className="border-amber-200 bg-amber-50/40"
          title={
            <span>
              {t.documents_intake_queue}
              <span className="ml-2 font-normal text-muted-foreground">
                · {user?.role === "teamlead_interpreter"
                  ? t.documents_intake_interpreter_hint
                  : t.documents_intake_general_hint}
              </span>
            </span>
          }
          accessory={
            <Badge
              variant="outline"
              className="rounded-full border-amber-200 bg-amber-50 text-amber-700"
            >
              {intakeQueue.length} {t.documents_pending}
            </Badge>
          }
        >
          {intakeError ? <Banner tone="error">{intakeError}</Banner> : null}
          {intakeBusy ? (
            <TabLoader />
          ) : intakeQueue.length === 0 ? (
            <EmptyCell>{t.documents_no_intake_pending}</EmptyCell>
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {intakeQueue.map((item) => (
                <ListItem key={item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {localizeDocumentCode(item.auto_name, l)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[item.original_filename, item.patient_pid, item.patient_name]
                          .filter(Boolean)
                          .join(" · ") || t.documents_unlinked_document}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="rounded-full border-amber-200 bg-amber-50 text-amber-700"
                    >
                      {t.documents_needs_review}
                    </Badge>
                  </div>
                  {item.classification_suggestion ? (
                    <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-3 text-sm text-sky-900">
                      <p className="font-medium">
                        {text.suggested(
                          localizeDocumentCode(item.classification_suggestion.art, l),
                          localizeDocumentCode(item.classification_suggestion.category, l),
                        )}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-sky-700">
                        {t.documents_confidence}:{" "}
                        {formatConfidenceLabel(
                          item.classification_suggestion.confidence,
                          t as unknown as Record<string, string>,
                        )}
                      </p>
                      <p className="mt-2 text-sm text-sky-800/90">
                        {item.classification_suggestion.rationale}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-dashed border-border/60 bg-muted/25 px-3 py-3 text-sm text-muted-foreground">
                      {t.documents_no_auto_classification}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.classification_suggestion ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg gap-1.5"
                        disabled={intakeActionId === item.id}
                        onClick={() =>
                          void handleApplyClassificationSuggestion(item)
                        }
                      >
                        {intakeActionId === item.id ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : null}
                        {item.ursprung === "interpreter_upload" &&
                        item.status === "draft"
                          ? t.documents_apply_and_release
                          : t.documents_apply_suggestion}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg"
                      onClick={() => openDocument(item.id)}
                    >
                      {t.documents_open_document}
                    </Button>
                  </div>
                </ListItem>
              ))}
            </div>
          )}
        </Section>
      ) : null}

      <Section
        title={t.documents_title}
        accessory={<CountBadge>{documents.length}</CountBadge>}
      >
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  search: event.target.value,
                }))
              }
              className="h-9 rounded-lg bg-card pl-9"
              placeholder={t.common_search}
            />
          </div>
          <select
            value={filters.patientId}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                patientId: event.target.value,
                orderId: "",
                appointmentId: "",
              }))
            }
            className={selectClassName}
          >
            <option value="">{text.allPatients}</option>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patientOptionLabel(patient)}
              </option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                status: event.target.value,
              }))
            }
            className={selectClassName}
          >
            <option value="">{text.allStatuses}</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {formatDocumentStatusLabel(status, t)}
              </option>
            ))}
          </select>
          <select
            value={filters.visibility}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                visibility: event.target.value,
              }))
            }
            className={selectClassName}
          >
            <option value="">{text.allVisibility}</option>
            {VISIBILITY_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {formatVisibilityLabel(value, t)}
              </option>
            ))}
          </select>
          <Input
            value={filters.art}
            onChange={(event) =>
              setFilters((current) => ({ ...current, art: event.target.value }))
            }
            list="documents-art-options"
            className="h-9 rounded-lg bg-card"
            placeholder={t.documents_category}
          />
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <Input
            value={filters.orderId}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                orderId: event.target.value,
              }))
            }
            className="h-9 rounded-lg bg-card"
            placeholder={t.orders_title}
          />
          <Input
            value={filters.appointmentId}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                appointmentId: event.target.value,
              }))
            }
            className="h-9 rounded-lg bg-card"
            placeholder={t.appointments_title}
          />
          <Input
            type="date"
            value={filters.dateFrom}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                dateFrom: event.target.value,
              }))
            }
            aria-label={t.documents_date_from}
            className="h-9 rounded-lg bg-card"
          />
          <Input
            type="date"
            value={filters.dateTo}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                dateTo: event.target.value,
              }))
            }
            aria-label={t.documents_date_to}
            className="h-9 rounded-lg bg-card"
          />
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <select
            value={filters.category}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                category: event.target.value,
              }))
            }
            className={selectClassName}
            >
              <option value="">{text.allCategories}</option>
              {categories.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))}
            </select>
          <Input
            value={filters.klinik}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                klinik: event.target.value,
              }))
            }
            className="h-9 rounded-lg bg-card"
            placeholder={t.documents_clinic}
          />
          <Input
            value={filters.ursprung}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                ursprung: event.target.value,
              }))
            }
            className="h-9 rounded-lg bg-card"
            placeholder={t.documents_source}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-lg"
            onClick={() =>
              setFilters({
                search: "",
                patientId: "",
                orderId: "",
                appointmentId: "",
                status: "",
                visibility: "",
                art: "",
                category: "",
                dateFrom: "",
                dateTo: "",
                klinik: "",
                ursprung: "",
              })
            }
          >
            {text.resetFilters}
          </Button>
        </div>
        <datalist id="documents-art-options">
          {arts.map((art) => (
            <option key={art} value={art} />
          ))}
        </datalist>
        {selectedDocumentIds.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/50 bg-muted/25 px-4 py-3 text-sm text-foreground">
            <span>{text.selectedDocuments(selectedDocumentIds.length)}</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg"
                onClick={() =>
                  setSelectedDocumentIds(documents.map((item) => item.id))
                }
              >
                {t.documents_select_all_shown}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg"
                onClick={() => setSelectedDocumentIds([])}
              >
                {t.documents_clear_selection}
              </Button>
            </div>
          </div>
        ) : null}

        {busy ? (
          <TabLoader />
        ) : documents.length === 0 ? (
          <EmptyCell>{t.documents_no_documents_match}</EmptyCell>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/40">
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={t.documents_select_bulk_share}
                        checked={
                          documents.length > 0 &&
                          documents.every((d) =>
                            selectedDocumentIds.includes(d.id),
                          )
                        }
                        onChange={(event) =>
                          setSelectedDocumentIds(
                            event.target.checked
                              ? documents.map((d) => d.id)
                              : [],
                          )
                        }
                        className="size-4 rounded border-input"
                      />
                    </th>
                    <th className="px-3 py-2.5 font-medium">{t.documents_filename}</th>
                    <th className="px-3 py-2.5 font-medium">{t.orders_patient}</th>
                    <th className="px-3 py-2.5 font-medium">{t.documents_category}</th>
                    <th className="px-3 py-2.5 font-medium">{t.users_status}</th>
                    <th className="px-3 py-2.5 font-medium">{text.visibilityHeader}</th>
                    <th className="px-3 py-2.5 font-medium text-right">
                      {t.documents_size}
                    </th>
                    <th className="px-3 py-2.5 font-medium">{t.documents_uploaded_by}</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((item) => (
                    <tr
                      key={item.id}
                      className={cn(
                        "group/row border-t border-border transition-colors hover:bg-muted/40 cursor-pointer",
                        selectedId === item.id && "bg-sky-50/60",
                      )}
                      onClick={() => openDocument(item.id)}
                    >
                      <td
                        className="w-10 px-3 py-2.5"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={t.documents_select_bulk_share}
                          checked={selectedDocumentIds.includes(item.id)}
                          onChange={(event) =>
                            toggleDocumentSelection(item.id, event.target.checked)
                          }
                          className="size-4 rounded border-input"
                        />
                      </td>
                      <td className="px-3 py-2.5 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate font-medium text-foreground">
                            {localizeDocumentCode(item.auto_name, l)}
                          </span>
                          {item.needs_categorization ? (
                            <Badge
                              variant="outline"
                              className="rounded-full text-[10px] border-amber-200 bg-amber-50 text-amber-700 shrink-0"
                            >
                              {text.needsCategorization}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                          <span className="truncate">
                            {item.original_filename ?? t.documents_unclassified}
                          </span>
                          <span className="text-muted-foreground/60">·</span>
                          <span>v{item.version_number}</span>
                          {item.is_latest_version ? (
                            <>
                              <span className="text-muted-foreground/60">·</span>
                              <span>{text.current}</span>
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {item.patient_name ? (
                          <div className="min-w-0">
                            <span className="font-mono text-xs text-muted-foreground">
                              {item.patient_pid ?? text.pidFallback}
                            </span>
                            <div className="truncate text-foreground">
                              {item.patient_name}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">
                            {t.common_not_set}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {item.art || item.category ? (
                          <div className="min-w-0">
                            {item.art ? (
                              <div className="truncate text-foreground">
                                {localizeDocumentCode(item.art, l)}
                              </div>
                            ) : null}
                            {item.category ? (
                              <div className="truncate text-xs text-muted-foreground">
                                {localizeDocumentCode(item.category, l)}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">
                            {t.documents_unclassified}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant="outline"
                          className={cn("rounded-full text-[10px]", statusBadge(item.status))}
                        >
                          {formatDocumentStatusLabel(item.status, t)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col items-start gap-1">
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full text-[10px]",
                              visibilityBadge(item.visibility),
                            )}
                          >
                            {formatVisibilityLabel(item.visibility, t)}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full text-[10px]",
                              sensitivityBadge(item.data_sensitivity),
                            )}
                          >
                            {formatSensitivityLabel(item.data_sensitivity)}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {formatFileSize(item.file_size)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-foreground truncate">
                          {item.uploaded_by_name || t.documents_unknown_uploader}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDateTime(item.updated_at)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      <Sheet open={templateOpen} onOpenChange={setTemplateOpen}>
        <SheetContent side="right" className="w-full sm:max-w-[880px]">
          <form
            onSubmit={handleGenerateDocument}
            className="flex flex-col flex-1 min-h-0"
          >
            <SheetHeader className="shrink-0 border-b border-border/60 px-4 pt-3 pb-3">
              <SheetTitle>{t.documents_generate_title}</SheetTitle>
              <SheetDescription>{t.documents_generate_description}</SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {generateError ? (
              <Banner tone="error">{generateError}</Banner>
            ) : null}
            {selectedTemplate ? (
              <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-900">
                <p className="font-semibold">{selectedTemplate.label}</p>
                <p className="mt-1 text-sky-800/80">
                  {selectedTemplate.description}
                </p>
              </div>
            ) : null}
            {generateForm.replaceDocumentId && detail?.id === generateForm.replaceDocumentId ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                {t.documents_generate_replace_warning}{" "}
                {detail.version_number}.
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.documents_category} required>
                <select
                  value={generateForm.templateId}
                  onChange={(event) =>
                    applyGenerateTemplate(event.target.value)
                  }
                  className={selectClassName}
                >
                  <option value="">{t.documents_select_template}</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.provider_name
                        ? `${template.label} · ${template.provider_name}`
                        : template.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.patients_languages} required>
                <select
                  value={generateForm.language}
                  onChange={(event) =>
                    setGenerateForm((current) => ({
                      ...current,
                      language: event.target.value,
                    }))
                  }
                  className={selectClassName}
                  disabled={!selectedTemplate}
                >
                  {(selectedTemplate?.supported_languages ?? ["de"]).map(
                    (language) => (
                      <option key={language} value={language}>
                        {formatLanguageLabel(language)}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field label={t.documents_filename}>
                <Input
                  value={generateForm.autoName}
                  onChange={(event) =>
                    setGenerateForm((current) => ({
                      ...current,
                      autoName: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border-border/60 bg-muted/25"
                />
              </Field>
              <Field label={t.orders_patient} required>
                <select
                  value={generateForm.patientId}
                  onChange={(event) => {
                    const patientId = event.target.value;
                    setGenerateForm((current) => ({
                      ...current,
                      patientId,
                      orderId: "",
                      appointmentId: "",
                      replaceDocumentId: "",
                      language: resolveTemplateLanguage(
                        patientId,
                        selectedTemplate,
                        patients,
                      ),
                    }));
                  }}
                  className={selectClassName}
                >
                  <option value="">{t.documents_select_patient}</option>
                  {patients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patientOptionLabel(patient)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.orders_title}>
                <select
                  value={generateForm.orderId}
                  onChange={(event) =>
                    setGenerateForm((current) => ({
                      ...current,
                      orderId: event.target.value,
                    }))
                  }
                  className={selectClassName}
                  disabled={!generateForm.patientId}
                >
                  <option value="">{t.documents_patient_wide_context}</option>
                  {generateOrders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.order_number} · {order.patient_pid}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.appointments_title}>
                <select
                  value={generateForm.appointmentId}
                  onChange={(event) =>
                    setGenerateForm((current) => ({
                      ...current,
                      appointmentId: event.target.value,
                    }))
                  }
                  className={selectClassName}
                  disabled={!generateForm.patientId}
                >
                  <option value="">{t.documents_all_appointments_scope}</option>
                  {generateAppointments.map((appointment) => (
                    <option key={appointment.id} value={appointment.id}>
                      {appointment.title} · {formatDate(appointment.date)}
                      {appointment.time_start
                        ? ` · ${appointment.time_start}`
                        : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.users_status}>
                <select
                  value={generateForm.status}
                  onChange={(event) =>
                    setGenerateForm((current) => ({
                      ...current,
                      status: event.target.value as DocumentStatus,
                    }))
                  }
                  className={selectClassName}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {formatDocumentStatusLabel(status, t)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.users_status}>
                <select
                  value={generateForm.visibility}
                  onChange={(event) =>
                    setGenerateForm((current) => ({
                      ...current,
                      visibility: event.target.value as DocumentVisibility,
                    }))
                  }
                  className={selectClassName}
                >
                  {VISIBILITY_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {formatVisibilityLabel(value, t)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.documents_filename}>
                <Input
                  value={generateForm.titleOverride}
                  onChange={(event) =>
                    setGenerateForm((current) => ({
                      ...current,
                      titleOverride: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border-border/60 bg-muted/25"
                  placeholder={t.patients_notes}
                />
              </Field>
              <Field label={t.common_provider}>
                <Input
                  value={generateForm.klinik}
                  onChange={(event) =>
                    setGenerateForm((current) => ({
                      ...current,
                      klinik: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border-border/60 bg-muted/25"
                  placeholder={t.common_provider}
                />
              </Field>
              <Field label={t.documents_source}>
                <Input
                  value={generateForm.ursprung}
                  onChange={(event) =>
                    setGenerateForm((current) => ({
                      ...current,
                      ursprung: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border-border/60 bg-muted/25"
                  placeholder={t.documents_default_template_source.replace(
                    "{id}",
                    selectedTemplate?.id ?? "{id}",
                  )}
                />
              </Field>
            </div>
            {availableTemplateBlocks.length > 0 ? (
              <div className="space-y-3 rounded-xl border border-border/60 bg-muted/25 p-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {t.documents_text_blocks}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.documents_text_blocks_hint}
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {availableTemplateBlocks.map((block) => {
                    const checked = generateForm.textBlockKeys.includes(
                      block.key,
                    );
                    return (
                      <label
                        key={block.key}
                        className="flex gap-3 rounded-lg border border-border/60 bg-card px-4 py-3 text-sm text-foreground"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setGenerateForm((current) => ({
                              ...current,
                              textBlockKeys: event.target.checked
                                ? [...current.textBlockKeys, block.key]
                                : current.textBlockKeys.filter(
                                    (item) => item !== block.key,
                                  ),
                            }))
                          }
                          className="mt-0.5 size-4 rounded border-input"
                        />
                        <span>
                          <span className="block font-medium text-foreground">
                            {block.label}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {block.description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.patients_notes}>
                <textarea
                  value={generateForm.introduction}
                  onChange={(event) =>
                    setGenerateForm((current) => ({
                      ...current,
                      introduction: event.target.value,
                    }))
                  }
                  className={textareaClassName}
                  placeholder={t.patients_notes}
                />
              </Field>
              <Field label={t.patients_notes}>
                <textarea
                  value={generateForm.closingNote}
                  onChange={(event) =>
                    setGenerateForm((current) => ({
                      ...current,
                      closingNote: event.target.value,
                    }))
                  }
                  className={textareaClassName}
                  placeholder={t.patients_notes}
                />
              </Field>
            </div>
            <Field label={t.patients_notes}>
              <textarea
                value={generateForm.notes}
                onChange={(event) =>
                  setGenerateForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                className={textareaClassName}
                placeholder={t.patients_notes}
              />
            </Field>
            </div>
            <div className="shrink-0 flex justify-end gap-2 border-t border-border/60 px-4 py-3 bg-popover">
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg"
                onClick={() => setTemplateOpen(false)}
              >
                {t.common_cancel}
              </Button>
              <Button
                type="submit"
                className="h-9 rounded-lg gap-1.5"
                disabled={generateBusy || templates.length === 0}
              >
                {generateBusy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <FileText className="size-4" />
                )}
                {generateBusy
                  ? t.documents_generating
                  : t.documents_generate_document}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={uploadOpen} onOpenChange={setUploadOpen}>
        <SheetContent side="right" className="w-full sm:max-w-[760px]">
          <form onSubmit={handleUpload} className="flex flex-col flex-1 min-h-0">
            <SheetHeader className="shrink-0 border-b border-border/60 px-4 pt-3 pb-3">
              <SheetTitle>{t.documents_upload}</SheetTitle>
              <SheetDescription>
                {text.uploadDescription}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {uploadError ? <Banner tone="error">{uploadError}</Banner> : null}
            {!canManage ? (
              <Banner tone="warning">
                {user?.role === "interpreter"
                  ? t.documents_upload_interpreter_hint
                  : t.documents_upload_teamlead_hint}
              </Banner>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.documents_filename} required>
                <Input
                  type="file"
                  onChange={handleUploadFileChange}
                  className="h-10 rounded-xl border-border/60 bg-muted/25"
                />
              </Field>
              <Field label={t.documents_filename}>
                <Input
                  value={uploadForm.autoName}
                  onChange={(event) =>
                    setUploadForm((current) => ({
                      ...current,
                      autoName: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border-border/60 bg-muted/25"
                />
              </Field>
              <Field label={t.orders_patient}>
                <select
                  value={uploadForm.patientId}
                  onChange={(event) =>
                    setUploadForm((current) => ({
                      ...current,
                      patientId: event.target.value,
                      orderId: "",
                      appointmentId: "",
                    }))
                  }
                  className={selectClassName}
                >
                  <option value="">{t.documents_select_patient}</option>
                  {patients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patientOptionLabel(patient)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.orders_title}>
                <select
                  value={uploadForm.orderId}
                  onChange={(event) =>
                    setUploadForm((current) => ({
                      ...current,
                      orderId: event.target.value,
                    }))
                  }
                  className={selectClassName}
                  disabled={!uploadForm.patientId}
                >
                  <option value="">{t.documents_optional_order_link}</option>
                  {uploadOrders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.order_number} · {order.patient_pid}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.appointments_title}>
                <select
                  value={uploadForm.appointmentId}
                  onChange={(event) =>
                    setUploadForm((current) => ({
                      ...current,
                      appointmentId: event.target.value,
                    }))
                  }
                  className={selectClassName}
                  disabled={!uploadForm.patientId}
                >
                  <option value="">{t.documents_optional_appointment_link}</option>
                  {uploadAppointments.map((appointment) => (
                    <option key={appointment.id} value={appointment.id}>
                      {appointment.title} · {formatDate(appointment.date)}
                      {appointment.time_start
                        ? ` · ${appointment.time_start}`
                        : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.documents_category}>
                <Input
                  value={uploadForm.art}
                  onChange={(event) =>
                    setUploadForm((current) => ({
                      ...current,
                      art: event.target.value,
                    }))
                  }
                  list="documents-art-options"
                  className="h-10 rounded-xl border-border/60 bg-muted/25"
                  placeholder={t.documents_auto_classification_optional}
                />
              </Field>
              <Field label={t.documents_category}>
                <select
                  value={uploadForm.category}
                  onChange={(event) =>
                    setUploadForm((current) => ({
                      ...current,
                      category: event.target.value,
                    }))
                  }
                  className={selectClassName}
                >
                  <option value="">{t.documents_no_category}</option>
                  {categories.map((category) => (
                    <option key={category.key} value={category.key}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </Field>
              {canManage ? (
                <Field label={t.users_status}>
                  <select
                    value={uploadForm.status}
                    onChange={(event) =>
                      setUploadForm((current) => ({
                        ...current,
                        status: event.target.value as DocumentStatus,
                      }))
                    }
                    className={selectClassName}
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {formatDocumentStatusLabel(status, t)}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              {canManage ? (
                <Field label={t.users_status}>
                  <select
                    value={uploadForm.visibility}
                    onChange={(event) =>
                      setUploadForm((current) => ({
                        ...current,
                        visibility: event.target.value as DocumentVisibility,
                      }))
                    }
                    className={selectClassName}
                  >
                    {VISIBILITY_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {formatVisibilityLabel(value, t)}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <Field label={t.common_provider}>
                <Input
                  value={uploadForm.klinik}
                  onChange={(event) =>
                    setUploadForm((current) => ({
                      ...current,
                      klinik: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border-border/60 bg-muted/25"
                />
              </Field>
              {canManage ? (
                <Field label={t.documents_source}>
                  <Input
                    value={uploadForm.ursprung}
                    onChange={(event) =>
                      setUploadForm((current) => ({
                        ...current,
                        ursprung: event.target.value,
                      }))
                    }
                    className="h-10 rounded-xl border-border/60 bg-muted/25"
                  />
                </Field>
              ) : null}
            </div>
            <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={uploadForm.isMedical}
                onChange={(event) =>
                  setUploadForm((current) => ({
                    ...current,
                    isMedical: event.target.checked,
                  }))
                }
                className="size-4 rounded border-input"
              />
              {t.documents_mark_medical_data}
            </label>
            <Field label={t.patients_notes}>
              <textarea
                value={uploadForm.notes}
                onChange={(event) =>
                  setUploadForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                className={textareaClassName}
              />
            </Field>
            </div>
            <div className="shrink-0 flex justify-end gap-2 border-t border-border/60 px-4 py-3 bg-popover">
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg"
                onClick={() => setUploadOpen(false)}
              >
                {t.common_cancel}
              </Button>
              <Button
                type="submit"
                className="h-9 rounded-lg gap-1.5"
                disabled={uploadBusy}
              >
                {uploadBusy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <FolderPlus className="size-4" />
                )}
                {uploadBusy ? t.documents_uploading : t.documents_upload}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) {
            setDeleteError("");
            setDeleteReason("");
          }
        }}
      >
        <DialogContent className="max-w-2xl rounded-xl p-0">
          <DialogHeader className="border-b border-border/70 px-6 pt-6 pb-4">
            <DialogTitle>{t.documents_delete_file}</DialogTitle>
            <DialogDescription>
              {t.documents_delete_file_description}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleDeleteStoredFile();
            }}
            className="space-y-5 px-6 py-5"
          >
            {deleteError ? <Banner tone="error">{deleteError}</Banner> : null}
            <Banner tone="warning">{t.documents_delete_file_hint}</Banner>
            <Field label={t.documents_delete_file_reason} required>
              <textarea
                value={deleteReason}
                onChange={(event) => setDeleteReason(event.target.value)}
                placeholder={t.documents_delete_file_reason_placeholder}
                className={textareaClassName}
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg"
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleteError("");
                  setDeleteReason("");
                }}
              >
                {t.common_cancel}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                className="h-9 rounded-lg gap-1.5"
                disabled={deleteBusy}
              >
                {deleteBusy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                {deleteBusy ? t.documents_deleting : t.documents_delete_file_confirm}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet
        open={Boolean(selectedId)}
        onOpenChange={(open) => (!open ? closeDetail() : undefined)}
      >
        <SheetContent side="right" className="w-full sm:max-w-[820px]">
          <SheetHeader className="border-b border-border/70 pb-4">
            <SheetTitle>{detail?.auto_name || t.documents_title}</SheetTitle>
            <SheetDescription>{t.documents_detail_description}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            {detailBusy ? (
              <div className="flex min-h-[280px] items-center justify-center text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                {t.documents_loading_document}
              </div>
            ) : detailError ? (
              <div className="pt-5">
                <Banner tone="error">{detailError}</Banner>
              </div>
            ) : detail ? (
              <div className="space-y-6 pt-5">
                <section className="rounded-xl border border-border/60 bg-muted/25 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
                            statusBadge(detail.status),
                          )}
                        >
                          {formatDocumentStatusLabel(detail.status, t)}
                        </span>
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
                            visibilityBadge(detail.visibility),
                          )}
                        >
                          {formatVisibilityLabel(detail.visibility, t)}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full",
                            sensitivityBadge(detail.data_sensitivity),
                          )}
                        >
                          {formatSensitivityLabel(detail.data_sensitivity)}
                        </Badge>
                      </div>
                      <p className="mt-3 text-xl font-semibold text-foreground">
                        {localizeDocumentCode(detail.auto_name, l)}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {[
                          detail.original_filename,
                          detail.mime_type,
                          formatFileSize(detail.file_size),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        {text.versionOf(detail.version_number, detail.version_count)}
                        {detail.is_latest_version
                          ? ` · ${text.current}`
                          : ` · ${text.historical}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {canManage && currentDetailTemplate ? (
                        <Button
                          variant="outline"
                          className="rounded-lg"
                          onClick={() => openReplacementTemplate(detail)}
                        >
                          <FileText className="size-4" />
                          {text.newVersion}
                        </Button>
                      ) : null}
                      {detail.has_stored_file &&
                      (detail.mime_type?.startsWith("text/html") ||
                        detail.mime_type?.startsWith("application/pdf")) ? (
                        <Button
                          variant="outline"
                          className="rounded-lg"
                          onClick={() => void handleOpenPreview()}
                        >
                          <FileText className="size-4" />
                          {t.documents_preview}
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        className="rounded-lg"
                        disabled={!detail.has_stored_file}
                        onClick={() =>
                          void downloadDocument(
                            detail.id,
                            detail.original_filename ?? detail.auto_name,
                          )
                        }
                      >
                        <Download className="size-4" />
                        {t.documents_download}
                      </Button>
                      {canManage && detail.has_stored_file ? (
                        <Button
                          variant="destructive"
                          className="rounded-lg"
                          onClick={() => {
                            setDeleteError("");
                            setDeleteReason("");
                            setDeleteOpen(true);
                          }}
                        >
                          <Trash2 className="size-4" />
                          {t.documents_delete_file}
                        </Button>
                      ) : null}
                      {detail.patient_id ? (
                        <StaffLink
                          to={`/patients?patient=${detail.patient_id}`}
                          className="inline-flex h-10 items-center rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          {t.orders_patient}
                        </StaffLink>
                      ) : null}
                      {detail.order_id ? (
                        <StaffLink
                          to={`/orders?order=${detail.order_id}`}
                          className="inline-flex h-10 items-center rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          {t.orders_title}
                        </StaffLink>
                      ) : null}
                      {detail.appointment_id ? (
                        <StaffLink
                          to={`/appointments?appointment=${detail.appointment_id}`}
                          className="inline-flex h-10 items-center rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          {t.appointments_title}
                        </StaffLink>
                      ) : null}
                    </div>
                  </div>
                </section>

                {!detail.has_stored_file && detail.file_deleted_at ? (
                  <Banner tone="warning">
                    <div className="space-y-1">
                      <div>
                        {t.documents_file_deleted_banner.replace(
                          "{datetime}",
                          formatDateTime(detail.file_deleted_at),
                        )}
                        {detail.file_deleted_by_name
                          ? ` · ${t.documents_file_deleted_by.replace(
                              "{name}",
                              detail.file_deleted_by_name,
                            )}`
                          : ""}
                      </div>
                      {detail.file_delete_reason ? (
                        <div className="text-xs">
                          {t.documents_delete_file_reason}:{" "}
                          {detail.file_delete_reason}
                        </div>
                      ) : null}
                    </div>
                  </Banner>
                ) : null}

                <SectionCard title={t.common_provider}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <DetailField
                      label={t.orders_patient}
                      value={
                        detail.patient_name
                          ? `${detail.patient_pid ?? text.pidFallback} · ${detail.patient_name}`
                          : t.common_not_set
                      }
                    />
                    <DetailField
                      label={t.orders_title}
                      value={detail.order_number || t.common_not_set}
                    />
                    <DetailField
                      label={t.appointments_title}
                      value={detail.appointment_title || t.common_not_set}
                    />
                    <DetailField
                      label={t.documents_category}
                      value={detail.art || t.common_not_set}
                    />
                    <DetailField
                      label={t.documents_category}
                      value={detail.category || t.common_not_set}
                    />
                    <DetailField
                      label={t.common_provider}
                      value={detail.klinik || t.common_not_set}
                    />
                    <DetailField
                      label={t.documents_source}
                      value={detail.ursprung || t.common_not_set}
                    />
                    <DetailField
                      label={t.documents_uploaded_by}
                      value={detail.uploaded_by_name || t.documents_unknown_uploader}
                    />
                    <DetailField
                      label={t.users_created}
                      value={formatDateTime(detail.created_at)}
                    />
                    <DetailField
                      label={t.documents_updated}
                      value={formatDateTime(detail.updated_at)}
                    />
                    <DetailField
                      label={t.documents_version_chain}
                      value={text.versionOf(detail.version_number, detail.version_count)}
                    />
                  </div>
                  {detail.notes ? (
                    <div className="mt-4 rounded-lg border border-border/60 bg-card px-4 py-3 text-sm text-foreground">
                      {detail.notes}
                    </div>
                  ) : null}
                </SectionCard>

                {detailVersions.length > 0 ? (
                  <SectionCard title={t.documents_version_history}>
                    <div className="space-y-3">
                      {detailVersions.map((version) => (
                        <button
                          key={version.id}
                          type="button"
                          onClick={() => openDocument(version.id)}
                          className={cn(
                            "w-full rounded-lg border px-4 py-3 text-left transition",
                            version.id === detail.id
                              ? "border-sky-300 bg-sky-50"
                              : "border-border/60 bg-card hover:border-input",
                          )}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className="rounded-full border-border/60 bg-card text-foreground"
                                >
                                  v{version.version_number}
                                </Badge>
                                {!version.is_latest_version ? (
                                  <Badge
                                    variant="outline"
                                    className="rounded-full border-border/60 bg-muted text-foreground"
                                  >
                                    {t.documents_archived}
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="mt-2 text-sm font-semibold text-foreground">
                                {version.auto_name}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {formatDateTime(version.created_at)}
                              </p>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {version.original_filename || version.art}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </SectionCard>
                ) : null}

                <SectionCard title={t.documents_text_extraction}>
                  {textExtractionError ? (
                    <Banner tone="error">{textExtractionError}</Banner>
                  ) : null}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full",
                            textExtractionStatusBadge(
                              textExtraction?.status ?? "not_started",
                            ),
                          )}
                        >
                          {formatExtractionStatusLabel(
                            textExtraction?.status ?? "not_started",
                            t,
                          )}
                        </Badge>
                        {textExtraction?.method ? (
                          <Badge
                            variant="outline"
                            className="rounded-full border-border/60 bg-card text-foreground"
                          >
                            {formatExtractionMethodLabel(textExtraction.method)}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {textExtraction?.extracted_at
                          ? t.documents_last_processed.replace(
                              "{datetime}",
                              formatDateTime(textExtraction.extracted_at),
                            )
                          : t.documents_no_extraction_run}
                        {textExtraction?.extracted_by_name
                          ? ` · ${textExtraction.extracted_by_name}`
                          : ""}
                      </p>
                    </div>
                    {canRequestTranslation ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl"
                        disabled={textExtractionBusy}
                        onClick={() => void handleRunTextExtraction()}
                      >
                        {textExtractionBusy ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <RefreshCw className="size-4" />
                        )}
                        {t.documents_run_extraction}
                      </Button>
                    ) : null}
                  </div>
                  {textExtraction?.message ? (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {textExtraction.message}
                    </div>
                  ) : null}
                  {textExtraction?.extracted_text ? (
                    <div className="mt-4 space-y-2">
                      <Label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        {t.documents_extracted_text}
                      </Label>
                      <textarea
                        readOnly
                        value={textExtraction.extracted_text}
                        className={textareaClassName}
                      />
                    </div>
                  ) : (
                    <div className="mt-4 rounded-lg border border-dashed border-border/60 bg-muted/25 px-4 py-5 text-sm text-muted-foreground">
                      {t.documents_no_extracted_text}
                    </div>
                  )}
                </SectionCard>

                {detail.patient_id ? (
                  <SectionCard title={t.documents_translation_requests}>
                    {translationError ? (
                      <Banner tone="error">{translationError}</Banner>
                    ) : null}
                    {canRequestTranslation ? (
                      <form
                        onSubmit={handleCreateTranslationRequest}
                        className="space-y-4"
                      >
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label={t.patients_languages} required>
                            <select
                              value={translationForm.requestedLanguage}
                              onChange={(event) =>
                                setTranslationForm((current) => ({
                                  ...current,
                                  requestedLanguage: event.target.value,
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="de">{formatLanguageLabel("de")}</option>
                              <option value="en">{formatLanguageLabel("en")}</option>
                              <option value="uk">{formatLanguageLabel("uk")}</option>
                            </select>
                          </Field>
                          <div className="flex items-end">
                            <Button
                              type="submit"
                              className="rounded-lg"
                              disabled={translationBusy}
                            >
                              {translationBusy ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : (
                                <FileText className="size-4" />
                              )}
                              {t.documents_request_translation}
                            </Button>
                          </div>
                        </div>
                        <Field label={t.patients_notes}>
                          <textarea
                            value={translationForm.note}
                            onChange={(event) =>
                              setTranslationForm((current) => ({
                                ...current,
                                note: event.target.value,
                              }))
                            }
                            className={textareaClassName}
                            placeholder={t.documents_translation_note_placeholder}
                          />
                        </Field>
                      </form>
                    ) : null}
                    {translationRequests.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border/60 bg-muted/25 px-4 py-6 text-sm text-muted-foreground">
                        {t.documents_no_translation_requests}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {translationRequests.map((request) => {
                          const draft = translationDrafts[request.id] ?? {
                            note: request.note ?? "",
                            sourceLanguage: request.source_language ?? "",
                            sourceText: request.source_text ?? "",
                            translatedText: request.translated_text ?? "",
                          };
                          const canEditWorkspace =
                            canUpdateTranslation && request.status !== "cancelled";

                          return (
                            <div
                              key={request.id}
                              className="rounded-lg border border-border/60 bg-card px-4 py-4"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        "rounded-full",
                                        translationStatusBadge(request.status),
                                      )}
                                    >
                                      {formatTranslationStatusLabel(
                                        request.status,
                                        t,
                                      )}
                                    </Badge>
                                    <Badge
                                      variant="outline"
                                      className="rounded-full border-border/60 bg-card text-foreground"
                                    >
                                      {formatLanguageLabel(request.requested_language)}
                                    </Badge>
                                  </div>
                                  <p className="mt-2 text-sm font-semibold text-foreground">
                                    {request.requested_by_name ||
                                      t.documents_unknown_requester}
                                  </p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {formatDateTime(request.requested_at)}
                                    {request.completed_at
                                      ? text.completedAt(
                                          formatDateTime(request.completed_at),
                                        )
                                      : ""}
                                    {request.translated_by_name
                                      ? text.translatedByWorkspace(
                                          request.translated_by_name,
                                        )
                                      : ""}
                                  </p>
                                </div>
                                {canUpdateTranslation &&
                                request.status !== "completed" &&
                                request.status !== "cancelled" ? (
                                  <div className="flex flex-wrap gap-2">
                                    {request.status !== "in_progress" ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        className="rounded-xl"
                                        disabled={translationBusy}
                                        onClick={() =>
                                          void handleUpdateTranslationRequest(
                                            request.id,
                                            "in_progress",
                                          )
                                        }
                                      >
                                        {t.documents_translation_start}
                                      </Button>
                                    ) : null}
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className="rounded-xl"
                                      disabled={translationBusy}
                                      onClick={() =>
                                        void handleUpdateTranslationRequest(
                                          request.id,
                                          "completed",
                                        )
                                      }
                                    >
                                      {t.documents_translation_complete}
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className="rounded-xl"
                                      disabled={translationBusy}
                                      onClick={() =>
                                        void handleUpdateTranslationRequest(
                                          request.id,
                                          "cancelled",
                                        )
                                      }
                                    >
                                      {t.documents_translation_cancel}
                                    </Button>
                                  </div>
                                ) : null}
                              </div>
                              {canEditWorkspace ? (
                                <div className="mt-4 space-y-4">
                                  <div className="grid gap-4 md:grid-cols-2">
                                    <Field label={t.documents_source_language}>
                                      <select
                                        value={draft.sourceLanguage}
                                        onChange={(event) =>
                                          updateTranslationDraft(request.id, {
                                            sourceLanguage: event.target.value,
                                          })
                                        }
                                        className={selectClassName}
                                      >
                                        <option value="">{t.common_not_set}</option>
                                        <option value="de">{formatLanguageLabel("de")}</option>
                                        <option value="en">{formatLanguageLabel("en")}</option>
                                        <option value="uk">{formatLanguageLabel("uk")}</option>
                                      </select>
                                    </Field>
                                    <div className="flex flex-wrap items-end gap-2">
                                      {textExtraction?.extracted_text ? (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          className="rounded-xl"
                                          disabled={translationBusy}
                                          onClick={() =>
                                            handleUseExtractedTextForTranslation(
                                              request.id,
                                            )
                                          }
                                        >
                                          {t.documents_use_extracted_text}
                                        </Button>
                                      ) : null}
                                      <Button
                                        type="button"
                                        variant="outline"
                                        className="rounded-xl"
                                        disabled={translationBusy}
                                        onClick={() =>
                                          void handleSaveTranslationWorkspace(
                                            request.id,
                                          )
                                        }
                                      >
                                        {t.documents_save_workspace}
                                      </Button>
                                    </div>
                                  </div>
                                  <Field label={t.patients_notes}>
                                    <textarea
                                      value={draft.note}
                                      onChange={(event) =>
                                        updateTranslationDraft(request.id, {
                                          note: event.target.value,
                                        })
                                      }
                                      className={textareaClassName}
                                      placeholder={t.documents_translation_note_placeholder}
                                    />
                                  </Field>
                                  <Field label={t.documents_source_text}>
                                    <textarea
                                      value={draft.sourceText}
                                      onChange={(event) =>
                                        updateTranslationDraft(request.id, {
                                          sourceText: event.target.value,
                                        })
                                      }
                                      className={textareaClassName}
                                      placeholder={t.documents_source_text_placeholder}
                                    />
                                  </Field>
                                  <Field label={t.documents_translated_text}>
                                    <textarea
                                      value={draft.translatedText}
                                      onChange={(event) =>
                                        updateTranslationDraft(request.id, {
                                          translatedText: event.target.value,
                                        })
                                      }
                                      className={textareaClassName}
                                      placeholder={t.documents_translated_text_placeholder}
                                    />
                                  </Field>
                                </div>
                              ) : (
                                <div className="mt-4 space-y-3">
                                  {request.note ? (
                                    <div className="rounded-lg border border-border/60 bg-muted/25 px-3 py-2 text-sm text-foreground">
                                      {request.note}
                                    </div>
                                  ) : null}
                                  {request.source_text ? (
                                    <div className="rounded-lg border border-border/60 bg-muted/25 px-3 py-3">
                                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                        {t.documents_source_text}
                                      </p>
                                      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                                        {request.source_text}
                                      </p>
                                    </div>
                                  ) : null}
                                  {request.translated_text ? (
                                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
                                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-700">
                                        {t.documents_translated_text}
                                      </p>
                                      <p className="mt-2 whitespace-pre-wrap text-sm text-emerald-900">
                                        {request.translated_text}
                                      </p>
                                    </div>
                                  ) : null}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </SectionCard>
                ) : null}

                {canReviewSelectedDocument && editForm ? (
                  <SectionCard title={t.documents_interpreter_review}>
                    {saveError ? (
                      <Banner tone="error">{saveError}</Banner>
                    ) : null}
                    <form onSubmit={handleSave} className="space-y-4">
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        {t.documents_interpreter_review_hint}
                      </div>
                      {detail.classification_suggestion ? (
                        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                          {text.suggestedClassification}{" "}
                          <span className="font-medium">
                            {localizeDocumentCode(detail.classification_suggestion.art, l)} ·{" "}
                            {localizeDocumentCode(detail.classification_suggestion.category, l)}
                          </span>
                        </div>
                      ) : null}
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label={t.documents_category} required>
                          <Input
                            value={editForm.art}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? { ...current, art: event.target.value }
                                  : current,
                              )
                            }
                            list="documents-art-options"
                            className="h-10 rounded-xl border-border/60 bg-muted/25"
                          />
                        </Field>
                        <Field label={t.documents_taxonomy_category}>
                          <select
                            value={editForm.category}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? { ...current, category: event.target.value }
                                  : current,
                              )
                            }
                            className={selectClassName}
                          >
                            <option value="">{t.documents_choose_category}</option>
                            {categories.map((category) => (
                              <option key={category.key} value={category.key}>
                                {category.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <label className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/25 px-3 py-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={editForm.isMedical}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? {
                                    ...current,
                                    isMedical: event.target.checked,
                                  }
                                : current,
                            )
                          }
                          className="size-4 rounded border-input"
                        />
                        {t.documents_mark_medical_data}
                      </label>
                      <Field label={t.documents_review_notes}>
                        <textarea
                          value={editForm.notes}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? { ...current, notes: event.target.value }
                                : current,
                            )
                          }
                          className="min-h-[120px] w-full rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                          placeholder={t.documents_review_notes}
                        />
                      </Field>
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                        <span>{t.documents_release_internal_hint}</span>
                        <Button
                          type="submit"
                          className="rounded-xl"
                          disabled={saveBusy}
                        >
                          {saveBusy ? (
                            <LoaderCircle className="mr-2 size-4 animate-spin" />
                          ) : null}
                          {saveBusy
                            ? t.documents_releasing
                            : t.documents_release_reviewed_document}
                        </Button>
                      </div>
                    </form>
                  </SectionCard>
                ) : null}

                {canManage && editForm ? (
                  <SectionCard title={t.common_provider}>
                    {saveError ? (
                      <Banner tone="error">{saveError}</Banner>
                    ) : null}
                    <form onSubmit={handleSave} className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label={t.orders_patient}>
                          <select
                            value={editForm.patientId}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      patientId: event.target.value,
                                      orderId: "",
                                      appointmentId: "",
                                    }
                                  : current,
                              )
                            }
                            className={selectClassName}
                          >
                            <option value="">{t.documents_no_patient}</option>
                            {patients.map((patient) => (
                              <option key={patient.id} value={patient.id}>
                                {patientOptionLabel(patient)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={t.orders_title}>
                          <select
                            value={editForm.orderId}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? { ...current, orderId: event.target.value }
                                  : current,
                              )
                            }
                            className={selectClassName}
                            disabled={!editForm.patientId}
                          >
                            <option value="">{t.documents_no_order}</option>
                            {detailOrders.map((order) => (
                              <option key={order.id} value={order.id}>
                                {order.order_number} · {order.patient_pid}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={t.appointments_title}>
                          <select
                            value={editForm.appointmentId}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      appointmentId: event.target.value,
                                    }
                                  : current,
                              )
                            }
                            className={selectClassName}
                            disabled={!editForm.patientId}
                          >
                            <option value="">{t.documents_no_appointment}</option>
                            {detailAppointments.map((appointment) => (
                              <option
                                key={appointment.id}
                                value={appointment.id}
                              >
                                {appointment.title} ·{" "}
                                {formatDate(appointment.date)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={t.documents_filename} required>
                          <Input
                            value={editForm.autoName}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? { ...current, autoName: event.target.value }
                                  : current,
                              )
                            }
                            className="h-10 rounded-xl border-border/60 bg-muted/25"
                          />
                        </Field>
                        <Field label={t.documents_category} required>
                          <Input
                            value={editForm.art}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? { ...current, art: event.target.value }
                                  : current,
                              )
                            }
                            list="documents-art-options"
                            className="h-10 rounded-xl border-border/60 bg-muted/25"
                          />
                        </Field>
                        <Field label={t.documents_category}>
                          <select
                            value={editForm.category}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? { ...current, category: event.target.value }
                                  : current,
                              )
                            }
                            className={selectClassName}
                          >
                            <option value="">{t.documents_no_category}</option>
                            {categories.map((category) => (
                              <option key={category.key} value={category.key}>
                                {category.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={t.users_status}>
                          <select
                            value={editForm.status}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      status: event.target
                                        .value as DocumentStatus,
                                    }
                                  : current,
                              )
                            }
                            className={selectClassName}
                          >
                            {STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>
                                {formatDocumentStatusLabel(status, t)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={t.users_status}>
                          <select
                            value={editForm.visibility}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      visibility: event.target
                                        .value as DocumentVisibility,
                                    }
                                  : current,
                              )
                            }
                            className={selectClassName}
                          >
                            {VISIBILITY_OPTIONS.map((value) => (
                              <option key={value} value={value}>
                                {formatVisibilityLabel(value, t)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={t.common_provider}>
                          <Input
                            value={editForm.klinik}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? { ...current, klinik: event.target.value }
                                  : current,
                              )
                            }
                            className="h-10 rounded-xl border-border/60 bg-muted/25"
                          />
                        </Field>
                        <Field label={t.documents_source}>
                          <Input
                            value={editForm.ursprung}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? { ...current, ursprung: event.target.value }
                                  : current,
                              )
                            }
                            className="h-10 rounded-xl border-border/60 bg-muted/25"
                          />
                        </Field>
                      </div>
                      <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={editForm.isMedical}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? {
                                    ...current,
                                    isMedical: event.target.checked,
                                  }
                                : current,
                            )
                          }
                          className="size-4 rounded border-input"
                        />
                        {t.documents_mark_medical_data}
                      </label>
                      <Field label={t.patients_notes}>
                        <textarea
                          value={editForm.notes}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? { ...current, notes: event.target.value }
                                : current,
                            )
                          }
                          className={textareaClassName}
                        />
                      </Field>
                      <div className="flex justify-end">
                        <Button
                          type="submit"
                          className="rounded-lg"
                          disabled={saveBusy}
                        >
                          {saveBusy ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : (
                            <FileText className="size-4" />
                          )}
                          {saveBusy ? t.patients_saving : t.documents_save_metadata}
                        </Button>
                      </div>
                    </form>
                  </SectionCard>
                ) : null}

                <SectionCard title={t.documents_patient_portal}>
                  <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-xl border border-border/60 bg-muted/25 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full",
                            detail.visibility === "patient_visible"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-border/60 bg-muted text-muted-foreground",
                          )}
                        >
                          {detail.visibility === "patient_visible"
                            ? t.documents_portal_eligible
                            : t.documents_not_portal_eligible}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="rounded-full border-sky-200 bg-sky-50 text-sky-700"
                        >
                          {activePortalShares.length}{" "}
                          {t.documents_active_portal_releases}
                        </Badge>
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">
                        {t.documents_portal_access_hint}
                      </p>
                      {!detail.patient_id ? (
                        <p className="mt-3 text-sm text-amber-700">
                          {t.documents_link_patient_before_portal}
                        </p>
                      ) : null}
                      {activePortalShares.length > 0 ? (
                        <div className="mt-4 space-y-2">
                          {activePortalShares.map((share) => (
                            <div
                              key={share.id}
                              className="rounded-lg border border-border/60 bg-card px-4 py-3 text-sm text-foreground"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span>
                                  {share.target_user_name ||
                                    t.documents_patient_portal_user}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "rounded-full",
                                    share.confirmed
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : share.requires_confirmation
                                        ? "border-amber-200 bg-amber-50 text-amber-700"
                                        : "border-sky-200 bg-sky-50 text-sky-700",
                                  )}
                                >
                                  {share.confirmed
                                    ? t.documents_confirmed
                                    : share.requires_confirmation
                                      ? t.documents_waiting_confirmation
                                      : t.documents_released}
                                </Badge>
                              </div>
                              <p className="mt-2 text-xs text-muted-foreground">
                                {t.documents_portal_released_at.replace(
                                  "{datetime}",
                                  formatDateTime(share.shared_at),
                                )}
                                {share.confirmed
                                  ? ` · ${t.documents_portal_confirmed_by_patient}`
                                  : ""}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="rounded-xl border border-border/60 bg-card p-4">
                      <p className="text-sm font-semibold text-foreground">
                        {t.documents_portal_controls}
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {t.documents_portal_trail_hint}
                      </p>
                      <div className="mt-4 grid gap-3">
                        <div className="rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                          {t.documents_confirmed_recipients}:{" "}
                          <span className="font-semibold text-foreground">
                            {confirmedPortalShares}
                          </span>
                        </div>
                        {canManage ? (
                          <>
                            <Button
                              type="button"
                              className="rounded-lg"
                              disabled={portalBusy || !detail.patient_id}
                              onClick={() => void handleReleaseToPortal()}
                            >
                              {portalBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                              {activePortalShares.length > 0
                                ? t.documents_refresh_portal_release
                                : t.documents_release_to_portal}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-lg"
                              disabled={portalBusy || activePortalShares.length === 0}
                              onClick={() => void handleRevokePortalRelease()}
                            >
                              {portalBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                              {t.documents_revoke_portal_release}
                            </Button>
                          </>
                        ) : (
                          <div className="rounded-lg border border-dashed border-border/60 bg-muted/25 px-4 py-4 text-sm text-muted-foreground">
                            {t.documents_only_ceo_pm_portal}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </SectionCard>

                {canViewShares ? (
                  <SectionCard title={t.documents_share}>
                  {shareError ? (
                    <Banner tone="error">{shareError}</Banner>
                  ) : null}
                  <div className="space-y-3">
                    {shares.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border/60 bg-muted/25 px-4 py-6 text-sm text-muted-foreground">
                        {t.documents_no_shares_yet}
                      </div>
                    ) : (
                      shares.map((share) => {
                        const target = share.provider_name
                          ? `${t.documents_provider_target} · ${share.provider_name}`
                          : share.target_user_name
                            ? `${share.target_user_name} · ${formatRoleLabel(share.target_user_role)}`
                            : t.documents_unknown_target;
                        const canCurrentUserConfirm =
                          !share.confirmed &&
                          !share.revoked_at &&
                          share.shared_with_user_id === user?.id;
                        return (
                          <div
                            key={share.id}
                            className="rounded-lg border border-border/60 bg-card px-4 py-4"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-foreground">
                                  {target}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {t.documents_shared_by.replace(
                                    "{name}",
                                    share.shared_by_name || t.common_unknown,
                                  )}{" "}
                                  · {formatDateTime(share.shared_at)}
                                </p>
                                {share.channel ? (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {formatShareChannelLabel(share.channel)}
                                  </p>
                                ) : null}
                                {share.message ? (
                                  <div className="mt-3 rounded-lg border border-border/60 bg-muted/25 px-3 py-2 text-sm text-foreground">
                                    {share.message}
                                  </div>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {share.revoked_at ? (
                                  <Badge
                                    variant="outline"
                                    className="rounded-full border-border/60 bg-muted text-muted-foreground"
                                  >
                                    {text.revokedBadge}
                                  </Badge>
                                ) : share.confirmed ? (
                                  <Badge
                                    variant="outline"
                                    className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700"
                                  >
                                    {t.documents_confirmed}
                                  </Badge>
                                ) : share.requires_confirmation ? (
                                  <Badge
                                    variant="outline"
                                    className="rounded-full border-amber-200 bg-amber-50 text-amber-700"
                                  >
                                    {t.documents_waiting_confirmation}
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="rounded-full border-sky-200 bg-sky-50 text-sky-700"
                                  >
                                    {t.documents_released}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {canCurrentUserConfirm ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  className="rounded-lg"
                                  onClick={() =>
                                    void handleConfirmShare(share.id)
                                  }
                                >
                                  {t.common_confirm}
                                </Button>
                              ) : null}
                              {canManage && !share.revoked_at ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="rounded-xl"
                                  onClick={() =>
                                    void handleRevokeShare(share.id)
                                  }
                                >
                                  {t.documents_revoke}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {canManage ? (
                    <form
                      onSubmit={handleCreateShare}
                      className="mt-5 space-y-4 rounded-xl border border-border/60 bg-muted/25 p-4"
                    >
                      {selectedDocumentIds.length > 1 ? (
                        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                          {t.documents_sharing_selected.replace(
                            "{count}",
                            String(selectedDocumentIds.length),
                          )}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant={
                            shareForm.targetType === "user"
                              ? "default"
                              : "outline"
                          }
                          className="rounded-xl"
                          onClick={() =>
                            setShareForm((current) => ({
                              ...current,
                              targetType: "user",
                              providerId: "",
                              message: "",
                            }))
                          }
                        >
                          {t.documents_internal_user}
                        </Button>
                        <Button
                          type="button"
                          variant={
                            shareForm.targetType === "provider"
                              ? "default"
                              : "outline"
                          }
                          className="rounded-xl"
                          onClick={() =>
                            setShareForm((current) => ({
                              ...current,
                              targetType: "provider",
                              userId: "",
                            }))
                          }
                        >
                          {t.documents_provider_target}
                        </Button>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        {shareForm.targetType === "user" ? (
                          <Field label={t.patients_assign_owner} required>
                            <select
                              value={shareForm.userId}
                              onChange={(event) =>
                                setShareForm((current) => ({
                                  ...current,
                                  userId: event.target.value,
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="">{t.documents_select_user}</option>
                              {staff.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name} · {formatRoleLabel(item.role)}
                                </option>
                              ))}
                            </select>
                          </Field>
                        ) : (
                          <Field label={t.common_provider} required>
                            <select
                              value={shareForm.providerId}
                              onChange={(event) =>
                                setShareForm((current) => ({
                                  ...current,
                                  providerId: event.target.value,
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="">{t.documents_select_provider}</option>
                              {providers.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name} ·{" "}
                                  {item.address_city || t.documents_no_city}
                                </option>
                              ))}
                            </select>
                          </Field>
                        )}
                        <Field label={t.documents_source}>
                          <Input
                            value={shareForm.channel}
                            onChange={(event) =>
                              setShareForm((current) => ({
                                ...current,
                                channel: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl border-border/60 bg-card"
                          />
                        </Field>
                      </div>
                      <Field
                        label={t.documents_share_message}
                        required={shareForm.targetType === "provider"}
                      >
                        <textarea
                          value={shareForm.message}
                          onChange={(event) =>
                            setShareForm((current) => ({
                              ...current,
                              message: event.target.value,
                            }))
                          }
                          placeholder={t.documents_share_message_placeholder}
                          className={textareaClassName}
                        />
                      </Field>
                      <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={shareForm.requiresConfirmation}
                          onChange={(event) =>
                            setShareForm((current) => ({
                              ...current,
                              requiresConfirmation: event.target.checked,
                            }))
                          }
                          className="size-4 rounded border-input"
                        />
                        {t.documents_require_confirmation}
                      </label>
                      <div className="flex justify-end">
                        <Button
                          type="submit"
                          className="rounded-lg"
                          disabled={shareBusy}
                        >
                          {shareBusy ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : (
                            <Share2 className="size-4" />
                          )}
                          {shareBusy ? t.documents_sharing : t.documents_create_share}
                        </Button>
                      </div>
                    </form>
                  ) : null}
                  </SectionCard>
                ) : null}
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "error" | "success" | "warning";
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        tone === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : tone === "warning"
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-emerald-200 bg-emerald-50 text-emerald-700",
      )}
    >
      {children}
    </div>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
      <h2 className="mb-4 text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-2 text-sm text-foreground">{value}</div>
    </div>
  );
}

function Field({
  label,
  children,
  required = false,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
}) {
  const generatedId = useId();
  let htmlFor: string | undefined;
  let content = children;
  if (isValidElement(children) && !Array.isArray(children)) {
    const element = children as ReactElement<{ id?: string }>;
    const childProps = element.props as { id?: string };
    const nextId = childProps.id ?? generatedId;
    htmlFor = nextId;
    content = cloneElement(element, { id: nextId });
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-[11.5px] font-medium text-muted-foreground leading-tight">
        {label}
        {required ? <span className="ml-1 text-rose-600">*</span> : null}
      </Label>
      {content}
    </div>
  );
}
