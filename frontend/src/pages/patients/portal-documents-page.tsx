import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { startTransition, useCallback, useEffect, useMemo, useReducer, useRef, type FormEvent } from "react";
import { Download, IdCard, LoaderCircle, RefreshCw, ShieldCheck, Upload } from "lucide-react";

import { AdminDialogScaffold } from "@/components/admin-dialog-scaffold";
import { PortalSection as Section, PortalComplete } from "./ui/portal-page-layout";
import { Button } from "@/components/ui/button";
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
  InfoRow,
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
    <TabShell className="mx-auto mt-0 max-w-6xl space-y-4">
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
        <h2 className="hidden text-lg font-semibold md:block">{t.portal_documents_my_documents}</h2>
        <Button onClick={() => dispatchDocumentsState({ uploadOpen: true })}><Upload className="size-4" />{t.portal_documents_upload_documents}</Button>
      </div>

      {documentAlerts && documentAlerts.configured_rule_count > 0 ? (
        <Section
          title={t.portal_documents_required_documents}
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
                        variant="outline"
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

      {documents.length > 0 ? <div className="rounded-xl border border-border/70 bg-card p-2">
        <div className="flex flex-wrap gap-2">
          {PORTAL_DOCUMENT_CATEGORY_TABS.map((tab) => {
            const count = categoryCounts.get(tab.key) ?? 0;
            const label = l(tab.labelKey);
            return (
              <button
                key={tab.key}
                type="button"
                aria-pressed={activeCategory === tab.key}
                onClick={() => dispatchDocumentsState({ activeCategory: tab.key })}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition",
                  activeCategory === tab.key
                    ? "border-primary/40 bg-primary/10 font-medium text-foreground"
                    : "border-border/60 bg-card text-muted-foreground hover:bg-muted/35",
                )}
              >
                <span>{label}</span>
                {count > 0 ? <CountBadge>{count}</CountBadge> : null}
              </button>
            );
          })}
        </div>
      </div> : null}

      <section className="space-y-4">
        <section className="space-y-4">
          <Section
            title={t.portal_documents_released_to_me}
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
              <div className="space-y-3">
                {visibleDocuments.map((item) => {
                  const busy = busyId === item.id;
                  const documentTranslationRequests = translationRequests.filter(
                    (request) => request.document_id === item.id,
                  );

                  return (
                    <ListItem key={item.id} className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge className={documentTone(item)}>
                              {item.confirmed ? t.portal_documents_confirmed : item.requires_confirmation ? t.portal_documents_needs_confirmation : t.portal_documents_released}
                            </StatusBadge>
                            <StatusBadge status={item.status}>{portalStatusLabel(item.status)}</StatusBadge>
                          </div>
                          <h2 className="mt-3 text-base font-semibold text-foreground">{item.auto_name}</h2>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {[
                              ...portalDocumentTypeLabels(item.art, item.category),
                              formatPortalFileSize(item.file_size),
                            ].join(" / ")}
                          </p>
                        </div>
                        {item.requires_confirmation && !item.confirmed ? (
                          <ShieldCheck className="size-5 text-amber-500" />
                        ) : null}
                      </div>

                      <dl className="grid gap-3 sm:grid-cols-2">
                        <InfoRow
                          className={cn("rounded-lg p-3", tokens.surface.mutedCard)}
                          label={t.portal_documents_released_at}
                          value={formatPortalDateTime(item.shared_at)}
                        />
                        <InfoRow
                          className={cn("rounded-lg p-3", tokens.surface.mutedCard)}
                          label={t.portal_documents_filename}
                          value={item.original_filename || item.auto_name}
                        />
                        <InfoRow
                          className={cn("rounded-lg p-3", tokens.surface.mutedCard)}
                          label={t.portal_documents_source}
                          value={portalDocumentSourceLabel(item.ursprung, item.klinik)}
                        />
                      </dl>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          className="h-9 rounded-lg"
                          disabled={busy}
                          onClick={() => void handleDownload(item)}
                        >
                          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                          {t.portal_documents_download}
                        </Button>
                        {item.requires_confirmation && !item.confirmed ? (
                          <Button
                            variant="outline"
                            className="h-9 rounded-lg"
                            disabled={busy}
                            onClick={() => void handleConfirm(item.id)}
                          >
                            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                            {t.portal_documents_confirm_receipt}
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          className="h-9 rounded-lg"
                          disabled={busy}
                          onClick={() => openTranslationDialog(item)}
                        >
                          {t.portal_documents_request_translation}
                        </Button>
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
                              <span>
                                {t.portal_documents_translation} {request.requested_language.toUpperCase()} / {formatPortalDateTime(request.requested_at)}
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
            <form className="space-y-4" onSubmit={(event) => void handleUpload(event)}>
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
            accessory={<CountBadge>{uploads.length}</CountBadge>}
          >
            {uploads.length === 0 ? (
              <EmptyCell>
                {t.portal_documents_no_portal_uploads_yet}
              </EmptyCell>
            ) : (
              <div className="space-y-3">
                {uploads.map((item) => {
                  const busy = busyId === item.id;

                  return (
                    <ListItem key={item.id} className="space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-2">
                            <StatusBadge className={uploadedDocumentTone(item)}>
                              {portalDocumentValueLabel(item.art)}
                            </StatusBadge>
                          </div>
                          <p className="mt-3 text-sm font-semibold text-foreground">{item.auto_name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {[
                              // The badge above names the type; the category only when it says more.
                              portalDocumentTypeLabels(item.art, item.category)[1] ?? null,
                              item.order_number,
                              item.appointment_title,
                              formatPortalFileSize(item.file_size),
                            ].filter(Boolean).join(" / ")}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          className="h-9 rounded-lg"
                          disabled={busy}
                          onClick={() => void handleUploadDownload(item)}
                        >
                          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                          {t.portal_documents_download}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t.portal_documents_uploaded} {formatPortalDateTime(item.created_at)}
                      </p>
                      {item.notes ? (
                        <div className={cn("rounded-lg px-4 py-3 text-sm text-muted-foreground", tokens.surface.mutedCard)}>
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t.portal_documents_request_translation}
            </DialogTitle>
            <DialogDescription>
              {translationDocument?.auto_name ??
                t.portal_documents_select_document}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
