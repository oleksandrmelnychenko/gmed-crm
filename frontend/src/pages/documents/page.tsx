import { NativeComboboxSelect } from "@/components/ui/combobox-select";
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
import { createPortal, flushSync } from "react-dom";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import {
  CalendarClock,
  ChevronDown,
  Download,
  FileText,
  FolderPlus,
  History,
  Languages,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  Trash2,
  Undo2,
  UserRound,
} from "lucide-react";

import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { DocumentsGrid } from "@/components/documents-grid";
import { localizeDocumentCode } from "@/lib/required-document-labels";
import {
  AdminSheetScaffold,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import {
  EmptyCell,
  PageHeader,
  StatusBadge,
  TabLoader,
  checkboxClass,
  inputClass as shellInputClassName,
  selectClass as shellSelectClassName,
  textareaClass as shellTextareaClass,
  type StatusTone,
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
} from "@/components/ui/sheet";
import { clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatUnknownValue, getLang, t as translateCatalog, useLang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { PatientDocumentsPage } from "@/pages/patients/portal-documents-page";
import { cn } from "@/lib/utils";
import {
  sensitivityBadge,
  statusBadge,
  translationStatusBadge,
  visibilityBadge,
} from "./appearance/status-appearance";
import {
  confirmDocumentShare,
  createBulkDocumentShares,
  createDocumentShare,
  createTranslationRequest,
  deleteStoredDocumentFile,
  downloadDocumentFile,
  fetchDocument,
  fetchDocumentDetailBundle,
  fetchDocumentIntakeQueue,
  fetchDocumentLookups,
  fetchDocumentShares,
  fetchDocumentVersions,
  fetchDocuments,
  fetchPatientDocumentContext,
  fetchTranslationRequestQueue,
  fetchTranslationRequests,
  generateDocument,
  openDocumentPreview,
  releaseDocumentToPortal,
  revokeDocumentPortalRelease,
  revokeDocumentShare,
  runDocumentTextExtraction,
  updateDocument,
  updateTranslationRequest,
  uploadDocument,
} from "./data/document-api";
import {
  STATUS_OPTIONS,
  VISIBILITY_OPTIONS,
  buildDocumentsPath,
  canManageDocumentIntake,
  canManageDocuments,
  canRequestTranslations,
  canUpdateTranslations,
  canUploadDocuments,
  canViewDocumentShares,
  canViewDocuments,
  detailToEditForm,
  emptyGenerateForm,
  emptyUploadForm,
  formatConfidenceLabel,
  normalizeTemplateLanguage,
  patientOptionLabel,
  resolveTemplateLanguage,
  templateForDocument,
} from "./model/document-model";
import type {
  AppointmentOption,
  CategoryOption,
  DocumentItem,
  DocumentShare,
  DocumentStatus,
  DocumentTemplate,
  DocumentTextExtraction,
  DocumentVisibility,
  EditFormState,
  FiltersState,
  GenerateFormState,
  OrderOption,
  PatientOption,
  ProviderOption,
  ShareFormState,
  StaffOption,
  TemplateTextBlock,
  TranslationRequest,
  TranslationWorkspaceDraft,
  UploadFormState,
} from "./model/types";

const selectClassName = shellSelectClassName;
const textareaClassName = shellTextareaClass;
const DEFAULT_GENERATE_TEMPLATE_ID = "patient_sticker_compact";
const documentSectionClassName = "border-border/50 bg-transparent";
const documentQueueRowHeightOverrides = {
  comfortable: 56,
  compact: 48,
  condensed: 40,
};
const documentListRowHeightOverrides = {
  comfortable: 64,
  compact: 56,
  condensed: 48,
};

function runtimeTranslations() {
  return translateCatalog(getLang());
}

function runtimeLocale() {
  return getLang() === "ru" ? "ru-RU" : "de-DE";
}

function formatRoleLabel(role?: string | null) {
  const tr = runtimeTranslations();
  if (!role) return tr.common_unknown;
  const translated = tr[`role_${role}` as keyof typeof tr];
  return typeof translated === "string" ? translated : formatUnknownValue(role, tr);
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
      return language ? formatUnknownValue(language, runtimeTranslations()) : runtimeTranslations().common_not_set;
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
      return value ? formatUnknownValue(value, runtimeTranslations()) : runtimeTranslations().common_not_set;
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
      return channel ? formatUnknownValue(channel, runtimeTranslations()) : runtimeTranslations().common_not_set;
  }
}

function formatDocumentSourceLabel(
  source?: string | null,
  tr: ReturnType<typeof runtimeTranslations> = runtimeTranslations(),
) {
  const normalized = source?.trim().toLowerCase();
  if (!normalized) return tr.common_not_set;

  switch (normalized) {
    case "patient_portal":
      return tr.documents_patient_portal;
    case "interpreter_upload":
      return `${tr.role_interpreter} - ${tr.documents_upload}`;
    case "patient_upload":
      return `${tr.role_patient} - ${tr.documents_upload}`;
    case "staff_upload":
      return `${tr.activity_user} - ${tr.documents_upload}`;
    case "upload":
      return tr.documents_upload;
    case "generated":
    case "document_generation":
    case "template":
      return tr.documents_generate_from_template;
    case "translation":
    case "translation_request":
      return tr.documents_translation_requests;
    case "manual":
      return tr.orders_billing_source_manual;
    default:
      return formatUnknownValue(source, tr);
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
      return method ? formatUnknownValue(method, runtimeTranslations()) : runtimeTranslations().common_not_set;
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
    return formatUnknownValue(value, tr);
  }
}

function formatGenerateDocumentError(error: unknown, l: (de: string, ru: string, en: string) => string) {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("Treatment plan template requires at least one appointment")) {
    return l(
      "Der Behandlungsplan braucht mindestens einen Termin im ausgewählten Scope.",
      "Для плана лечения нужен минимум один приём в выбранном scope.",
      "Для плану лікування потрібен мінімум один прийом у вибраному scope.",
    );
  }

  if (message.includes("Medication summary template requires at least one case")) {
    return l(
      "Die Medikamentenübersicht braucht mindestens einen Fall im ausgewählten Scope.",
      "Для сводки медикаментов нужен минимум один кейс в выбранном scope.",
      "Для медикаментозної зводки потрібен мінімум один кейс у вибраному scope.",
    );
  }

  if (message.includes("Medication summary template requires recorded medication")) {
    return l(
      "Die Medikamentenübersicht braucht dokumentierte Medikamente im ausgewählten Scope.",
      "Для сводки медикаментов нужны записанные медикаменты в выбранном scope.",
      "Для медикаментозної зводки потрібні записані медикаменти у вибраному scope.",
    );
  }

  if (message.includes("Framework contract template requires an existing framework contract")) {
    return l(
      "Der Rahmenvertrag braucht einen bestehenden Vertrag im ausgewählten Scope.",
      "Для рамочного договора нужен существующий договор в выбранном scope.",
      "Для рамкового договору потрібен наявний договір у вибраному scope.",
    );
  }

  return message;
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
    return formatUnknownValue(value, tr);
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
      return formatUnknownValue(status, tr);
  }
}

function documentStatusTone(status: string): StatusTone {
  if (status === "active") return "success";
  if (status === "archived") return "neutral";
  return "warning";
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
      return formatUnknownValue(visibility, tr);
  }
}

function documentVisibilityTone(visibility: string): StatusTone {
  if (visibility === "patient_visible") return "success";
  if (visibility === "released_external") return "brand";
  if (visibility === "released_internal") return "info";
  return "neutral";
}

function documentSensitivityTone(value: string): StatusTone {
  const normalized = value.toLowerCase();
  if (normalized === "medical") return "error";
  if (normalized === "financial") return "warning";
  return "info";
}

function formatTranslationStatusLabel(
  status: string,
  tr: ReturnType<typeof runtimeTranslations>,
) {
  switch (status) {
    case "requested":
    case "pending":
      return tr.documents_translation_requested;
    case "in_progress":
      return tr.documents_translation_in_progress;
    case "completed":
      return tr.documents_translation_completed;
    case "cancelled":
      return tr.documents_translation_cancelled;
    default:
      return formatUnknownValue(status, tr);
  }
}

function translationRequestChevronTone(status: string) {
  switch (status) {
    case "completed":
      return "text-emerald-600";
    case "in_progress":
      return "text-sky-600";
    case "cancelled":
      return "text-rose-500";
    default:
      return "text-amber-600";
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
      return formatUnknownValue(status, tr);
  }
}

const STAFF_DOCUMENT_REALTIME_EVENTS = [
  "document.uploaded",
  "document.payment_proof_uploaded",
  "document.generated",
  "document.updated",
  "document.deleted",
  "document.portal_released",
  "document.portal_revoked",
  "document.confirmed",
  "document.translation_requested",
  "document.translation_updated",
] as const;

type TranslationUpdateOptions = {
  assignedTo?: string | null;
  createTranslatedDocument?: boolean;
  translatedDocumentAutoName?: string | null;
};

export function DocumentsPage() {
  const { user } = useAuth();
  const { documentId } = useParams<{ documentId?: string }>();
  const location = useLocation();
  const isIntakePath = location.pathname === "/documents/intake";
  const isTranslationRequestsPath =
    location.pathname === "/documents/translation-requests";

  if (user?.role === "patient") {
    return <PatientDocumentsPage />;
  }

  return (
    <StaffDocumentsPage
      routeDocumentId={
        isIntakePath || isTranslationRequestsPath ? undefined : documentId
      }
      routeMode={
        isIntakePath
          ? "intake"
          : isTranslationRequestsPath
            ? "translation-requests"
            : "documents"
      }
    />
  );
}

type StaffDocumentsPageProps = {
  routeDocumentId?: string;
  routeMode?: "documents" | "intake" | "translation-requests";
};

