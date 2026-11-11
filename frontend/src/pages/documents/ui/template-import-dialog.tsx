import { HeadingMarker, SectionHeading } from "@/components/ui/section-heading";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  Braces,
  ChevronDown,
  CircleAlert,
  FileInput,
  FilePenLine,
  FileSearch,
  Files,
  FileText,
  LayoutTemplate,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";

import { AdminDialogScaffold, AdminFormSection } from "@/components/admin-dialog-scaffold";
import { inputClass } from "@/components/ui-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilePicker } from "@/components/ui/file-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import { ApiRequestError, isLocalizedApiError } from "@/lib/api";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { useLang, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  TEMPLATE_IMPORT_ACCEPT,
  activateImportedTemplate,
  fetchImportedTemplatePreviewPdf,
  disableImportedTemplate,
  fetchImportedTemplates,
  importTemplateFile,
  isTemplateImportFileName,
  templateLabelFromFileName,
  updateImportedTemplate,
  type ImportedTemplate,
  type ImportedTemplateVariable,
} from "../data/template-import-api";
import { PdfPagesPreview } from "./pdf-pages-preview";

/**
 * Import of the agency's own document templates on the documents page.
 *
 * The owner's wish of 2026-11-10: "I write something in Word, upload it and
 * it simply looks like that, plus the frames at the top and the bottom." So
 * the dialog is: choose the file → see the finished page on the GMED
 * letterhead → save. The fields that fill in patient data (`{{…}}`) stay
 * possible but out of the way, in a collapsed block.
 */

const FILE_INPUT_ID = "template-import-file";

/** What each `{{field}}` stands for; keys mirror the server catalog. */
const VARIABLE_LABELS: Record<string, { de: string; ru: string }> = {
  patient_id: { de: "Patientennummer", ru: "Номер пациента" },
  lead_number: { de: "Anfragenummer (Lead)", ru: "Номер обращения (лид)" },
  patient_name: { de: "Vor- und Nachname", ru: "Имя и фамилия" },
  patient_first_name: { de: "Vorname", ru: "Имя" },
  patient_last_name: { de: "Nachname", ru: "Фамилия" },
  patient_title: { de: "Titel", ru: "Титул" },
  birth_date: { de: "Geburtsdatum", ru: "Дата рождения" },
  patient_street: { de: "Straße und Hausnummer", ru: "Улица и дом" },
  patient_zip: { de: "Postleitzahl", ru: "Почтовый индекс" },
  patient_city: { de: "Ort", ru: "Город" },
  patient_country: { de: "Land", ru: "Страна" },
  patient_email: { de: "E-Mail", ru: "E-mail" },
  patient_phone: { de: "Telefon", ru: "Телефон" },
  order_number: { de: "Auftragsnummer", ru: "Номер заказа" },
  appointment_title: { de: "Termin: Bezeichnung", ru: "Приём: название" },
  appointment_date: { de: "Termin: Datum", ru: "Приём: дата" },
  appointment_time: { de: "Termin: Uhrzeit", ru: "Приём: время" },
  appointment_location: { de: "Termin: Ort", ru: "Приём: место" },
  provider_name: { de: "Termin: Klinik", ru: "Приём: клиника" },
  doctor_name: { de: "Termin: Arzt", ru: "Приём: врач" },
  today: { de: "Heutiges Datum", ru: "Сегодняшняя дата" },
};

