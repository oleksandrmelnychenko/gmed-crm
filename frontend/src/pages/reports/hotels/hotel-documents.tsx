import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, FileText, Paperclip, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, clearApiCache, downloadApiFile } from "@/lib/api";
import type { Lang } from "@/lib/i18n";

const copy = {
  ru: { title: "Документы гостиницы", hint: "Общие договоры, тарифы и условия сотрудничества. Доступны для всех проживаний в этом отеле.", add: "Добавить файл", name: "Название документа", notes: "Комментарий", choose: "Выбрать файл", save: "Загрузить", busy: "Загрузка…", cancel: "Отмена", empty: "Документы ещё не добавлены", download: "Скачать", failed: "Не удалось загрузить документы", uploadFailed: "Не удалось сохранить файл. Можно повторить загрузку.", downloadFailed: "Не удалось скачать файл", invalid: "Выберите непустой PDF, изображение или Word до 25 МБ", retry: "Повторить", link: "Чтобы прикреплять договоры, выберите гостиницу из провайдеров в карточке бронирования.", permission: "Документы доступны сотрудникам с правом просмотра документов провайдера.", formats: "PDF, PNG, JPG, WebP, DOC, DOCX · до 25 МБ", saved: "Файл сохранён" },
  de: { title: "Hoteldokumente", hint: "Allgemeine Verträge, Tarife und Konditionen. Für alle Aufenthalte in diesem Hotel verfügbar.", add: "Datei hinzufügen", name: "Dokumenttitel", notes: "Kommentar", choose: "Datei auswählen", save: "Hochladen", busy: "Wird geladen…", cancel: "Abbrechen", empty: "Noch keine Dokumente", download: "Herunterladen", failed: "Dokumente konnten nicht geladen werden", uploadFailed: "Datei konnte nicht gespeichert werden. Upload erneut versuchen.", downloadFailed: "Datei konnte nicht heruntergeladen werden", invalid: "Nicht leere PDF-, Bild- oder Word-Datei bis 25 MB auswählen", retry: "Erneut versuchen", link: "Zum Anhängen von Verträgen das Hotel in der Buchung aus den Anbietern auswählen.", permission: "Dokumente sind für Mitarbeiter mit Leserecht für Anbieterdokumente verfügbar.", formats: "PDF, PNG, JPG, WebP, DOC, DOCX · bis 25 MB", saved: "Datei gespeichert" },
} as const;
type HotelDocument = { id: string; auto_name: string; original_filename: string | null; created_at: string; notes: string | null };

