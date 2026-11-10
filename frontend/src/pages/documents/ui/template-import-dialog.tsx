import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { CircleAlert, CircleCheck, Eye, FileUp, LoaderCircle } from "lucide-react";

import { AdminSheetScaffold } from "@/components/admin-page-patterns";
import {
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/ui-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { FilePicker } from "@/components/ui/file-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ApiRequestError } from "@/lib/api";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { useLang, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  TEMPLATE_IMPORT_ACCEPT,
  activateImportedTemplate,
  createImportedTemplatePreviewUrl,
  disableImportedTemplate,
  fetchImportedTemplates,
  importTemplateFile,
  isTemplateImportFileName,
  templateLabelFromFileName,
  updateImportedTemplate,
  type ImportedTemplate,
  type ImportedTemplateVariable,
} from "../data/template-import-api";

/**
 * Import of the agency's own document templates on the documents page (owner
 * request 2026-11-10): choose a Word or text file, see the variable check
 * and the preview, activate it — then it is offered in "generate from
 * template". The built-in legal templates are not replaced here.
 */

const TEMPLATE_LANGUAGES = ["de", "en", "uk", "ru"] as const;

const LANGUAGE_LABELS: Record<string, { de: string; ru: string }> = {
  de: { de: "Deutsch", ru: "Немецкий" },
  en: { de: "Englisch", ru: "Английский" },
  uk: { de: "Ukrainisch", ru: "Украинский" },
  ru: { de: "Russisch", ru: "Русский" },
};

