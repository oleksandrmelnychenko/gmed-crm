import { useEffect, useRef, useState } from "react";
import { Download, Languages, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLang } from "@/lib/i18n";
import {
  createDocumentPreviewObjectUrl,
  createDocumentTranslation,
  downloadDocumentFile,
  fetchDocumentTranslations,
  fetchMachineTranslationCapability,
  previewDocumentTranslation,
  renderDocumentTranslationPdf,
  revokeDocumentPreviewObjectUrl,
} from "../data/document-api";
import type {
  DocumentTranslation,
  MachineTranslationCapability,
} from "../model/types";
import { RichMarkupEditor } from "./rich-markup-editor";

const TARGET_LANGUAGES = ["de", "ru", "uk", "en"] as const;
const SOURCE_LANGUAGES = ["de", "ru", "uk", "en"] as const;

const LANGUAGE_LABELS: Record<string, { ru: string; de: string }> = {
  de: { ru: "Немецкий", de: "Deutsch" },
  ru: { ru: "Русский", de: "Russisch" },
  uk: { ru: "Украинский", de: "Ukrainisch" },
  en: { ru: "Английский", de: "Englisch" },
};

export function documentTranslationLanguageLabel(language: string | null | undefined, lang: string) {
  if (!language) return lang === "de" ? "automatisch" : "автоматически";
  const entry = LANGUAGE_LABELS[language];
  return entry ? (lang === "de" ? entry.de : entry.ru) : language.toUpperCase();
}

export function documentTranslationActionLabel(lang: string) {
  return lang === "de" ? "Übersetzen" : "Перевести";
}

export type DocumentTranslationEditTarget = {
  /** The saved translation document that receives a new PDF version. */
  translatedDocumentId: string;
  initialText: string;
  targetLanguage: string;
  sourceLanguage: string | null;
};

type Props = {
  /** Source document: shown on the left and used for machine translation. */
  documentId: string | null;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires after a translation was saved (new child document or new version). */
  onSaved?: (translation?: DocumentTranslation) => void;
  /** Document language as stored on the record, used to preselect the source. */
  documentLanguage?: string | null;
  /** Edit an existing translation instead of creating a new child. */
  editing?: DocumentTranslationEditTarget | null;
};

