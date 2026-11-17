import { Download, FilePlus2, FileSearch, FileWarning, LoaderCircle, PencilLine, ScanText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SectionHeading } from "@/components/ui/section-heading";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import { createDocumentPreviewColumn } from "@/components/data-table/document-preview-column";
import {
  splitTranslationTree,
  translationIndent,
  withTranslationChildren,
} from "@/components/data-table/document-translation-tree";
import {
  DataTablePager,
  useDataTablePagination,
} from "@/components/data-table/data-table-pager";
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TabsContent } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { EmptyCell, TabLoader } from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import {
  localizeDocumentCode,
  localizeRequiredDocumentLabel,
} from "@/lib/required-document-labels";
import { useLang, type Lang } from "@/lib/i18n";
import { formatDocumentSourceLabel } from "@/lib/document-source-labels";
import { cn } from "@/lib/utils";
import {
  documentPartyUpload,
  documentPartyUploadTypeLabel,
  formatVersionDocumentNumber,
  FREE_TEXT_DOCUMENT_TEMPLATE_ID,
} from "@/pages/documents/model/document-model";
import type { PatientOption as DocumentPatientOption } from "@/pages/documents/model/types";
import {
  createDocumentPreviewObjectUrl,
  downloadDocumentFile,
  revokeDocumentPreviewObjectUrl,
} from "@/pages/documents/data/document-api";

import { clinicalImportStartErrorMessage } from "../../data/clinical-document-import";
import type {
  DocumentAlerts,
  DocumentItem,
} from "../../model/detail-tab-types";
import { PatientDocumentGenerateDialog } from "../sheets/patient-document-generate-dialog";
import { PatientDocumentEditSheet } from "../sheets/patient-document-edit-sheet";
import { DocumentSignatureAction } from "@/pages/documents/ui/document-signature-action";
import { DocumentPreviewSurface } from "@/pages/documents/ui/document-preview-surface";
import { DocumentStatusBadges } from "@/pages/documents/ui/document-demo-signature-badge";
import {
  DocumentTranslationDialog,
  type DocumentTranslationEditTarget,
  documentTranslationActionLabel,
} from "@/pages/documents/ui/document-translation-dialog";
import { fetchDocumentBlob } from "@/pages/documents/data/document-api";
import { OutdatedSignatureDocuments } from "@/pages/documents/ui/signature-status";
import { isOutdatedCurrentVersion, outdatedDocumentIds } from "@/pages/documents/model/outdated-document-version";
import {
  OutdatedDocumentChip,
  RenewOutdatedDocumentButton,
  useCanRenewOutdatedDocuments,
  useOutdatedDocumentRenewal,
} from "@/pages/documents/ui/outdated-document-renewal";
import {
  DocumentValidityAction,
  DocumentValidityChip,
  validityFilterOptions,
} from "@/pages/documents/ui/document-validity";
import {
  matchesValidityFilter,
  parseValidityFilter,
  type DocumentValidityFilter,
} from "@/pages/documents/model/document-validity";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { DocumentPortalReleaseAction } from "@/pages/documents/ui/document-portal-release-action";
import { documentUploadFormReplacing, type DocumentUploadFormState } from "../../model/sheet-forms";
import { useAuth } from "@/lib/auth";
import {
  countNotSentForSignature,
  isPatientConsentFormRow,
  isPreviousVersionRow,
  notSentCountLabel,
  previousVersionChip,
  previousVersionRows,
  signatureStateChip,
} from "@/pages/documents/model/document-versions";
import {
  DocumentStateChip,
  DocumentVersionToggle,
  PreviousVersionLabel,
} from "@/pages/documents/ui/document-version-cells";
import {
  canChangePatientConsents,
  PatientConsentChangeHost,
  PatientConsentChangeRowButton,
} from "./patient-consent-choices";

type LocalizeFn = (key: string) => string;
type StatusLabelFn = (status: string) => string;
type DateFormatter = (value?: string | null, fallback?: string) => string;
type LocalizedLabel = { de: string; ru: string };
type PatientDocumentContext = {
  id: string;
  patient_id: string;
  first_name?: string | null;
  last_name?: string | null;
  languages?: string[];
};

type PatientDocumentPreview = {
  id: string;
  title: string;
  contentType?: string;
  url?: string;
  pdfData?: ArrayBuffer;
};

type PatientDocumentsTabProps = {
  l: LocalizeFn;
  patientId: string | undefined;
  patient?: PatientDocumentContext;
  commonNotSet: string;
  commonUnknown: string;
  documentsFilenameLabel: string;
  appointmentsTypeLabel: string;
  usersStatusLabel: string;
  patientsAssignedByLabel: string;
  usersCreatedLabel: string;
  tabLoading: boolean;
  documents: DocumentItem[];
  filteredDocuments: DocumentItem[];
  documentAlerts: DocumentAlerts | null;
  documentCategoryOptions: string[];
  documentStatusOptions: string[];
  hasDocumentFilters: boolean;
  documentStatusFilter: string;
  documentCategoryFilter: string;
  onDocumentStatusFilterChange: (value: string) => void;
  onDocumentCategoryFilterChange: (value: string) => void;
  onDocumentGenerated: () => void;
  onResetDocumentFilters: () => void;
  canManageDocuments: boolean;
  onOpenUpload: (initialForm?: DocumentUploadFormState) => void;
  /** Absent for roles the server does not admit to the clinical import. */
  onRecognizeDocument?: (documentId: string) => Promise<void>;
  statusColors: Record<string, string>;
  statusLabel: StatusLabelFn;
  formatDate: DateFormatter;
};

