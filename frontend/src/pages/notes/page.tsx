import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Download,
  FileImage,
  FileText,
  LoaderCircle,
  Paperclip,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react";

import { PageHeader } from "@/components/ui-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch, clearApiCache, downloadApiFile } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type NoteAttachment = {
  id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded_by_name: string;
  created_at: string;
};

type NoteSummary = {
  id: string;
  title: string;
  body: string | null;
  created_by_name: string;
  updated_by_name: string;
  attachment_count: number;
  created_at: string;
  updated_at: string;
};

type InternalNote = Omit<NoteSummary, "attachment_count"> & {
  attachments: NoteAttachment[];
};

const copy = {
  de: {
    title: "Interne Notizen",
    subtitle: "Schnelle interne Arbeitsnotizen mit PDF-, Bild- und Word-Anhängen",
    newNote: "Neue Notiz",
    search: "Notizen durchsuchen",
    untitled: "Neue Notiz",
    noteTitle: "Titel",
    noteBody: "Notiz",
    bodyPlaceholder: "Information, Übergabe oder Arbeitsdetail festhalten …",
    save: "Speichern",
    saving: "Speichern …",
    attachments: "Anhänge",
    attach: "Datei anhängen",
    allowedFiles: "PDF, Bilder oder Word · maximal 20 MB",
    noNotes: "Noch keine internen Notizen",
    selectNote: "Notiz auswählen oder eine neue Notiz anlegen",
    updated: "Aktualisiert",
    by: "von",
    archive: "Archivieren",
    deleteFile: "Datei entfernen",
    confirmArchive: "Diese Notiz archivieren?",
    confirmDeleteFile: "Diesen Anhang entfernen?",
    saved: "Notiz gespeichert",
    fileAdded: "Datei angehängt",
    error: "Aktion fehlgeschlagen",
    cancel: "Abbrechen",
  },
  ru: {
    title: "Заметки",
    subtitle: "Быстрые внутренние заметки с файлами PDF, изображениями и Word",
    newNote: "Новая заметка",
    search: "Поиск по заметкам",
    untitled: "Новая заметка",
    noteTitle: "Название",
    noteBody: "Заметка",
    bodyPlaceholder: "Зафиксируйте информацию, передачу или рабочую деталь…",
    save: "Сохранить",
    saving: "Сохранение…",
    attachments: "Файлы",
    attach: "Прикрепить файл",
    allowedFiles: "PDF, изображения или Word · до 20 МБ",
    noNotes: "Внутренних заметок пока нет",
    selectNote: "Выберите заметку или создайте новую",
    updated: "Обновлено",
    by: "автор",
    archive: "Архивировать",
    deleteFile: "Удалить файл",
    confirmArchive: "Архивировать эту заметку?",
    confirmDeleteFile: "Удалить этот файл?",
    saved: "Заметка сохранена",
    fileAdded: "Файл прикреплён",
    error: "Не удалось выполнить действие",
    cancel: "Отмена",
  },
} as const;

