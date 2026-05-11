import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { startTransition, useCallback, useEffect, useMemo, useReducer, type FormEvent } from "react";
import { Download, LoaderCircle, RefreshCw, ShieldCheck, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
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
  Section,
  StatCard,
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
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import { localizeRequiredDocumentLabel } from "@/lib/required-document-labels";
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
  formatPortalDateTime,
  formatPortalFileSize,
  portalDocumentSourceLabel as sharedPortalDocumentSourceLabel,
  portalDocumentValueLabel as sharedPortalDocumentValueLabel,
  portalStatusLabel,
  translationRequestTone,
  uploadedDocumentTone,
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
  uploadBusy: false,
  uploadError: "",
  uploadKind: "general",
  uploadName: "",
  uploadNotes: "",
  uploadFile: null,
  activeCategory: "all",
  translationDocument: null,
  translationLanguage: "en",
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
  const { t, lang } = useLang();
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
    uploadBusy,
    uploadError,
    uploadFile,
    uploadKind,
    uploadName,
    uploadNotes,
    uploads,
    version,
  } = documentsState;
  const l = useCallback(
    (de: string, ru: string, en: string) =>
      lang === "de" ? de : lang === "ru" ? ru : en,
    [lang],
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
      dispatchDocumentsState((current) => ({
        refreshing: !current.loading,
        error: "",
      }));

      try {
        const workspace = await fetchPortalDocumentsWorkspace();
        if (cancelled) return;
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
        if (cancelled) return;
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

      dispatchDocumentsState((current) => ({
        notice: t.portal_documents_upload_sent_to_the_care_team,
        uploadFile: null,
        uploadName: "",
        uploadNotes: "",
        uploadKind: "general",
        uploadBusy: false,
        version: current.version + 1,
      }));
    } catch (err) {
      dispatchDocumentsState({
        uploadError: err instanceof Error ? err.message : t.portal_documents_failed_to_upload_document,
        uploadBusy: false,
      });
    }
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
      translationLanguage: "en",
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
    <TabShell className="mt-0 space-y-6">
      <PageHeader
        title={t.portal_documents_my_documents}
        description={t.portal_documents_only_files_explicitly_released_to_your_portal_are_visible_here}
        actions={
          <>
            <CountBadge>
              {t.portal_documents_pending_confirmations}: {pending}
            </CountBadge>
            <CountBadge>
              {t.portal_documents_my_uploads}: {uploads.length}
            </CountBadge>
            <Button variant="outline" className="h-9 rounded-lg" onClick={() => dispatchDocumentsState((current) => ({ version: current.version + 1 }))}>
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              {t.portal_documents_refresh}
            </Button>
          </>
        }
      />

      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label={t.portal_documents_released_to_me} value={String(documents.length)} />
        <StatCard label={t.portal_documents_pending_confirmations} value={String(pending)} />
        <StatCard label={t.portal_documents_my_uploads} value={String(uploads.length)} />
      </section>

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
            <SuccessBanner>
              <p className="font-semibold">
                {t.portal_documents_your_minimum_document_pack_is_complete}
              </p>
              <p className="mt-1 text-sm">
                {t.portal_documents_you_already_uploaded_or_received_all_required_base_documents}
              </p>
            </SuccessBanner>
          ) : (
            <Banner tone="warning" withIcon>
              <div className="space-y-3">
                <div>
                  <p className="font-semibold">
                    {l(
                      `Es fehlen noch ${documentAlerts.missing_count} Pflichtdokument${documentAlerts.missing_count === 1 ? "" : "e"}.`,
                      `Еще не хватает ${documentAlerts.missing_count} обязательн${documentAlerts.missing_count === 1 ? "ого документа" : "ых документов"}.`,
                      `${documentAlerts.missing_count} required document${documentAlerts.missing_count === 1 ? "" : "s"} still missing`,
                    )}
                  </p>
                  <p className="mt-1 text-sm">
                    {t.portal_documents_use_the_upload_form_below_to_send_the_missing_items_to_your_care}
                  </p>
                </div>
                {documentAlerts.missing_count > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {documentAlerts.missing_documents.map((item) => (
                      <StatusBadge key={item.key} tone="warning">
                        {localizeRequiredDocumentLabel(item.key, item.label, l)}
                      </StatusBadge>
                    ))}
                  </div>
                ) : null}
              </div>
            </Banner>
          )}
        </Section>
      ) : null}

      <div className={cn("rounded-xl p-3", tokens.surface.softCard)}>
        <div className="flex flex-wrap gap-2">
          {PORTAL_DOCUMENT_CATEGORY_TABS.map((tab) => {
            const count = categoryCounts.get(tab.key) ?? 0;
            const label = lang === "de" ? tab.label.de : lang === "ru" ? tab.label.ru : tab.label.en;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => dispatchDocumentsState({ activeCategory: tab.key })}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition",
                  activeCategory === tab.key
                    ? "border-ring bg-muted text-foreground"
                    : "border-border/60 bg-card text-muted-foreground hover:bg-muted/35",
                )}
              >
                <span>{label}</span>
                <CountBadge>{count}</CountBadge>
              </button>
            );
          })}
        </div>
      </div>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.9fr]">
        <section className="space-y-4">
          <Section
            title={t.portal_documents_released_to_me}
            accessory={<CountBadge>{visibleDocuments.length}</CountBadge>}
          >
            <p className="text-sm text-muted-foreground">
              {t.portal_documents_only_files_explicitly_released_by_your_care_team_are_visible_her}
            </p>

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
                              portalDocumentValueLabel(item.art),
                              item.category ? portalDocumentValueLabel(item.category) : null,
                              formatPortalFileSize(item.file_size),
                            ].filter(Boolean).join(" / ")}
                          </p>
                        </div>
                        {item.requires_confirmation && !item.confirmed ? (
                          <ShieldCheck className="size-5 text-amber-500" />
                        ) : null}
                      </div>

                      <dl className="grid gap-3 sm:grid-cols-2">
                        <InfoRow
                          className={cn("rounded-lg p-3", tokens.surface.mutedCard)}
                          label={t.portal_documents_released_by}
                          value={item.shared_by_name || t.portal_documents_care_team}
                        />
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

                      {item.notes ? (
                        <div className={cn("rounded-lg px-4 py-3 text-sm text-muted-foreground", tokens.surface.mutedCard)}>
                          {item.notes}
                        </div>
                      ) : null}

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
          <Section
            title={t.portal_documents_upload_documents}
            accessory={<Upload className="size-4 text-muted-foreground" />}
          >
            <p className="text-sm text-muted-foreground">
              {t.portal_documents_send_files_to_the_care_team_payment_proofs_stay_internal_and_can}
            </p>
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
                <input
                  id="portal-document-upload-file"
                  type="file"
                  onChange={(event) => dispatchDocumentsState({ uploadFile: event.target.files?.[0] ?? null })}
                  className={cn(
                    inputClass,
                    "block h-auto w-full border border-input px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground",
                  )}
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
          </Section>

          <Section
            title={t.portal_documents_my_uploads}
            accessory={<CountBadge>{uploads.length}</CountBadge>}
          >
            <p className="text-sm text-muted-foreground">
              {t.portal_documents_files_you_already_sent_from_the_portal}
            </p>
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
                              item.category ? portalDocumentValueLabel(item.category) : null,
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
                <option value="en">{t.portal_documents_english}</option>
                <option value="uk">{t.portal_documents_ukrainian}</option>
                <option value="ru">{t.portal_documents_russian}</option>
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
