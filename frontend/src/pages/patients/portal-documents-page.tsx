import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { startTransition, useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Download, LoaderCircle, RefreshCw, ShieldCheck, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clearApiCache } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import { localizeRequiredDocumentLabel } from "@/lib/required-document-labels";
import {
  confirmPortalDocument,
  fetchPortalDocumentsWorkspace,
  uploadPortalDocument,
} from "@/pages/patients/data/portal-api";
import {
  documentTone,
  downloadPortalDocument,
  downloadPortalUpload,
  formatPortalDateTime,
  formatPortalFileSize,
  portalStatusLabel,
  uploadedDocumentTone,
} from "@/pages/patients/model/portal-shared";
import type {
  PortalDocumentAlertsSummary,
  PortalDocumentItem,
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

export function PatientDocumentsPage() {
  const { lang } = useLang();
  const [documents, setDocuments] = useState<PortalDocumentItem[]>([]);
  const [documentAlerts, setDocumentAlerts] = useState<PortalDocumentAlertsSummary | null>(null);
  const [uploads, setUploads] = useState<PortalUploadedDocumentItem[]>([]);
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
  const [version, setVersion] = useState(0);
  const l = useCallback(
    (de: string, ru: string, en: string) =>
      lang === "de" ? de : lang === "ru" ? ru : en,
    [lang],
  );

  useRealtimeSubscription(PORTAL_DOCUMENT_REALTIME_EVENTS, () => {
    clearApiCache("/me/documents");
    clearApiCache("/me/document-alerts");
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
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          {l("Dokumente werden geladen...", "Загрузка документов...", "Loading documents...")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
              {l("Patientenportal", "Портал пациента", "Patient portal")}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              {l("Meine Dokumente", "Мои документы", "My documents")}
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-500">
              {l("Hier sind nur Dateien sichtbar, die ausdrücklich für Ihr Portal freigegeben wurden.", "Здесь видны только файлы, явно опубликованные для вашего портала.", "Only files explicitly released to your portal are visible here.")}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
              {l("Ausstehende Bestätigungen", "Ожидающие подтверждения", "Pending confirmations")}: <span className="font-semibold text-slate-950">{pending}</span>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
              {l("Meine Uploads", "Мои загрузки", "My uploads")}: <span className="font-semibold text-slate-950">{uploads.length}</span>
            </div>
            <Button variant="outline" className="rounded-2xl" onClick={() => setVersion((value) => value + 1)}>
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              {l("Aktualisieren", "Обновить", "Refresh")}
            </Button>
          </div>
        </div>
      </section>

      {notice ? (
        <section className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700 shadow-sm">
          {notice}
        </section>
      ) : null}
      {error ? (
        <section className="rounded-[1.5rem] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 shadow-sm">
          {error}
        </section>
      ) : null}

      {documentAlerts && documentAlerts.configured_rule_count > 0 ? (
        <section
          className={cn(
            "rounded-[1.75rem] border px-5 py-4 shadow-sm",
            documentAlerts.document_pack_complete
              ? "border-emerald-200 bg-emerald-50"
              : "border-amber-200 bg-amber-50",
          )}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {l("Erforderliche Dokumente", "Обязательные документы", "Required documents")}
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">
                {documentAlerts.document_pack_complete
                  ? l("Ihr Mindest-Dokumentenpaket ist vollständig.", "Минимальный комплект документов уже собран.", "Your minimum document pack is complete")
                  : l(
                      `Es fehlen noch ${documentAlerts.missing_count} Pflichtdokument${documentAlerts.missing_count === 1 ? "" : "e"}.`,
                      `Еще не хватает ${documentAlerts.missing_count} обязательн${documentAlerts.missing_count === 1 ? "ого документа" : "ых документов"}.`,
                      `${documentAlerts.missing_count} required document${documentAlerts.missing_count === 1 ? "" : "s"} still missing`,
                    )}
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                {documentAlerts.document_pack_complete
                  ? l("Sie haben bereits alle erforderlichen Basisdokumente hochgeladen oder erhalten.", "Вы уже загрузили или получили все обязательные базовые документы.", "You already uploaded or received all required base documents.")
                  : l("Nutzen Sie das Upload-Formular unten, um die fehlenden Unterlagen an Ihr Betreuungsteam zu senden.", "Используйте форму загрузки ниже, чтобы отправить недостающие документы вашей команде сопровождения.", "Use the upload form below to send the missing items to your care team.")}
              </p>
              {documentAlerts.missing_count > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {documentAlerts.missing_documents.map((item) => (
                    <Badge
                      key={item.key}
                      variant="outline"
                      className="rounded-full border-amber-300 bg-white text-amber-800"
                    >
                      {localizeRequiredDocumentLabel(item.key, item.label, l)}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="rounded-2xl border border-white/60 bg-white/70 px-4 py-2 text-sm text-slate-700">
              {l("Erfüllt", "Выполнено", "Fulfilled")}:{" "}
              <span className="font-semibold text-slate-950">
                {documentAlerts.required_documents.filter((item) => item.fulfilled).length}/
                {documentAlerts.configured_rule_count}
              </span>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.9fr]">
        <section className="space-y-4">
          <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{l("Für mich freigegeben", "Опубликовано для меня", "Released to me")}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {l("Hier sind nur Dateien sichtbar, die von Ihrem Betreuungsteam ausdrücklich freigegeben wurden.", "Здесь видны только файлы, которые команда сопровождения явно опубликовала для вас.", "Only files explicitly released by your care team are visible here.")}
                </p>
              </div>
            </div>
          </div>

          {documents.length === 0 ? (
            <section className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
              <p className="text-base font-semibold text-slate-950">{l("Noch keine Dokumente freigegeben", "Документы пока не опубликованы", "No documents released yet")}</p>
              <p className="mt-2 text-sm text-slate-500">
                {l("Ihr Betreuungsteam veröffentlicht Dateien hier, sobald sie für den Portalzugang freigegeben sind.", "Команда сопровождения опубликует здесь файлы, как только они будут допущены к доступу через портал.", "Your care team will publish files here once they are cleared for portal access.")}
              </p>
            </section>
          ) : (
            documents.map((item) => {
              const busy = busyId === item.id;

              return (
                <article
                  key={item.id}
                  className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={cn("rounded-full", documentTone(item))}>
                          {item.confirmed ? l("Bestätigt", "Подтверждено", "Confirmed") : item.requires_confirmation ? l("Bestätigung erforderlich", "Требуется подтверждение", "Needs confirmation") : l("Freigegeben", "Опубликовано", "Released")}
                        </Badge>
                        <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-600">
                          {portalStatusLabel(item.status)}
                        </Badge>
                      </div>
                      <h2 className="mt-3 text-xl font-semibold text-slate-950">{item.auto_name}</h2>
                      <p className="mt-2 text-sm text-slate-500">
                        {[item.art, item.category, formatPortalFileSize(item.file_size)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {item.requires_confirmation && !item.confirmed ? (
                      <ShieldCheck className="size-5 text-amber-500" />
                    ) : null}
                  </div>

                  <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                    <Detail label={l("Freigegeben von", "Опубликовано", "Released by")} value={item.shared_by_name || l("Betreuungsteam", "Команда сопровождения", "Care team")} />
                    <Detail label={l("Freigegeben am", "Опубликовано", "Released at")} value={formatPortalDateTime(item.shared_at)} />
                    <Detail label={l("Dateiname", "Имя файла", "Filename")} value={item.original_filename || item.auto_name} />
                    <Detail label={l("Quelle", "Источник", "Source")} value={item.ursprung || item.klinik || l("Portalfreigabe", "Публикация в портале", "Portal release")} />
                  </dl>

                  {item.notes ? (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      {item.notes}
                    </div>
                  ) : null}

                  <div className="mt-5 flex flex-wrap gap-3">
                    <Button
                      className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                      disabled={busy}
                      onClick={() => void handleDownload(item)}
                    >
                      {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                      {l("Herunterladen", "Скачать", "Download")}
                    </Button>
                    {item.requires_confirmation && !item.confirmed ? (
                      <Button
                        variant="outline"
                        className="rounded-2xl"
                        disabled={busy}
                        onClick={() => void handleConfirm(item.id)}
                      >
                        {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        {l("Empfang bestätigen", "Подтвердить получение", "Confirm receipt")}
                      </Button>
                    ) : null}
                  </div>
                </article>
              );
            })
          )}
        </section>

        <section className="space-y-4">
          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{l("Dokumente hochladen", "Загрузить документы", "Upload documents")}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {l("Senden Sie Dateien an das Betreuungsteam. Zahlungsnachweise bleiben intern und können im Rechnungsbereich hochgeladen werden.", "Отправляйте файлы команде сопровождения. Подтверждения оплаты остаются внутренними и загружаются из раздела счетов.", "Send files to the care team. Payment proofs stay internal and can be uploaded from the invoice workspace.")}
                </p>
              </div>
              <Upload className="mt-1 size-5 text-sky-700" />
            </div>
            <form className="mt-5 space-y-4" onSubmit={(event) => void handleUpload(event)}>
              <Field label={l("Upload-Typ", "Тип загрузки", "Upload type")}>
                <NativeComboboxSelect
                  value={uploadKind}
                  onChange={(event) => setUploadKind(event.target.value)}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                >
                  <option value="general">{l("Allgemein", "Общий", "General")}</option>
                  <option value="medical_record">{l("Medizinischer Befund", "Медицинский документ", "Medical record")}</option>
                  <option value="insurance_document">{l("Versicherungsdokument", "Страховой документ", "Insurance document")}</option>
                </NativeComboboxSelect>
              </Field>
              <Field label={l("Titel", "Название", "Title")}>
                <input
                  value={uploadName}
                  onChange={(event) => setUploadName(event.target.value)}
                  placeholder={l("Optionaler Titel", "Необязательное название", "Optional title")}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                />
              </Field>
              <Field label={l("Datei", "Файл", "File")}>
                <input
                  type="file"
                  onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                  className="block w-full rounded-2xl border border-slate-200 bg-card px-3 py-2 text-sm text-foreground"
                />
              </Field>
              <Field label={l("Notiz", "Заметка", "Note")}>
                <textarea
                  value={uploadNotes}
                  onChange={(event) => setUploadNotes(event.target.value)}
                  placeholder={l("Optionaler Kontext für das Betreuungsteam", "Необязательный контекст для команды сопровождения", "Optional context for the care team")}
                  className="min-h-[110px] w-full rounded-2xl border border-slate-200 bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                />
              </Field>
              {uploadError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {uploadError}
                </div>
              ) : null}
              <Button
                type="submit"
                className="w-full rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                disabled={uploadBusy}
              >
                {uploadBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {l("Upload senden", "Отправить загрузку", "Send upload")}
              </Button>
            </form>
          </section>

          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{l("Meine Uploads", "Мои загрузки", "My uploads")}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {l("Dateien, die Sie bereits aus dem Portal gesendet haben.", "Файлы, которые вы уже отправили из портала.", "Files you already sent from the portal.")}
              </p>
            </div>
            <div className="mt-5 space-y-3">
              {uploads.length === 0 ? (
                <div className="rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-sm text-slate-500">
                  {l("Noch keine Portal-Uploads.", "Пока нет загрузок из портала.", "No portal uploads yet.")}
                </div>
              ) : (
                uploads.map((item) => {
                  const busy = busyId === item.id;

                  return (
                    <article key={item.id} className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline" className={cn("rounded-full", uploadedDocumentTone(item))}>
                              {item.art.replaceAll("_", " ")}
                            </Badge>
                          </div>
                          <p className="mt-3 text-sm font-semibold text-slate-950">{item.auto_name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {[item.order_number, item.appointment_title, formatPortalFileSize(item.file_size)].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          className="rounded-2xl"
                          disabled={busy}
                          onClick={() => void handleUploadDownload(item)}
                        >
                          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                          {l("Herunterladen", "Скачать", "Download")}
                        </Button>
                      </div>
                      <p className="mt-3 text-xs text-slate-500">
                        {l("Hochgeladen", "Загружено", "Uploaded")} {formatPortalDateTime(item.created_at)}
                      </p>
                      {item.notes ? (
                        <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                          {item.notes}
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </section>
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm text-slate-900">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
        {label}
      </span>
      {children}
    </label>
  );
}