/** What each `{{variable}}` stands for; keys mirror the server catalog. */
const VARIABLE_LABELS: Record<string, { de: string; ru: string }> = {
  patient_id: { de: "Patientennummer", ru: "Номер пациента" },
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
    intro: ru
      ? "Загрузите файл Word (.docx) или текстовый файл (.txt). Из файла берётся текст; документ печатается на фирменном бланке GMED. Оформление Word (таблицы, шрифты, картинки) не переносится."
      : "Laden Sie eine Word-Datei (.docx) oder Textdatei (.txt) hoch. Übernommen wird der Text; das Dokument wird auf dem GMED-Briefbogen gedruckt. Die Word-Gestaltung (Tabellen, Schriften, Bilder) wird nicht übernommen.",
    legalNote: ru
      ? "Встроенные юридические шаблоны (договор, согласия, GwG, смета) импортом не заменяются."
      : "Die eingebauten rechtlichen Vorlagen (Vertrag, Einwilligungen, GwG, Kostenvoranschlag) werden durch den Import nicht ersetzt.",
    file: ru ? "Файл шаблона" : "Vorlagendatei",
    name: ru ? "Название шаблона" : "Name der Vorlage",
    description: ru ? "Описание" : "Beschreibung",
    language: ru ? "Язык шаблона" : "Sprache der Vorlage",
    importAction: ru ? "Импортировать" : "Importieren",
    importing: ru ? "Импорт…" : "Import…",
    newVersionOf: ru ? "Новая версия шаблона" : "Neue Version der Vorlage",
    cancelNewVersion: ru ? "Отменить" : "Abbrechen",
    wrongFile: ru
      ? "Подходит только файл Word (.docx) или текстовый файл (.txt)."
      : "Nur eine Word-Datei (.docx) oder Textdatei (.txt) ist möglich.",
    chooseFile: ru ? "Выберите файл шаблона." : "Wählen Sie eine Vorlagendatei.",
    list: ru ? "Импортированные шаблоны" : "Importierte Vorlagen",
    empty: ru ? "Импортированных шаблонов пока нет." : "Noch keine importierten Vorlagen.",
    loadFailed: ru ? "Не удалось загрузить шаблоны." : "Vorlagen konnten nicht geladen werden.",
    failed: ru ? "Не удалось выполнить действие." : "Die Aktion ist fehlgeschlagen.",
    version: ru ? "версия" : "Version",
    status: {
      draft: ru ? "Черновик" : "Entwurf",
      active: ru ? "Активен" : "Aktiv",
      disabled: ru ? "Отключён" : "Deaktiviert",
    },
    open: ru ? "Открыть" : "Öffnen",
    checkOk: ru
      ? "Переменные проверены: все известны."
      : "Variablen geprüft: alle bekannt.",
    checkNone: ru
      ? "В тексте нет переменных — документ будет одинаковым для всех пациентов."
      : "Der Text enthält keine Variablen – das Dokument ist für alle Patienten gleich.",
    unknown: ru
      ? "Неизвестные переменные — исправьте их в тексте, иначе шаблон нельзя активировать:"
      : "Unbekannte Variablen – bitte im Text korrigieren, sonst kann die Vorlage nicht aktiviert werden:",
    unclosed: ru
      ? "В тексте есть «{{» без закрывающих «}}»."
      : "Im Text steht ein „{{“ ohne schließendes „}}“.",
    used: ru ? "Используются" : "Verwendet",
    text: ru ? "Текст шаблона" : "Text der Vorlage",
    textReadOnly: ru
      ? "Текст активированной версии не меняется. Чтобы изменить его, загрузите новую версию."
      : "Der Text einer aktivierten Version wird nicht geändert. Laden Sie dafür eine neue Version hoch.",
    saveText: ru ? "Сохранить изменения" : "Änderungen speichern",
    saved: ru ? "Изменения сохранены." : "Änderungen gespeichert.",
    sample: ru ? "Пример с тестовыми данными" : "Beispiel mit Testdaten",
    pdfPreview: ru ? "Просмотр PDF" : "PDF-Vorschau",
    activate: ru ? "Активировать" : "Aktivieren",
    activateHint: ru
      ? "После активации шаблон появится в «Сгенерировать из шаблона»."
      : "Nach der Aktivierung erscheint die Vorlage unter „Aus Vorlage generieren“.",
    activated: ru
      ? "Шаблон активирован и доступен в «Сгенерировать из шаблона»."
      : "Die Vorlage ist aktiviert und unter „Aus Vorlage generieren“ verfügbar.",
    disable: ru ? "Отключить" : "Deaktivieren",
    discard: ru ? "Удалить черновик" : "Entwurf verwerfen",
    disabledNotice: ru
      ? "Шаблон отключён. Уже созданные документы не изменились."
      : "Die Vorlage ist deaktiviert. Bereits erzeugte Dokumente bleiben unverändert.",
    uploadNewVersion: ru ? "Загрузить новую версию" : "Neue Version hochladen",
    imported: ru
      ? "Файл импортирован как черновик. Проверьте переменные и просмотр, затем активируйте."
      : "Die Datei wurde als Entwurf importiert. Prüfen Sie Variablen und Vorschau und aktivieren Sie dann.",
    unsaved: ru
      ? "Сначала сохраните изменения текста."
      : "Speichern Sie zuerst die Textänderungen.",
    variables: ru ? "Доступные переменные" : "Verfügbare Variablen",
    variablesHint: ru
      ? "Пишите переменную в тексте в двойных фигурных скобках, например {{patient_name}}."
      : "Schreiben Sie die Variable im Text in doppelten geschweiften Klammern, z. B. {{patient_name}}.",
    close: ru ? "Закрыть" : "Schließen",
    importedBy: ru ? "Импортировал(а)" : "Importiert von",
  };
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError && error.message.trim()) return error.message;
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
  /** An activation or a disabling changed what "generate from template" offers. */
  onCatalogChanged: () => void;
}) {
  const { lang } = useLang();
  const tx = texts(lang);
  const language = lang === "de" ? "de" : "ru";

  const [templates, setTemplates] = useState<ImportedTemplate[]>([]);
  const [variables, setVariables] = useState<ImportedTemplateVariable[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [templateLanguage, setTemplateLanguage] = useState<string>("de");
  const [newVersionOf, setNewVersionOf] = useState<ImportedTemplate | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const selected = templates.find((template) => template.id === selectedId) ?? null;
  const dirty = Boolean(
    selected &&
      selected.status === "draft" &&
      (draftBody !== selected.body || draftLabel.trim() !== selected.label),
  );

  const dropPreview = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
  }, []);

  const select = useCallback(
    (template: ImportedTemplate | null) => {
      dropPreview();
      setSelectedId(template?.id ?? null);
      setDraftBody(template?.body ?? "");
      setDraftLabel(template?.label ?? "");
    },
    [dropPreview],
  );

  const applyTemplate = useCallback(
    (template: ImportedTemplate) => {
      setTemplates((current) =>
        current.some((item) => item.id === template.id)
          ? current.map((item) => (item.id === template.id ? template : item))
          : [template, ...current],
      );
      select(template);
    },
    [select],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchImportedTemplates();
      setTemplates(response.templates);
      setVariables(response.variables);
    } catch (nextError) {
      setError(errorMessage(nextError, texts(lang).loadFailed));
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    if (!open) return;
    setError("");
    setNotice("");
    setFile(null);
    setLabel("");
    setDescription("");
    setNewVersionOf(null);
    select(null);
    void reload();
  }, [open, reload, select]);

  useEffect(() => dropPreview, [dropPreview]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setError("");
    if (next && !isTemplateImportFileName(next.name)) {
      setFile(null);
      setError(tx.wrongFile);
      return;
    }
    setFile(next);
    if (next && !label.trim() && !newVersionOf) {
      setLabel(templateLabelFromFileName(next.name));
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (nextError) {
      setError(errorMessage(nextError, tx.failed));
    } finally {
      setBusy(false);
    }
  }

  function handleImport() {
    if (!file) {
      setError(tx.chooseFile);
      return;
    }
    void run(async () => {
      const response = await importTemplateFile({
        file,
        label,
        description,
        language: templateLanguage,
        familyId: newVersionOf?.family_id ?? null,
      });
      applyTemplate(response.template);
      setFile(null);
      setLabel("");
      setDescription("");
      setNewVersionOf(null);
      setNotice(tx.imported);
    });
  }

  function handleSave() {
    if (!selected) return;
    void run(async () => {
      const response = await updateImportedTemplate(selected.id, {
        label: draftLabel,
        body: draftBody,
      });
      applyTemplate(response.template);
      setNotice(tx.saved);
    });
  }

  function handleActivate() {
    if (!selected) return;
    if (dirty) {
      setError(tx.unsaved);
      return;
    }
    void run(async () => {
      await activateImportedTemplate(selected.id);
      // The version that was active before steps back: reload the list.
      await reload();
      onCatalogChanged();
      setNotice(tx.activated);
    });
  }

  function handleDisable() {
    if (!selected) return;
    void run(async () => {
      const response = await disableImportedTemplate(selected.id);
      applyTemplate(response.template);
      onCatalogChanged();
      setNotice(tx.disabledNotice);
    });
  }

  function handlePdfPreview() {
    if (!selected) return;
    if (dirty) {
      setError(tx.unsaved);
      return;
    }
    void run(async () => {
      dropPreview();
      const url = await createImportedTemplatePreviewUrl(selected.id);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    });
  }

  function startNewVersion(template: ImportedTemplate) {
    setNewVersionOf(template);
    setLabel("");
    setTemplateLanguage(template.language);
    setFile(null);
    setError("");
    setNotice("");
  }

  const variableLabel = (key: string) => VARIABLE_LABELS[key]?.[language] ?? key;
  const languageLabel = (code: string) => LANGUAGE_LABELS[code]?.[language] ?? code;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[860px]">
        <AdminSheetScaffold
          title={tx.title}
          footer={(
            <div className="flex shrink-0 justify-end border-t border-border bg-popover px-4 py-3">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tx.close}
              </Button>
            </div>
          )}
        >
          <div className="space-y-5" data-testid="template-import-dialog">
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>{tx.intro}</p>
              <p>{tx.legalNote}</p>
            </div>
            {error ? <Notice tone="error">{error}</Notice> : null}
            {notice ? <Notice tone="success">{notice}</Notice> : null}

            <section className="space-y-3 rounded-xl border border-border p-4">
              {newVersionOf ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <span className="text-muted-foreground">{tx.newVersionOf}: </span>
                    <span className="font-medium">{newVersionOf.label}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setNewVersionOf(null)}
                  >
                    {tx.cancelNewVersion}
                  </Button>
                </div>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <Label htmlFor="template-import-file" className={fieldLabelClass}>
                    {tx.file}
                  </Label>
                  <FilePicker
                    id="template-import-file"
                    accept={TEMPLATE_IMPORT_ACCEPT}
                    selected={file}
                    onChange={handleFileChange}
                    disabled={busy}
                  />
                </div>
                {!newVersionOf ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="template-import-label" className={fieldLabelClass}>
                      {tx.name}
                    </Label>
                    <Input
                      id="template-import-label"
                      value={label}
                      maxLength={200}
                      onChange={(event) => setLabel(event.target.value)}
                      className={inputClass}
                    />
                  </div>
                ) : null}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="template-import-language" className={fieldLabelClass}>
                    {tx.language}
                  </Label>
                  <NativeComboboxSelect
                    id="template-import-language"
                    value={templateLanguage}
                    onChange={(event) => setTemplateLanguage(event.target.value)}
                    className={selectClass}
                  >
                    {TEMPLATE_LANGUAGES.map((code) => (
                      <option key={code} value={code}>
                        {languageLabel(code)}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                </div>
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <Label htmlFor="template-import-description" className={fieldLabelClass}>
                    {tx.description}
                  </Label>
                  <Input
                    id="template-import-description"
                    value={description}
                    maxLength={1000}
                    onChange={(event) => setDescription(event.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={handleImport} disabled={busy || !file} className="gap-1.5">
                  {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileUp className="size-3.5" />}
                  {busy ? tx.importing : tx.importAction}
                </Button>
              </div>
            </section>

            {selected ? (
              <section
                className="space-y-4 rounded-xl border border-border p-4"
                data-testid="template-import-selected"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{selected.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {tx.version} {selected.version_number} · {languageLabel(selected.language)}
                      {selected.source_filename ? ` · ${selected.source_filename}` : ""}
                      {selected.created_by_name
                        ? ` · ${tx.importedBy}: ${selected.created_by_name}`
                        : ""}
                      {selected.created_at ? `, ${formatAppDateTime(selected.created_at)}` : ""}
                    </p>
                  </div>
                  <Badge variant="outline" className={statusTone(selected.status)}>
                    {tx.status[selected.status]}
                  </Badge>
                </div>

                {selected.unknown_variables.length > 0 || selected.unclosed_variable ? (
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
                ) : (
                  <Notice tone="success">
                    <span className="flex items-start gap-2">
                      <CircleCheck className="mt-0.5 size-4 shrink-0" />
                      <span>
                        {selected.used_variables.length > 0 ? tx.checkOk : tx.checkNone}
                        {selected.used_variables.length > 0 ? (
                          <span className="block text-xs">
                            {tx.used}:{" "}
                            {selected.used_variables.map(variableLabel).join(", ")}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </Notice>
                )}

                {selected.status === "draft" ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="template-import-draft-label" className={fieldLabelClass}>
                      {tx.name}
                    </Label>
                    <Input
                      id="template-import-draft-label"
                      value={draftLabel}
                      maxLength={200}
                      onChange={(event) => setDraftLabel(event.target.value)}
                      className={inputClass}
                    />
                  </div>
                ) : null}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="template-import-body" className={fieldLabelClass}>
                    {tx.text}
                  </Label>
                  <textarea
                    id="template-import-body"
                    value={draftBody}
                    readOnly={selected.status !== "draft"}
                    onChange={(event) => setDraftBody(event.target.value)}
                    className={cn(textareaClass, "min-h-[220px] font-mono text-[12.5px] leading-relaxed")}
                  />
                  {selected.status !== "draft" ? (
                    <p className="text-xs text-muted-foreground">{tx.textReadOnly}</p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className={fieldLabelClass}>{tx.sample}</span>
                  <div
                    className="max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
                    data-testid="template-import-sample"
                  >
                    {selected.preview_text}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {selected.status === "draft" ? (
                    <Button type="button" variant="outline" onClick={handleSave} disabled={busy || !dirty}>
                      {tx.saveText}
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" onClick={handlePdfPreview} disabled={busy} className="gap-1.5">
                    <Eye className="size-3.5" />
                    {tx.pdfPreview}
                  </Button>
                  {selected.status !== "active" ? (
                    <Button
                      type="button"
                      onClick={handleActivate}
                      disabled={busy || !selected.can_activate}
                      title={tx.activateHint}
                    >
                      {tx.activate}
                    </Button>
                  ) : null}
                  {selected.status !== "disabled" ? (
                    <Button type="button" variant="ghost" onClick={handleDisable} disabled={busy}>
                      {selected.status === "draft" ? tx.discard : tx.disable}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => startNewVersion(selected)}
                    disabled={busy}
                  >
                    {tx.uploadNewVersion}
                  </Button>
                </div>
                {selected.status !== "active" ? (
                  <p className="text-xs text-muted-foreground">{tx.activateHint}</p>
                ) : null}
                {previewUrl ? (
                  <iframe
                    title={tx.pdfPreview}
                    src={previewUrl}
                    className="h-[560px] w-full rounded-lg border border-border bg-white"
                  />
                ) : null}
              </section>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{tx.list}</h3>
              {loading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                </p>
              ) : templates.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tx.empty}</p>
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {templates.map((template) => (
                    <li
                      key={template.id}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm",
                        template.id === selectedId ? "bg-muted/50" : "",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{template.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {tx.version} {template.version_number} · {languageLabel(template.language)}
                          {template.created_at ? ` · ${formatAppDateTime(template.created_at)}` : ""}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge variant="outline" className={statusTone(template.status)}>
                          {tx.status[template.status]}
                        </Badge>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setError("");
                            setNotice("");
                            select(template);
                          }}
                        >
                          {tx.open}
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <details className="rounded-xl border border-border p-4 text-sm">
              <summary className="cursor-pointer font-semibold">{tx.variables}</summary>
              <p className="mt-2 text-muted-foreground">{tx.variablesHint}</p>
              <ul className="mt-3 grid gap-x-6 gap-y-1 md:grid-cols-2">
                {variables.map((variable) => (
                  <li key={variable.key} className="flex items-baseline justify-between gap-3">
                    <code className="font-mono text-[12.5px]">{`{{${variable.key}}}`}</code>
                    <span className="text-right text-muted-foreground">
                      {variableLabel(variable.key)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </AdminSheetScaffold>
      </SheetContent>
    </Sheet>
  );
}
