import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { startTransition, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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
import { formatUnknownValue, useLang } from "@/lib/i18n";
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
  l: (de: string, ru: string, en: string) => string,
  translations: { common_unknown: string; common_unknown_value: string },
) {
  switch (value) {
    case "general":
      return l("Allgemein", "Общий", "General");
    case "report":
    case "medical_report":
      return l("Medizinischer Bericht", "Медицинский отчет", "Medical report");
    case "discharge_report":
      return l("Entlassungsbericht", "Выписной отчет", "Discharge report");
    case "clinic_letter":
    case "clinic_correspondence":
    case "correspondence":
      return l("Korrespondenz", "Переписка", "Correspondence");
    case "blood_results":
    case "analyses":
    case "analysis":
      return l("Analysen", "Анализы", "Analyses");
    case "conclusions":
      return l("Befunde", "Заключения", "Conclusions");
    case "invoice_pdf":
    case "invoices":
      return l("Rechnung", "Счет", "Invoice");
    case "translated_letter":
    case "translations":
      return l("Ubersetzung", "Перевод", "Translation");
    case "insurance":
    case "insurance_document":
      return l("Versicherungsdokument", "Страховой документ", "Insurance document");
    case "identity":
      return l("Identitat", "Идентификация", "Identity");
    case "payment_proof":
      return l("Zahlungsnachweis", "Подтверждение оплаты", "Payment proof");
    default:
      return formatUnknownValue(value, translations);
  }
}

function portalDocumentSourceLabel(
  source: string | null | undefined,
  clinic: string | null | undefined,
  l: (de: string, ru: string, en: string) => string,
  translations: { common_unknown: string; common_unknown_value: string },
) {
  switch (source) {
    case "patient_portal":
      return l("Patientenportal", "Портал пациента", "Patient portal");
    case "provider":
      return l("Provider", "Провайдер", "Provider");
    case "staff_workspace":
      return l("Team-Workspace", "Рабочая область команды", "Team workspace");
    case "portal_release":
      return l("Portalfreigabe", "Публикация в портале", "Portal release");
    case null:
    case undefined:
    case "":
      return clinic || l("Portalfreigabe", "Публикация в портале", "Portal release");
    default:
      return formatUnknownValue(source, translations);
  }
}