function texts(lang: Lang) {
  const ru = lang === "ru";
  return {
    title: ru ? "Импорт шаблона" : "Vorlage importieren",
    file: ru ? "Файл Word" : "Word-Datei",
    intro: ru
      ? "Выберите файл Word (.docx). Документ будет выглядеть как в Word; сверху и снизу добавятся шапка и подвал GMED."
      : "Wählen Sie eine Word-Datei (.docx). Das Dokument sieht aus wie in Word; oben und unten kommen Kopf- und Fußzeile von GMED hinzu.",
    replacing: ru ? "Новый файл для шаблона" : "Neue Datei für die Vorlage",
    cancelReplace: ru ? "Отменить" : "Abbrechen",
    uploading: ru ? "Файл загружается…" : "Die Datei wird hochgeladen…",
    wrongFile: ru
      ? "Подходит только файл Word (.docx) или текстовый файл (.txt)."
      : "Nur eine Word-Datei (.docx) oder Textdatei (.txt) ist möglich.",
    name: ru ? "Название шаблона" : "Name der Vorlage",
    preview: ru ? "Так будет выглядеть документ" : "So sieht das Dokument aus",
    previewLoading: ru ? "Готовим просмотр…" : "Die Vorschau wird erstellt…",
    previewFailed: ru
      ? "Не удалось показать документ."
      : "Das Dokument konnte nicht angezeigt werden.",
    pdfPage: ru ? "Страница" : "Seite",
    unknown: ru
      ? "В файле есть неизвестные поля. Исправьте их в Word и загрузите файл снова:"
      : "Die Datei enthält unbekannte Felder. Korrigieren Sie sie in Word und laden Sie die Datei erneut hoch:",
    unclosed: ru
      ? "В файле есть «{{» без закрывающих «}}». Исправьте в Word и загрузите файл снова."
      : "Die Datei enthält ein „{{“ ohne schließendes „}}“. Korrigieren Sie es in Word und laden Sie die Datei erneut hoch.",
    textOnly: ru
      ? "На этом сервере нет LibreOffice, поэтому документ показан упрощённо: только текст на бланке."
      : "Auf diesem Server fehlt LibreOffice, daher wird das Dokument vereinfacht gezeigt: nur Text auf dem Briefbogen.",
    save: ru ? "Сохранить шаблон" : "Vorlage speichern",
    saving: ru ? "Сохраняем…" : "Wird gespeichert…",
    discard: ru ? "Отменить" : "Verwerfen",
    disable: ru ? "Отключить" : "Deaktivieren",
    enable: ru ? "Включить снова" : "Wieder aktivieren",
    replace: ru ? "Заменить файлом" : "Datei ersetzen",
    close: ru ? "Закрыть" : "Schließen",
    saved: ru
      ? "Шаблон сохранён и доступен в «Сгенерировать из шаблона»."
      : "Die Vorlage ist gespeichert und unter „Aus Vorlage generieren“ verfügbar.",
    discarded: ru ? "Файл не сохранён." : "Die Datei wurde nicht gespeichert.",
    disabledNotice: ru
      ? "Шаблон отключён. Уже созданные документы не изменились."
      : "Die Vorlage ist deaktiviert. Bereits erzeugte Dokumente bleiben unverändert.",
    list: ru ? "Сохранённые шаблоны" : "Gespeicherte Vorlagen",
    empty: ru ? "Шаблонов пока нет." : "Noch keine Vorlagen.",
    loadFailed: ru ? "Не удалось загрузить шаблоны." : "Vorlagen konnten nicht geladen werden.",
    retry: ru ? "Повторить" : "Erneut laden",
    damagedFile: ru
      ? "Файл повреждён или это не настоящий файл Word. Сохраните документ в Word заново как .docx и загрузите его ещё раз."
      : "Die Datei ist beschädigt oder keine echte Word-Datei. Speichern Sie das Dokument in Word erneut als .docx und laden Sie es noch einmal hoch.",
    importFailed: ru ? "Не удалось загрузить файл." : "Die Datei konnte nicht hochgeladen werden.",
    saveFailed: ru ? "Не удалось сохранить шаблон." : "Die Vorlage konnte nicht gespeichert werden.",
    disableFailed: ru ? "Не удалось отключить шаблон." : "Die Vorlage konnte nicht deaktiviert werden.",
    version: ru ? "версия" : "Version",
    status: {
      draft: ru ? "Не сохранён" : "Nicht gespeichert",
      active: ru ? "Активен" : "Aktiv",
      disabled: ru ? "Отключён" : "Deaktiviert",
    },
    variables: ru
      ? "Автоподстановка данных пациента (необязательно)"
      : "Patientendaten automatisch einsetzen (optional)",
    variablesHint: ru
      ? "Если в документе нужно имя пациента, дата или номер заказа, напишите в Word поле в двойных фигурных скобках, например {{patient_name}}. При создании документа оно заменится данными."
      : "Wenn das Dokument den Namen des Patienten, ein Datum oder die Auftragsnummer braucht, schreiben Sie in Word ein Feld in doppelten geschweiften Klammern, z. B. {{patient_name}}. Beim Erzeugen wird es durch die Daten ersetzt.",
  };
}