const DOCUMENT_META_LABELS = {
  number: { de: "Nummer", ru: "Номер" },
  source: { de: "Quelle", ru: "Источник" },
  addressee: { de: "Adressat", ru: "Адресат" },
  parties: { de: "Quelle / Adressat", ru: "Источник / адресат" },
} satisfies Record<string, LocalizedLabel>;

function metaLabel(key: keyof typeof DOCUMENT_META_LABELS, lang: Lang) {
  return DOCUMENT_META_LABELS[key][lang === "de" ? "de" : "ru"];
}

const DOCUMENT_CATEGORY_CHIP_TONES = [
  "border-sky-200 bg-sky-50 text-sky-700",
  "border-emerald-200 bg-emerald-50 text-emerald-700",
  "border-amber-200 bg-amber-50 text-amber-700",
  "border-violet-200 bg-violet-50 text-violet-700",
  "border-rose-200 bg-rose-50 text-rose-700",
  "border-teal-200 bg-teal-50 text-teal-700",
  "border-indigo-200 bg-indigo-50 text-indigo-700",
  "border-orange-200 bg-orange-50 text-orange-700",
] as const;

function documentCategoryChipTone(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return DOCUMENT_CATEGORY_CHIP_TONES[
    Math.abs(hash) % DOCUMENT_CATEGORY_CHIP_TONES.length
  ];
}

/**
 * The source of a payer's or a legal representative's upload, readable
 * ("Zahler" instead of the raw "payer"); null for the patient's own files.
 */
function partySourceLabel(doc: Pick<DocumentItem, "art" | "source_person">, lang: Lang): string | null {
  const party = documentPartyUpload(doc);
  if (party === "payer") return lang === "de" ? "Zahler" : "Плательщик";
  if (party === "representative") return lang === "de" ? "Gesetzliche/r Vertreter/in" : "Законный представитель";
  return null;
}

/**
 * The type column: a payer's or representative's upload by its art
 * ("Ausweis (Zahler/in)"), so it never reads as the patient's identity
 * document; anything else by its category.
 */
function documentTypeText(doc: Pick<DocumentItem, "art" | "category">, localize: LocalizeFn): string {
  return documentPartyUploadTypeLabel(doc.art) ?? (doc.category ? localizeDocumentCode(doc.category, localize) : "");
}

/**
 * The document's unified name — the same the document list and the detail
 * page show (QA 2026-10-11 B-13) — else its file name. A signed scan keeps
 * the document's name, never the scan's file name.
 */
function documentDisplayName(
  doc: Pick<DocumentItem, "auto_name" | "filename">,
  localize: LocalizeFn,
): string {
  const name = doc.auto_name?.trim();
  return (name ? localizeDocumentCode(name, localize) : "") || doc.filename || "document";
}

function compactParty(...parts: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");
}

function supportsInlinePreview(contentType?: string) {
  const mimeType = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    mimeType === "application/pdf" ||
    mimeType.startsWith("image/") ||
    mimeType === "text/html" ||
    mimeType === "text/plain"
  );
}

export function patientDocumentPreviewSandbox(contentType?: string) {
  const mimeType = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";

  // Chromium's built-in PDF viewer cannot start inside a fully sandboxed
  // blob iframe and leaves the preview surface blank. Other inline formats
  // remain sandboxed; active text formats are additionally neutralized by
  // createDocumentPreviewObjectUrl before they reach this component.
  return mimeType === "application/pdf" ? undefined : "";
}

const CLINICAL_IMPORT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

export function canRecognizePatientDocument(
  doc: Pick<DocumentItem, "category" | "filename" | "is_medical" | "mime_type">,
) {
  const isMedical = doc.is_medical ?? doc.category?.startsWith("medical") ?? false;
  if (!isMedical) return false;
  const mimeType = doc.mime_type?.split(";", 1)[0]?.trim().toLowerCase();
  if (mimeType) return CLINICAL_IMPORT_MIME_TYPES.has(mimeType);
  return /\.(?:pdf|png|jpe?g)$/i.test(doc.filename.trim());
}