export function HotelDocuments({ providerId, role, lang, onDirty }: { providerId: string | null; role: string; lang: Lang; onDirty: (id: string, dirty: boolean) => void }) {
  const labels = copy[lang];
  const canRead = ["ceo", "billing", "patient_manager", "concierge"].includes(role), canUpload = ["ceo", "patient_manager", "concierge"].includes(role);
  const [documents, setDocuments] = useState<HotelDocument[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [adding, setAdding] = useState(false), [file, setFile] = useState<File | null>(null), [title, setTitle] = useState(""), [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false), [uploadError, setUploadError] = useState(""), [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirtyKey = `documents:${providerId}`;
  const dirty = Boolean(file || title || notes || busy);
  useEffect(() => { onDirty(dirtyKey, dirty); return () => onDirty(dirtyKey, false); }, [dirtyKey, dirty, onDirty]);
  const load = useCallback(async () => {
    if (!providerId || !canRead) return;
    setLoading(true); setError("");
    try { setDocuments(await apiFetch<HotelDocument[]>(`/providers/${providerId}/documents?general_only=true`, { forceFresh: true })); }
    catch { setError(labels.failed); }
    finally { setLoading(false); }
  }, [providerId, canRead, labels.failed]);
  useEffect(() => { void load(); }, [load]);
  function reset() { setFile(null); setTitle(""); setNotes(""); setUploadError(""); setAdding(false); }
  async function upload() {
    if (!file || !providerId || busy) return;
    if (!file.size || file.size > 25 * 1024 * 1024 || !/\.(pdf|png|jpe?g|webp|docx?)$/i.test(file.name)) { setUploadError(labels.invalid); return; }
    setBusy(true); setUploadError(""); setSaved(false);
    try {
      const body = new FormData(); body.append("file", file); body.append("title", title.trim()); body.append("notes", notes.trim()); body.append("is_medical", "false");
      await apiFetch(`/providers/${providerId}/documents`, { method: "POST", body, timeoutMs: 90000 });
      clearApiCache(`/providers/${providerId}/documents`); reset(); setSaved(true);
      await load();
    } catch { setUploadError(labels.uploadFailed); }
    finally { setBusy(false); }
  }
  async function download(document: HotelDocument) {
    setError("");
    try { await downloadApiFile(`/documents/${document.id}/download`, document.original_filename || document.auto_name); }
    catch { setError(labels.downloadFailed); }
  }
  return <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm" data-testid="hotel-documents">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/15 px-4 py-3"><h3 className="flex items-center gap-2 text-sm font-semibold"><span className="size-2 shrink-0 rounded-full bg-orange-500" />{labels.title}{canRead && !loading ? <span className="rounded-full border border-border/70 bg-card px-2 py-0.5 font-mono text-xs font-normal text-muted-foreground">{documents.length}</span> : null}</h3>{providerId && canUpload && !adding ? <Button size="sm" onClick={() => { setAdding(true); setSaved(false); }}><Plus className="size-3.5" />{labels.add}</Button> : null}</header>
    <div className="space-y-3 p-4">
    <p className="text-xs leading-5 text-muted-foreground">{!providerId ? labels.link : !canRead ? labels.permission : labels.hint}</p>
    {saved ? <p role="status" className="flex items-center gap-1.5 text-xs text-emerald-700"><Check className="size-3.5" />{labels.saved}</p> : null}
    {error ? <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}<Button size="sm" variant="outline" onClick={() => void load()}>{labels.retry}</Button></div> : null}
    {adding ? <form className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-4" onSubmit={event => { event.preventDefault(); void upload(); }}>
      <input ref={fileInput} type="file" aria-label={labels.choose} accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" className="hidden" disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); setUploadError(""); }} />
      <Button type="button" variant="outline" disabled={busy} className="h-auto min-h-9 max-w-full whitespace-normal break-all text-left" onClick={() => fileInput.current?.click()}><Paperclip className="size-4 shrink-0" />{file?.name || labels.choose}</Button><p className="text-xs text-muted-foreground">{labels.formats}</p>
      <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">{labels.name}<Input maxLength={255} value={title} placeholder={file?.name} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
      <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">{labels.notes}<textarea maxLength={4000} className="min-h-20 w-full rounded-lg border border-input bg-field px-3 py-2 text-sm font-normal text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35" disabled={busy} value={notes} onChange={event => setNotes(event.target.value)} /></label>
      {uploadError ? <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{uploadError}</p> : null}
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={reset}>{labels.cancel}</Button><Button type="submit" size="sm" disabled={busy || !file}>{busy ? labels.busy : labels.save}</Button></div>
    </form> : null}
    {providerId && canRead ? loading ? <p role="status" className="text-xs text-muted-foreground">{labels.busy}</p> : <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70">{documents.map(document => <li key={document.id} className="flex items-start gap-3 px-3 py-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600"><FileText className="size-4" /></span><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{document.auto_name}</p><p className="mt-0.5 break-all text-xs text-muted-foreground">{document.original_filename} · {new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "de-DE").format(new Date(document.created_at))}</p>{document.notes ? <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{document.notes}</p> : null}</div><Button size="icon-sm" variant="outline" className="shrink-0" aria-label={`${labels.download}: ${document.auto_name}`} title={labels.download} onClick={() => void download(document)}><Download className="size-4" /></Button></li>)}{!documents.length && !error ? <li className="px-4 py-6 text-center text-xs text-muted-foreground">{labels.empty}</li> : null}</ul> : null}
    </div>
  </section>;
}
