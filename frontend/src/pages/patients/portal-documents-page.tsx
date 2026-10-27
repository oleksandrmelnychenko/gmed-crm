import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { startTransition, useCallback, useEffect, useMemo, useReducer, useRef, type FormEvent } from "react";
import { CalendarDays, ClipboardList, Download, Files, FileText, FlaskConical, IdCard, Languages, LoaderCircle, Mail, Receipt, RefreshCw, Upload } from "lucide-react";

import { AdminDialogScaffold } from "@/components/admin-dialog-scaffold";
import { PortalSection as Section, PortalComplete } from "./ui/portal-page-layout";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { FilePicker } from "@/components/ui/file-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Banner,
  CountBadge,
  EmptyCell,
  Field,
  ListItem,
  PageHeader,
  StatusBadge,
  SuccessBanner,
  TabLoader,
  TabShell,
  inputClass,
  selectClass,
  textareaClass,
  tokens,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { formatPluralCount, useLang, useLanguageBound } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import { localizeRequiredDocumentLabel } from "@/lib/required-document-labels";
import { missingDocumentHints } from "./model/portal-required-documents";
import {
  confirmPortalDocument,
  fetchPortalDocumentsWorkspace,
  requestPortalDocumentTranslation,
  uploadPortalDocument,
} from "@/pages/patients/data/portal-api";
import {
  PORTAL_DOCUMENT_CATEGORY_TABS,
  portalDocumentCategoryKey,
  type PortalDocumentCategoryKey,
} from "@/pages/patients/model/portal-document-categories";
import {
  documentTone,
  downloadPortalDocument,
  downloadPortalUpload,
  portalDocumentSourceLabel as sharedPortalDocumentSourceLabel,
  portalDocumentValueLabel as sharedPortalDocumentValueLabel,
  translationRequestTone,
  uploadedDocumentTone,
  usePortalLabels,
} from "@/pages/patients/model/portal-shared";
import type {
  PortalDocumentAlertsSummary,
  PortalDocumentItem,
  PortalTranslationRequestItem,
  PortalUploadedDocumentItem,
} from "@/pages/patients/model/portal-shared";
import { cn } from "@/lib/utils";