function formatDate(value: string, lang: "de" | "ru") {
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function InternalNotesPage() {
  const { lang } = useLang();
  const labels = copy[lang];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<InternalNote | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");

  const loadNotes = useCallback(async (keepSelection = true) => {
    setLoading(true);
    setError("");
    try {
      const rows = await apiFetch<NoteSummary[]>("/internal-notes", { forceFresh: true });
      setNotes(rows);
      setSelectedId((current) => {
        if (keepSelection && current && rows.some((note) => note.id === current)) return current;
        return rows[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : labels.error);
    } finally {
      setLoading(false);
    }
  }, [labels.error]);

  useEffect(() => {
    void loadNotes(false);
  }, [loadNotes]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void apiFetch<InternalNote>(`/internal-notes/${selectedId}`, { forceFresh: true })
      .then((note) => {
        if (cancelled) return;
        setActiveNote(note);
        setDraftTitle(note.title);
        setDraftBody(note.body ?? "");
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : labels.error);
      });
    return () => {
      cancelled = true;
    };
  }, [labels.error, selectedId]);

  const visibleNotes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return notes;
    return notes.filter((note) => `${note.title} ${note.body ?? ""}`.toLocaleLowerCase().includes(normalized));
  }, [notes, query]);

  async function saveNote() {
    const title = draftTitle.trim();
    if (!title || !selectedId || !activeNote) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await apiFetch<InternalNote>(`/internal-notes/${selectedId}/update`, {
        method: "POST",
        body: JSON.stringify({
          title,
          body: draftBody.trim() || null,
          expected_updated_at: activeNote.updated_at,
        }),
      });
      clearApiCache("/internal-notes");
      setActiveNote(saved);
      setSelectedId(saved.id);
      setNotice(labels.saved);
      await loadNotes();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : labels.error);
    } finally {
      setSaving(false);
    }
  }

  async function createNote() {
    const title = newTitle.trim();
    if (!title || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await apiFetch<InternalNote>("/internal-notes", {
        method: "POST",
        body: JSON.stringify({ title, body: newBody.trim() || null }),
      });
      clearApiCache("/internal-notes");
      setNewNoteOpen(false);
      setNewTitle("");
      setNewBody("");
      setActiveNote(saved);
      setSelectedId(saved.id);
      setNotice(labels.saved);
      await loadNotes();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : labels.error);
    } finally {
      setSaving(false);
    }
  }

  async function attachFile(file: File) {
    if (!activeNote) return;
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.append("file", file);
      const updated = await apiFetch<InternalNote>(`/internal-notes/${activeNote.id}/attachments`, {
        method: "POST",
        body: form,
        timeoutMs: 60_000,
      });
      setActiveNote(updated);
      setNotice(labels.fileAdded);
      await loadNotes();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : labels.error);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function deleteAttachment(attachment: NoteAttachment) {
    if (!activeNote || !window.confirm(labels.confirmDeleteFile)) return;
    setUploading(true);
    try {
      await apiFetch<void>(`/internal-notes/${activeNote.id}/attachments/${attachment.id}/delete`, { method: "POST" });
      const refreshed = await apiFetch<InternalNote>(`/internal-notes/${activeNote.id}`, { forceFresh: true });
      setActiveNote(refreshed);
      await loadNotes();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : labels.error);
    } finally {
      setUploading(false);
    }
  }

  async function archiveNote() {
    if (!activeNote || !window.confirm(labels.confirmArchive)) return;
    setSaving(true);
    try {
      await apiFetch<void>(`/internal-notes/${activeNote.id}/archive`, { method: "POST" });
      setActiveNote(null);
      setSelectedId(null);
      await loadNotes(false);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : labels.error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-4 lg:space-y-0" data-testid="internal-notes-page">
      <PageHeader
        title={labels.title}
        description={labels.subtitle}
        actions={<Button type="button" onClick={() => { setNewTitle(""); setNewBody(""); setNewNoteOpen(true); }}><Plus />{labels.newNote}</Button>}
      />

      {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p> : null}

      <div className="grid min-h-[620px] overflow-hidden rounded-lg border border-border/70 bg-card lg:min-h-0 lg:flex-1 lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden border-b border-border/70 lg:border-r lg:border-b-0">
          <div className="border-b border-border/70 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-9 rounded-lg bg-field pl-9" value={query} placeholder={labels.search} onChange={(event) => setQuery(event.target.value)} />
            </div>
          </div>
          <div className="min-h-0 max-h-[280px] flex-1 overflow-y-auto overscroll-contain p-2 lg:max-h-none">
            {loading ? <div className="flex justify-center py-10"><LoaderCircle className="size-5 animate-spin text-muted-foreground" /></div> : null}
            {!loading && visibleNotes.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">{labels.noNotes}</p> : null}
            {visibleNotes.map((note) => (
              <button
                key={note.id}
                type="button"
                className={cn("relative mb-1 w-full rounded-lg px-2.5 py-2 text-left transition-colors", selectedId === note.id ? "bg-muted/70 before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-[var(--brand)]" : "hover:bg-muted/45")}
                onClick={() => setSelectedId(note.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-1 text-[13px] font-semibold">{note.title}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    {note.attachment_count > 0 ? <Badge variant="secondary" className="h-5 shrink-0 rounded-full px-1.5 text-[9px]"><Paperclip className="size-2.5" />{note.attachment_count}</Badge> : null}
                    <span className="inline-flex items-center rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[9px] font-medium tabular-nums text-sky-700">
                      {formatDate(note.updated_at, lang)}
                    </span>
                  </div>
                </div>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{note.body || "—"}</p>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-w-0 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden">
          {!selectedId ? <div className="flex min-h-[420px] items-center justify-center text-sm text-muted-foreground">{labels.selectNote}</div> : (
            <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3.5 sm:px-5">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-foreground">{activeNote?.title ?? labels.untitled}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{`${labels.updated} ${activeNote ? formatDate(activeNote.updated_at, lang) : ""}`}</p>
                  {activeNote ? <p className="mt-1 text-xs text-muted-foreground">{labels.by} {activeNote.updated_by_name}</p> : null}
                </div>
                <div className="flex gap-2">
                  {activeNote ? <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void archiveNote()}><Archive />{labels.archive}</Button> : null}
                  <Button type="button" size="sm" disabled={saving || !draftTitle.trim()} onClick={() => void saveNote()}>
                    {saving ? <LoaderCircle className="animate-spin" /> : <Save />}{saving ? labels.saving : labels.save}
                  </Button>
                </div>
              </div>

              <label className="mx-4 mt-4 block space-y-1.5 text-sm font-medium sm:mx-5">
                <span>{labels.noteTitle}</span>
                <Input className="h-9 bg-field" value={draftTitle} maxLength={255} placeholder={labels.untitled} onChange={(event) => setDraftTitle(event.target.value)} />
              </label>
              <label className="mx-4 mt-3 block space-y-1.5 text-sm font-medium sm:mx-5">
                <span>{labels.noteBody}</span>
                <textarea
                  className="min-h-40 w-full resize-y rounded-lg border border-input bg-field px-3 py-3 text-sm font-normal leading-6 outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                  value={draftBody}
                  maxLength={20_000}
                  placeholder={labels.bodyPlaceholder}
                  onChange={(event) => setDraftBody(event.target.value)}
                />
              </label>

              {activeNote ? (
                <section className="mx-4 mt-4 mb-4 overflow-hidden rounded-lg border border-border/70 bg-card sm:mx-5 sm:mb-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-3.5 py-2.5">
                    <div>
                      <h2 className="flex items-center gap-2 text-[13px] font-semibold"><span className="size-2 rounded-full bg-[var(--brand)]" />{labels.attachments}</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">{labels.allowedFiles}</p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void attachFile(file);
                      }}
                    />
                    <Button type="button" variant="outline" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                      {uploading ? <LoaderCircle className="animate-spin" /> : <Paperclip />}{labels.attach}
                    </Button>
                  </div>
                  <div className="divide-y divide-border/60">
                    {activeNote.attachments.map((attachment) => (
                      <div key={attachment.id} className="flex items-center gap-3 px-3 py-2.5">
                        {attachment.mime_type.startsWith("image/") ? <FileImage className="size-5 shrink-0 text-violet-600" /> : <FileText className="size-5 shrink-0 text-sky-600" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{attachment.file_name}</p>
                          <p className="text-xs text-muted-foreground">{formatSize(attachment.file_size)} · {attachment.uploaded_by_name}</p>
                        </div>
                        <Button type="button" size="icon-sm" variant="ghost" title={attachment.file_name} onClick={() => void downloadApiFile(`/internal-notes/${activeNote.id}/attachments/${attachment.id}/download`, attachment.file_name)}><Download /></Button>
                        <Button type="button" size="icon-sm" variant="ghost" title={labels.deleteFile} disabled={uploading} onClick={() => void deleteAttachment(attachment)}><Trash2 /></Button>
                      </div>
                    ))}
                    {activeNote.attachments.length === 0 ? <p className="px-3 py-5 text-center text-sm text-muted-foreground">{labels.allowedFiles}</p> : null}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </main>
      </div>

      <Dialog open={newNoteOpen} onOpenChange={setNewNoteOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{labels.newNote}</DialogTitle>
            <DialogDescription>{labels.subtitle}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="grid gap-1.5 text-sm font-medium">
              <span>{labels.noteTitle}</span>
              <Input autoFocus value={newTitle} maxLength={255} placeholder={labels.untitled} onChange={(event) => setNewTitle(event.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              <span>{labels.noteBody}</span>
              <textarea
                className="min-h-52 w-full resize-y rounded-lg border border-input bg-field px-3 py-3 text-sm font-normal leading-6 outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                value={newBody}
                maxLength={20_000}
                placeholder={labels.bodyPlaceholder}
                onChange={(event) => setNewBody(event.target.value)}
              />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setNewNoteOpen(false)}>{labels.cancel}</Button>
            <Button type="button" disabled={saving || !newTitle.trim()} onClick={() => void createNote()}>
              {saving ? <LoaderCircle className="animate-spin" /> : <Save />}{saving ? labels.saving : labels.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
