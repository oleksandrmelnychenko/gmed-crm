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
  const isNew = selectedId === "new";

  const loadNotes = useCallback(async (keepSelection = true) => {
    setLoading(true);
    setError("");
    try {
      const rows = await apiFetch<NoteSummary[]>("/internal-notes", { forceFresh: true });
      setNotes(rows);
      setSelectedId((current) => {
        if (current === "new") return current;
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
    if (!selectedId || selectedId === "new") {
      if (selectedId === "new") {
        setActiveNote(null);
        setDraftTitle("");
        setDraftBody("");
      }
      return;
    }
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
    if (!title) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = isNew
        ? await apiFetch<InternalNote>("/internal-notes", {
            method: "POST",
            body: JSON.stringify({ title, body: draftBody.trim() || null }),
          })
        : await apiFetch<InternalNote>(`/internal-notes/${selectedId}/update`, {
            method: "POST",
            body: JSON.stringify({
              title,
              body: draftBody.trim() || null,
              expected_updated_at: activeNote?.updated_at,
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
    <div className="space-y-3" data-testid="internal-notes-page">
      <PageHeader
        title={labels.title}
        description={labels.subtitle}
        actions={<Button type="button" onClick={() => setSelectedId("new")}><Plus />{labels.newNote}</Button>}
      />

      {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p> : null}

      <div className="grid min-h-[calc(100vh-14rem)] overflow-hidden rounded-xl border bg-card shadow-sm lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-b bg-muted/15 lg:border-b-0 lg:border-r">
          <div className="border-b p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="bg-background pl-9" value={query} placeholder={labels.search} onChange={(event) => setQuery(event.target.value)} />
            </div>
          </div>
          <div className="max-h-[360px] overflow-y-auto p-2 lg:max-h-[calc(100vh-18rem)]">
            {loading ? <div className="flex justify-center py-10"><LoaderCircle className="size-5 animate-spin text-muted-foreground" /></div> : null}
            {!loading && visibleNotes.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">{labels.noNotes}</p> : null}
            {visibleNotes.map((note) => (
              <button
                key={note.id}
                type="button"
                className={cn("mb-1 w-full rounded-lg border px-3 py-3 text-left transition-colors", selectedId === note.id ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-muted/60")}
                onClick={() => setSelectedId(note.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-1 text-sm font-semibold">{note.title}</p>
                  {note.attachment_count > 0 ? <Badge variant="secondary" className="shrink-0"><Paperclip className="size-3" />{note.attachment_count}</Badge> : null}
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{note.body || "—"}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">{formatDate(note.updated_at, lang)}</p>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-w-0 p-4 sm:p-6">
          {!selectedId ? <div className="flex min-h-[420px] items-center justify-center text-sm text-muted-foreground">{labels.selectNote}</div> : (
            <div className="mx-auto max-w-4xl space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{isNew ? labels.newNote : `${labels.updated} ${activeNote ? formatDate(activeNote.updated_at, lang) : ""}`}</p>
                  {!isNew && activeNote ? <p className="mt-1 text-xs text-muted-foreground">{labels.by} {activeNote.updated_by_name}</p> : null}
                </div>
                <div className="flex gap-2">
                  {!isNew && activeNote ? <Button type="button" variant="outline" disabled={saving} onClick={() => void archiveNote()}><Archive />{labels.archive}</Button> : null}
                  <Button type="button" disabled={saving || !draftTitle.trim()} onClick={() => void saveNote()}>
                    {saving ? <LoaderCircle className="animate-spin" /> : <Save />}{saving ? labels.saving : labels.save}
                  </Button>
                </div>
              </div>

              <label className="block space-y-1.5 text-sm font-medium">
                <span>{labels.noteTitle}</span>
                <Input value={draftTitle} maxLength={255} placeholder={labels.untitled} onChange={(event) => setDraftTitle(event.target.value)} />
              </label>
              <label className="block space-y-1.5 text-sm font-medium">
                <span>{labels.noteBody}</span>
                <textarea
                  className="min-h-64 w-full resize-y rounded-lg border border-input bg-field px-3 py-3 text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                  value={draftBody}
                  maxLength={20_000}
                  placeholder={labels.bodyPlaceholder}
                  onChange={(event) => setDraftBody(event.target.value)}
                />
              </label>

              {!isNew && activeNote ? (
                <section className="rounded-xl border bg-muted/15 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">{labels.attachments}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">{labels.allowedFiles}</p>
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
                  <div className="mt-4 divide-y rounded-lg border bg-background">
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
    </div>
  );
}