const PORTAL_DOCUMENT_REALTIME_EVENTS = [
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

function portalDocumentValueLabel(
  value: string | null | undefined,
) {
  return sharedPortalDocumentValueLabel(value);
}

function portalDocumentSourceLabel(
  source: string | null | undefined,
  clinic: string | null | undefined,
) {
  return sharedPortalDocumentSourceLabel(source, clinic);
}

/**
 * Upload kind for an identity document. The server stores it as a passport
 * scan in the identity category, which the required "passport" document
 * accepts; the care team still checks the file.
 */
const IDENTITY_UPLOAD_KIND = "identity_document";

/** Required-document rules that ask for the patient's passport or ID card. */
const IDENTITY_RULE_KEYS = new Set([
  "passport",
  "reisepass",
  "passport_scan",
  "identity",
  "identity_document",
  "id_card",
  "personalausweis",
]);

function isIdentityRuleKey(key: string) {
  return IDENTITY_RULE_KEYS.has(key.trim().toLowerCase().replace(/[\s-]+/g, "_"));
}

interface PatientDocumentsState {
  documents: PortalDocumentItem[];
  documentAlerts: PortalDocumentAlertsSummary | null;
  uploads: PortalUploadedDocumentItem[];
  translationRequests: PortalTranslationRequestItem[];
  loading: boolean;
  refreshing: boolean;
  error: string;
  notice: string;
  busyId: string | null;
  uploadOpen: boolean;
  uploadBusy: boolean;
  uploadError: string;
  uploadKind: string;
  uploadName: string;
  uploadNotes: string;
  uploadFile: File | null;
  activeCategory: PortalDocumentCategoryKey;
  translationDocument: PortalDocumentItem | null;
  translationLanguage: string;
  translationNote: string;
  translationBusy: boolean;
  translationError: string;
  version: number;
}

type PatientDocumentsAction =
  | Partial<PatientDocumentsState>
  | ((current: PatientDocumentsState) => Partial<PatientDocumentsState>);

const INITIAL_PATIENT_DOCUMENTS_STATE: PatientDocumentsState = {
  documents: [],
  documentAlerts: null,
  uploads: [],
  translationRequests: [],
  loading: true,
  refreshing: false,
  error: "",
  notice: "",
  busyId: null,
  uploadOpen: false,
  uploadBusy: false,
  uploadError: "",
  uploadKind: "general",
  uploadName: "",
  uploadNotes: "",
  uploadFile: null,
  activeCategory: "all",
  translationDocument: null,
  translationLanguage: "de",
  translationNote: "",
  translationBusy: false,
  translationError: "",
  version: 0,
};

function patientDocumentsReducer(
  current: PatientDocumentsState,
  action: PatientDocumentsAction,
): PatientDocumentsState {
  const patch = typeof action === "function" ? action(current) : action;
  return {
    ...current,
    ...patch,
  };
}

function usePatientDocumentsPageContent() {
  const {
    formatPortalDateTime,
    formatPortalFileSize,
    portalDocumentTypeLabels,
    portalStatusLabel,
  } = usePortalLabels();
  const { portalDocumentSourceLabel, portalDocumentValueLabel } = useLanguageHelpers();
  const { lang, t } = useLang();
  const uploadFileInputRef = useRef<HTMLInputElement>(null);
  // Every read of the documents workspace takes a number; only the newest
  // answer is shown. A list request that started before an upload and answers
  // after it no longer replaces the list with the new file by the old one
  // (QA B-10 d: "Meine hochgeladenen Dateien" stayed empty after sending).
  const workspaceRequestRef = useRef(0);
  const [documentsState, dispatchDocumentsState] = useReducer(
    patientDocumentsReducer,
    INITIAL_PATIENT_DOCUMENTS_STATE,
  );
  const {
    activeCategory,
    busyId,
    documentAlerts,
    documents,
    error,
    loading,
    notice,
    refreshing,
    translationBusy,
    translationDocument,
    translationError,
    translationLanguage,
    translationNote,
    translationRequests,
    uploadOpen,
    uploadBusy,
    uploadError,
    uploadFile,
    uploadKind,
    uploadName,
    uploadNotes,
    uploads,
    version,
  } = documentsState;
  const l = useCallback((key: string) => t.uiText[key] ?? key, [t]);
  const missingHints = missingDocumentHints(
    (documentAlerts?.missing_documents ?? []).map((item) => item.key),
  );

  useRealtimeSubscription(PORTAL_DOCUMENT_REALTIME_EVENTS, () => {
    clearApiCache("/me/documents");
    clearApiCache("/me/document-alerts");
    clearApiCache("/me/translation-requests");
    dispatchDocumentsState((current) => ({ version: current.version + 1 }));
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const request = ++workspaceRequestRef.current;
      dispatchDocumentsState((current) => ({
        refreshing: !current.loading,
        error: "",
      }));

      try {
        const workspace = await fetchPortalDocumentsWorkspace();
        if (cancelled || request !== workspaceRequestRef.current) return;
        startTransition(() =>
          dispatchDocumentsState({
            documents: workspace.releasedDocuments,
            documentAlerts: workspace.documentAlerts,
            uploads: workspace.uploadedDocuments,
            translationRequests: workspace.translationRequests,
            error: "",
            loading: false,
            refreshing: false,
          }),
        );
      } catch (err) {
        if (cancelled || request !== workspaceRequestRef.current) return;
        dispatchDocumentsState({
          error: err instanceof Error ? err.message : t.portal_documents_failed_to_load_documents,
          loading: false,
          refreshing: false,
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [t.portal_documents_failed_to_load_documents, version]);

  const pending = useMemo(
    () => documents.filter((item) => item.requires_confirmation && !item.confirmed).length,
    [documents],
  );
  const categoryCounts = useMemo(() => {
    const counts = new Map<PortalDocumentCategoryKey, number>([["all", documents.length]]);
    for (const item of documents) {
      const key = portalDocumentCategoryKey(item);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [documents]);
  const visibleDocuments = useMemo(
    () =>
      activeCategory === "all"
        ? documents
        : documents.filter((item) => portalDocumentCategoryKey(item) === activeCategory),
    [activeCategory, documents],
  );

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uploadFile) {
      dispatchDocumentsState({ uploadError: t.portal_documents_choose_a_file_first });
      return;
    }

    dispatchDocumentsState({ uploadBusy: true, uploadError: "", notice: "" });

    try {
      const formData = new FormData();
      formData.set("file", uploadFile);
      formData.set("upload_kind", uploadKind);
      if (uploadName.trim()) {
        formData.set("auto_name", uploadName.trim());
      }
      if (uploadNotes.trim()) {
        formData.set("notes", uploadNotes.trim());
      }

      await uploadPortalDocument(formData);

      // The file input is not controlled by React: clear it, or the sent file
      // stays selected and a second click sends it again.
      if (uploadFileInputRef.current) uploadFileInputRef.current.value = "";
      dispatchDocumentsState({
        uploadOpen: false,
        notice: t.portal_documents_upload_sent_to_the_care_team,
        uploadFile: null,
        uploadName: "",
        uploadNotes: "",
        uploadKind: "general",
        uploadBusy: false,
      });
      // Show the new file and the required-document state at once, past the
      // client cache and any list request that started before the upload.
      const request = ++workspaceRequestRef.current;
      try {
        const workspace = await fetchPortalDocumentsWorkspace({ forceFresh: true });
        if (request === workspaceRequestRef.current) {
          startTransition(() =>
            dispatchDocumentsState({
              documents: workspace.releasedDocuments,
              documentAlerts: workspace.documentAlerts,
              uploads: workspace.uploadedDocuments,
              translationRequests: workspace.translationRequests,
              loading: false,
              refreshing: false,
            }),
          );
        }
      } catch {
        if (request === workspaceRequestRef.current) {
          dispatchDocumentsState((current) => ({ version: current.version + 1 }));
        }
      }
      // The automatic file name arrives a little later.
      window.setTimeout(
        () => dispatchDocumentsState((current) => ({ version: current.version + 1 })),
        3_500,
      );
      window.setTimeout(
        () => dispatchDocumentsState((current) => ({ version: current.version + 1 })),
        10_000,
      );
    } catch (err) {
      dispatchDocumentsState({
        uploadError: err instanceof Error ? err.message : t.portal_documents_failed_to_upload_document,
        uploadBusy: false,
      });
    }
  }

  useEffect(() => {
    if (!uploadOpen || uploadKind !== IDENTITY_UPLOAD_KIND) return;
    const frame = requestAnimationFrame(() => uploadFileInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [uploadOpen, uploadKind]);

  /** The missing passport: pick the identity category and go to the file field. */
  function startIdentityUpload() {
    dispatchDocumentsState({ uploadOpen: true, uploadKind: IDENTITY_UPLOAD_KIND, uploadError: "" });
  }

  async function handleConfirm(documentId: string) {
    dispatchDocumentsState({ busyId: documentId, notice: "", error: "" });

    try {
      await confirmPortalDocument(documentId);
      dispatchDocumentsState((current) => ({
        busyId: null,
        notice: t.portal_documents_document_receipt_confirmed,
        version: current.version + 1,
      }));
    } catch (err) {
      dispatchDocumentsState({
        busyId: null,
        error: err instanceof Error ? err.message : t.portal_documents_failed_to_confirm_release,
      });
    }
  }

  async function handleDownload(item: PortalDocumentItem) {
    dispatchDocumentsState({ busyId: item.id, notice: "", error: "" });

    try {
      await downloadPortalDocument(item.id, item.original_filename ?? item.auto_name);
    } catch (err) {
      dispatchDocumentsState({
        error: err instanceof Error ? err.message : t.portal_documents_failed_to_download_document,
      });
    }
    dispatchDocumentsState({ busyId: null });
  }

  function openTranslationDialog(item: PortalDocumentItem) {
    dispatchDocumentsState({
      translationDocument: item,
      translationLanguage: "de",
      translationNote: "",
      translationError: "",
    });
  }

  async function handleRequestTranslation() {
    if (!translationDocument) return;

    dispatchDocumentsState({ translationBusy: true, translationError: "", notice: "" });

    try {
      await requestPortalDocumentTranslation(translationDocument.id, {
        requested_language: translationLanguage,
        note: translationNote.trim() || undefined,
      });
      clearApiCache("/me/translation-requests");
      dispatchDocumentsState((current) => ({
        notice: t.portal_documents_translation_request_sent_to_the_care_team,
        translationDocument: null,
        translationBusy: false,
        version: current.version + 1,
      }));
    } catch (err) {
      dispatchDocumentsState({
        translationError: err instanceof Error ? err.message : t.portal_documents_failed_to_request_translation,
        translationBusy: false,
      });
    }
  }

  async function handleUploadDownload(item: PortalUploadedDocumentItem) {
    dispatchDocumentsState({ busyId: item.id, notice: "", error: "" });

    try {
      await downloadPortalUpload(item.id, item.original_filename ?? item.auto_name);
    } catch (err) {
      dispatchDocumentsState({
        error: err instanceof Error ? err.message : t.portal_documents_failed_to_download_uploaded_document,
      });
    }
    dispatchDocumentsState({ busyId: null });
  }

  if (loading) {
    return (
      <div className="min-h-[320px]">
        <TabLoader />
      </div>
    );
  }

  return (
    <TabShell className="mt-0 w-full min-w-0 max-w-none space-y-3">
      <PageHeader
        title={t.portal_documents_my_documents}
        description={t.portal_documents_only_files_explicitly_released_to_your_portal_are_visible_here}
        actions={
          <>
            {pending > 0 ? <CountBadge>
              {t.portal_documents_pending_confirmations}: {pending}
            </CountBadge> : null}
            {uploads.length > 0 ? <CountBadge>
              {t.portal_documents_my_uploads}: {uploads.length}
            </CountBadge> : null}
            <Button
              variant="outline"
              className="h-9 rounded-lg"
              onClick={() => {
                // "Aktualisieren" asks the server again, not the 15-second client cache.
                clearApiCache("/me/documents");
                clearApiCache("/me/document-alerts");
                clearApiCache("/me/translation-requests");
                dispatchDocumentsState((current) => ({ version: current.version + 1 }));
              }}
            >
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              {t.portal_documents_refresh}
            </Button>
          </>
        }
      />

      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold"><span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />{t.portal_documents_my_documents}</h2>
        <Button onClick={() => dispatchDocumentsState({ uploadOpen: true })}><Upload className="size-4" />{t.portal_documents_upload_documents}</Button>
      </div>

      {documentAlerts && documentAlerts.configured_rule_count > 0 ? (
        <Section
          title={t.portal_documents_required_documents}
          className="p-3 sm:p-3"
          accessory={
            <CountBadge>
              {t.portal_documents_fulfilled}: {documentAlerts.required_documents.filter((item) => item.fulfilled).length}/
              {documentAlerts.configured_rule_count}
            </CountBadge>
          }
        >
          {documentAlerts.document_pack_complete ? (
            <PortalComplete>{t.portal_documents_your_minimum_document_pack_is_complete}</PortalComplete>
          ) : (
            <Banner tone="warning" withIcon>
              <div className="space-y-3">
                <div>
                  <p className="font-semibold">
                    {formatPluralCount(lang, documentAlerts.missing_count, {
                      one: t.portal_documents_missing_required_document_one,
                      few: t.portal_documents_missing_required_document_many,
                      many: t.portal_documents_missing_required_document_many,
                    })}
                  </p>
                  {missingHints.upload || !missingHints.consent ? (
                    <p className="mt-1 text-sm">
                      {t.portal_documents_use_the_upload_form_below_to_send_the_missing_items_to_your_care}
                    </p>
                  ) : null}
                  {missingHints.consent ? (
                    // A consent is signed, not uploaded: GMED sends it.
                    <p className="mt-1 text-sm" data-testid="portal-documents-consent-hint">
                      {l("portal_documents_consent_sent_by_gmed")}
                    </p>
                  ) : null}
                </div>
                {documentAlerts.missing_count > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {documentAlerts.missing_documents.map((item) => (
                      <StatusBadge key={item.key} tone="warning">
                        {localizeRequiredDocumentLabel(item.key, item.label, l)}
                      </StatusBadge>
                    ))}
                    {documentAlerts.missing_documents.some((item) => isIdentityRuleKey(item.key)) ? (
                      <Button
                        type="button"
                        className="h-8 rounded-lg"
                        onClick={startIdentityUpload}
                      >
                        <IdCard className="size-4" />
                        {t.portal_documents_upload_identity_document}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Banner>
          )}
        </Section>
      ) : null}

      {documents.length > 0 ? <div className="rounded-xl border border-border/60 bg-card p-1.5">
        <div className="flex flex-wrap justify-center gap-1">
          {PORTAL_DOCUMENT_CATEGORY_TABS.map((tab) => {
            const count = categoryCounts.get(tab.key) ?? 0;
            const label = l(tab.labelKey);
            const CategoryIcon = {
              all: Files,
              correspondence: Mail,
              consents: FileText,
              analyses: FlaskConical,
              conclusions: ClipboardList,
              invoices: Receipt,
              translations: Languages,
            }[tab.key];
            return (
              <button
                key={tab.key}
                type="button"
                aria-pressed={activeCategory === tab.key}
                onClick={() => dispatchDocumentsState({ activeCategory: tab.key })}
                className={cn(
                  "inline-flex min-h-8 items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]",
                  activeCategory === tab.key
                    ? "bg-[var(--brand)] font-semibold text-white"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <CategoryIcon aria-hidden="true" className="size-4 shrink-0" />
                <span>{label}</span>
                {count > 0 ? <span className={cn("rounded-full px-1.5 font-mono text-[11px] leading-5", activeCategory === tab.key ? "bg-white/20 text-white" : "bg-muted text-muted-foreground")}>{count}</span> : null}
              </button>
            );
          })}
        </div>
      </div> : null}

      <section className="space-y-4">
        <section className="space-y-4">
          <Section
            title={t.portal_documents_released_to_me}
            className="p-3 sm:p-3"
            accessory={visibleDocuments.length > 0 ? <CountBadge>{visibleDocuments.length}</CountBadge> : undefined}
          >

            {visibleDocuments.length === 0 ? (
              <EmptyCell>
                <p className="text-base font-semibold text-foreground">
                  {t.portal_documents_no_documents_in_this_category}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t.portal_documents_your_care_team_will_publish_files_here_once_they_are_cleared_for}
                </p>
              </EmptyCell>
            ) : (
              <div className="space-y-2">
                {visibleDocuments.map((item) => {
                  const busy = busyId === item.id;
                  const documentTranslationRequests = translationRequests.filter(
                    (request) => request.document_id === item.id,
                  );

                  return (
                    <ListItem key={item.id} className="min-w-0 space-y-2 rounded-xl p-3">
                      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start">
                        <FileText aria-hidden="true" className="hidden size-5 shrink-0 text-muted-foreground lg:mt-0.5 lg:block" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <h3 className="text-sm font-semibold leading-5 text-foreground [overflow-wrap:anywhere]">{item.auto_name}</h3>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge className={documentTone(item)}>
                              {item.confirmed ? t.portal_documents_confirmed : item.requires_confirmation ? t.portal_documents_needs_confirmation : t.portal_documents_released}
                            </StatusBadge>
                            <StatusBadge status={item.status}>{portalStatusLabel(item.status)}</StatusBadge>
                            <StatusChip tone="info" title={t.portal_documents_released_at}><CalendarDays aria-hidden="true" />{formatPortalDateTime(item.shared_at)}</StatusChip>
                            <span className="text-xs text-muted-foreground">{formatPortalFileSize(item.file_size)}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>{portalDocumentTypeLabels(item.art, item.category).join(" · ")}</span>
                            <span><span className="font-mono">{t.portal_documents_source}: </span>{portalDocumentSourceLabel(item.ursprung, item.klinik)}</span>
                          </div>
                          <StatusChip title={t.portal_documents_filename} className="items-start border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200">
                            <FileText aria-hidden="true" className="mt-0.5" />
                            <span className="min-w-0 [overflow-wrap:anywhere]">{item.original_filename || item.auto_name}</span>
                          </StatusChip>
                        </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5 lg:max-w-64 lg:justify-end">
                        <Button
                          className="h-8 rounded-lg text-xs"
                          disabled={busy}
                          onClick={() => void handleDownload(item)}
                        >
                          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                          {t.portal_documents_download}
                        </Button>
                        {item.requires_confirmation && !item.confirmed ? (
                          <Button
                            className="h-8 rounded-lg text-xs"
                            disabled={busy}
                            onClick={() => void handleConfirm(item.id)}
                          >
                            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                            {t.portal_documents_confirm_receipt}
                          </Button>
                        ) : null}
                        <Button
                          className="h-8 rounded-lg text-xs"
                          disabled={busy}
                          onClick={() => openTranslationDialog(item)}
                        >
                          <Languages aria-hidden="true" className="size-3.5" />
                          {t.portal_documents_request_translation}
                        </Button>
                      </div>
                      </div>

                      {documentTranslationRequests.length > 0 ? (
                        <div className="space-y-2">
                          {documentTranslationRequests.map((request) => (
                            <div
                              key={request.id}
                              className={cn(
                                "flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground",
                                tokens.surface.mutedCard,
                              )}
                            >
                              <span className="flex flex-wrap items-center gap-2">
                                <Languages aria-hidden="true" className="size-3.5" />
                                <span className="font-mono">{t.portal_documents_translation} {request.requested_language.toUpperCase()}</span>
                                <StatusChip tone="info"><CalendarDays aria-hidden="true" />{formatPortalDateTime(request.requested_at)}</StatusChip>
                              </span>
                              <StatusBadge status={request.status} className={translationRequestTone(request.status)}>
                                {portalStatusLabel(request.status)}
                              </StatusBadge>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </ListItem>
                  );
                })}
              </div>
            )}
          </Section>
        </section>

        <section className="space-y-4">
          <Dialog open={uploadOpen} onOpenChange={(open) => {
            if (uploadBusy) return;
            dispatchDocumentsState(open ? { uploadOpen: true } : {
              uploadOpen: false, uploadError: "", uploadFile: null, uploadName: "", uploadNotes: "", uploadKind: "general",
            });
          }}>
            <AdminDialogScaffold title={t.portal_documents_upload_documents} description={t.portal_documents_send_files_to_the_care_team_payment_proofs_stay_internal_and_can}>
            <form className="space-y-3 rounded-xl border border-border/60 bg-card p-3 [&_label]:font-mono [&_label]:text-xs" onSubmit={(event) => void handleUpload(event)}>
              <Field label={t.portal_documents_category} htmlFor="portal-document-upload-kind">
                <NativeComboboxSelect
                  id="portal-document-upload-kind"
                  value={uploadKind}
                  onChange={(event) => dispatchDocumentsState({ uploadKind: event.target.value })}
                  className={selectClass}
                >
                  <option value="general">{t.portal_documents_general}</option>
                  <option value="correspondence">{t.portal_documents_correspondence}</option>
                  <option value="analyses">{t.portal_documents_analyses}</option>
                  <option value="conclusions">{t.portal_documents_conclusions}</option>
                  <option value="invoices">{t.portal_documents_invoices}</option>
                  <option value="translations">{t.portal_documents_translations}</option>
                  <option value="insurance_document">{t.portal_documents_insurance_document}</option>
                  <option value={IDENTITY_UPLOAD_KIND}>{t.portal_documents_identity_document}</option>
                </NativeComboboxSelect>
              </Field>
              <Field label={t.portal_documents_title} htmlFor="portal-document-upload-title">
                <input
                  id="portal-document-upload-title"
                  value={uploadName}
                  onChange={(event) => dispatchDocumentsState({ uploadName: event.target.value })}
                  placeholder={t.portal_documents_optional_title}
                  className={cn(inputClass, "w-full border border-input px-3 text-sm")}
                />
              </Field>
              <Field label={t.portal_documents_file} htmlFor="portal-document-upload-file">
                <FilePicker
                  ref={uploadFileInputRef}
                  id="portal-document-upload-file"
                  selected={uploadFile}
                  onChange={(event) => dispatchDocumentsState({ uploadFile: event.target.files?.[0] ?? null })}
                />
              </Field>
              <Field label={t.portal_documents_note} htmlFor="portal-document-upload-note">
                <textarea
                  id="portal-document-upload-note"
                  value={uploadNotes}
                  onChange={(event) => dispatchDocumentsState({ uploadNotes: event.target.value })}
                  placeholder={t.portal_documents_optional_context_for_the_care_team}
                  className={cn(textareaClass, "min-h-[110px]")}
                />
              </Field>
              {uploadError ? <Banner tone="error">{uploadError}</Banner> : null}
              <Button
                type="submit"
                className="h-9 w-full rounded-lg"
                disabled={uploadBusy}
              >
                {uploadBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {t.portal_documents_send_upload}
              </Button>
            </form>
            </AdminDialogScaffold>
          </Dialog>

          {uploads.length > 0 ? (
          <Section
            title={t.portal_documents_my_uploads}
            className="p-3 sm:p-3"
            accessory={<CountBadge>{uploads.length}</CountBadge>}
          >
            {uploads.length === 0 ? (
              <EmptyCell>
                {t.portal_documents_no_portal_uploads_yet}
              </EmptyCell>
            ) : (
              <div className="space-y-2">
                {uploads.map((item) => {
                  const busy = busyId === item.id;

                  return (
                    <ListItem key={item.id} className="min-w-0 space-y-2 rounded-xl p-3">
                      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
                        <FileText aria-hidden="true" className="hidden size-5 shrink-0 text-muted-foreground sm:mt-0.5 sm:block" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <h3 className="text-sm font-semibold leading-5 text-foreground [overflow-wrap:anywhere]">{item.auto_name}</h3>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge className={uploadedDocumentTone(item)}>
                              {portalDocumentValueLabel(item.art)}
                            </StatusBadge>
                            <StatusChip tone="info" title={t.portal_documents_uploaded}><CalendarDays aria-hidden="true" />{formatPortalDateTime(item.created_at)}</StatusChip>
                            <span className="text-xs text-muted-foreground">{formatPortalFileSize(item.file_size)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                            {[
                              // The badge above names the type; the category only when it says more.
                              portalDocumentTypeLabels(item.art, item.category)[1] ?? null,
                              item.order_number,
                              item.appointment_title,
                            ].filter(Boolean).join(" / ")}
                          </p>
                          <StatusChip title={t.portal_documents_filename} className="items-start border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200">
                            <FileText aria-hidden="true" className="mt-0.5" />
                            <span className="min-w-0 [overflow-wrap:anywhere]">{item.original_filename || item.auto_name}</span>
                          </StatusChip>
                        </div>
                        <Button
                          className="h-8 w-fit shrink-0 rounded-lg text-xs"
                          disabled={busy}
                          onClick={() => void handleUploadDownload(item)}
                        >
                          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                          {t.portal_documents_download}
                        </Button>
                      </div>
                      {item.notes ? (
                        <div className={cn("rounded-lg px-3 py-2 text-xs leading-5 text-foreground", tokens.surface.mutedCard)}>
                          {item.notes}
                        </div>
                      ) : null}
                    </ListItem>
                  );
                })}
              </div>
            )}
          </Section>
          ) : null}
        </section>
      </section>

      <Dialog
        open={Boolean(translationDocument)}
        onOpenChange={(open) => {
          if (!open && !translationBusy) {
            dispatchDocumentsState({ translationDocument: null, translationError: "" });
          }
        }}
      >
        <DialogContent className="sm:max-w-lg [&_label]:font-mono [&_label]:text-xs">
          <DialogHeader>
            <DialogTitle>
              {t.portal_documents_request_translation}
            </DialogTitle>
            <DialogDescription>
              {translationDocument?.auto_name ??
                t.portal_documents_select_document}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3">
            <Field label={t.portal_documents_target_language} htmlFor="portal-translation-language">
              <NativeComboboxSelect
                id="portal-translation-language"
                value={translationLanguage}
                onChange={(event) => dispatchDocumentsState({ translationLanguage: event.target.value })}
                className={selectClass}
              >
                <option value="de">{t.portal_documents_german}</option>
              </NativeComboboxSelect>
            </Field>
            <Field label={t.portal_documents_note} htmlFor="portal-translation-note">
              <textarea
                id="portal-translation-note"
                value={translationNote}
                onChange={(event) => dispatchDocumentsState({ translationNote: event.target.value })}
                placeholder={t.portal_documents_optional_context_for_the_care_team}
                className={cn(textareaClass, "min-h-[110px]")}
              />
            </Field>
            {translationError ? <Banner tone="error">{translationError}</Banner> : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg"
              disabled={translationBusy}
              onClick={() => dispatchDocumentsState({ translationDocument: null })}
            >
              {t.portal_documents_cancel}
            </Button>
            <Button
              type="button"
              className="h-9 rounded-lg"
              disabled={translationBusy}
              onClick={() => void handleRequestTranslation()}
            >
              {translationBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t.portal_documents_send_request}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabShell>
  );
}

export function PatientDocumentsPage(...args: Parameters<typeof usePatientDocumentsPageContent>) {
  return usePatientDocumentsPageContent(...args);
}

/**
 * The helpers of this file that read the UI language themselves; its
 * components take them from `useLanguageHelpers()` (bound to the current language).
 */
const LANGUAGE_HELPERS = {
  portalDocumentSourceLabel,
  portalDocumentValueLabel,
};

function useLanguageHelpers() {
  return useLanguageBound(LANGUAGE_HELPERS);
}