// The dialog is read-only until the reviewer saves: machine drafts are shown,
// edited and persisted explicitly. The backend owns ACLs and the translated
// document creation.
export function DocumentTranslationDialog({ documentId, title, open, onOpenChange, onSaved, documentLanguage, editing }: Props) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const [preview, setPreview] = useState<{ url: string; contentType: string } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const previewUrlRef = useRef<string | null>(null);
  const [capability, setCapability] = useState<MachineTranslationCapability | null>(null);
  const [translations, setTranslations] = useState<DocumentTranslation[]>([]);
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [targetLanguage, setTargetLanguage] = useState<string>("ru");
  const [sourceText, setSourceText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [draftProvider, setDraftProvider] = useState<"local" | "manual">("manual");
  const [detected, setDetected] = useState<string | null>(null);
  const [busy, setBusy] = useState<"translate" | "save" | null>(null);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!open || !documentId) return;
    let active = true;
    setError("");
    setNotice("");
    setSourceText("");
    setTranslatedText(editing?.initialText ?? "");
    setSavedText(editing?.initialText ?? "");
    setDraftProvider("manual");
    setDetected(null);
    const preselected = documentLanguage && LANGUAGE_LABELS[documentLanguage] ? documentLanguage : "";
    setSourceLanguage(editing?.sourceLanguage ?? preselected);
    setTargetLanguage(editing?.targetLanguage ?? (preselected === "ru" ? "de" : "ru"));
    setPreviewError("");
    createDocumentPreviewObjectUrl(documentId)
      .then((next) => {
        if (!active) {
          revokeDocumentPreviewObjectUrl(next.url);
          return;
        }
        previewUrlRef.current = next.url;
        setPreview(next);
      })
      .catch((nextError: unknown) => {
        if (active) {
          setPreviewError(
            nextError instanceof Error
              ? nextError.message
              : tx("Не удалось открыть документ.", "Das Dokument konnte nicht geöffnet werden."),
          );
        }
      });
    fetchMachineTranslationCapability()
      .then((next) => {
        if (active) setCapability(next);
      })
      .catch(() => {
        if (active) setCapability(null);
      });
    fetchDocumentTranslations(documentId)
      .then((rows) => {
        if (active) setTranslations(rows);
      })
      .catch(() => {
        if (active) setTranslations([]);
      });
    return () => {
      active = false;
      if (previewUrlRef.current) {
        revokeDocumentPreviewObjectUrl(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      setPreview(null);
    };
    // The dialog resets whenever it opens for a document; the language prop
    // and the edit target only seed the initial state.
  }, [open, documentId, documentLanguage, editing]);

  const machineReady = capability?.external_calls_enabled === true;
  const machineHint =
    capability?.status === "blocked"
      ? tx(
          "Машинный перевод отключён: сервис перевода на этом сервере недоступен.",
          "Die maschinelle Übersetzung ist deaktiviert: Der Übersetzungsdienst ist auf diesem Server nicht verfügbar.",
        )
      : capability && !machineReady
        ? tx(
            "Машинный перевод на этом сервере не настроен. Текст перевода можно ввести вручную.",
            "Die maschinelle Übersetzung ist auf diesem Server nicht eingerichtet. Der Übersetzungstext kann manuell eingetragen werden.",
          )
        : "";

  async function handleTranslate() {
    if (!documentId) return;
    if (sourceLanguage && sourceLanguage === targetLanguage) {
      setError(tx("Исходный и целевой языки должны отличаться.", "Ausgangs- und Zielsprache müssen sich unterscheiden."));
      return;
    }
    setBusy("translate");
    setError("");
    setNotice("");
    try {
      const result = await previewDocumentTranslation(documentId, {
        source_language: sourceLanguage || null,
        target_language: targetLanguage,
      });
      setSourceText(result.source_text);
      setTranslatedText(result.translated_text);
      setDraftProvider("local");
      setDetected(result.detected_source_language);
      if (!sourceLanguage && result.detected_source_language && LANGUAGE_LABELS[result.detected_source_language]) {
        setSourceLanguage(result.detected_source_language);
      }
      setNotice(
        tx(
          "Машинный черновик готов. Проверьте термины, отрицания, дозировки и даты по оригиналу перед сохранением.",
          "Maschineller Entwurf erstellt. Begriffe, Verneinungen, Dosierungen und Daten vor dem Speichern am Original prüfen.",
        ),
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : tx("Не удалось получить перевод.", "Die Übersetzung konnte nicht erstellt werden."),
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    if (!documentId || !translatedText.trim()) return;
    setBusy("save");
    setError("");
    setNotice("");
    try {
      if (editing) {
        await renderDocumentTranslationPdf(editing.translatedDocumentId, {
          translated_text: translatedText.trim(),
        });
        setSavedText(translatedText.trim());
        onSaved?.();
        onOpenChange(false);
        return;
      }
      const saved = await createDocumentTranslation(documentId, {
        source_language: sourceLanguage || null,
        target_language: targetLanguage,
        source_text: sourceText.trim() || null,
        translated_text: translatedText.trim(),
        provider: draftProvider,
      });
      setTranslations((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setSavedText(translatedText.trim());
      onSaved?.(saved);
      // The saved translation now appears as a child row in the list, so the
      // dialog closes right away.
      onOpenChange(false);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : tx("Не удалось сохранить перевод.", "Die Übersetzung konnte nicht gespeichert werden."),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      dirty={Boolean(translatedText.trim()) && translatedText.trim() !== savedText && busy === null}
      onSaveBeforeDismiss={() => void handleSave()}
    >
      <DialogContent
        className="flex h-[92vh] w-[96vw] max-w-none flex-col overflow-hidden rounded-xl p-0 sm:max-w-[1600px]"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader className="border-b border-border/70 px-5 py-4">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 pr-14">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 truncate text-base">
                <Languages className="size-4 shrink-0" />
                {editing ? tx("Редактировать перевод", "Übersetzung bearbeiten") : tx("Перевод документа", "Dokument übersetzen")}
              </DialogTitle>
              <DialogDescription className="truncate">{title}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="min-h-[320px] border-b border-border/70 bg-slate-50 p-3 lg:border-b-0 lg:border-r">
            {preview ? (
              <iframe
                title={title}
                src={preview.url}
                className="h-full min-h-[320px] w-full rounded-lg border border-border bg-white"
              />
            ) : previewError ? (
              <p className="p-3 text-sm text-destructive">{previewError}</p>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                {tx("Загрузка документа…", "Dokument wird geladen…")}
              </div>
            )}
          </div>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium">
                <span>{tx("С языка", "Von")}</span>
                <NativeComboboxSelect
                  value={sourceLanguage}
                  onChange={(event) => setSourceLanguage(event.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-white px-2 text-sm"
                >
                  <option value="">{documentTranslationLanguageLabel(null, lang)}</option>
                  {SOURCE_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {documentTranslationLanguageLabel(language, lang)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </label>
              <label className="space-y-1 text-xs font-medium">
                <span>{tx("На язык", "Nach")}</span>
                <NativeComboboxSelect
                  value={targetLanguage}
                  onChange={(event) => setTargetLanguage(event.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-white px-2 text-sm"
                >
                  {TARGET_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {documentTranslationLanguageLabel(language, lang)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg"
                disabled={busy !== null || !machineReady}
                title={machineHint || undefined}
                onClick={() => void handleTranslate()}
              >
                {busy === "translate" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Languages className="size-3.5" />}
                {tx("Перевести (локальная модель)", "Übersetzen (lokales Modell)")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg"
                disabled={busy !== null || !translatedText.trim()}
                onClick={() => void handleSave()}
              >
                {busy === "save" ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                {editing
                  ? tx("Сохранить новую версию PDF", "Neue PDF-Version speichern")
                  : tx("Сохранить как PDF-документ", "Als PDF-Dokument speichern")}
              </Button>
              {detected ? (
                <span className="text-xs text-muted-foreground">
                  {tx("Определён язык:", "Erkannte Sprache:")} {documentTranslationLanguageLabel(detected, lang)}
                </span>
              ) : null}
            </div>
            {machineHint ? <p className="text-xs text-muted-foreground">{machineHint}</p> : null}
            {error ? (
              <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                {notice}
              </p>
            ) : null}
            <div className="flex min-h-[200px] flex-1 flex-col gap-1 text-xs font-medium">
              <span>{tx("Перевод (можно редактировать)", "Übersetzung (bearbeitbar)")}</span>
              <RichMarkupEditor
                value={translatedText}
                onChange={setTranslatedText}
                lang={targetLanguage}
                placeholder={tx(
                  "Нажмите «Перевести» или введите перевод вручную.",
                  "„Übersetzen“ wählen oder die Übersetzung manuell eintragen.",
                )}
                labels={{
                  toolbar: tx("Форматирование перевода", "Formatierung der Übersetzung"),
                  bold: tx("Жирный (Ctrl+B)", "Fett (Strg+B)"),
                  heading: tx("Заголовок", "Überschrift"),
                  bullet: tx("Маркированный список", "Aufzählung"),
                  numbered: tx("Нумерованный список", "Nummerierung"),
                  paragraph: tx("Обычный абзац", "Normaler Absatz"),
                  clear: tx("Убрать форматирование", "Formatierung entfernen"),
                  undo: tx("Отменить (Ctrl+Z)", "Rückgängig (Strg+Z)"),
                  redo: tx("Повторить (Ctrl+Y)", "Wiederholen (Strg+Y)"),
                }}
              />
            </div>
            {sourceText ? (
              <details className="text-xs">
                <summary className="cursor-pointer font-medium">{tx("Распознанный исходный текст", "Erkannter Ausgangstext")}</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-slate-50 p-3 font-sans text-xs leading-5">{sourceText}</pre>
              </details>
            ) : null}
            <section className="space-y-2 border-t border-border/70 pt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tx("Переводы этого документа", "Übersetzungen dieses Dokuments")}
              </h4>
              {translations.length === 0 ? (
                <p className="text-xs text-muted-foreground">{tx("Переводов пока нет.", "Noch keine Übersetzungen.")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {translations.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs">
                      <span className="min-w-0">
                        <span className="font-medium">
                          {documentTranslationLanguageLabel(item.source_language, lang)} → {documentTranslationLanguageLabel(item.target_language, lang)}
                        </span>
                        <span className="ml-2 text-muted-foreground">
                          {item.provider === "local"
                            ? tx("локальная модель", "lokales Modell")
                            : item.provider === "deepl"
                              ? "DeepL"
                              : tx("вручную", "manuell")}
                          {item.created_by_name ? ` · ${item.created_by_name}` : ""}
                          {" · "}
                          {new Date(item.created_at).toLocaleDateString(lang === "de" ? "de-DE" : "ru-RU")}
                        </span>
                      </span>
                      {item.translated_document_id ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 rounded-lg"
                          onClick={() =>
                            void downloadDocumentFile(
                              item.translated_document_id as string,
                              item.translated_document_name ?? `translation-${item.target_language}.pdf`,
                            )
                          }
                        >
                          <Download className="size-3.5" />
                          {item.translated_document_name ?? tx("Скачать", "Herunterladen")}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