function StaffDocumentsPage({
  routeDocumentId,
  routeMode = "documents",
}: StaffDocumentsPageProps) {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const { staffGo } = useStaffNavigate();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const [searchParams] = useSearchParams();
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
  const legacyQueryDocumentId = searchParams.get("document") ?? "";
  const isIntakeRoute = routeMode === "intake";
  const isTranslationRequestsRoute = routeMode === "translation-requests";
  const isRouteDetail = Boolean(routeDocumentId);
  const legacyEmbedDetailOnly = searchParams.get("embed") === "detail";
  const embedDetailOnly = isRouteDetail || legacyEmbedDetailOnly;

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

  const [selectedId, setSelectedId] = useState(() =>
    routeDocumentId ?? (legacyEmbedDetailOnly ? legacyQueryDocumentId : ""),
  );
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<DocumentItem | null>(null);
  const [detailVersions, setDetailVersions] = useState<DocumentItem[]>([]);
  const [translationRequests, setTranslationRequests] = useState<
    TranslationRequest[]
  >([]);
  const [translationQueue, setTranslationQueue] = useState<TranslationRequest[]>([]);
  const [translationQueueBusy, setTranslationQueueBusy] = useState(false);
  const [translationQueueError, setTranslationQueueError] = useState("");
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
  const [translationActionMenuOpen, setTranslationActionMenuOpen] = useState<string | null>(null);
  const [translationActionMenuPosition, setTranslationActionMenuPosition] =
    useState<{ left: number; top: number } | null>(null);
  const [textExtractionBusy, setTextExtractionBusy] = useState(false);
  const [textExtractionError, setTextExtractionError] = useState("");
  const [translationForm, setTranslationForm] = useState({
    requestedLanguage: "en",
    note: "",
  });
  const [translationRequestOpen, setTranslationRequestOpen] = useState(false);
  const [metadataEditOpen, setMetadataEditOpen] = useState(false);
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
  const [shareCreateOpen, setShareCreateOpen] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);

  useDebouncedRealtimeSubscription(STAFF_DOCUMENT_REALTIME_EVENTS, (_event, events) => {
    if (!canView) return;
    clearApiCache("/documents");
    clearApiCache("/documents/intake-queue");
    clearApiCache("/documents/translation-requests");
    clearApiCache("/documents/translation-requests?status=pending,in_progress");
    for (const event of events) {
      if (event.entity_type === "document") {
        clearApiCache(`/documents/${event.entity_id}`);
      }
    }
    startTransition(() => setVersion((current) => current + 1));
  }, 250);

  useEffect(() => {
    if (!translationActionMenuOpen) return;

    function handlePointer(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-translation-action-menu]")) {
        setTranslationActionMenuOpen(null);
        setTranslationActionMenuPosition(null);
      }
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setTranslationActionMenuOpen(null);
        setTranslationActionMenuPosition(null);
      }
    }

    function closeActionMenu() {
      setTranslationActionMenuOpen(null);
      setTranslationActionMenuPosition(null);
    }

    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("resize", closeActionMenu);
    window.addEventListener("scroll", closeActionMenu, true);
    return () => {
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", closeActionMenu);
      window.removeEventListener("scroll", closeActionMenu, true);
    };
  }, [translationActionMenuOpen]);

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
    setSelectedId(
      routeDocumentId ?? (legacyEmbedDetailOnly ? legacyQueryDocumentId : ""),
    );
  }, [legacyEmbedDetailOnly, legacyQueryDocumentId, routeDocumentId]);

  useEffect(() => {
    if (routeDocumentId || legacyEmbedDetailOnly || !legacyQueryDocumentId) {
      return;
    }

    const next = new URLSearchParams(searchParams);
    next.delete("document");
    next.delete("embed");
    const search = next.toString();
    staffGo(`/documents/${legacyQueryDocumentId}${search ? `?${search}` : ""}`);
  }, [
    legacyEmbedDetailOnly,
    legacyQueryDocumentId,
    routeDocumentId,
    searchParams,
    staffGo,
  ]);

  const documentsPath = useMemo(
    () => buildDocumentsPath({ ...filters, search: deferredSearch }),
    [deferredSearch, filters],
  );

  useEffect(() => {
    if (!canView) return;
    let active = true;
    async function loadLookups() {
      const lookups = await fetchDocumentLookups(canManage);
      if (!active) return;
      startTransition(() => {
        setPatients(lookups.patients);
        setProviders(lookups.providers);
        setStaff(lookups.staff);
        setCategories(lookups.categories);
        setArts(lookups.arts);
        setTemplates(lookups.templates);
        setTemplateTextBlocks(lookups.textBlocks);
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
        const rows = await fetchDocuments(documentsPath);
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
        const rows = await fetchDocumentIntakeQueue();
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
    if (!canRequestTranslation && !canUpdateTranslation) {
      setTranslationQueue([]);
      setTranslationQueueBusy(false);
      setTranslationQueueError("");
      return;
    }
    let active = true;
    async function loadTranslationQueue() {
      setTranslationQueueBusy(true);
      setTranslationQueueError("");
      try {
        const rows = await fetchTranslationRequestQueue();
        if (!active) return;
        startTransition(() => setTranslationQueue(rows));
      } catch (nextError) {
        if (!active) return;
        setTranslationQueue([]);
        setTranslationQueueError(
          nextError instanceof Error
            ? nextError.message
            : t.documents_failed_load_document,
        );
      } finally {
        if (active) setTranslationQueueBusy(false);
      }
    }
    void loadTranslationQueue();
    return () => {
      active = false;
    };
  }, [
    canRequestTranslation,
    canUpdateTranslation,
    t.documents_failed_load_document,
    version,
  ]);

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
        const {
          detail: documentResponse,
          shares: shareResponse,
          versions: versionResponse,
          translationRequests: translationResponse,
          textExtraction: extractionResponse,
        } = await fetchDocumentDetailBundle(selectedId, canViewShares);
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
      const { orders: orderRows, appointments: appointmentRows } =
        await fetchPatientDocumentContext(uploadForm.patientId);
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
      const fallbackTemplate =
        templates.find((template) => template.id === DEFAULT_GENERATE_TEMPLATE_ID) ??
        templates[0];
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
      const { orders: orderRows, appointments: appointmentRows } =
        await fetchPatientDocumentContext(generateForm.patientId);
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
      const { orders: orderRows, appointments: appointmentRows } =
        await fetchPatientDocumentContext(patientId);
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

  function closeDocumentOverlayLayers() {
    setTemplateOpen(false);
    setUploadOpen(false);
    setTranslationRequestOpen(false);
    setMetadataEditOpen(false);
    setShareCreateOpen(false);
    setDeleteOpen(false);
    setSelectedId("");
  }

  function openDocument(id: string) {
    flushSync(closeDocumentOverlayLayers);
    const next = new URLSearchParams(searchParams);
    next.delete("document");
    next.delete("embed");
    if (
      isTranslationRequestsRoute ||
      searchParams.get("from") === "translation-requests"
    ) {
      next.set("from", "translation-requests");
    } else if (isIntakeRoute || searchParams.get("from") === "intake") {
      next.set("from", "intake");
    } else {
      next.delete("from");
    }
    const search = next.toString();
    staffGo(`/documents/${id}${search ? `?${search}` : ""}`);
  }

  function toggleDocumentSelection(id: string, checked: boolean) {
    setSelectedDocumentIds((current) => {
      if (checked) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((value) => value !== id);
    });
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
      const response = await uploadDocument(formData);
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
      await updateDocument(item.id, {
        art: item.classification_suggestion.art,
        category: item.classification_suggestion.category,
        is_medical: item.classification_suggestion.is_medical,
        status:
          item.ursprung === "interpreter_upload" && item.status === "draft"
            ? "active"
            : undefined,
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

    setGenerateBusy(true);
    setGenerateError("");
    try {
      const response = await generateDocument({
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
      });
      setTemplateOpen(false);
      setNotice(
        t.documents_generated_version.replace(
          "{version}",
          String(response.version_number ?? 1),
        ),
      );
      refresh();
      if (response.id) openDocument(response.id);
    } catch (nextError) {
      setGenerateError(
        formatGenerateDocumentError(nextError, l) || t.documents_failed_generate,
      );
    } finally {
      setGenerateBusy(false);
    }
  }

  async function handleOpenPreview() {
    if (!detail) return;
    try {
      await openDocumentPreview(detail.id, t.documents_popup_blocked);
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
    const rows = await fetchTranslationRequests(documentId);
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
      await createTranslationRequest(detail.id, {
        requested_language: translationForm.requestedLanguage,
        note: translationForm.note.trim() || null,
      });
      await reloadTranslationRequests(detail.id);
      clearApiCache("/documents/translation-requests");
      clearApiCache("/documents/translation-requests?status=pending,in_progress");
      setVersion((current) => current + 1);
      setTranslationForm({ requestedLanguage: "en", note: "" });
      setTranslationRequestOpen(false);
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
      const response = await runDocumentTextExtraction(detail.id);
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
    options?: TranslationUpdateOptions,
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
      await updateTranslationRequest(requestId, {
        status,
        note: draft.note.trim() || null,
        source_language: draft.sourceLanguage || null,
        source_text: draft.sourceText.trim() || null,
        translated_text: draft.translatedText.trim() || null,
        assigned_to: options?.assignedTo || undefined,
        create_translated_document: options?.createTranslatedDocument || undefined,
        translated_document_auto_name: options?.translatedDocumentAutoName || undefined,
      });
      await reloadTranslationRequests(detail.id);
      clearApiCache("/documents/translation-requests");
      clearApiCache("/documents/translation-requests?status=pending,in_progress");
      setVersion((current) => current + 1);
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

  async function handleUpdateQueuedTranslationRequest(
    request: TranslationRequest,
    status: string,
    options?: TranslationUpdateOptions,
  ) {
    setTranslationQueueBusy(true);
    setTranslationQueueError("");
    try {
      await updateTranslationRequest(request.id, {
        status,
        assigned_to: options?.assignedTo || undefined,
        create_translated_document: options?.createTranslatedDocument || undefined,
        translated_document_auto_name: options?.translatedDocumentAutoName || undefined,
      });
      clearApiCache("/documents/translation-requests");
      clearApiCache("/documents/translation-requests?status=pending,in_progress");
      if (detail?.id === request.document_id) {
        await reloadTranslationRequests(detail.id);
      }
      setVersion((current) => current + 1);
      setNotice(
        t.documents_translation_marked.replace(
          "{status}",
          formatTranslationStatusLabel(status, t),
        ),
      );
    } catch (nextError) {
      setTranslationQueueError(
        nextError instanceof Error
          ? nextError.message
          : t.documents_failed_update_translation,
      );
    } finally {
      setTranslationQueueBusy(false);
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
      await updateDocument(detail.id, payload);
      const fresh = await fetchDocument(detail.id);
      setDetail(fresh);
      setEditForm(detailToEditForm(fresh));
      setNotice(
        canManage
          ? t.documents_metadata_updated_notice
          : t.documents_review_released_notice,
      );
      if (canManage) setMetadataEditOpen(false);
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
        await createBulkDocumentShares(targetDocumentIds, payload);
      } else {
        await createDocumentShare(targetDocumentIds[0], payload);
      }
      if (detail) {
        setShares(await fetchDocumentShares(detail.id));
      }
      setShareForm({
        targetType: "user",
        userId: "",
        providerId: "",
        channel: "email",
        message: "",
        requiresConfirmation: true,
      });
      setShareCreateOpen(false);
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
    await revokeDocumentShare(detail.id, shareId);
    setShares(await fetchDocumentShares(detail.id));
    setNotice(t.documents_share_revoked_notice);
    refresh();
  }

  async function handleConfirmShare(shareId: string) {
    if (!detail) return;
    await confirmDocumentShare(detail.id, shareId);
    if (canManage) {
      setShares(await fetchDocumentShares(detail.id));
    }
    setNotice(t.documents_share_confirmed_notice);
    refresh();
  }

  async function handleReleaseToPortal() {
    if (!detail) return;
    setPortalBusy(true);
    setShareError("");
    try {
      await releaseDocumentToPortal(detail.id);
      const [fresh, freshShares] = await Promise.all([
        fetchDocument(detail.id),
        fetchDocumentShares(detail.id),
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
      await revokeDocumentPortalRelease(detail.id);
      const [fresh, freshShares] = await Promise.all([
        fetchDocument(detail.id),
        fetchDocumentShares(detail.id),
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
      const response = await deleteStoredDocumentFile(detail.id, deleteReason.trim());

      const [freshShares, freshVersions] = await Promise.all([
        canManage
          ? fetchDocumentShares(detail.id).catch(() => [])
          : Promise.resolve([]),
        fetchDocumentVersions(detail.id).catch(() => []),
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
      {!embedDetailOnly ? (
        <>
      <PageHeader
        title={
          isTranslationRequestsRoute
            ? t.documents_translation_requests
            : isIntakeRoute
              ? t.documents_intake_queue
              : t.documents_title
        }
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

      {isIntakeRoute && !canManageIntake ? (
        <Banner tone="warning">
          {l(
            "Diese Rolle kann die Intake-Dokumentenwarteschlange nicht verwalten.",
            "Эта роль не может управлять очередью intake документов.",
            "Ця роль не може керувати чергою intake документів.",
          )}
        </Banner>
      ) : null}

      {isIntakeRoute &&
      canManageIntake &&
      (isIntakeRoute || intakeBusy || intakeError || intakeQueue.length > 0) ? (
        <DocumentSection
          className={documentSectionClassName}
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
        >
          {intakeError ? <Banner tone="error">{intakeError}</Banner> : null}
          <DocumentIntakeQueueTable
            actionId={intakeActionId}
            emptyText={t.documents_no_intake_pending}
            l={l}
            loading={intakeBusy}
            onApplySuggestion={handleApplyClassificationSuggestion}
            onOpenDocument={openDocument}
            rows={intakeQueue}
            selectedId={selectedId}
            t={t}
            text={text}
          />
        </DocumentSection>
      ) : null}

      {isTranslationRequestsRoute &&
      (canRequestTranslation || canUpdateTranslation) &&
      (isTranslationRequestsRoute || translationQueueBusy || translationQueueError || translationQueue.length > 0) ? (
        <DocumentSection className={documentSectionClassName}>
          {translationQueueError ? <Banner tone="error">{translationQueueError}</Banner> : null}
          <DocumentTranslationRequestsTable
            canUpdateTranslation={canUpdateTranslation}
            currentUserId={user?.id ?? null}
            emptyText={t.documents_no_translation_requests}
            l={l}
            loading={translationQueueBusy}
            onOpenDocument={openDocument}
            onUpdateRequest={handleUpdateQueuedTranslationRequest}
            rows={translationQueue}
            t={t}
          />
        </DocumentSection>
      ) : null}

      {!isIntakeRoute && !isTranslationRequestsRoute ? (
      <DocumentSection
        className={documentSectionClassName}
      >
        <div className="relative z-30 space-y-1.5">
          <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-6">
            <div className="relative xl:col-span-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filters.search}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    search: event.target.value,
                  }))
                }
                className="h-8 rounded-lg bg-background pl-8 text-[13px]"
                placeholder={t.common_search}
              />
            </div>
            <NativeComboboxSelect
              value={filters.patientId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  patientId: event.target.value,
                  orderId: "",
                  appointmentId: "",
                }))
              }
              className={cn(selectClassName, "h-8 bg-background text-[13px]")}
            >
              <option value="">{text.allPatients}</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patientOptionLabel(patient)}
                </option>
              ))}
            </NativeComboboxSelect>
            <NativeComboboxSelect
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value,
                }))
              }
              className={cn(selectClassName, "h-8 bg-background text-[13px]")}
            >
              <option value="">{text.allStatuses}</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {formatDocumentStatusLabel(status, t)}
                </option>
              ))}
            </NativeComboboxSelect>
            <NativeComboboxSelect
              value={filters.visibility}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  visibility: event.target.value,
                }))
              }
              className={cn(selectClassName, "h-8 bg-background text-[13px]")}
            >
              <option value="">{text.allVisibility}</option>
              {VISIBILITY_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {formatVisibilityLabel(value, t)}
                </option>
              ))}
            </NativeComboboxSelect>
            <Input
              value={filters.art}
              onChange={(event) =>
                setFilters((current) => ({ ...current, art: event.target.value }))
              }
              list="documents-art-options"
              className="h-8 rounded-lg bg-background text-[13px]"
              placeholder={t.operations_document_type}
            />
          </div>
          <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-4">
            <Input
              value={filters.orderId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  orderId: event.target.value,
                }))
              }
              className="h-8 rounded-lg bg-background text-[13px]"
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
              className="h-8 rounded-lg bg-background text-[13px]"
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
              className="h-8 rounded-lg bg-background text-[13px]"
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
              className="h-8 rounded-lg bg-background text-[13px]"
            />
          </div>
          <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-4">
            <NativeComboboxSelect
              value={filters.category}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  category: event.target.value,
                }))
              }
              className={cn(selectClassName, "h-8 bg-background text-[13px]")}
            >
              <option value="">{text.allCategories}</option>
              {categories.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))}
            </NativeComboboxSelect>
            <Input
              value={filters.klinik}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  klinik: event.target.value,
                }))
              }
              className="h-8 rounded-lg bg-background text-[13px]"
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
              className="h-8 rounded-lg bg-background text-[13px]"
              placeholder={t.documents_source}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-lg px-3 text-[13px]"
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
        </div>
        <datalist id="documents-art-options">
          {arts.map((art) => (
            <option key={art} value={art} label={localizeDocumentCode(art, l)} />
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
          <DocumentsGrid
            documents={documents}
            selectedDocumentIds={selectedDocumentIds}
            selectedId={selectedId}
            labels={{
              selectBulkShare: t.documents_select_bulk_share,
              filename: t.documents_filename,
              patient: t.orders_patient,
              category: t.documents_category,
              status: t.users_status,
              visibility: text.visibilityHeader,
              size: t.documents_size,
              uploadedBy: t.documents_uploaded_by,
              unclassified: t.documents_unclassified,
              current: text.current,
              pidFallback: text.pidFallback,
              notSet: t.common_not_set,
              unknownUploader: t.documents_unknown_uploader,
              needsCategorization: text.needsCategorization,
            }}
            localizeCode={(value) => localizeDocumentCode(value, l)}
            onSelectionChange={setSelectedDocumentIds}
            onToggleSelection={toggleDocumentSelection}
            onOpenDocument={openDocument}
            statusBadge={statusBadge}
            visibilityBadge={visibilityBadge}
            sensitivityBadge={sensitivityBadge}
            formatStatusLabel={(value) => formatDocumentStatusLabel(value, t)}
            formatVisibilityLabel={(value) => formatVisibilityLabel(value, t)}
            formatSensitivityLabel={formatSensitivityLabel}
            formatFileSize={formatFileSize}
            formatDateTime={formatDateTime}
            rowHeightOverrides={documentListRowHeightOverrides}
          />
        )}
      </DocumentSection>
      ) : null}
        </>
      ) : null}

      <Sheet open={templateOpen} onOpenChange={setTemplateOpen}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[880px]">
          <form
            onSubmit={handleGenerateDocument}
            className="flex flex-1 min-h-0 flex-col"
          >
            <AdminSheetScaffold
              title={t.documents_generate_title}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.documents_generate_document}
                  submittingLabel={t.documents_generating}
                  submitting={generateBusy}
                  submitDisabled={templates.length === 0}
                  onCancel={() => setTemplateOpen(false)}
                />
              )}
            >
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
                <NativeComboboxSelect
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
                </NativeComboboxSelect>
              </Field>
              <Field label={t.patients_languages} required>
                <NativeComboboxSelect
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
                </NativeComboboxSelect>
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
                  className={shellInputClassName}
                />
              </Field>
              <Field label={t.orders_patient} required>
                <NativeComboboxSelect
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
                </NativeComboboxSelect>
              </Field>
              <Field label={t.orders_title}>
                <NativeComboboxSelect
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
                </NativeComboboxSelect>
              </Field>
              <Field label={t.appointments_title}>
                <NativeComboboxSelect
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
                </NativeComboboxSelect>
              </Field>
              <Field label={t.users_status}>
                <NativeComboboxSelect
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
                </NativeComboboxSelect>
              </Field>
              <Field label={text.visibilityHeader}>
                <NativeComboboxSelect
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
                </NativeComboboxSelect>
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
                  className={shellInputClassName}
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
                  className={shellInputClassName}
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
                  className={shellInputClassName}
                  placeholder={t.documents_default_template_source.replace(
                    "{id}",
                    selectedTemplate?.id ?? "{id}",
                  )}
                />
              </Field>
            </div>
            {availableTemplateBlocks.length > 0 ? (
              <div className="space-y-3 rounded-xl border border-border/60 p-4">
                <div>
                  <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span aria-hidden className="size-2 rounded-full bg-amber-500" />
                    <span>{t.documents_text_blocks}</span>
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
                        htmlFor={`template-block-${block.key}`}
                        key={block.key}
                        aria-label={block.label}
                        className="flex gap-3 rounded-lg border border-border/60 bg-card px-4 py-3 text-sm text-foreground"
                      >
                        <input
                          id={`template-block-${block.key}`}
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
                          className={cn(checkboxClass, "mt-0.5")}
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
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={uploadOpen} onOpenChange={setUploadOpen}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[760px]">
          <form onSubmit={handleUpload} className="flex flex-1 min-h-0 flex-col">
            <AdminSheetScaffold
              title={t.documents_upload}
              description={text.uploadDescription}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.documents_upload}
                  submittingLabel={t.documents_uploading}
                  submitting={uploadBusy}
                  onCancel={() => setUploadOpen(false)}
                />
              )}
            >
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
                  className={shellInputClassName}
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
                  className={shellInputClassName}
                />
              </Field>
              <Field label={t.orders_patient}>
                <NativeComboboxSelect
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
                </NativeComboboxSelect>
              </Field>
              <Field label={t.orders_title}>
                <NativeComboboxSelect
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
                </NativeComboboxSelect>
              </Field>
              <Field label={t.appointments_title}>
                <NativeComboboxSelect
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
                </NativeComboboxSelect>
              </Field>
              <Field label={t.operations_document_type}>
                <Input
                  value={uploadForm.art}
                  onChange={(event) =>
                    setUploadForm((current) => ({
                      ...current,
                      art: event.target.value,
                    }))
                  }
                  list="documents-art-options"
                  className={shellInputClassName}
                  placeholder={t.documents_auto_classification_optional}
                />
              </Field>
              <Field label={t.documents_category}>
                <NativeComboboxSelect
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
                </NativeComboboxSelect>
              </Field>
              {canManage ? (
                <Field label={t.users_status}>
                  <NativeComboboxSelect
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
                  </NativeComboboxSelect>
                </Field>
              ) : null}
              {canManage ? (
                <Field label={text.visibilityHeader}>
                  <NativeComboboxSelect
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
                  </NativeComboboxSelect>
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
                  className={shellInputClassName}
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
                    className={shellInputClassName}
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
                className={checkboxClass}
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
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet
        open={translationRequestOpen}
        onOpenChange={(open) => {
          setTranslationRequestOpen(open);
          if (!open) setTranslationError("");
        }}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[560px]">
          <form
            onSubmit={handleCreateTranslationRequest}
            className="flex flex-1 min-h-0 flex-col"
          >
            <AdminSheetScaffold
              title={t.documents_request_translation}
              description={t.documents_translation_requests}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.documents_request_translation}
                  submittingLabel={t.documents_request_translation}
                  submitting={translationBusy}
                  onCancel={() => setTranslationRequestOpen(false)}
                />
              )}
            >
              {translationError ? <Banner tone="error">{translationError}</Banner> : null}
              <Field label={t.patients_languages} required>
                <NativeComboboxSelect
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
                </NativeComboboxSelect>
              </Field>
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
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet
        open={shareCreateOpen}
        onOpenChange={(open) => {
          setShareCreateOpen(open);
          if (!open) setShareError("");
        }}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[640px]">
          <form onSubmit={handleCreateShare} className="flex flex-1 min-h-0 flex-col">
            <AdminSheetScaffold
              title={t.documents_create_share}
              description={t.documents_share}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.documents_create_share}
                  submittingLabel={t.documents_sharing}
                  submitting={shareBusy}
                  onCancel={() => setShareCreateOpen(false)}
                />
              )}
            >
              {shareError ? <Banner tone="error">{shareError}</Banner> : null}
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
                  variant={shareForm.targetType === "user" ? "default" : "outline"}
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
                  variant={shareForm.targetType === "provider" ? "default" : "outline"}
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
                    <NativeComboboxSelect
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
                    </NativeComboboxSelect>
                  </Field>
                ) : (
                  <Field label={t.common_provider} required>
                    <NativeComboboxSelect
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
                          {item.name} · {item.address_city || t.documents_no_city}
                        </option>
                      ))}
                    </NativeComboboxSelect>
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
                    className={shellInputClassName}
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
                  className={checkboxClass}
                />
                {t.documents_require_confirmation}
              </label>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      {canManage && editForm ? (
        <Sheet open={metadataEditOpen} onOpenChange={setMetadataEditOpen}>
          <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
            <form
              onSubmit={handleSave}
              className="flex flex-1 min-h-0 flex-col"
            >
              <AdminSheetScaffold
                title={l(
                  "Metadaten bearbeiten",
                  "\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u043c\u0435\u0442\u0430\u0434\u0430\u043d\u043d\u044b\u0435",
                  "\u0420\u0435\u0434\u0430\u0433\u0443\u0432\u0430\u0442\u0438 \u043c\u0435\u0442\u0430\u0434\u0430\u043d\u0456",
                )}
                footer={(
                  <SheetFormFooter
                    cancelLabel={t.common_cancel}
                    submitLabel={t.documents_save_metadata}
                    submittingLabel={t.patients_saving}
                    submitting={saveBusy}
                    submitDisabled={!editForm.autoName.trim() || !editForm.art.trim()}
                    onCancel={() => setMetadataEditOpen(false)}
                  />
                )}
              >
                {saveError ? <Banner tone="error">{saveError}</Banner> : null}
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={t.orders_patient}>
                    <NativeComboboxSelect
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
                    </NativeComboboxSelect>
                  </Field>
                  <Field label={t.orders_title}>
                    <NativeComboboxSelect
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
                    </NativeComboboxSelect>
                  </Field>
                  <Field label={t.appointments_title}>
                    <NativeComboboxSelect
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
                          {appointment.title} · {formatDate(appointment.date)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
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
                      className={shellInputClassName}
                    />
                  </Field>
                  <Field label={t.operations_document_type} required>
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
                      className={shellInputClassName}
                    />
                  </Field>
                  <Field label={t.documents_category}>
                    <NativeComboboxSelect
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
                    </NativeComboboxSelect>
                  </Field>
                  <Field label={t.users_status}>
                    <NativeComboboxSelect
                      value={editForm.status}
                      onChange={(event) =>
                        setEditForm((current) =>
                          current
                            ? {
                                ...current,
                                status: event.target.value as DocumentStatus,
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
                    </NativeComboboxSelect>
                  </Field>
                  <Field label={text.visibilityHeader}>
                    <NativeComboboxSelect
                      value={editForm.visibility}
                      onChange={(event) =>
                        setEditForm((current) =>
                          current
                            ? {
                                ...current,
                                visibility: event.target.value as DocumentVisibility,
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
                    </NativeComboboxSelect>
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
                      className={shellInputClassName}
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
                      className={shellInputClassName}
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
                    className={checkboxClass}
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
              </AdminSheetScaffold>
            </form>
          </SheetContent>
        </Sheet>
      ) : null}

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
                disabled={deleteBusy}
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

      {(() => {
        const detailContent = (
            <DocumentDetailState
              busy={detailBusy}
              error={detailError}
              errorContent={
                <div className="pt-5">
                  <Banner tone="error">{detailError}</Banner>
                </div>
              }
              loadingLabel={t.documents_loading_document}
            >
              {detail ? (
              <div className={cn("space-y-4", !embedDetailOnly && "pt-5")}>
                <section className="space-y-4 rounded-xl bg-card/40">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-white">
                      <FileText className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">
                          {localizeDocumentCode(detail.auto_name, l)}
                        </h2>
                        <StatusBadge tone={documentStatusTone(detail.status)}>
                          {formatDocumentStatusLabel(detail.status, t)}
                        </StatusBadge>
                        <StatusBadge tone={documentVisibilityTone(detail.visibility)}>
                          {formatVisibilityLabel(detail.visibility, t)}
                        </StatusBadge>
                        <StatusBadge tone={documentSensitivityTone(detail.data_sensitivity)}>
                          {formatSensitivityLabel(detail.data_sensitivity)}
                        </StatusBadge>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {[
                          detail.original_filename,
                          detail.mime_type,
                          formatFileSize(detail.file_size),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="mt-1 text-[11px] font-mono text-muted-foreground/80">
                        {text.versionOf(detail.version_number, detail.version_count)}
                        {detail.is_latest_version
                          ? ` · ${text.current}`
                          : ` · ${text.historical}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 sm:max-w-[44%] sm:justify-end">
                      {canManage && currentDetailTemplate ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 gap-1.5 rounded-lg px-3.5"
                          onClick={() => openReplacementTemplate(detail)}
                        >
                          <FileText className="size-3.5" />
                          {text.newVersion}
                        </Button>
                      ) : null}
                      {detail.has_stored_file &&
                      (detail.mime_type?.startsWith("text/html") ||
                        detail.mime_type?.startsWith("application/pdf")) ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 gap-1.5 rounded-lg px-3.5"
                          onClick={() => void handleOpenPreview()}
                        >
                          <FileText className="size-3.5" />
                          {t.documents_preview}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        className="rounded-lg"
                        aria-label={t.documents_download}
                        title={t.documents_download}
                        disabled={!detail.has_stored_file}
                        onClick={() =>
                          void downloadDocumentFile(
                            detail.id,
                            detail.original_filename ?? detail.auto_name,
                          )
                        }
                      >
                        <Download className="size-4" />
                      </Button>
                      {canManage && detail.has_stored_file ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-lg"
                          className="rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive"
                          aria-label={t.documents_delete_file}
                          title={t.documents_delete_file}
                          onClick={() => {
                            setDeleteError("");
                            setDeleteReason("");
                            setDeleteOpen(true);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                      {canManage && editForm ? (
                        <Button
                          type="button"
                          className="h-9 gap-1.5 rounded-lg bg-[var(--brand)] px-3.5 text-white shadow-sm hover:bg-[var(--brand)]/90 focus-visible:ring-[var(--brand)]/30"
                          onClick={() => {
                            setSaveError("");
                            setMetadataEditOpen(true);
                          }}
                        >
                          <FileText className="size-3.5" />
                          {l(
                            "Metadaten bearbeiten",
                            "\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u043c\u0435\u0442\u0430\u0434\u0430\u043d\u043d\u044b\u0435",
                            "\u0420\u0435\u0434\u0430\u0433\u0443\u0432\u0430\u0442\u0438 \u043c\u0435\u0442\u0430\u0434\u0430\u043d\u0456",
                          )}
                        </Button>
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

                <section className="overflow-hidden rounded-2xl bg-white shadow-[0_10px_24px_rgba(15,23,42,0.035)] ring-1 ring-slate-950/[0.06]">
                  <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_310px]">
                    <DocumentMetaPanel
                      className="border-b border-slate-200/70 xl:border-b-0 xl:border-r"
                      title={l("Verkn\u00fcpfungen", "\u0421\u0432\u044f\u0437\u0438", "Links")}
                    >
                      <DocumentMetaHighlight
                        label={t.orders_patient}
                        value={
                          detail.patient_name || t.common_not_set
                        }
                        accessory={
                          detail.patient_name ? (
                            <span className="rounded-full bg-white px-2 py-1 font-mono text-[11px] font-medium text-muted-foreground ring-1 ring-slate-200/80">
                              {detail.patient_pid ?? text.pidFallback}
                            </span>
                          ) : null
                        }
                      >
                        <div className="mt-4 space-y-2.5">
                          <DocumentMetaFact
                            label={t.orders_title}
                            value={detail.order_number || t.common_not_set}
                          />
                          <DocumentMetaFact
                            label={t.appointments_title}
                            value={detail.appointment_title || t.common_not_set}
                          />
                        </div>
                      </DocumentMetaHighlight>
                    </DocumentMetaPanel>

                    <DocumentMetaPanel
                      className="border-b border-slate-200/70 xl:border-b-0 xl:border-r"
                      title={l(
                        "Klassifikation",
                        "\u041a\u043b\u0430\u0441\u0441\u0438\u0444\u0438\u043a\u0430\u0446\u0438\u044f",
                        "Classification",
                      )}
                    >
                      <DocumentMetaHighlight
                        label={l(
                          "Dokumenttyp",
                          "\u0422\u0438\u043f \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430",
                          "Document type",
                        )}
                        value={detail.art ? localizeDocumentCode(detail.art, l) : t.common_not_set}
                      >
                        <div className="mt-4 space-y-2.5">
                          <DocumentMetaFact
                            label={t.documents_category}
                            value={detail.category ? localizeDocumentCode(detail.category, l) : t.common_not_set}
                          />
                          <DocumentMetaFact
                            label={t.common_provider}
                            value={detail.klinik || t.common_not_set}
                          />
                          <DocumentMetaFact
                            label={t.documents_source}
                            value={formatDocumentSourceLabel(detail.ursprung, t)}
                          />
                        </div>
                      </DocumentMetaHighlight>
                    </DocumentMetaPanel>

                    <aside className="px-5 py-4">
                      <div className="mb-5 flex items-end justify-between gap-3">
                        <div className="min-w-0">
                          <span className="text-[11px] font-medium leading-4 text-muted-foreground">
                            {t.documents_version_chain}
                          </span>
                          <p className="mt-1 flex min-w-0 items-baseline gap-1.5">
                            <span className="text-2xl font-semibold leading-7 tracking-tight text-foreground">
                              v{detail.version_number}
                            </span>
                            <span className="text-xs font-medium text-muted-foreground">
                              {l("von", "из", "of")} {detail.version_count}
                            </span>
                          </p>
                        </div>
                        <span
                          aria-hidden
                          className="mb-1 h-1.5 w-11 shrink-0 rounded-full bg-[var(--brand)] opacity-30"
                        />
                      </div>
                      <div className="space-y-3">
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
                      </div>
                    </aside>
                  </div>

                  {detail.notes ? (
                    <div className="border-t border-slate-200/70 px-5 py-4">
                      <div className="flex w-full flex-col gap-2">
                        <div className="w-full rounded-xl border border-slate-200/70 bg-[#f9fdff] px-4 py-3">
                          <div className="mb-2 flex items-center gap-2.5">
                            <span className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
                            <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">
                              {t.patients_notes}
                            </span>
                          </div>
                          <p className="w-full whitespace-pre-wrap text-[13.5px] font-normal leading-6 text-muted-foreground">
                            {detail.notes}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>

                {detailVersions.length > 0 ? (
                  <SectionCard
                    icon={<History className="size-4" />}
                    iconChrome="plain"
                    neutralSurface
                    title={t.documents_version_history}
                    tone="violet"
                  >
                    <div className="space-y-1">
                      {detailVersions.map((version, index) => {
                        const selected = version.id === detail.id;
                        const filename =
                          version.original_filename ||
                          localizeDocumentCode(version.art, l) ||
                          t.common_not_set;

                        return (
                        <button
                          key={version.id}
                          type="button"
                          onClick={() => openDocument(version.id)}
                          className={cn(
                            "group relative grid w-full rounded-lg gap-3 bg-transparent px-3.5 py-1.5 text-left transition hover:bg-violet-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[64px_minmax(0,1fr)_minmax(132px,auto)]",
                            selected &&
                              "before:absolute before:bottom-3 before:left-0 before:top-3 before:w-0.5 before:rounded-full before:bg-violet-500",
                          )}
                        >
                          <div className="flex items-center justify-center">
                            <span
                              className={cn(
                                "inline-flex h-8 w-12 items-center justify-center rounded-lg border text-xs font-semibold leading-none tabular-nums",
                                selected
                                  ? "border-violet-200 bg-violet-100 text-violet-700"
                                  : "border-border/60 bg-background text-foreground",
                              )}
                            >
                              v{version.version_number}
                            </span>
                          </div>

                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                                {localizeDocumentCode(version.auto_name, l)}
                              </span>
                            </div>
                            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span className="tabular-nums">
                                {formatDateTime(version.created_at)}
                              </span>
                              <span className="min-w-0 truncate">{filename}</span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground sm:justify-end">
                            <span className="tabular-nums sm:hidden">
                              {index + 1} / {detailVersions.length}
                            </span>
                            <span className="flex min-w-0 flex-wrap justify-end gap-1.5">
                              {selected ? (
                                <Badge
                                  variant="outline"
                                  className="rounded-full border-violet-200 bg-violet-50 text-[10px] text-violet-700"
                                >
                                  {l(
                                    "Ge\u00f6ffnet",
                                    "\u041e\u0442\u043a\u0440\u044b\u0442\u0430",
                                    "Open",
                                  )}
                                </Badge>
                              ) : null}
                              <Badge
                                variant="outline"
                                className={cn(
                                  "rounded-full bg-transparent text-[10px]",
                                  version.is_latest_version
                                    ? "border-emerald-200 text-emerald-700"
                                    : "border-border/60 text-muted-foreground",
                                )}
                              >
                                {version.is_latest_version
                                  ? text.current
                                  : t.documents_archived}
                              </Badge>
                            </span>
                          </div>
                        </button>
                        );
                      })}
                    </div>
                  </SectionCard>
                ) : null}

                <SectionCard
                  icon={<Search className="size-4" />}
                  iconChrome="plain"
                  neutralSurface
                  title={t.documents_text_extraction}
                  tone="brand"
                  accessory={
                    canRequestTranslation ? (
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 rounded-lg"
                        disabled={textExtractionBusy}
                        onClick={() => void handleRunTextExtraction()}
                      >
                        {textExtractionBusy ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="size-3.5" />
                        )}
                        {t.documents_run_extraction}
                      </Button>
                    ) : null
                  }
                >
                  {textExtractionError ? (
                    <Banner tone="error">{textExtractionError}</Banner>
                  ) : null}
                  <div className="space-y-3">
                    {textExtraction?.message ? (
                      <div className="px-1 py-1 text-sm text-amber-900">
                        {textExtraction.message}
                      </div>
                    ) : null}
                    {textExtraction?.extracted_text ? (
                      <div className="px-1 pt-1">
                        <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <Label className="text-sm font-medium text-foreground">
                              {t.documents_extracted_text}
                            </Label>
                          </div>
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <span
                              className={cn(
                                "size-1.5 rounded-full",
                                (textExtraction?.status ?? "not_started") === "completed" && "bg-emerald-500",
                                (textExtraction?.status ?? "not_started") === "failed" && "bg-rose-500",
                                (textExtraction?.status ?? "not_started") === "unsupported" && "bg-amber-500",
                                (textExtraction?.status ?? "not_started") === "not_started" && "bg-muted-foreground/35",
                              )}
                            />
                            <span className="font-medium text-foreground">
                              {formatExtractionStatusLabel(
                                textExtraction?.status ?? "not_started",
                                t,
                              )}
                            </span>
                            {textExtraction?.method ? (
                              <>
                                <span className="size-1 rounded-full bg-muted-foreground/35" />
                                <span>{formatExtractionMethodLabel(textExtraction.method)}</span>
                              </>
                            ) : null}
                            <span className="size-1 rounded-full bg-muted-foreground/35" />
                            <span>
                              {textExtraction?.extracted_at
                                ? t.documents_last_processed.replace(
                                    "{datetime}",
                                    formatDateTime(textExtraction.extracted_at),
                                  )
                                : t.documents_no_extraction_run}
                            </span>
                            {textExtraction?.extracted_by_name ? (
                              <>
                                <span className="size-1 rounded-full bg-muted-foreground/35" />
                                <span>{textExtraction.extracted_by_name}</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <textarea
                          readOnly
                          value={textExtraction.extracted_text}
                          className={cn(textareaClassName, "min-h-[320px] bg-white leading-relaxed")}
                        />
                      </div>
                    ) : (
                      <div className="space-y-2 px-1 py-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              (textExtraction?.status ?? "not_started") === "completed" && "bg-emerald-500",
                              (textExtraction?.status ?? "not_started") === "failed" && "bg-rose-500",
                              (textExtraction?.status ?? "not_started") === "unsupported" && "bg-amber-500",
                              (textExtraction?.status ?? "not_started") === "not_started" && "bg-muted-foreground/35",
                            )}
                          />
                          <span className="font-medium text-foreground">
                            {formatExtractionStatusLabel(
                              textExtraction?.status ?? "not_started",
                              t,
                            )}
                          </span>
                          {textExtraction?.method ? (
                            <>
                              <span className="size-1 rounded-full bg-muted-foreground/35" />
                              <span>{formatExtractionMethodLabel(textExtraction.method)}</span>
                            </>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
                          <span className="size-2 rounded-full bg-muted-foreground/35" />
                          <span>{t.documents_no_extracted_text}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </SectionCard>

                {detail.patient_id ? (
                  <SectionCard
                    icon={<Languages className="size-4" />}
                    iconChrome="plain"
                    neutralSurface
                    title={t.documents_translation_requests}
                    tone="brand"
                    accessory={
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm">
                          <span className="font-semibold tabular-nums text-foreground">
                            {translationRequests.length}
                          </span>
                          {t.documents_translation_requests}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm">
                          <span className="font-semibold tabular-nums text-amber-700">
                            {translationRequests.filter((request) => request.status === "requested").length}
                          </span>
                          {formatTranslationStatusLabel("requested", t)}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm">
                          <span className="font-semibold tabular-nums text-sky-700">
                            {translationRequests.filter((request) => request.status === "in_progress").length}
                          </span>
                          {formatTranslationStatusLabel("in_progress", t)}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm">
                          <span className="font-semibold tabular-nums text-emerald-700">
                            {translationRequests.filter((request) => request.status === "completed").length}
                          </span>
                          {formatTranslationStatusLabel("completed", t)}
                        </span>
                        {canRequestTranslation ? (
                          <Button
                            type="button"
                            size="sm"
                            className="h-8 rounded-lg"
                            onClick={() => {
                              setTranslationError("");
                              setTranslationRequestOpen(true);
                            }}
                          >
                            <FileText className="size-3.5" />
                            {t.documents_request_translation}
                          </Button>
                        ) : null}
                      </div>
                    }
                  >
                    {translationError ? (
                      <Banner tone="error">{translationError}</Banner>
                    ) : null}
                    {translationRequests.length === 0 ? (
                      <div className="flex items-center gap-3 rounded-lg px-3 py-4 text-sm text-muted-foreground">
                        <span className="size-2.5 shrink-0 rounded-full bg-muted-foreground/35" />
                        <span>{t.documents_no_translation_requests}</span>
                      </div>
                    ) : (
                      <div className="space-y-0">
                        {translationRequests.map((request) => {
                          const draft = translationDrafts[request.id] ?? {
                            note: request.note ?? "",
                            sourceLanguage: request.source_language ?? "",
                            sourceText: request.source_text ?? "",
                            translatedText: request.translated_text ?? "",
                          };
                          const canEditWorkspace =
                            canUpdateTranslation && request.status !== "cancelled";
                          const canActOnTranslation =
                            canUpdateTranslation &&
                            request.status !== "completed" &&
                            request.status !== "cancelled";
                          const canShowTranslationActionMenu =
                            canActOnTranslation || Boolean(request.translated_document_id);
                          const actionMenuButtonClass =
                            "h-8 w-full justify-start rounded-md px-2.5 text-xs font-medium text-foreground hover:bg-[#f9fdff] hover:text-foreground";

                          return (
                            <details
                              key={request.id}
                              className={cn(
                                "group relative pl-9",
                                request.status === "cancelled" && "opacity-75",
                              )}
                            >
                              <summary className="relative grid cursor-pointer list-none gap-2 rounded-lg px-3 py-3 pr-12 transition hover:bg-[#f9fdff] group-open:bg-[#f9fdff] group-open:ring-1 group-open:ring-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                                <div className="absolute -left-9 bottom-0 top-0 flex w-8 items-start justify-center pt-3">
                                  <span
                                    className={cn(
                                      "inline-flex size-7 shrink-0 items-center justify-center transition-colors",
                                      translationRequestChevronTone(request.status),
                                    )}
                                  >
                                    <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                                  </span>
                                </div>
                                {canShowTranslationActionMenu ? (
                                  <div
                                    data-translation-action-menu
                                    role="presentation"
                                    className="absolute right-3 top-3 z-20"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                    }}
                                    onKeyDown={(event) => event.stopPropagation()}
                                  >
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      className="size-7 rounded-full bg-white text-muted-foreground shadow-sm ring-1 ring-border/60 hover:bg-[#f9fdff] hover:text-foreground"
                                      aria-label={l("Aktionen", "Действия", "Actions")}
                                      aria-expanded={translationActionMenuOpen === request.id}
                                      onClick={(event) => {
                                        if (translationActionMenuOpen === request.id) {
                                          setTranslationActionMenuOpen(null);
                                          setTranslationActionMenuPosition(null);
                                          return;
                                        }

                                        const rect = event.currentTarget.getBoundingClientRect();
                                        const menuWidth = 240;
                                        setTranslationActionMenuPosition({
                                          left: Math.max(
                                            8,
                                            Math.min(
                                              window.innerWidth - menuWidth - 8,
                                              rect.right - menuWidth,
                                            ),
                                          ),
                                          top: rect.bottom + 8,
                                        });
                                        setTranslationActionMenuOpen(request.id);
                                      }}
                                    >
                                      <MoreHorizontal className="size-4" />
                                    </Button>
                                    {translationActionMenuOpen === request.id &&
                                    translationActionMenuPosition &&
                                    typeof document !== "undefined"
                                      ? createPortal(
                                      <div
                                        data-translation-action-menu
                                        className="fixed z-[9999] w-60 rounded-lg border border-border/60 bg-white p-1.5 shadow-xl"
                                        style={{
                                          left: translationActionMenuPosition.left,
                                          top: translationActionMenuPosition.top,
                                        }}
                                      >
                                        <span className="absolute -top-1.5 right-3 size-3 rotate-45 border-l border-t border-border/60 bg-white" />
                                        {request.translated_document_id ? (
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className={actionMenuButtonClass}
                                            disabled={translationBusy}
                                            onClick={() => {
                                              setTranslationActionMenuOpen(null);
                                              setTranslationActionMenuPosition(null);
                                              openDocument(request.translated_document_id!);
                                            }}
                                          >
                                            {l("Uebersetzung öffnen", "Открыть перевод", "Open translation")}
                                          </Button>
                                        ) : null}
                                        {canActOnTranslation && request.status !== "in_progress" ? (
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className={actionMenuButtonClass}
                                            disabled={translationBusy}
                                            onClick={() => {
                                              setTranslationActionMenuOpen(null);
                                              setTranslationActionMenuPosition(null);
                                              void handleUpdateTranslationRequest(
                                                request.id,
                                                "in_progress",
                                                undefined,
                                                undefined,
                                                { assignedTo: request.assigned_to ?? user?.id ?? null },
                                              );
                                            }}
                                          >
                                            {t.documents_translation_start}
                                          </Button>
                                        ) : null}
                                        {canActOnTranslation ? (
                                          <>
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              className={actionMenuButtonClass}
                                              disabled={translationBusy}
                                              onClick={() => {
                                                setTranslationActionMenuOpen(null);
                                                setTranslationActionMenuPosition(null);
                                                void handleUpdateTranslationRequest(
                                                  request.id,
                                                  "completed",
                                                );
                                              }}
                                            >
                                              {t.documents_translation_complete}
                                            </Button>
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              className={actionMenuButtonClass}
                                              disabled={translationBusy || !draft.translatedText.trim()}
                                              onClick={() => {
                                                setTranslationActionMenuOpen(null);
                                                setTranslationActionMenuPosition(null);
                                                void handleUpdateTranslationRequest(
                                                  request.id,
                                                  "completed",
                                                  undefined,
                                                  l("Uebersetzung abgeschlossen und Dokument erstellt.", "Перевод завершен, документ создан.", "Translation completed and document created."),
                                                  { createTranslatedDocument: true },
                                                );
                                              }}
                                            >
                                              {l("Abschließen + Dokument", "Завершить + документ", "Complete + document")}
                                            </Button>
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              className={actionMenuButtonClass}
                                              disabled={translationBusy}
                                              onClick={() => {
                                                setTranslationActionMenuOpen(null);
                                                setTranslationActionMenuPosition(null);
                                                void handleUpdateTranslationRequest(
                                                  request.id,
                                                  "cancelled",
                                                );
                                              }}
                                            >
                                              {t.documents_translation_cancel}
                                            </Button>
                                          </>
                                        ) : null}
                                      </div>,
                                      document.body,
                                    )
                                      : null}
                                  </div>
                                ) : null}
                                <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                                  <div className="min-w-0">
                                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                      <p className="max-w-full truncate text-[15px] font-semibold leading-5 text-foreground">
                                        {request.requested_by_name ||
                                          t.documents_unknown_requester}
                                      </p>
                                      <span className="size-1 rounded-full bg-muted-foreground/35" />
                                      <span className="text-xs tabular-nums text-muted-foreground">
                                        {formatDateTime(request.requested_at)}
                                      </span>
                                      {request.completed_at ? (
                                        <>
                                          <span className="size-1 rounded-full bg-muted-foreground/35" />
                                          <span className="text-xs tabular-nums text-muted-foreground">
                                            {formatTranslationStatusLabel("completed", t)}{" "}
                                            {formatDateTime(request.completed_at)}
                                          </span>
                                        </>
                                      ) : null}
                                    </div>
                                    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                      <span>
                                        {l("Zugewiesen", "Назначено", "Assigned")}:{" "}
                                        <span className="font-medium text-foreground">
                                          {request.assigned_to_name ?? l("Nicht zugewiesen", "Не назначено", "Unassigned")}
                                        </span>
                                      </span>
                                      {request.translated_by_name ? (
                                        <>
                                          <span className="size-1 rounded-full bg-muted-foreground/35" />
                                          <span>
                                            Workspace:{" "}
                                            <span className="font-medium text-foreground">
                                              {request.translated_by_name}
                                            </span>
                                          </span>
                                        </>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div className="flex min-w-0 flex-wrap justify-start gap-1.5 lg:max-w-[420px] lg:justify-end lg:pr-1">
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
                                      className="rounded-full border-0 bg-[#f9fdff] px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                                    >
                                      {formatLanguageLabel(request.requested_language)}
                                    </Badge>
                                    {request.translated_document_name ? (
                                      <Badge
                                        variant="outline"
                                        className="max-w-[220px] truncate rounded-full border-0 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700"
                                      >
                                        {request.translated_document_name}
                                      </Badge>
                                    ) : null}
                                  </div>
                                </div>
                              </summary>
                              <div
                                aria-hidden="true"
                                className="ml-20 flex h-3 items-center px-3"
                              >
                                <span className="h-px w-12 bg-gradient-to-r from-transparent via-border/70 to-border/70" />
                                <span className="size-1.5 rounded-full bg-border" />
                                <span className="h-px flex-1 bg-gradient-to-r from-border/70 to-transparent" />
                              </div>
                              <div className="mb-2 ml-20 overflow-hidden rounded-lg bg-[#fbfdff] p-2 shadow-sm">
                                {request.translated_document_id ? (
                                  <div className="flex items-center gap-3 px-3 py-2">
                                    <div className="min-w-0">
                                      <p className="text-[11.5px] font-medium leading-tight text-muted-foreground">
                                        {l("Fertiges Dokument", "Готовый документ", "Ready document")}
                                      </p>
                                      <p className="mt-1 truncate text-sm font-medium text-foreground">
                                        {request.translated_document_name ?? t.documents_translated_text}
                                      </p>
                                    </div>
                                  </div>
                                ) : null}
                                {canEditWorkspace ? (
                                  <div>
                                    <div className="grid gap-3 px-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                                      <div className="grid gap-3 md:grid-cols-2">
                                        <Field label={t.documents_source_language}>
                                          <NativeComboboxSelect
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
                                          </NativeComboboxSelect>
                                        </Field>
                                        <Field label={l("Assignee", "Исполнитель", "Assignee")}>
                                          <NativeComboboxSelect
                                            value={request.assigned_to ?? ""}
                                            onChange={(event) => {
                                              const assignedTo = event.target.value;
                                              if (!assignedTo) return;
                                              void handleUpdateTranslationRequest(
                                                request.id,
                                                request.status === "pending" ? "in_progress" : request.status,
                                                undefined,
                                                l("Zuweisung aktualisiert.", "Назначение обновлено.", "Assignee updated."),
                                                { assignedTo },
                                              );
                                            }}
                                            className={selectClassName}
                                            disabled={translationBusy}
                                          >
                                            <option value="">{l("Nicht zugewiesen", "Не назначено", "Unassigned")}</option>
                                            {staff.map((member) => (
                                              <option key={member.id} value={member.id}>
                                                {member.name} / {formatRoleLabel(member.role)}
                                              </option>
                                            ))}
                                          </NativeComboboxSelect>
                                        </Field>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                                        {textExtraction?.extracted_text ? (
                                          <Button
                                            type="button"
                                            variant="outline"
                                            className="h-8 rounded-lg bg-white"
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
                                          className="h-8 rounded-lg bg-white"
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
                                    <div className="grid lg:grid-cols-2">
                                      <div className="px-3 py-3 lg:pr-4">
                                        <Field label={t.documents_source_text}>
                                          <textarea
                                            value={draft.sourceText}
                                            onChange={(event) =>
                                              updateTranslationDraft(request.id, {
                                                sourceText: event.target.value,
                                              })
                                            }
                                            className={cn(textareaClassName, "min-h-[260px]")}
                                            placeholder={t.documents_source_text_placeholder}
                                          />
                                        </Field>
                                      </div>
                                      <div className="px-3 py-3 lg:pl-4">
                                        <Field label={t.documents_translated_text}>
                                          <textarea
                                            value={draft.translatedText}
                                            onChange={(event) =>
                                              updateTranslationDraft(request.id, {
                                                translatedText: event.target.value,
                                              })
                                            }
                                            className={cn(textareaClassName, "min-h-[260px] bg-white")}
                                            placeholder={t.documents_translated_text_placeholder}
                                          />
                                        </Field>
                                      </div>
                                    </div>
                                    <div className="px-3 py-3">
                                      <Field label={t.patients_notes}>
                                        <textarea
                                          value={draft.note}
                                          onChange={(event) =>
                                            updateTranslationDraft(request.id, {
                                              note: event.target.value,
                                            })
                                          }
                                          className={cn(textareaClassName, "min-h-[92px]")}
                                          placeholder={t.documents_translation_note_placeholder}
                                        />
                                      </Field>
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    {request.note ? (
                                      <div className="px-3 py-3">
                                        <p className="text-[11.5px] font-medium leading-tight text-muted-foreground">
                                          {t.patients_notes}
                                        </p>
                                        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                                          {request.note}
                                        </p>
                                      </div>
                                    ) : null}
                                    {request.source_text || request.translated_text ? (
                                      <div className="grid lg:grid-cols-2">
                                        {request.source_text ? (
                                          <div className="px-3 py-3 lg:pr-4">
                                            <p className="text-[11.5px] font-medium leading-tight text-muted-foreground">
                                              {t.documents_source_text}
                                            </p>
                                            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                                              {request.source_text}
                                            </p>
                                          </div>
                                        ) : null}
                                        {request.translated_text ? (
                                          <div className="px-3 py-3 lg:pl-4">
                                            <p className="text-[11.5px] font-medium leading-tight text-muted-foreground">
                                              {t.documents_translated_text}
                                            </p>
                                            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                                              {request.translated_text}
                                            </p>
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            </details>
                          );
                        })}
                      </div>
                    )}
                  </SectionCard>
                ) : null}

                {canReviewSelectedDocument && editForm ? (
                  <SectionCard
                    icon={<ShieldCheck className="size-4" />}
                    title={t.documents_interpreter_review}
                    tone="rose"
                  >
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
                            className={shellInputClassName}
                          />
                        </Field>
                        <Field label={t.documents_taxonomy_category}>
                          <NativeComboboxSelect
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
                          </NativeComboboxSelect>
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
                          className={checkboxClass}
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
                            className={cn(textareaClassName, "min-h-[120px]")}
                            placeholder={t.documents_review_notes}
                          />
                      </Field>
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200/70 bg-rose-50/40 px-4 py-3 text-sm text-rose-900/80">
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

                <SectionCard
                  icon={<UserRound className="size-4" />}
                  iconChrome="plain"
                  neutralSurface
                  title={t.documents_patient_portal}
                  tone="brand"
                  accessory={
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full bg-white px-2.5 py-1 text-[11px] font-medium shadow-sm",
                          detail.visibility === "patient_visible"
                            ? "text-emerald-700"
                            : "text-muted-foreground",
                        )}
                      >
                        {detail.visibility === "patient_visible"
                          ? t.documents_portal_eligible
                          : t.documents_not_portal_eligible}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm">
                        <span className="font-semibold tabular-nums text-foreground">
                          {activePortalShares.length}
                        </span>
                        {t.documents_active_portal_releases}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm">
                        <span className="font-semibold tabular-nums text-emerald-700">
                          {confirmedPortalShares}
                        </span>
                        {t.documents_confirmed_recipients}
                      </span>
                      {canManage ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            className="h-8 rounded-lg"
                            disabled={portalBusy || !detail.patient_id}
                            onClick={() => void handleReleaseToPortal()}
                          >
                            {portalBusy ? (
                              <LoaderCircle className="size-3.5 animate-spin" />
                            ) : null}
                            {activePortalShares.length > 0
                              ? t.documents_refresh_portal_release
                              : t.documents_release_to_portal}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg border-transparent bg-white shadow-sm hover:border-transparent"
                            disabled={portalBusy || activePortalShares.length === 0}
                            onClick={() => void handleRevokePortalRelease()}
                          >
                            {portalBusy ? (
                              <LoaderCircle className="size-3.5 animate-spin" />
                            ) : null}
                            {t.documents_revoke_portal_release}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  }
                >
                  {!detail.patient_id || !canManage ? (
                    <div className="rounded-lg bg-amber-50/70 px-4 py-3 text-sm text-amber-900/80">
                      {!detail.patient_id ? (
                        <p className="font-medium text-amber-700">
                          {t.documents_link_patient_before_portal}
                        </p>
                      ) : null}
                      {!canManage ? (
                        <p className="font-medium text-muted-foreground">
                          {t.documents_only_ceo_pm_portal}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="space-y-1">
                    {activePortalShares.length === 0 ? (
                      <div className="flex items-center gap-3 rounded-lg px-3 py-4 text-sm text-muted-foreground">
                        <span className="size-2.5 shrink-0 rounded-full bg-muted-foreground/35" />
                        <span>
                          {l(
                            "Noch keine aktiven Portal-Freigaben.",
                            "\u0410\u043a\u0442\u0438\u0432\u043d\u044b\u0445 \u0440\u0435\u043b\u0438\u0437\u043e\u0432 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442.",
                            "No active portal releases yet.",
                          )}
                        </span>
                      </div>
                    ) : (
                      activePortalShares.map((share, index) => (
                        <div
                          key={share.id}
                          className="group grid gap-3 rounded-lg px-3 py-2.5 transition hover:bg-emerald-50/45 sm:grid-cols-[minmax(0,1fr)_auto]"
                        >
                          <div className="flex min-w-0 gap-3">
                            <div className="relative flex w-5 shrink-0 justify-center">
                              {index < activePortalShares.length - 1 ? (
                                <span
                                  aria-hidden="true"
                                  className="absolute bottom-[-14px] top-5 w-px bg-emerald-100 transition group-hover:bg-emerald-200"
                                />
                              ) : null}
                              <span
                                className={cn(
                                  "relative mt-1 size-2.5 rounded-full ring-4 ring-white",
                                  share.confirmed
                                    ? "bg-emerald-500"
                                    : "bg-sky-500",
                                )}
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                                <p className="min-w-0 truncate text-sm font-semibold text-foreground">
                                  {share.target_user_name ||
                                    t.documents_patient_portal_user}
                                </p>
                                <span className="text-[11px] tabular-nums text-muted-foreground">
                                  {formatDateTime(share.shared_at)}
                                </span>
                              </div>
                              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                {t.documents_portal_released_at.replace(
                                  "{datetime}",
                                  formatDateTime(share.shared_at),
                                )}
                              </p>
                              {share.confirmed ? (
                                <span className="mt-1.5 inline-flex text-xs font-medium text-emerald-700">
                                  {t.documents_portal_confirmed_by_patient}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex items-start pl-8 sm:justify-end sm:pl-0">
                            <DocumentShareStateBadge
                              share={share}
                              t={t}
                              text={text}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </SectionCard>

                {canViewShares ? (
                  <SectionCard
                    icon={<Share2 className="size-4" />}
                    iconChrome="plain"
                    neutralSurface
                    title={t.documents_share}
                    tone="brand"
                    accessory={
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm">
                          <span className="font-semibold tabular-nums text-foreground">
                            {shares.length}
                          </span>
                          {l("Gesamt", "\u0412\u0441\u0435\u0433\u043e", "Total")}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm">
                          <span className="font-semibold tabular-nums text-emerald-700">
                            {shares.filter((share) => !share.revoked_at).length}
                          </span>
                          {l("Aktiv", "\u0410\u043a\u0442\u0438\u0432\u043d\u044b\u0435", "Active")}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm">
                          <span className="font-semibold tabular-nums text-amber-700">
                            {shares.filter(
                              (share) =>
                                !share.revoked_at &&
                                !share.confirmed &&
                                share.requires_confirmation,
                            ).length}
                          </span>
                          {t.documents_waiting_confirmation}
                        </span>
                        {canManage ? (
                          <Button
                            type="button"
                            size="sm"
                            className="h-8 rounded-lg"
                            onClick={() => {
                              setShareError("");
                              setShareCreateOpen(true);
                            }}
                          >
                            <Share2 className="size-3.5" />
                            {t.documents_create_share}
                          </Button>
                        ) : null}
                      </div>
                    }
                  >
                    {shareError ? (
                      <Banner tone="error">{shareError}</Banner>
                    ) : null}

                    {shares.length === 0 ? (
                      <div className="flex items-center gap-3 rounded-lg px-3 py-4 text-sm text-muted-foreground">
                        <span className="size-2.5 shrink-0 rounded-full bg-muted-foreground/35" />
                        <span>{t.documents_no_shares_yet}</span>
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-lg">
                        <div className="hidden grid-cols-[minmax(170px,0.7fr)_minmax(150px,150px)_minmax(360px,1.4fr)] gap-4 px-3 py-2 text-[11px] font-medium text-muted-foreground lg:grid">
                          <span>{l("Empfaenger", "Получатель", "Recipient")}</span>
                          <span className="border-l border-border/50 px-3">
                            {t.users_status}
                          </span>
                          <span className="border-l border-border/50 px-3">
                            {l("Freigabe", "Доступ", "Access")}
                          </span>
                        </div>
                        {shares.map((share) => {
                          const isProviderShare = Boolean(share.provider_name);
                          const targetName =
                            share.provider_name ||
                            share.target_user_name ||
                            t.documents_unknown_target;
                          const targetKind = isProviderShare
                            ? t.documents_provider_target
                            : share.target_user_role
                              ? formatRoleLabel(share.target_user_role)
                              : t.common_not_set;
                          const canCurrentUserConfirm =
                            !share.confirmed &&
                            !share.revoked_at &&
                            share.shared_with_user_id === user?.id;
                          return (
                            <div
                              key={share.id}
                              className={cn(
                                "group grid gap-3 border-t border-border/50 px-3 py-3 transition first:border-t-0 hover:bg-[#f9fdff] lg:grid-cols-[minmax(170px,0.7fr)_minmax(150px,150px)_minmax(360px,1.4fr)] lg:items-center lg:gap-4",
                                share.revoked_at && "opacity-70",
                              )}
                            >
                              <div className="flex min-w-0 items-center">
                                <div className="min-w-0">
                                  <p className="min-w-0 truncate text-[15px] font-semibold leading-5 text-foreground">
                                    {targetName}
                                  </p>
                                  <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-xs tabular-nums text-muted-foreground">
                                    <CalendarClock className="size-3.5 shrink-0" />
                                    <span className="truncate">
                                      {formatDateTime(share.shared_at)}
                                    </span>
                                  </p>
                                </div>
                              </div>
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5 lg:border-l lg:border-border/50 lg:px-3">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "rounded-full border-0 px-2 py-0.5 text-[10px] font-medium",
                                    isProviderShare
                                      ? "bg-sky-50 text-sky-700"
                                      : "bg-[var(--brand)]/10 text-[var(--brand)]",
                                  )}
                                >
                                  {targetKind}
                                </Badge>
                                <DocumentShareStateBadge
                                  share={share}
                                  t={t}
                                  text={text}
                                />
                              </div>
                              <div className="min-w-0 lg:border-l lg:border-border/50 lg:px-3">
                                <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                      <span className="min-w-0 truncate text-xs font-medium text-foreground/80">
                                        {t.documents_shared_by.replace(
                                          "{name}",
                                          share.shared_by_name || t.common_unknown,
                                        )}
                                      </span>
                                      {share.channel ? (
                                        <>
                                        <span className="size-1 rounded-full bg-border" />
                                        <Badge
                                          variant="outline"
                                          className="rounded-full border-0 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700"
                                        >
                                          {formatShareChannelLabel(share.channel)}
                                        </Badge>
                                        </>
                                      ) : null}
                                    </div>
                                    {share.message ? (
                                      <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
                                        {share.message}
                                      </p>
                                    ) : null}
                                  </div>
                                  <div className="flex shrink-0 flex-wrap items-center gap-2 lg:ml-auto lg:justify-end">
                                    {canCurrentUserConfirm ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        className="h-8 rounded-lg"
                                        onClick={() => void handleConfirmShare(share.id)}
                                      >
                                        {t.common_confirm}
                                      </Button>
                                    ) : null}
                                    {canManage && !share.revoked_at ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 gap-1.5 rounded-md border-transparent px-2.5 text-[11.5px] text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                                        onClick={() => void handleRevokeShare(share.id)}
                                      >
                                        <Undo2 className="size-3.5" />
                                        {t.documents_revoke}
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </SectionCard>
                ) : null}
              </div>
              ) : null}
            </DocumentDetailState>
        );
        return (
          <>
            {embedDetailOnly ? (
              <div className="space-y-4">{detailContent}</div>
            ) : null}
          </>
        );
      })()}
    </div>
  );
}

type DocumentsPageTranslations = ReturnType<typeof runtimeTranslations>;
type DocumentsLocalizer = (de: string, ru: string, en: string) => string;
type DocumentsPageText = {
  pidFallback: string;
  suggested: (art: string, category: string) => string;
  suggestedClassification: string;
};

function DocumentIntakeQueueTable({
  actionId,
  emptyText,
  l,
  loading,
  onApplySuggestion,
  onOpenDocument,
  rows,
  selectedId,
  t,
  text,
}: {
  actionId: string;
  emptyText: string;
  l: DocumentsLocalizer;
  loading: boolean;
  onApplySuggestion: (item: DocumentItem) => Promise<void>;
  onOpenDocument: (id: string) => void;
  rows: DocumentItem[];
  selectedId: string;
  t: DocumentsPageTranslations;
  text: DocumentsPageText;
}) {
  const columns = useMemo<ColumnDef<DocumentItem>[]>(
    () => [
      {
        id: "document",
        label: t.documents_filename,
        accessor: (item) =>
          `${localizeDocumentCode(item.auto_name, l)} ${item.original_filename ?? ""}`.trim(),
        searchable: true,
        sortable: true,
        required: true,
        pinned: "left",
        width: 160,
        render: (item) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">
              {localizeDocumentCode(item.auto_name, l)}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {item.original_filename ?? t.documents_unlinked_document}
            </div>
          </div>
        ),
      },
      {
        id: "patient",
        label: t.orders_patient,
        accessor: (item) => `${item.patient_pid ?? ""} ${item.patient_name ?? ""}`.trim(),
        searchable: true,
        sortable: true,
        width: 220,
        render: (item) =>
          item.patient_name || item.patient_pid ? (
            <div className="min-w-0">
              <span className="font-mono text-[11px] text-muted-foreground">
                {item.patient_pid ?? text.pidFallback}
              </span>
              <div className="truncate text-xs text-foreground">
                {item.patient_name ?? t.common_not_set}
              </div>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t.documents_unlinked_document}
            </span>
          ),
      },
      {
        id: "suggestion",
        label: text.suggestedClassification,
        accessor: (item) =>
          item.classification_suggestion
            ? `${item.classification_suggestion.art} ${item.classification_suggestion.category} ${item.classification_suggestion.confidence}`
            : "",
        searchable: true,
        sortable: true,
        width: 330,
        render: (item) => {
          const suggestion = item.classification_suggestion;
          if (!suggestion) {
            return (
              <span className="block truncate text-xs text-muted-foreground">
                {t.documents_no_auto_classification}
              </span>
            );
          }

          return (
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-foreground">
                {text.suggested(
                  localizeDocumentCode(suggestion.art, l),
                  localizeDocumentCode(suggestion.category, l),
                )}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {t.documents_confidence}:{" "}
                {formatConfidenceLabel(
                  suggestion.confidence,
                  t,
                )}
                {suggestion.rationale ? ` / ${suggestion.rationale}` : ""}
              </div>
            </div>
          );
        },
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (item) => `${item.status} ${item.ursprung ?? ""}`.trim(),
        sortable: true,
        width: 150,
        render: (item) => (
          <div className="flex min-w-0 flex-col items-start gap-1">
            <Badge
              variant="outline"
              className="rounded-full border-amber-200 bg-amber-50 text-[10px] text-amber-700"
            >
              {t.documents_needs_review}
            </Badge>
            <span className="truncate text-[11px] text-muted-foreground">
              {[formatDocumentStatusLabel(item.status, t), item.ursprung ? formatDocumentSourceLabel(item.ursprung, t) : null]
                .filter(Boolean)
                .join(" / ")}
            </span>
          </div>
        ),
      },
      {
        id: "updated_at",
        label: t.documents_updated,
        accessor: (item) => item.updated_at,
        filterType: "date",
        sortable: true,
        width: 180,
        render: (item) => (
          <span className="text-xs text-muted-foreground">
            {formatDateTime(item.updated_at)}
          </span>
        ),
      },
      {
        id: "actions",
        label: t.users_actions,
        accessor: () => "",
        sortable: false,
        filterType: undefined,
        width: 220,
        render: (item) =>
          item.classification_suggestion ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 max-w-full overflow-hidden rounded-md px-2 text-[11px]"
              disabled={actionId === item.id}
              onClick={(event) => {
                event.stopPropagation();
                void onApplySuggestion(item);
              }}
            >
              {actionId === item.id ? (
                <LoaderCircle className="size-3 shrink-0 animate-spin" />
              ) : null}
              <span className="truncate">
                {item.ursprung === "interpreter_upload" && item.status === "draft"
                  ? t.documents_apply_and_release
                  : t.documents_apply_suggestion}
              </span>
            </Button>
          ) : null,
      },
    ],
    [actionId, l, onApplySuggestion, t, text],
  );

  return (
    <DataTableSurface
      rows={rows}
      columns={columns}
      rowId={(item) => item.id}
      activeRowId={selectedId || null}
      defaultDensity="comfortable"
      dictionary={t as unknown as Record<string, string>}
      loading={loading}
      loadingState={<TabLoader />}
      emptyState={<span>{emptyText}</span>}
      tableClassName="min-h-[360px]"
      rowHeightOverrides={documentQueueRowHeightOverrides}
      onRowClick={(item) => onOpenDocument(item.id)}
      rowAccent={() => "bg-amber-500"}
      footer={({ filteredCount, totalCount }) => (
        <span className="tabular-nums">
          {filteredCount === totalCount
            ? `${totalCount}`
            : `${filteredCount} / ${totalCount}`}{" "}
          {t.documents_pending}
        </span>
      )}
    />
  );
}

function DocumentTranslationRequestsTable({
  canUpdateTranslation,
  currentUserId,
  emptyText,
  l,
  loading,
  onOpenDocument,
  onUpdateRequest,
  rows,
  t,
}: {
  canUpdateTranslation: boolean;
  currentUserId: string | null;
  emptyText: string;
  l: DocumentsLocalizer;
  loading: boolean;
  onOpenDocument: (id: string) => void;
  onUpdateRequest: (
    request: TranslationRequest,
    status: string,
    options?: TranslationUpdateOptions,
  ) => Promise<void>;
  rows: TranslationRequest[];
  t: DocumentsPageTranslations;
}) {
  const columns = useMemo<ColumnDef<TranslationRequest>[]>(
    () => [
      {
        id: "document",
        label: t.documents_filename,
        accessor: (request) =>
          `${request.document_name ?? request.document_id} ${request.document_category ?? ""}`.trim(),
        searchable: true,
        sortable: true,
        required: true,
        pinned: "left",
        width: 160,
        render: (request) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">
              {request.document_name || request.document_id}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {request.document_category
                ? localizeDocumentCode(request.document_category, l)
                : t.documents_unclassified}
            </div>
          </div>
        ),
      },
      {
        id: "patient",
        label: t.orders_patient,
        accessor: (request) =>
          `${request.patient_pid ?? ""} ${request.patient_name ?? ""}`.trim(),
        searchable: true,
        sortable: true,
        width: 220,
        render: (request) =>
          request.patient_name || request.patient_pid ? (
            <div className="min-w-0">
              <span className="font-mono text-[11px] text-muted-foreground">
                {request.patient_pid ?? "PID"}
              </span>
              <div className="truncate text-xs text-foreground">
                {request.patient_name ?? t.common_not_set}
              </div>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">{t.common_not_set}</span>
          ),
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (request) => request.status,
        sortable: true,
        width: 160,
        render: (request) => (
          <Badge
            variant="outline"
            className={cn("rounded-full text-[10px]", translationStatusBadge(request.status))}
          >
            {formatTranslationStatusLabel(request.status, t)}
          </Badge>
        ),
      },
      {
        id: "language",
        label: l("Sprache", "Язык", "Language"),
        accessor: (request) => request.requested_language,
        searchable: true,
        sortable: true,
        width: 140,
        render: (request) => (
          <Badge
            variant="outline"
            className="rounded-full border-border/60 bg-card text-[10px] text-foreground"
          >
            {formatLanguageLabel(request.requested_language)}
          </Badge>
        ),
      },
      {
        id: "requested_at",
        label: l("Angefragt", "Запрошено", "Requested"),
        accessor: (request) => request.requested_at,
        filterType: "date",
        sortable: true,
        width: 158,
        render: (request) => (
          <div className="min-w-0">
            <div className="truncate text-xs text-foreground">
              {formatDateTime(request.requested_at)}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {formatDocumentSourceLabel(request.request_source, t)}
            </div>
          </div>
        ),
      },
      {
        id: "assigned",
        label: l("Zugewiesen", "Назначено", "Assigned"),
        accessor: (request) =>
          `${request.assigned_to_name ?? ""} ${request.translated_document_name ?? ""}`.trim(),
        searchable: true,
        sortable: true,
        width: 120,
        render: (request) => (
          <div className="min-w-0">
            <div className="truncate text-xs text-foreground">
              {request.assigned_to_name ?? t.common_not_set}
            </div>
            {request.translated_document_name ? (
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {request.translated_document_name}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "note",
        label: t.documents_review_notes,
        accessor: (request) => request.note ?? "",
        searchable: true,
        width: 196,
        render: (request) => (
          <span className="block truncate text-xs text-muted-foreground">
            {request.note || t.common_not_set}
          </span>
        ),
      },
      {
        id: "actions",
        label: t.users_actions,
        accessor: () => "",
        sortable: false,
        filterType: undefined,
        width: 180,
        render: (request) => {
          const canAssign =
            canUpdateTranslation &&
            Boolean(currentUserId) &&
            request.status !== "completed" &&
            request.status !== "cancelled" &&
            request.assigned_to !== currentUserId;

          return canAssign && currentUserId ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 max-w-full overflow-hidden rounded-md px-2 text-[11px]"
              disabled={loading}
              onClick={(event) => {
                event.stopPropagation();
                void onUpdateRequest(
                  request,
                  request.status === "pending" ? "in_progress" : request.status,
                  { assignedTo: currentUserId },
                );
              }}
            >
              <span className="truncate">
                {l("Mir zuweisen", "Назначить мне", "Assign to me")}
              </span>
            </Button>
          ) : null;
        },
      },
    ],
    [
      canUpdateTranslation,
      currentUserId,
      l,
      loading,
      onUpdateRequest,
      t,
    ],
  );

  return (
    <DataTableSurface
      rows={rows}
      columns={columns}
      rowId={(request) => request.id}
      defaultDensity="comfortable"
      dictionary={t as unknown as Record<string, string>}
      loading={loading}
      loadingState={<TabLoader />}
      emptyState={<span>{emptyText}</span>}
      tableClassName="min-h-[360px]"
      rowHeightOverrides={documentQueueRowHeightOverrides}
      onRowClick={(request) => onOpenDocument(request.document_id)}
      rowAccent={(request) => {
        if (request.status === "completed") return "bg-emerald-500";
        if (request.status === "cancelled") return "bg-rose-500";
        if (request.status === "in_progress") return "bg-sky-500";
        return "bg-amber-500";
      }}
      footer={({ filteredCount, totalCount }) => (
        <span className="tabular-nums">
          {filteredCount === totalCount
            ? `${totalCount}`
            : `${filteredCount} / ${totalCount}`}{" "}
          {t.documents_pending}
        </span>
      )}
    />
  );
}

function DocumentDetailState({
  busy,
  error,
  loadingLabel,
  errorContent,
  children,
}: {
  busy: boolean;
  error: string;
  loadingLabel: string;
  errorContent?: ReactNode;
  children: ReactNode;
}) {
  if (busy) {
    return (
      <div className="flex min-h-[280px] items-center justify-center text-sm text-muted-foreground">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        {loadingLabel}
      </div>
    );
  }

  if (error) {
    return <>{errorContent ?? null}</>;
  }

  return <>{children}</>;
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

type DocumentSectionTone =
  | "brand"
  | "neutral"
  | "sky"
  | "amber"
  | "emerald"
  | "rose"
  | "violet";

function documentSectionToneBorder(tone: DocumentSectionTone) {
  switch (tone) {
    case "brand":
      return "border-[var(--brand)]/25";
    case "sky":
      return "border-sky-200/80";
    case "amber":
      return "border-amber-200/80";
    case "emerald":
      return "border-emerald-200/80";
    case "rose":
      return "border-rose-200/80";
    case "violet":
      return "border-violet-200/80";
    default:
      return "border-border/60";
  }
}

function documentSectionToneHeader(tone: DocumentSectionTone) {
  switch (tone) {
    case "brand":
      return "border-[var(--brand)]/15 bg-[#f9fdff]";
    case "sky":
      return "border-sky-200/70 bg-sky-50/60";
    case "amber":
      return "border-amber-200/70 bg-amber-50/65";
    case "emerald":
      return "border-emerald-200/70 bg-emerald-50/60";
    case "rose":
      return "border-rose-200/70 bg-rose-50/60";
    case "violet":
      return "border-violet-200/70 bg-violet-50/60";
    default:
      return "border-border/50 bg-muted/25";
  }
}

function documentSectionToneIcon(tone: DocumentSectionTone) {
  switch (tone) {
    case "brand":
      return "border-[var(--brand)]/25 bg-[var(--brand)]/10 text-[var(--brand)]";
    case "sky":
      return "border-sky-200 bg-sky-100 text-sky-700";
    case "amber":
      return "border-amber-200 bg-amber-100 text-amber-700";
    case "emerald":
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    case "rose":
      return "border-rose-200 bg-rose-100 text-rose-700";
    case "violet":
      return "border-violet-200 bg-violet-100 text-violet-700";
    default:
      return "border-border/60 bg-background text-muted-foreground";
  }
}

function SectionCard({
  title,
  accessory,
  children,
  icon,
  iconChrome = "default",
  neutralSurface = false,
  tone = "neutral",
}: {
  title: ReactNode;
  accessory?: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  iconChrome?: "default" | "plain";
  neutralSurface?: boolean;
  tone?: DocumentSectionTone;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border bg-white shadow-sm",
        neutralSurface ? "border-border/60" : documentSectionToneBorder(tone),
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3",
          documentSectionToneHeader(tone),
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
              iconChrome === "default" && "border shadow-sm",
              documentSectionToneIcon(tone),
              iconChrome === "plain" && "border-0 bg-transparent shadow-none",
            )}
          >
            {icon ?? <span className="size-2 rounded-full bg-current" />}
          </span>
          <h3 className="truncate text-sm font-semibold text-foreground">
            {title}
          </h3>
        </div>
        {accessory ? (
          <div className="min-w-0 max-w-full">{accessory}</div>
        ) : null}
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function DocumentSection({
  accessory,
  children,
  className,
}: {
  title?: ReactNode;
  accessory?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "space-y-3 rounded-xl border border-border/60 bg-card/70 p-3.5 shadow-sm",
        className,
      )}
    >
      {accessory ? (
        <div className="flex min-w-0 max-w-full justify-end">{accessory}</div>
      ) : null}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[92px_minmax(0,1fr)] items-baseline gap-3">
      <span className="min-w-0 text-[11px] font-medium leading-4 text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 break-words text-[13px] font-semibold leading-5 text-foreground">
        {value}
      </span>
    </div>
  );
}

function DocumentMetaPanel({
  title,
  compact = false,
  className,
  children,
}: {
  title: ReactNode;
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("px-5 py-4", compact && "px-0 py-0", className)}>
      <div className={cn("flex items-center gap-2.5", compact ? "mb-2.5" : "mb-3.5")}>
        <span className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
        <p className="min-w-0 truncate text-[13px] font-semibold text-foreground">
          {title}
        </p>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DocumentMetaHighlight({
  label,
  value,
  accessory,
  className,
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  accessory?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("py-1.5", className)}>
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="text-[11px] font-medium leading-4 text-muted-foreground">
            {label}
          </span>
          <div className="mt-1 min-w-0 break-words text-[17px] font-semibold leading-6 tracking-tight text-foreground">
            {value}
          </div>
        </div>
        {accessory ? <div className="shrink-0 pt-1">{accessory}</div> : null}
      </div>
      {children}
    </div>
  );
}

function DocumentMetaFact({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[92px_minmax(24px,1fr)_minmax(0,auto)] items-baseline gap-3">
      <span className="min-w-0 text-[11px] font-medium leading-4 text-muted-foreground">
        {label}
      </span>
      <span aria-hidden className="h-px min-w-6 bg-slate-200/80" />
      <span className="min-w-0 max-w-full break-words text-right text-[13px] font-semibold leading-5 text-foreground">
        {value}
      </span>
    </div>
  );
}

function DocumentShareStateBadge({
  share,
  t,
  text,
}: {
  share: DocumentShare;
  t: DocumentsPageTranslations;
  text: DocumentsPageText & { revokedBadge: string };
}) {
  if (share.revoked_at) {
    return (
      <Badge
        variant="outline"
        className="rounded-full border-0 bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
      >
        {text.revokedBadge}
      </Badge>
    );
  }

  if (share.confirmed) {
    return (
      <Badge
        variant="outline"
        className="rounded-full border-0 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
      >
        {t.documents_confirmed}
      </Badge>
    );
  }

  if (share.requires_confirmation) {
    return (
      <Badge
        variant="outline"
        className="rounded-full border-0 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"
      >
        {t.documents_waiting_confirmation}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="rounded-full border-0 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700"
    >
      {t.documents_released}
    </Badge>
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