/** The server's file check refuses content that is not what its name says
 * (a damaged .docx): it answers in English, the dialog says it in words. */
const FILE_CONTENT_MISMATCH = "Uploaded file content does not match the declared MIME type or filename extension";

function errorMessage(error: unknown, fallback: string, damagedFile?: string) {
  if (damagedFile && error instanceof Error && error.message.includes(FILE_CONTENT_MISMATCH)) {
    return damagedFile;
  }
  if (isLocalizedApiError(error)) return error.message;
  if (error instanceof ApiRequestError && (error.body?.message?.trim() || !error.status)) {
    return error.message.trim() || fallback;
  }
  return fallback;
}

function statusTone(status: ImportedTemplate["status"]) {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "draft") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-border bg-muted text-muted-foreground";
}

function Notice({ tone, children }: { tone: "error" | "success" | "warning"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
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

const fieldLabelClass = "text-[11.5px] font-medium text-muted-foreground leading-tight";

export function TemplateImportDialog({
  open,
  onOpenChange,
  onCatalogChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A saved or disabled template changed what "generate from template" offers. */
  onCatalogChanged: () => void;
}) {
  const { lang } = useLang();
  const tx = texts(lang);
  const language = lang === "de" ? "de" : "ru";

  const [templates, setTemplates] = useState<ImportedTemplate[]>([]);
  const [variables, setVariables] = useState<ImportedTemplateVariable[]>([]);
  const [exactLayoutAvailable, setExactLayoutAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const listRequest = useRef(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"" | "upload" | "save" | "other">("");

  /** The saved template a newly chosen file replaces (a new version of it). */
  const [replaceTarget, setReplaceTarget] = useState<ImportedTemplate | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [previewPdf, setPreviewPdf] = useState<ArrayBuffer | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "failed">("idle");
  const previewRequest = useRef(0);

  const selected = templates.find((template) => template.id === selectedId) ?? null;

  const loadPreview = useCallback(async (templateId: string | null) => {
    const request = ++previewRequest.current;
    setPreviewPdf(null);
    if (!templateId) {
      setPreviewState("idle");
      return;
    }
    setPreviewState("loading");
    try {
      const pdf = await fetchImportedTemplatePreviewPdf(templateId);
      if (request !== previewRequest.current) return;
      setPreviewPdf(pdf);
      setPreviewState("idle");
    } catch {
      if (request === previewRequest.current) setPreviewState("failed");
    }
  }, []);

  const select = useCallback(
    (template: ImportedTemplate | null) => {
      setSelectedId(template?.id ?? null);
      setDraftLabel(template?.label ?? "");
      void loadPreview(template?.id ?? null);
    },
    [loadPreview],
  );

  const reload = useCallback(async () => {
    const request = ++listRequest.current;
    setListError("");
    setLoading(true);
    try {
      const response = await fetchImportedTemplates();
      if (request !== listRequest.current) return;
      setTemplates(response.templates);
      setVariables(response.variables);
      setExactLayoutAvailable(response.exact_layout_available !== false);
    } catch (nextError) {
      if (request === listRequest.current) {
        setListError(errorMessage(nextError, texts(lang).loadFailed));
      }
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    if (!open) return;
    setError("");
    setNotice("");
    setReplaceTarget(null);
    select(null);
    void reload();
    return () => {
      listRequest.current += 1;
    };
  }, [open, reload, select]);

  async function run(kind: "upload" | "save" | "other", failure: string, action: () => Promise<void>) {
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (nextError) {
      setError(errorMessage(nextError, failure, texts(lang).damagedFile));
    } finally {
      setBusy("");
    }
  }

  /** Choosing a file uploads it at once and shows how the document will look. */
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (!isTemplateImportFileName(file.name)) {
      setNotice("");
      setError(tx.wrongFile);
      return;
    }
    const target = replaceTarget;
    void run("upload", tx.importFailed, async () => {
      const response = await importTemplateFile({
        file,
        label: target ? "" : templateLabelFromFileName(file.name),
        description: "",
        language: target?.language ?? "de",
        familyId: target?.family_id ?? null,
      });
      setReplaceTarget(null);
      setTemplates((current) => [response.template, ...current]);
      select(response.template);
    });
  }

  function handleSave() {
    if (!selected) return;
    void run("save", tx.saveFailed, async () => {
      const label = draftLabel.trim();
      if (selected.status === "draft" && label && label !== selected.label) {
        await updateImportedTemplate(selected.id, { label });
      }
      await activateImportedTemplate(selected.id);
      // The version that was active before steps back: reload the list.
      await reload();
      onCatalogChanged();
      setNotice(tx.saved);
    });
  }

  function handleDisable() {
    if (!selected) return;
    const wasDraft = selected.status === "draft";
    void run("other", tx.disableFailed, async () => {
      await disableImportedTemplate(selected.id);
      await reload();
      if (wasDraft) {
        select(null);
        setNotice(tx.discarded);
      } else {
        onCatalogChanged();
        setNotice(tx.disabledNotice);
      }
    });
  }

  function handleReplace() {
    if (!selected) return;
    setReplaceTarget(selected);
    setError("");
    setNotice("");
    document.getElementById(FILE_INPUT_ID)?.click();
  }

  const variableLabel = (key: string) => VARIABLE_LABELS[key]?.[language] ?? key;
  const fieldsBroken = Boolean(
    selected && (selected.unknown_variables.length > 0 || selected.unclosed_variable),
  );
  // A discarded draft is of no further use: the list shows what was saved.
  const listed = templates.filter(
    (template) => template.status !== "disabled" || template.activated_at || template.id === selectedId,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AdminDialogScaffold
        icon={FileInput}
        title={tx.title}
        testId="template-import-dialog"
        maxWidthClassName="sm:w-[calc(100vw-2rem)] sm:max-w-3xl"
        footer={(
          <div className="flex flex-wrap justify-end gap-2 px-4 py-2.5">
            {selected?.status === "draft" ? (
              <>
                <Button type="button" size="sm" variant="outline" onClick={handleDisable} disabled={Boolean(busy)}>
                  {tx.discard}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSave}
                  disabled={Boolean(busy) || !selected.can_activate || !draftLabel.trim()}
                >
                  {busy === "save" ? <LoaderCircle className="animate-spin" /> : null}
                  {busy === "save" ? tx.saving : tx.save}
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                {tx.close}
              </Button>
            )}
          </div>
        )}
      >
        {error ? <Notice tone="error">{error}</Notice> : null}
        {notice ? <Notice tone="success">{notice}</Notice> : null}

        <AdminFormSection icon={FileText} title={tx.file}>
          {replaceTarget ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <span className="text-muted-foreground">{tx.replacing}: </span>
                <span className="font-medium">{replaceTarget.label}</span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setReplaceTarget(null)}>
                {tx.cancelReplace}
              </Button>
            </div>
          ) : null}
          <FilePicker
            id={FILE_INPUT_ID}
            aria-label={tx.file}
            accept={TEMPLATE_IMPORT_ACCEPT}
            showSelection={false}
            onChange={handleFileChange}
            disabled={Boolean(busy)}
            className="rounded-lg border border-dashed border-border bg-muted/30 p-2"
            buttonClassName="h-8"
          />
          <p className="text-xs leading-5 text-muted-foreground">
            {busy === "upload" ? (
              <span role="status" className="inline-flex items-center gap-2">
                <LoaderCircle className="size-3.5 animate-spin" />
                {tx.uploading}
              </span>
            ) : (
              tx.intro
            )}
          </p>
        </AdminFormSection>

        {selected ? (
          <section
            className="min-w-0 space-y-3 rounded-xl border border-border/50 bg-card p-3"
            data-testid="template-import-selected"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h3><SectionHeading icon={FilePenLine}>{selected.label}</SectionHeading></h3>
                <p className="wrap-anywhere text-xs text-muted-foreground">
                  {tx.version} {selected.version_number}
                  {selected.source_filename ? ` · ${selected.source_filename}` : ""}
                  {selected.created_at ? ` · ${formatAppDateTime(selected.created_at)}` : ""}
                </p>
              </div>
              <Badge variant="outline" className={statusTone(selected.status)}>
                {tx.status[selected.status]}
              </Badge>
            </div>

            {fieldsBroken ? (
              <Notice tone="error">
                <span className="flex items-start gap-2">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  <span className="space-y-1">
                    {selected.unknown_variables.length > 0 ? (
                      <span className="block">
                        {tx.unknown}{" "}
                        <span className="font-mono font-semibold">
                          {selected.unknown_variables.join(", ")}
                        </span>
                      </span>
                    ) : null}
                    {selected.unclosed_variable ? (
                      <span className="block">{tx.unclosed}</span>
                    ) : null}
                  </span>
                </span>
              </Notice>
            ) : null}
            {selected.exact_layout && !exactLayoutAvailable ? (
              <Notice tone="warning">{tx.textOnly}</Notice>
            ) : null}

            {selected.status === "draft" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="template-import-label" className={fieldLabelClass}>
                  {tx.name}
                </Label>
                <Input
                  id="template-import-label"
                  value={draftLabel}
                  maxLength={200}
                  onChange={(event) => setDraftLabel(event.target.value)}
                  className={inputClass}
                />
              </div>
            ) : null}

            <div className="space-y-1.5" data-testid="template-import-pdf">
              <h4><SectionHeading icon={FileSearch}>{tx.preview}</SectionHeading></h4>
              {previewPdf ? (
                <PdfPagesPreview
                  data={previewPdf}
                  pageLabel={tx.pdfPage}
                  failedLabel={tx.previewFailed}
                  className="max-h-[min(720px,62dvh)] overflow-y-auto rounded-lg border border-border bg-muted/40 p-3"
                />
              ) : (
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-8 text-center text-sm text-muted-foreground">
                  {previewState === "failed" ? (
                    <span role="alert" className="text-rose-700">{tx.previewFailed}</span>
                  ) : (
                    <span role="status" className="inline-flex items-center gap-2">
                      <LoaderCircle className="size-4 animate-spin" />
                      {tx.previewLoading}
                    </span>
                  )}
                </div>
              )}
            </div>

            {selected.status !== "draft" ? (
              <div className="flex flex-wrap items-center gap-2">
                {selected.status === "active" ? (
                  <Button type="button" size="sm" variant="outline" onClick={handleDisable} disabled={Boolean(busy)}>
                    {tx.disable}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleSave}
                    disabled={Boolean(busy) || !selected.can_activate}
                  >
                    {tx.enable}
                  </Button>
                )}
                <Button type="button" size="sm" variant="outline" onClick={handleReplace} disabled={Boolean(busy)}>
                  {tx.replace}
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}

        <AdminFormSection icon={Files} title={tx.list}>
          {listError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0 break-words text-destructive">{listError}</span>
              <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void reload()}>
                <RefreshCw />{tx.retry}
              </Button>
            </div>
          ) : loading && listed.length === 0 ? (
            <p role="status" className="text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
            </p>
          ) : listed.length === 0 ? (
            <p className="text-xs leading-5 text-muted-foreground">{tx.empty}</p>
          ) : null}
          {listed.length > 0 ? (
            <ul className="divide-y divide-border/60">
              {listed.map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    data-workspace-tab
                    aria-pressed={template.id === selectedId}
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-2.5 py-2 text-left text-sm"
                    onClick={() => {
                      setError("");
                      setNotice("");
                      select(template);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-medium text-foreground">
                        <LayoutTemplate aria-hidden="true" className="size-4 shrink-0" />
                        <span className="min-w-0 wrap-anywhere">{template.label}</span>
                        {template.id === selectedId && <HeadingMarker />}
                      </span>
                      <span className="block ps-6 text-xs font-normal text-muted-foreground">
                        {tx.version} {template.version_number}
                        {template.created_at ? ` · ${formatAppDateTime(template.created_at)}` : ""}
                      </span>
                    </span>
                    <Badge variant="outline" className={statusTone(template.status)}>
                      {tx.status[template.status]}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </AdminFormSection>

        <details className="group min-w-0 rounded-xl border border-border/50 bg-card text-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2.5 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <SectionHeading icon={Braces}>{tx.variables}</SectionHeading>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <p className="border-t border-border/60 px-3 pt-2 text-xs leading-5 text-muted-foreground">{tx.variablesHint}</p>
          <ul className="grid gap-x-4 gap-y-1 px-3 pb-3 pt-2 text-xs sm:grid-cols-2">
            {variables.map((variable) => (
              <li key={variable.key} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 rounded-md bg-muted/40 px-2 py-1">
                <code className="font-mono text-[12.5px]">{`{{${variable.key}}}`}</code>
                <span className="text-right text-muted-foreground">
                  {variableLabel(variable.key)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </AdminDialogScaffold>
    </Dialog>
  );
}