export function PatientDocumentsTab({
  l,
  patientId,
  patient,
  commonNotSet,
  commonUnknown,
  documentsFilenameLabel,
  appointmentsTypeLabel,
  usersStatusLabel,
  patientsAssignedByLabel,
  usersCreatedLabel,
  tabLoading,
  documents,
  filteredDocuments,
  documentAlerts,
  documentCategoryOptions,
  documentStatusOptions,
  hasDocumentFilters,
  documentStatusFilter,
  documentCategoryFilter,
  onDocumentStatusFilterChange,
  onDocumentCategoryFilterChange,
  onDocumentGenerated,
  onResetDocumentFilters,
  canManageDocuments,
  onOpenUpload,
  onRecognizeDocument,
  statusColors,
  statusLabel,
  formatDate,
}: PatientDocumentsTabProps) {
  const { lang, t } = useLang();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateTemplateId, setGenerateTemplateId] = useState<string | null>(
    null,
  );
  const [editDocumentId, setEditDocumentId] = useState<string | null>(null);
  const [documentPreview, setDocumentPreview] =
    useState<PatientDocumentPreview | null>(null);
  const [documentPreviewBusy, setDocumentPreviewBusy] = useState(false);
  const [documentPreviewError, setDocumentPreviewError] = useState("");
  const [recognizingDocumentId, setRecognizingDocumentId] = useState<string | null>(null);
  const [translationDocument, setTranslationDocument] = useState<DocumentItem | null>(null);
  const [translationEditing, setTranslationEditing] = useState<DocumentTranslationEditTarget | null>(null);
  const { staffGo } = useStaffNavigate();
  const { user } = useAuth();
  // Earlier versions open under their document (fix-98); «Изменить согласия»
  // from an Einverständniserklärung row opens the patient card's dialog.
  const [expandedVersions, setExpandedVersions] = useState<ReadonlySet<string>>(() => new Set());
  const toggleVersions = useCallback(
    (id: string) =>
      setExpandedVersions((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const [consentChangePatientId, setConsentChangePatientId] = useState<string | null>(null);
  const canChangeConsents = canManageDocuments && canChangePatientConsents(user?.role);
  const [notSentOnly, setNotSentOnly] = useState(false);
  const notSentCount = useMemo(() => countNotSentForSignature(documents), [documents]);
  const [previewIsPreviousVersion, setPreviewIsPreviousVersion] = useState(false);
  // A converted patient's order documents whose terms changed after they were
  // made: a new version from the current data, then the signature dialog
  // (owner request 2026-11-15). The lead wizard is frozen after conversion.
  const canRenewOutdated = useCanRenewOutdatedDocuments() && canManageDocuments;
  const outdatedIds = useMemo(() => outdatedDocumentIds(documents), [documents]);
  const renewal = useOutdatedDocumentRenewal({
    onRenewed: () => {
      closeDocumentPreview();
      onDocumentGenerated();
    },
    onNeedsForm: (previousId) => staffGo(`/documents/${encodeURIComponent(previousId)}?new_version=1`),
  });

  // A saved translation opens in the translation editor (original on the
  // left, editable text on the right) instead of the read-only preview.
  async function openTranslationEditor(doc: DocumentItem) {
    const sourceId = doc.translation_source_document_id;
    if (!sourceId) return;
    let initialText: string;
    try {
      const detail = await apiFetch<{ generated_manual_text?: string | null; mime_type?: string | null }>(
        `/documents/${doc.id}`,
        { cache: "no-store" },
      );
      initialText = detail.generated_manual_text ?? "";
      if (!initialText.trim() && (detail.mime_type ?? "").startsWith("text/plain")) {
        const { blob } = await fetchDocumentBlob(doc.id, true);
        initialText = await blob.text();
      }
    } catch {
      initialText = "";
    }
    setTranslationEditing({
      translatedDocumentId: doc.id,
      initialText,
      targetLanguage: doc.document_language ?? "ru",
      sourceLanguage: null,
    });
    setTranslationDocument({ ...doc, id: sourceId });
  }
  const documentPreviewUrlRef = useRef<string | null>(null);
  const documentPreviewRequestRef = useRef(0);
  // Saved translations render as children of their source document.
  // «Просроченные / Истекают» (owner 2026-11-15): offered once any document
  // of the patient has a validity date.
  const [validityFilter, setValidityFilter] = useState<DocumentValidityFilter>("");
  const previewDocument = documentPreview
    ? documents.find((doc) => doc.id === documentPreview.id) ?? null
    : null;
  // «Загрузить новый»: the upload is the next version of the expired scan
  // (same type and chain; the category stays the old one's on the server).
  const uploadFormReplacing = (doc: DocumentItem): DocumentUploadFormState =>
    documentUploadFormReplacing({
      id: doc.id,
      art: doc.art,
      is_medical: doc.is_medical,
      order_id: doc.order_id,
      name: documentDisplayName(doc, l),
    });
  const anyValidityTracked = useMemo(
    () => documents.some((doc) => Boolean(doc.valid_until)),
    [documents],
  );
  const validityFilteredDocuments = useMemo(
    () =>
      filteredDocuments.filter(
        (doc) =>
          matchesValidityFilter(doc, validityFilter) &&
          (!notSentOnly || doc.signature_state === "not_sent"),
      ),
    [filteredDocuments, validityFilter, notSentOnly],
  );
  const documentTree = useMemo(
    () => splitTranslationTree(validityFilteredDocuments),
    [validityFilteredDocuments],
  );
  const documentPagination = useDataTablePagination(
    documentTree.roots,
    `${patientId ?? ""}:${documentStatusFilter}:${documentCategoryFilter}:${validityFilter}:${notSentOnly}`,
  );
  const pagedDocumentRows = useMemo(
    () => withTranslationChildren(documentPagination.pagedRows, documentTree.childrenByParent),
    [documentPagination.pagedRows, documentTree.childrenByParent],
  );
  const generatePatient = useMemo<DocumentPatientOption | undefined>(
    () =>
      patient
        ? {
            id: patient.id,
            patient_id: patient.patient_id,
            first_name: patient.first_name ?? undefined,
            last_name: patient.last_name ?? undefined,
            languages: patient.languages,
          }
        : undefined,
    [patient],
  );

  useEffect(
    () => () => {
      documentPreviewRequestRef.current += 1;
      if (documentPreviewUrlRef.current) {
        revokeDocumentPreviewObjectUrl(documentPreviewUrlRef.current);
        documentPreviewUrlRef.current = null;
      }
    },
    [],
  );

  function closeDocumentPreview() {
    documentPreviewRequestRef.current += 1;
    if (documentPreviewUrlRef.current) {
      revokeDocumentPreviewObjectUrl(documentPreviewUrlRef.current);
      documentPreviewUrlRef.current = null;
    }
    setDocumentPreview(null);
    setDocumentPreviewBusy(false);
    setDocumentPreviewError("");
  }

  function openDocumentGenerator(initialTemplateId: string | null = null) {
    setGenerateTemplateId(initialTemplateId);
    setGenerateOpen(true);
  }

  async function openPatientDocumentPreview(doc: DocumentItem) {
    // An earlier version opens read-only: no signature, release or renewal.
    setPreviewIsPreviousVersion(isPreviousVersionRow(doc));
    if (canManageDocuments && doc.translation_source_document_id && !isPreviousVersionRow(doc)) {
      await openTranslationEditor(doc);
      return;
    }
    const requestId = documentPreviewRequestRef.current + 1;
    documentPreviewRequestRef.current = requestId;
    if (documentPreviewUrlRef.current) {
      revokeDocumentPreviewObjectUrl(documentPreviewUrlRef.current);
      documentPreviewUrlRef.current = null;
    }

    setDocumentPreview({
      id: doc.id,
      title: documentDisplayName(doc, l),
    });
    setDocumentPreviewBusy(true);
    setDocumentPreviewError("");

    try {
      const preview = await createDocumentPreviewObjectUrl(doc.id);
      if (documentPreviewRequestRef.current !== requestId) {
        revokeDocumentPreviewObjectUrl(preview.url);
        return;
      }
      documentPreviewUrlRef.current = preview.url;
      setDocumentPreview({
        id: doc.id,
        title: documentDisplayName(doc, l),
        contentType: preview.contentType,
        url: preview.url,
        pdfData: preview.pdfData,
      });
    } catch {
      if (documentPreviewRequestRef.current === requestId) {
        setDocumentPreviewError(t.documents_failed_open_preview);
      }
    } finally {
      if (documentPreviewRequestRef.current === requestId) {
        setDocumentPreviewBusy(false);
      }
    }
  }

  async function recognizePatientDocument(doc: DocumentItem) {
    if (recognizingDocumentId || !onRecognizeDocument) return;
    setRecognizingDocumentId(doc.id);
    try {
      await onRecognizeDocument(doc.id);
    } catch (error) {
      toast.error(clinicalImportStartErrorMessage(error, lang === "de" ? "de" : "ru"));
    } finally {
      setRecognizingDocumentId(null);
    }
  }

  const documentPartyRows = (doc: DocumentItem) => [
    {
      label: metaLabel("source", lang),
      value:
        compactParty(
          partySourceLabel(doc, lang)
            ?? (doc.source_person?.trim() ? formatDocumentSourceLabel(doc.source_person, t) : null),
          doc.source_institution,
        ) || commonNotSet,
    },
    {
      label: metaLabel("addressee", lang),
      value:
        compactParty(doc.addressee_person, doc.addressee_institution) ||
        commonNotSet,
    },
  ];

  const documentColumns = useMemo<ColumnDef<DocumentItem>[]>(
    () => [
      createDocumentPreviewColumn<DocumentItem>({
        getId: (doc) => doc.id,
        getTitle: (doc) => documentDisplayName(doc, l),
        label: t.documents_preview,
        onPreview: (doc) => void openPatientDocumentPreview(doc),
        onSigned: onDocumentGenerated,
        // An archived version (also one whose file was deleted) is not signed.
        canSign: (doc) => doc.status !== "archived" && !isPreviousVersionRow(doc),
        canTranslate: (doc) => !isPreviousVersionRow(doc),
        translateLabel: documentTranslationActionLabel(lang),
        onTranslate: canManageDocuments
          ? (doc) => {
              setTranslationEditing(null);
              setTranslationDocument(doc);
            }
          : undefined,
      }),
      {
        id: "filename",
        label: documentsFilenameLabel,
        accessor: (doc) => documentDisplayName(doc, l),
        filterType: "text",
        sortable: true,
        required: true,
        minWidth: 280,
        render: (doc) => isPreviousVersionRow(doc) ? (
          <span className="flex min-w-0 items-center gap-2" title={doc.filename ?? undefined}>
            <PreviousVersionLabel document={doc} />
            <span className="truncate text-[13px] text-muted-foreground">
              {documentDisplayName(doc, l)}
            </span>
          </span>
        ) : (
          <span
            className="flex min-w-0 items-center gap-2"
            style={{ paddingLeft: translationIndent(documentTree.depthById.get(doc.id)) }}
            title={doc.filename ?? undefined}
          >
            {documentTree.depthById.get(doc.id) ? (
              <span aria-hidden className="shrink-0 font-mono text-xs text-muted-foreground">└</span>
            ) : null}
            <span className="truncate text-[13px] text-foreground">
              {documentDisplayName(doc, l)}
            </span>
            <DocumentVersionToggle
              document={doc}
              expanded={expandedVersions.has(doc.id)}
              onToggle={toggleVersions}
              lang={lang}
            />
            {doc.translation_source_document_id ? (
              <Badge
                variant="outline"
                className="shrink-0 rounded-full border-sky-200 bg-sky-50 text-[10px] text-sky-700"
              >
                {doc.document_language?.toUpperCase() ?? (lang === "de" ? "Übersetzung" : "Перевод")}
              </Badge>
            ) : null}
          </span>
        ),
      },
      {
        id: "document_number",
        label: metaLabel("number", lang),
        accessor: (doc) => formatVersionDocumentNumber(doc.document_number),
        filterType: "text",
        sortable: true,
        width: 185,
        render: (doc) =>
          formatVersionDocumentNumber(doc.document_number) ? (
            <span className="inline-flex shrink-0 rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-sky-700">
              {formatVersionDocumentNumber(doc.document_number)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {commonNotSet}
            </span>
          ),
      },
      {
        id: "category",
        label: appointmentsTypeLabel,
        accessor: (doc) => documentTypeText(doc, l),
        filterType: "enum",
        filterOptions: documentCategoryOptions.map((category) => ({
          value: localizeDocumentCode(category, l),
          label: localizeDocumentCode(category, l),
        })),
        sortable: true,
        width: 220,
        render: (doc) =>
          doc.category ? (
            <Badge
              variant="outline"
              className={cn(
                "max-w-full truncate rounded-full",
                documentCategoryChipTone(doc.category),
              )}
              title={documentTypeText(doc, l)}
            >
              <span className="truncate">{documentTypeText(doc, l)}</span>
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">
              {commonNotSet}
            </span>
          ),
      },
      {
        id: "parties",
        label: metaLabel("parties", lang),
        accessor: (doc) =>
          documentPartyRows(doc)
            .map((row) => row.value)
            .join(" · "),
        filterType: "text",
        width: 240,
        render: (doc) => {
          const value = documentPartyRows(doc)
            .filter((row) => row.value && row.value !== commonNotSet)
            .map((row) => row.value)
            .join(" · ");
          return (
            <span className="truncate text-xs text-foreground" title={value}>
              {value || commonNotSet}
            </span>
          );
        },
      },
      {
        id: "status",
        label: usersStatusLabel,
        accessor: (doc) => (doc.status ? statusLabel(doc.status) : ""),
        filterType: "enum",
        filterOptions: documentStatusOptions.map((status) => ({
          value: statusLabel(status),
          label: statusLabel(status),
        })),
        sortable: true,
        // Status and the DEMO signature side by side, never clipped.
        width: 240,
        render: (doc) => isPreviousVersionRow(doc) ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <DocumentStateChip chip={previousVersionChip(doc, lang)} documentId={doc.id} />
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5">
            <DocumentStatusBadges
              documentId={doc.id}
              statusLabel={doc.status ? statusLabel(doc.status) : commonNotSet}
              statusClassName={cn(
                "rounded-full",
                statusColors[doc.status ?? ""] ??
                  "border-border/60 bg-muted/25 text-muted-foreground",
              )}
            />
            {isOutdatedCurrentVersion(doc) ? (
              <OutdatedDocumentChip className="shrink-0 whitespace-nowrap" />
            ) : null}
            {/* Not sent / sent / signed (fix-98); only documents made to be signed. */}
            <DocumentStateChip chip={signatureStateChip(doc, lang)} documentId={doc.id} />
            {/* Optional validity date (owner 2026-11-15); nothing without one. */}
            <DocumentValidityChip document={doc} compact className="shrink-0 whitespace-nowrap" />
          </span>
        ),
      },
      {
        id: "created",
        label: usersCreatedLabel,
        accessor: (doc) => doc.created_at ?? "",
        filterType: "date",
        sortable: true,
        width: 220,
        render: (doc) => {
          const value = `${formatDate(doc.created_at)} · ${doc.uploaded_by_name ?? commonUnknown}`;
          return (
            <span
              className="truncate text-xs tabular-nums text-foreground"
              title={`${patientsAssignedByLabel}: ${doc.uploaded_by_name ?? commonUnknown}`}
            >
              {value}
            </span>
          );
        },
      },
    ],
    [
      appointmentsTypeLabel,
      canManageDocuments,
      documentTree.depthById,
      commonNotSet,
      commonUnknown,
      documentCategoryOptions,
      documentPartyRows,
      documentStatusOptions,
      documentsFilenameLabel,
      expandedVersions,
      formatDate,
      l,
      lang,
      toggleVersions,
      openPatientDocumentPreview,
      onDocumentGenerated,
      patientsAssignedByLabel,
      statusColors,
      statusLabel,
      usersCreatedLabel,
      usersStatusLabel,
    ],
  );

  return (
    <TabsContent value="documents" className="space-y-4 mt-4 min-h-[400px]">
      <OutdatedSignatureDocuments.Provider value={outdatedIds}>
      {!tabLoading &&
      documentAlerts &&
      documentAlerts.configured_rule_count > 0 &&
      !documentAlerts.document_pack_complete ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">
                {l("patients_required_documents_missing_count").replace(
                  "{count}",
                  String(documentAlerts.missing_count),
                )}
              </h4>
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-amber-200 bg-amber-100 text-[10px] text-amber-800"
            >
              {l("patients_fulfilled")}:{" "}
              {
                documentAlerts.required_documents.filter(
                  (item) => item.fulfilled,
                ).length
              }
              /{documentAlerts.configured_rule_count}
            </Badge>
          </div>
          {documentAlerts.missing_count > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {documentAlerts.missing_documents.map((item) => (
                <Badge
                  key={item.key}
                  variant="outline"
                  className="rounded-full border-amber-300 bg-card text-amber-800"
                >
                  {localizeRequiredDocumentLabel(item.key, item.label, l)}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {tabLoading ? (
        <TabLoader />
      ) : (
        <DataTableSurface
          toolbarClassName="sm:flex-wrap sm:overflow-x-visible"
          rows={pagedDocumentRows}
          columns={documentColumns}
          rowId={(doc) => (isPreviousVersionRow(doc) ? `${doc.previous_version_of}:${doc.id}` : doc.id)}
          defaultDensity="compact"
          expandRow={(doc) =>
            isPreviousVersionRow(doc) ? null : previousVersionRows(doc, expandedVersions)
          }
          rowBackground={(doc) => (isPreviousVersionRow(doc) ? "bg-muted/30" : null)}
          onRowClick={(doc) => void openPatientDocumentPreview(doc)}
          rowActions={(doc) => isPreviousVersionRow(doc) ? (
            // An earlier version is read-only: preview (row click) and download.
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={t.documents_download}
              aria-label={t.documents_download}
              onClick={(event) => {
                event.stopPropagation();
                void downloadDocumentFile(doc.id, doc.filename || "document");
              }}
            >
              <Download className="size-3.5" />
            </Button>
          ) : (
            <>
              {canChangeConsents && patientId && isPatientConsentFormRow(doc, patientId) ? (
                <PatientConsentChangeRowButton
                  title={documentDisplayName(doc, l)}
                  onOpen={() => setConsentChangePatientId(patientId)}
                />
              ) : null}
              {canRenewOutdated && isOutdatedCurrentVersion(doc) ? (
                <RenewOutdatedDocumentButton
                  documentId={doc.id}
                  busyId={renewal.busyId}
                  onRenew={(id) => void renewal.renew(id)}
                  title={documentDisplayName(doc, l)}
                  iconOnly
                />
              ) : canManageDocuments ? (
                // Expiring or expired (owner 2026-11-15): a template document
                // gets a new version, an uploaded scan the upload dialog.
                <DocumentValidityAction
                  document={doc}
                  busyId={renewal.busyId}
                  onRenew={canRenewOutdated ? (id) => void renewal.renew(id, "expired") : undefined}
                  onExtend={canRenewOutdated ? (id, date) => renewal.extend(id, date) : undefined}
                  onUploadNew={() => onOpenUpload(canRenewOutdated ? uploadFormReplacing(doc) : undefined)}
                  title={documentDisplayName(doc, l)}
                  iconOnly
                />
              ) : null}
              {canManageDocuments ? (
                <>
                  {onRecognizeDocument && canRecognizePatientDocument(doc) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title={lang === "de" ? "Erkennen" : "Распознать"}
                      aria-label={
                        lang === "de"
                          ? "Dokument erkennen"
                          : "Распознать документ"
                      }
                      disabled={recognizingDocumentId !== null}
                      onClick={() => void recognizePatientDocument(doc)}
                    >
                      {recognizingDocumentId === doc.id ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <ScanText className="size-3.5" />
                      )}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title={lang === "de" ? "Bearbeiten" : "Редактировать"}
                    aria-label={
                      lang === "de"
                        ? "Dokument bearbeiten"
                        : "Редактировать документ"
                    }
                    onClick={() => setEditDocumentId(doc.id)}
                  >
                    <PencilLine className="size-3.5" />
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={t.documents_download}
                aria-label={t.documents_download}
                onClick={() =>
                  void downloadDocumentFile(doc.id, doc.filename || "document")
                }
              >
                <Download className="size-3.5" />
              </Button>
            </>
          )}
          rowActionsAlwaysVisible
          rowActionsWidth={
            canManageDocuments
              ? (canRenewOutdated && outdatedIds.length > 0 ? 150 : 118) + (canChangeConsents ? 32 : 0)
              : 46
          }
          emptyState={
            <EmptyCell>
              {documents.length === 0
                ? // A role that sees only the documents opened to it (an
                  // interpreter, the concierge) cannot tell whether the
                  // patient has others (QA 2026-10-11 B-14).
                  canManageDocuments
                  ? l("patients_no_documents_have_been_uploaded_for_this_patient_yet")
                  : l("patients_no_documents_available_for_your_role")
                : l("patients_no_document_matches_the_current_filters")}
            </EmptyCell>
          }
          toolbarStart={
            <>
              {canManageDocuments ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 rounded-lg"
                    onClick={() =>
                      openDocumentGenerator(FREE_TEXT_DOCUMENT_TEMPLATE_ID)
                    }
                  >
                    <FilePlus2 className="size-3.5" />
                    {lang === "de" ? "Dokument erstellen" : "Создать документ"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 rounded-lg gap-1.5"
                    onClick={() => openDocumentGenerator()}
                  >
                    {l("documents_generate_from_template")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 shrink-0 rounded-lg gap-1.5"
                    onClick={() => onOpenUpload()}
                  >
                    {l("patients_upload_document")}
                  </Button>
                </>
              ) : null}
              <span
                aria-hidden
                className="mx-1 h-4 w-px shrink-0 self-center bg-border"
              />
              <NativeComboboxSelect
                value={documentStatusFilter}
                aria-label={usersStatusLabel}
                onChange={(event) =>
                  onDocumentStatusFilterChange(event.target.value ?? "all")
                }
                className="h-8 w-[170px] shrink-0 rounded-lg bg-field text-[13px]"
              >
                <option value="all">{l("patients_all_statuses")}</option>
                {documentStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </NativeComboboxSelect>
              <NativeComboboxSelect
                value={documentCategoryFilter}
                aria-label={appointmentsTypeLabel}
                onChange={(event) =>
                  onDocumentCategoryFilterChange(event.target.value ?? "all")
                }
                className="h-8 w-[200px] shrink-0 rounded-lg bg-field text-[13px]"
              >
                <option value="all">{l("patients_all_document_types")}</option>
                {documentCategoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {localizeDocumentCode(category, l)}
                  </option>
                ))}
              </NativeComboboxSelect>
              {anyValidityTracked || validityFilter ? (
                <NativeComboboxSelect
                  value={validityFilter}
                  aria-label={lang === "de" ? "Gültigkeit" : "Срок действия"}
                  data-testid="patient-documents-validity-filter"
                  onChange={(event) => setValidityFilter(parseValidityFilter(event.target.value))}
                  className="h-8 w-[210px] shrink-0 rounded-lg bg-field text-[13px]"
                >
                  {validityFilterOptions(lang).map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeComboboxSelect>
              ) : null}
              {notSentCount > 0 || notSentOnly ? (
                // «Ждут отправки на подпись: N» — a click shows only those.
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  aria-pressed={notSentOnly}
                  data-testid="patient-documents-not-sent-filter"
                  className={cn(
                    "h-8 shrink-0 rounded-lg border-amber-300 text-amber-900 dark:text-amber-200",
                    notSentOnly ? "bg-amber-100 dark:bg-amber-950/50" : "bg-amber-50 dark:bg-amber-950/30",
                  )}
                  onClick={() => setNotSentOnly((value) => !value)}
                >
                  {notSentCountLabel(notSentCount, lang)}
                </Button>
              ) : null}
              {hasDocumentFilters || validityFilter || notSentOnly ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="shrink-0"
                  onClick={() => {
                    setValidityFilter("");
                    setNotSentOnly(false);
                    onResetDocumentFilters();
                  }}
                >
                  {l("patients_reset_filters")}
                </Button>
              ) : null}
              <span
                aria-hidden
                className="mx-1 h-4 w-px shrink-0 self-center bg-border"
              />
            </>
          }
          toolbarAfter={
            <DataTablePager
              pageIndex={documentPagination.pageIndex}
              pageSize={documentPagination.pageSize}
              totalPages={documentPagination.totalPages}
              totalRows={documentPagination.totalRows}
              previousLabel={t.pagination_previous}
              nextLabel={t.pagination_next}
              onPageChange={documentPagination.onPageChange}
            />
          }
        />
      )}
      <Dialog
        open={Boolean(documentPreview)}
        onOpenChange={(open) => {
          if (!open) closeDocumentPreview();
        }}
      >
        <DialogContent className="flex h-[86vh] w-[94vw] max-w-none flex-col overflow-hidden rounded-xl p-0 duration-0 data-closed:animate-none data-open:animate-none sm:w-[78vw] sm:max-w-[1500px]">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-4 pr-10">
              <div className="min-w-0">
                <DialogTitle className="truncate text-base">
                  <SectionHeading icon={FileSearch}>{documentPreview?.title ?? t.documents_preview}</SectionHeading>
                </DialogTitle>
                <DialogDescription className="truncate">
                  {documentPreviewBusy
                    ? t.documents_loading_document
                    : documentPreview?.contentType || t.documents_preview}
                </DialogDescription>
              </div>
              {documentPreview ? (
                <div className="flex flex-wrap items-center gap-2">
                {canRenewOutdated && outdatedIds.includes(documentPreview.id) ? (
                  <RenewOutdatedDocumentButton
                    documentId={documentPreview.id}
                    busyId={renewal.busyId}
                    onRenew={(id) => void renewal.renew(id)}
                  />
                ) : null}
                {previewDocument ? <DocumentValidityChip document={previewDocument} className="shrink-0" /> : null}
                {previewDocument && canManageDocuments && !outdatedIds.includes(previewDocument.id) ? (
                  <DocumentValidityAction
                    document={previewDocument}
                    busyId={renewal.busyId}
                    onRenew={canRenewOutdated ? (id) => void renewal.renew(id, "expired") : undefined}
                    onExtend={canRenewOutdated ? (id, date) => renewal.extend(id, date) : undefined}
                    onUploadNew={() => {
                      closeDocumentPreview();
                      onOpenUpload(canRenewOutdated ? uploadFormReplacing(previewDocument) : undefined);
                    }}
                  />
                ) : null}
                {previewIsPreviousVersion ? null : (
                  <DocumentSignatureAction documentId={documentPreview.id} title={documentPreview.title} onDone={onDocumentGenerated} />
                )}
                {canRenewOutdated && !previewIsPreviousVersion && !outdatedIds.includes(documentPreview.id) ? (
                  <DocumentPortalReleaseAction key={documentPreview.id} documentId={documentPreview.id} onReleased={onDocumentGenerated} />
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5 rounded-lg"
                  onClick={() =>
                    void downloadDocumentFile(
                      documentPreview.id,
                      documentPreview.title,
                    )
                  }
                >
                  <Download className="size-3.5" />
                  {t.documents_download}
                </Button>
                </div>
              ) : null}
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 bg-muted p-3">
            {documentPreviewBusy ? (
              <div className="flex h-full min-h-80 items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                {t.documents_loading_document}
              </div>
            ) : documentPreviewError ? (
              <div className="flex h-full min-h-80 items-center justify-center rounded-lg border border-destructive/30 bg-card p-8 text-center text-sm text-destructive">
                {documentPreviewError}
              </div>
            ) : documentPreview?.url &&
              supportsInlinePreview(documentPreview.contentType) ? (
              documentPreview.pdfData ? (
                <DocumentPreviewSurface
                  preview={documentPreview}
                  title={documentPreview.title || t.documents_preview}
                  className="h-full min-h-[560px] w-full"
                />
                ) : (
                <iframe
                  title={documentPreview.title || t.documents_preview}
                  src={documentPreview.url}
                  sandbox={patientDocumentPreviewSandbox(documentPreview.contentType)}
                  className="h-full min-h-[560px] w-full rounded-lg border border-border bg-white"
                />
                )
            ) : documentPreview?.url ? (
              <div className="flex h-full min-h-80 flex-col items-center justify-center rounded-lg border border-border bg-card p-8 text-center">
                <FileWarning className="mb-3 size-8 text-muted-foreground" />
                <p className="max-w-md text-sm text-muted-foreground">
                  {lang === "de"
                    ? "Dieses Dateiformat kann nicht direkt im Browser angezeigt werden. Laden Sie die Datei herunter, um sie zu öffnen."
                    : "Этот формат нельзя показать прямо в браузере. Скачайте файл, чтобы открыть его."}
                </p>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      {canManageDocuments ? (
        <DocumentTranslationDialog
          documentId={translationDocument?.id ?? null}
          title={translationDocument ? documentDisplayName(translationDocument, l) : "document"}
          editing={translationEditing}
          open={Boolean(translationDocument)}
          onOpenChange={(open) => {
            if (!open) {
              setTranslationDocument(null);
              setTranslationEditing(null);
            }
          }}
          onSaved={onDocumentGenerated}
        />
      ) : null}
      {canManageDocuments ? (
        <>
          <PatientDocumentGenerateDialog
            open={generateOpen}
            patientId={patientId}
            patient={generatePatient}
            initialTemplateId={generateTemplateId}
            onOpenChange={(open) => {
              setGenerateOpen(open);
              if (!open) setGenerateTemplateId(null);
            }}
            onGenerated={(created) => {
              onDocumentGenerated();
              // Next steps for the new document right away: signature or the
              // client's portal, each an explicit click (owner 2026-11-15).
              if (canRenewOutdated) renewal.offer(created);
            }}
          />
          <PatientDocumentEditSheet
            open={Boolean(editDocumentId)}
            documentId={editDocumentId}
            onOpenChange={(open) => {
              if (!open) setEditDocumentId(null);
            }}
            onSaved={onDocumentGenerated}
          />
        </>
      ) : null}
      {canRenewOutdated ? renewal.dialog : null}
      {canChangeConsents ? (
        <PatientConsentChangeHost
          patientId={consentChangePatientId}
          onClose={() => setConsentChangePatientId(null)}
          onChanged={onDocumentGenerated}
        />
      ) : null}
      </OutdatedSignatureDocuments.Provider>
    </TabsContent>
  );
}
