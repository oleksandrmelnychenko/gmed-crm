import {
  Download,
  Eye,
  FilePlus2,
  FileWarning,
  LoaderCircle,
  PencilLine,
  ScanText,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { DataTableSurface } from "@/components/data-table/data-table-surface";
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
import {
  localizeDocumentCode,
  localizeRequiredDocumentLabel,
} from "@/lib/required-document-labels";
import { useLang, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  formatBusinessDocumentNumber,
  FREE_TEXT_DOCUMENT_TEMPLATE_ID,
} from "@/pages/documents/model/document-model";
import type { PatientOption as DocumentPatientOption } from "@/pages/documents/model/types";
import {
  createDocumentPreviewObjectUrl,
  downloadDocumentFile,
  revokeDocumentPreviewObjectUrl,
} from "@/pages/documents/data/document-api";

import type {
  DocumentAlerts,
  DocumentItem,
} from "../../model/detail-tab-types";
import { PatientDocumentGenerateDialog } from "../sheets/patient-document-generate-dialog";
import { PatientDocumentEditSheet } from "../sheets/patient-document-edit-sheet";

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
  onOpenUpload: () => void;
  onRecognizeDocument: (documentId: string) => Promise<void>;
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
  const documentPreviewUrlRef = useRef<string | null>(null);
  const documentPreviewRequestRef = useRef(0);
  const documentPagination = useDataTablePagination(
    filteredDocuments,
    `${patientId ?? ""}:${documentStatusFilter}:${documentCategoryFilter}`,
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
    const requestId = documentPreviewRequestRef.current + 1;
    documentPreviewRequestRef.current = requestId;
    if (documentPreviewUrlRef.current) {
      revokeDocumentPreviewObjectUrl(documentPreviewUrlRef.current);
      documentPreviewUrlRef.current = null;
    }

    setDocumentPreview({
      id: doc.id,
      title: doc.filename || "document",
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
        title: doc.filename || "document",
        contentType: preview.contentType,
        url: preview.url,
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
    if (recognizingDocumentId) return;
    setRecognizingDocumentId(doc.id);
    try {
      await onRecognizeDocument(doc.id);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : lang === "de"
            ? "Dokument konnte nicht zur Erkennung gesendet werden"
            : "Не удалось отправить документ на распознавание",
      );
    } finally {
      setRecognizingDocumentId(null);
    }
  }

  const documentPartyRows = (doc: DocumentItem) => [
    {
      label: metaLabel("source", lang),
      value:
        compactParty(doc.source_person, doc.source_institution) || commonNotSet,
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
      {
        id: "filename",
        label: documentsFilenameLabel,
        accessor: (doc) => doc.filename ?? "",
        filterType: "text",
        sortable: true,
        required: true,
        width: 280,
        render: (doc) => (
          <span
            className="block truncate font-mono text-xs text-foreground"
            title={doc.filename ?? undefined}
          >
            {doc.filename}
          </span>
        ),
      },
      {
        id: "document_number",
        label: metaLabel("number", lang),
        accessor: (doc) => formatBusinessDocumentNumber(doc.document_number),
        filterType: "text",
        sortable: true,
        width: 150,
        render: (doc) =>
          formatBusinessDocumentNumber(doc.document_number) ? (
            <span className="inline-flex shrink-0 rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-sky-700">
              {formatBusinessDocumentNumber(doc.document_number)}
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
        accessor: (doc) =>
          doc.category ? localizeDocumentCode(doc.category, l) : "",
        filterType: "enum",
        filterOptions: documentCategoryOptions.map((category) => ({
          value: localizeDocumentCode(category, l),
          label: localizeDocumentCode(category, l),
        })),
        sortable: true,
        width: 170,
        render: (doc) =>
          doc.category ? (
            <Badge
              variant="outline"
              className={cn(
                "rounded-full",
                documentCategoryChipTone(doc.category),
              )}
            >
              {localizeDocumentCode(doc.category, l)}
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
        width: 150,
        render: (doc) => (
          <Badge
            variant="outline"
            className={cn(
              "rounded-full",
              statusColors[doc.status ?? ""] ??
                "border-border/60 bg-muted/25 text-muted-foreground",
            )}
          >
            {doc.status ? statusLabel(doc.status) : commonNotSet}
          </Badge>
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
      commonNotSet,
      commonUnknown,
      documentCategoryOptions,
      documentPartyRows,
      documentStatusOptions,
      documentsFilenameLabel,
      formatDate,
      l,
      lang,
      patientsAssignedByLabel,
      statusColors,
      statusLabel,
      usersCreatedLabel,
      usersStatusLabel,
    ],
  );

  return (
    <TabsContent value="documents" className="space-y-4 mt-4 min-h-[400px]">
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
              {
                documentAlerts.required_documents.filter(
                  (item) => item.fulfilled,
                ).length
              }
              /{documentAlerts.configured_rule_count} {l("patients_fulfilled")}
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
          {documentAlerts.out_of_sync ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {l(
                "patients_the_stored_compliance_flag_for_document_pack_complete_is",
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      {tabLoading ? (
        <TabLoader />
      ) : (
        <DataTableSurface
          rows={documentPagination.pagedRows}
          columns={documentColumns}
          rowId={(doc) => doc.id}
          defaultDensity="comfortable"
          onRowClick={(doc) => void openPatientDocumentPreview(doc)}
          rowActions={(doc) => (
            <>
              {canManageDocuments ? (
                <>
                  {canRecognizePatientDocument(doc) ? (
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
                title={t.documents_preview}
                aria-label={t.documents_preview}
                onClick={() => void openPatientDocumentPreview(doc)}
              >
                <Eye className="size-3.5" />
              </Button>
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
          rowActionsWidth={canManageDocuments ? 150 : 82}
          emptyState={
            <EmptyCell>
              {documents.length === 0
                ? l(
                    "patients_no_documents_have_been_uploaded_for_this_patient_yet",
                  )
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
                    onClick={onOpenUpload}
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
              {hasDocumentFilters ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="shrink-0"
                  onClick={onResetDocumentFilters}
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
            <div className="flex min-w-0 items-start justify-between gap-4 pr-10">
              <div className="min-w-0">
                <DialogTitle className="truncate text-base">
                  {documentPreview?.title ?? t.documents_preview}
                </DialogTitle>
                <DialogDescription className="truncate">
                  {documentPreviewBusy
                    ? t.documents_loading_document
                    : documentPreview?.contentType || t.documents_preview}
                </DialogDescription>
              </div>
              {documentPreview ? (
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
              ) : null}
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 bg-slate-50 p-3">
            {documentPreviewBusy ? (
              <div className="flex h-full min-h-80 items-center justify-center rounded-lg border border-border bg-white text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                {t.documents_loading_document}
              </div>
            ) : documentPreviewError ? (
              <div className="flex h-full min-h-80 items-center justify-center rounded-lg border border-destructive/30 bg-white p-8 text-center text-sm text-destructive">
                {documentPreviewError}
              </div>
            ) : documentPreview?.url &&
              supportsInlinePreview(documentPreview.contentType) ? (
              <iframe
                title={documentPreview.title || t.documents_preview}
                src={documentPreview.url}
                sandbox=""
                className="h-full min-h-[560px] w-full rounded-lg border border-border bg-white"
              />
            ) : documentPreview?.url ? (
              <div className="flex h-full min-h-80 flex-col items-center justify-center rounded-lg border border-border bg-white p-8 text-center">
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
            onGenerated={onDocumentGenerated}
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
    </TabsContent>
  );
}