export function PatientDocumentsPage() {
  const { t, lang } = useLang();
  const [documents, setDocuments] = useState<PortalDocumentItem[]>([]);
  const [documentAlerts, setDocumentAlerts] = useState<PortalDocumentAlertsSummary | null>(null);
  const [uploads, setUploads] = useState<PortalUploadedDocumentItem[]>([]);
  const [translationRequests, setTranslationRequests] = useState<PortalTranslationRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadKind, setUploadKind] = useState("general");
  const [uploadName, setUploadName] = useState("");
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [activeCategory, setActiveCategory] = useState<PortalDocumentCategoryKey>("all");
  const [translationDocument, setTranslationDocument] = useState<PortalDocumentItem | null>(null);
  const [translationLanguage, setTranslationLanguage] = useState("en");
  const [translationNote, setTranslationNote] = useState("");
  const [translationBusy, setTranslationBusy] = useState(false);
  const [translationError, setTranslationError] = useState("");
  const [version, setVersion] = useState(0);
  const l = useCallback(
    (de: string, ru: string, en: string) =>
      lang === "de" ? de : lang === "ru" ? ru : en,
    [lang],
  );

  useRealtimeSubscription(PORTAL_DOCUMENT_REALTIME_EVENTS, () => {
    clearApiCache("/me/documents");
    clearApiCache("/me/document-alerts");
    clearApiCache("/me/translation-requests");
    setVersion((value) => value + 1);
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (loading) {
        setRefreshing(false);
      } else {
        setRefreshing(true);
      }

      try {
        const workspace = await fetchPortalDocumentsWorkspace();
        if (cancelled) return;
        startTransition(() => {
          setDocuments(workspace.releasedDocuments);
          setDocumentAlerts(workspace.documentAlerts);
          setUploads(workspace.uploadedDocuments);
          setTranslationRequests(workspace.translationRequests);
          setError("");
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : l("Dokumente konnten nicht geladen werden.", "Не удалось загрузить документы.", "Failed to load documents."));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [loading, version, l]);

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
      setUploadError(l("Bitte zuerst eine Datei auswählen.", "Сначала выберите файл.", "Choose a file first."));
      return;
    }

    setUploadBusy(true);
    setUploadError("");
    setNotice("");

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

      setNotice(l("Upload wurde an das Betreuungsteam gesendet.", "Загрузка отправлена команде сопровождения.", "Upload sent to the care team."));
      setUploadFile(null);
      setUploadName("");
      setUploadNotes("");
      setUploadKind("general");
      setVersion((value) => value + 1);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : l("Dokument konnte nicht hochgeladen werden.", "Не удалось загрузить документ.", "Failed to upload document."));
    } finally {
      setUploadBusy(false);
    }
  }

  async function handleConfirm(documentId: string) {
    setBusyId(documentId);
    setNotice("");
    setError("");

    try {
      await confirmPortalDocument(documentId);
      setNotice(l("Dokumentenerhalt bestätigt.", "Получение документа подтверждено.", "Document receipt confirmed."));
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : l("Freigabe konnte nicht bestätigt werden.", "Не удалось подтвердить публикацию.", "Failed to confirm release."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDownload(item: PortalDocumentItem) {
    setBusyId(item.id);
    setNotice("");
    setError("");

    try {
      await downloadPortalDocument(item.id, item.original_filename ?? item.auto_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : l("Dokument konnte nicht heruntergeladen werden.", "Не удалось скачать документ.", "Failed to download document."));
    } finally {
      setBusyId(null);
    }
  }

  function openTranslationDialog(item: PortalDocumentItem) {
    setTranslationDocument(item);
    setTranslationLanguage("en");
    setTranslationNote("");
    setTranslationError("");
  }

  async function handleRequestTranslation() {
    if (!translationDocument) return;

    setTranslationBusy(true);
    setTranslationError("");
    setNotice("");

    try {
      await requestPortalDocumentTranslation(translationDocument.id, {
        requested_language: translationLanguage,
        note: translationNote.trim() || undefined,
      });
      setNotice(l("Übersetzungsanfrage wurde an das Betreuungsteam gesendet.", "Запрос на перевод отправлен команде сопровождения.", "Translation request sent to the care team."));
      setTranslationDocument(null);
      clearApiCache("/me/translation-requests");
      setVersion((value) => value + 1);
    } catch (err) {
      setTranslationError(err instanceof Error ? err.message : l("Übersetzung konnte nicht angefragt werden.", "Не удалось запросить перевод.", "Failed to request translation."));
    } finally {
      setTranslationBusy(false);
    }
  }

  async function handleUploadDownload(item: PortalUploadedDocumentItem) {
    setBusyId(item.id);
    setNotice("");
    setError("");

    try {
      await downloadPortalUpload(item.id, item.original_filename ?? item.auto_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : l("Hochgeladenes Dokument konnte nicht heruntergeladen werden.", "Не удалось скачать загруженный документ.", "Failed to download uploaded document."));
    } finally {
      setBusyId(null);
    }
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
        title={l("Meine Dokumente", "Мои документы", "My documents")}
        description={l("Hier sind nur Dateien sichtbar, die ausdrücklich für Ihr Portal freigegeben wurden.", "Здесь видны только файлы, явно опубликованные для вашего портала.", "Only files explicitly released to your portal are visible here.")}
        actions={
          <>
            <CountBadge>
              {l("Ausstehende Bestätigungen", "Ожидающие подтверждения", "Pending confirmations")}: {pending}
            </CountBadge>
            <CountBadge>
              {l("Meine Uploads", "Мои загрузки", "My uploads")}: {uploads.length}
            </CountBadge>
            <Button variant="outline" className="h-9 rounded-lg" onClick={() => setVersion((value) => value + 1)}>
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              {l("Aktualisieren", "Обновить", "Refresh")}
            </Button>
          </>
        }
      />

      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label={l("Für mich freigegeben", "Опубликовано для меня", "Released to me")} value={String(documents.length)} />
        <StatCard label={l("Ausstehende Bestätigungen", "Ожидающие подтверждения", "Pending confirmations")} value={String(pending)} />
        <StatCard label={l("Meine Uploads", "Мои загрузки", "My uploads")} value={String(uploads.length)} />
      </section>

      {documentAlerts && documentAlerts.configured_rule_count > 0 ? (
        <Section
          title={l("Erforderliche Dokumente", "Обязательные документы", "Required documents")}
          accessory={
            <CountBadge>
              {l("Erfüllt", "Выполнено", "Fulfilled")}: {documentAlerts.required_documents.filter((item) => item.fulfilled).length}/
              {documentAlerts.configured_rule_count}
            </CountBadge>
          }
        >
          {documentAlerts.document_pack_complete ? (
            <SuccessBanner>
              <p className="font-semibold">
                {l("Ihr Mindest-Dokumentenpaket ist vollständig.", "Минимальный комплект документов уже собран.", "Your minimum document pack is complete")}
              </p>
              <p className="mt-1 text-sm">
                {l("Sie haben bereits alle erforderlichen Basisdokumente hochgeladen oder erhalten.", "Вы уже загрузили или получили все обязательные базовые документы.", "You already uploaded or received all required base documents.")}
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
                    {l("Nutzen Sie das Upload-Formular unten, um die fehlenden Unterlagen an Ihr Betreuungsteam zu senden.", "Используйте форму загрузки ниже, чтобы отправить недостающие документы вашей команде сопровождения.", "Use the upload form below to send the missing items to your care team.")}
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
                onClick={() => setActiveCategory(tab.key)}
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
            title={l("Für mich freigegeben", "Опубликовано для меня", "Released to me")}
            accessory={<CountBadge>{visibleDocuments.length}</CountBadge>}
          >
            <p className="text-sm text-muted-foreground">
              {l("Hier sind nur Dateien sichtbar, die von Ihrem Betreuungsteam ausdrücklich freigegeben wurden.", "Здесь видны только файлы, которые команда сопровождения явно опубликовала для вас.", "Only files explicitly released by your care team are visible here.")}
            </p>

            {visibleDocuments.length === 0 ? (
              <EmptyCell>
                <p className="text-base font-semibold text-foreground">
                  {l("Keine Dokumente in dieser Kategorie", "Нет документов в этой категории", "No documents in this category")}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {l("Ihr Betreuungsteam veröffentlicht Dateien hier, sobald sie für den Portalzugang freigegeben sind.", "Команда сопровождения опубликует здесь файлы, как только они будут допущены к доступу через портал.", "Your care team will publish files here once they are cleared for portal access.")}
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
                              {item.confirmed ? l("Bestätigt", "Подтверждено", "Confirmed") : item.requires_confirmation ? l("Bestätigung erforderlich", "Требуется подтверждение", "Needs confirmation") : l("Freigegeben", "Опубликовано", "Released")}
                            </StatusBadge>
                            <StatusBadge status={item.status}>{portalStatusLabel(item.status)}</StatusBadge>
                          </div>
                          <h2 className="mt-3 text-base font-semibold text-foreground">{item.auto_name}</h2>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {[
                              portalDocumentValueLabel(item.art, l, t),
                              item.category ? portalDocumentValueLabel(item.category, l, t) : null,
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
                          label={l("Freigegeben von", "Опубликовано", "Released by")}
                          value={item.shared_by_name || l("Betreuungsteam", "Команда сопровождения", "Care team")}
                        />
                        <InfoRow
                          className={cn("rounded-lg p-3", tokens.surface.mutedCard)}
                          label={l("Freigegeben am", "Опубликовано", "Released at")}
                          value={formatPortalDateTime(item.shared_at)}
                        />
                        <InfoRow
                          className={cn("rounded-lg p-3", tokens.surface.mutedCard)}
                          label={l("Dateiname", "Имя файла", "Filename")}
                          value={item.original_filename || item.auto_name}
                        />
                        <InfoRow
                          className={cn("rounded-lg p-3", tokens.surface.mutedCard)}
                          label={l("Quelle", "Источник", "Source")}
                          value={portalDocumentSourceLabel(item.ursprung, item.klinik, l, t)}
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
                          {l("Herunterladen", "Скачать", "Download")}
                        </Button>
                        {item.requires_confirmation && !item.confirmed ? (
                          <Button
                            variant="outline"
                            className="h-9 rounded-lg"
                            disabled={busy}
                            onClick={() => void handleConfirm(item.id)}
                          >
                            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                            {l("Empfang bestätigen", "Подтвердить получение", "Confirm receipt")}
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          className="h-9 rounded-lg"
                          disabled={busy}
                          onClick={() => openTranslationDialog(item)}
                        >
                          {l("Übersetzung anfragen", "Запросить перевод", "Request translation")}
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
                                {l("Übersetzung", "Перевод", "Translation")} {request.requested_language.toUpperCase()} / {formatPortalDateTime(request.requested_at)}
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
            title={l("Dokumente hochladen", "Загрузить документы", "Upload documents")}
            accessory={<Upload className="size-4 text-muted-foreground" />}
          >
            <p className="text-sm text-muted-foreground">
              {l("Senden Sie Dateien an das Betreuungsteam. Zahlungsnachweise bleiben intern und können im Rechnungsbereich hochgeladen werden.", "Отправляйте файлы команде сопровождения. Подтверждения оплаты остаются внутренними и загружаются из раздела счетов.", "Send files to the care team. Payment proofs stay internal and can be uploaded from the invoice workspace.")}
            </p>
            <form className="space-y-4" onSubmit={(event) => void handleUpload(event)}>
              <Field label={l("Kategorie", "Категория", "Category")} htmlFor="portal-document-upload-kind">
                <NativeComboboxSelect
                  id="portal-document-upload-kind"
                  value={uploadKind}
                  onChange={(event) => setUploadKind(event.target.value)}
                  className={selectClass}
                >
                  <option value="general">{l("Allgemein", "Общий", "General")}</option>
                  <option value="correspondence">{l("Korrespondenz", "Переписка", "Correspondence")}</option>
                  <option value="analyses">{l("Analysen", "Анализы", "Analyses")}</option>
                  <option value="conclusions">{l("Befunde / Schluesse", "Заключения", "Conclusions")}</option>
                  <option value="invoices">{l("Rechnungen", "Счета", "Invoices")}</option>
                  <option value="translations">{l("Uebersetzungen", "Переводы", "Translations")}</option>
                  <option value="insurance_document">{l("Versicherungsdokument", "Страховой документ", "Insurance document")}</option>
                </NativeComboboxSelect>
              </Field>
              <Field label={l("Titel", "Название", "Title")} htmlFor="portal-document-upload-title">
                <input
                  id="portal-document-upload-title"
                  value={uploadName}
                  onChange={(event) => setUploadName(event.target.value)}
                  placeholder={l("Optionaler Titel", "Необязательное название", "Optional title")}
                  className={cn(inputClass, "w-full border border-input px-3 text-sm")}
                />
              </Field>
              <Field label={l("Datei", "Файл", "File")} htmlFor="portal-document-upload-file">
                <input
                  id="portal-document-upload-file"
                  type="file"
                  onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                  className={cn(
                    inputClass,
                    "block h-auto w-full border border-input px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground",
                  )}
                />
              </Field>
              <Field label={l("Notiz", "Заметка", "Note")} htmlFor="portal-document-upload-note">
                <textarea
                  id="portal-document-upload-note"
                  value={uploadNotes}
                  onChange={(event) => setUploadNotes(event.target.value)}
                  placeholder={l("Optionaler Kontext für das Betreuungsteam", "Необязательный контекст для команды сопровождения", "Optional context for the care team")}
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
                {l("Upload senden", "Отправить загрузку", "Send upload")}
              </Button>
            </form>
          </Section>

          <Section
            title={l("Meine Uploads", "Мои загрузки", "My uploads")}
            accessory={<CountBadge>{uploads.length}</CountBadge>}
          >
            <p className="text-sm text-muted-foreground">
              {l("Dateien, die Sie bereits aus dem Portal gesendet haben.", "Файлы, которые вы уже отправили из портала.", "Files you already sent from the portal.")}
            </p>
            {uploads.length === 0 ? (
              <EmptyCell>
                {l("Noch keine Portal-Uploads.", "Пока нет загрузок из портала.", "No portal uploads yet.")}
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
                              {portalDocumentValueLabel(item.art, l, t)}
                            </StatusBadge>
                          </div>
                          <p className="mt-3 text-sm font-semibold text-foreground">{item.auto_name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {[
                              item.category ? portalDocumentValueLabel(item.category, l, t) : null,
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
                          {l("Herunterladen", "Скачать", "Download")}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {l("Hochgeladen", "Загружено", "Uploaded")} {formatPortalDateTime(item.created_at)}
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
            setTranslationDocument(null);
            setTranslationError("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {l("Übersetzung anfragen", "Запросить перевод", "Request translation")}
            </DialogTitle>
            <DialogDescription>
              {translationDocument?.auto_name ??
                l("Dokument auswählen", "Выберите документ", "Select document")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label={l("Zielsprache", "Язык перевода", "Target language")} htmlFor="portal-translation-language">
              <NativeComboboxSelect
                id="portal-translation-language"
                value={translationLanguage}
                onChange={(event) => setTranslationLanguage(event.target.value)}
                className={selectClass}
              >
                <option value="de">{l("Deutsch", "Немецкий", "German")}</option>
                <option value="en">{l("Englisch", "Английский", "English")}</option>
                <option value="uk">{l("Ukrainisch", "Украинский", "Ukrainian")}</option>
                <option value="ru">{l("Russisch", "Русский", "Russian")}</option>
              </NativeComboboxSelect>
            </Field>
            <Field label={l("Notiz", "Заметка", "Note")} htmlFor="portal-translation-note">
              <textarea
                id="portal-translation-note"
                value={translationNote}
                onChange={(event) => setTranslationNote(event.target.value)}
                placeholder={l("Optionaler Kontext für das Betreuungsteam", "Необязательный контекст для команды сопровождения", "Optional context for the care team")}
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
              onClick={() => setTranslationDocument(null)}
            >
              {l("Abbrechen", "Отмена", "Cancel")}
            </Button>
            <Button
              type="button"
              className="h-9 rounded-lg"
              disabled={translationBusy}
              onClick={() => void handleRequestTranslation()}
            >
              {translationBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {l("Anfrage senden", "Отправить запрос", "Send request")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabShell>
  );
}
