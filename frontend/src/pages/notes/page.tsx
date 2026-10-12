import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
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

import { ReadOnlyBanner } from "@/components/read-only-scope";
import { PageHeader } from "@/components/ui-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiRequestError, apiFetch, clearApiCache, downloadApiFile } from "@/lib/api";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
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

/** Who reads a note, chosen by its author; the CEO reads every note (owner 2026-10-12). */
export type NoteVisibility = "private" | "role" | "staff";

export const NOTE_VISIBILITIES: readonly NoteVisibility[] = ["private", "role", "staff"];

type NoteSummary = {
  id: string;
  title: string;
  body: string | null;
  created_by: string;
  created_by_name: string;
  /** The author's current role: "Моя роль" of a note means this role (QA E3-02). */
  created_by_role?: string | null;
  updated_by_name: string;
  attachment_count: number;
  /** Older servers send no visibility: their notes were visible to all staff. */
  visibility?: NoteVisibility;
  visible_role?: string | null;
  created_at: string;
  updated_at: string;
  /** Set in the archive list (`?archived=true`). */
  archived_at?: string | null;
};

type InternalNote = Omit<NoteSummary, "attachment_count"> & {
  attachments: NoteAttachment[];
};

export const NOTES_COPY = {
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
    visibility: "Sichtbarkeit",
    visibilityHint: "Wer die Notiz lesen darf. Der CEO sieht alle Notizen.",
    visibilityAuthorOnly: "Die Sichtbarkeit ändert nur die Person, die die Notiz angelegt hat.",
    visibilityOwn: { private: "Nur ich", role: "Meine Rolle", staff: "Alle Mitarbeitenden" },
    visibilityOther: { private: "Nur Autor:in", role: "Rolle", staff: "Alle Mitarbeitenden" },
    visibilityAuthorRole: (role: string) => `Rolle der Autor:in: ${role}`,
    visibilityAuthorRoleUnknown: "Rolle der Autor:in",
    visibilityHintOther: (author: string) =>
      `Die Sichtbarkeit gilt aus Sicht der Person, die die Notiz angelegt hat (${author}). Der CEO sieht alle Notizen.`,
    errorNotFound: "Die Notiz gibt es nicht mehr oder sie ist nicht für Sie freigegeben.",
    errorConflict: "Die Notiz wurde inzwischen von jemand anderem geändert. Bitte neu laden.",
    errorReadOnly: "Ihre Rolle kann Notizen nur lesen.",
    archiveAuthorOnly: "Archivieren können nur die Person, die die Notiz angelegt hat, und der CEO.",
    viewActive: "Aktuell",
    viewArchive: "Archiv",
    restore: "Wiederherstellen",
    restored: "Notiz wiederhergestellt",
    noArchived: "Keine archivierten Notizen",
    selectArchived: "Archivierte Notiz auswählen",
    archivedOn: (date: string, by: string) => `Archiviert am ${date} · ${by}`,
    restoreHint: "Wiederherstellen können die Person, die die Notiz angelegt hat, und der CEO.",
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
    visibility: "Видимость",
    visibilityHint: "Кто может читать заметку. CEO видит все заметки.",
    visibilityAuthorOnly: "Видимость меняет только автор заметки.",
    visibilityOwn: { private: "Только я", role: "Моя роль", staff: "Все сотрудники" },
    visibilityOther: { private: "Только автор", role: "Роль", staff: "Все сотрудники" },
    visibilityAuthorRole: (role: string) => `Роль автора: ${role}`,
    visibilityAuthorRoleUnknown: "Роль автора",
    visibilityHintOther: (author: string) =>
      `Видимость задаётся от лица автора заметки (${author}). CEO видит все заметки.`,
    errorNotFound: "Заметки больше нет или она вам недоступна.",
    errorConflict: "Заметку тем временем изменил другой сотрудник. Обновите страницу.",
    errorReadOnly: "Ваша роль может только просматривать заметки.",
    archiveAuthorOnly: "Архивировать заметку может только её автор или CEO.",
    viewActive: "Текущие",
    viewArchive: "Архив",
    restore: "Восстановить",
    restored: "Заметка восстановлена",
    noArchived: "В архиве нет заметок",
    selectArchived: "Выберите заметку из архива",
    archivedOn: (date: string, by: string) => `В архиве с ${date} · ${by}`,
    restoreHint: "Восстановить заметку может её автор или CEO.",
  },
} as const;

type NotesCopy = (typeof NOTES_COPY)[keyof typeof NOTES_COPY];

/** Who may change the visibility, archive and restore: the author or the CEO (QA E3-03). */
export function canManageNote(
  note: Pick<NoteSummary, "created_by"> | null | undefined,
  viewer: { id: string; role: string } | null | undefined,
): boolean {
  if (!note || !viewer || !canWriteNotes(viewer.role)) return false;
  return note.created_by === viewer.id || viewer.role === "ceo";
}

/** The CEO Assistant reads notes but writes none (owner rule, QA E3-03); the server refuses it too. */
export function canWriteNotes(role: string | null | undefined): boolean {
  return Boolean(role) && role !== "ceo_assistant";
}

/**
 * The visibility choices as the editor reads them. The server applies the
 * choice to the AUTHOR (QA E3-02): for the author they read "Только я /
 * Моя роль", for anyone else (the CEO) "Только автор / Роль автора: Sales".
 */
export function noteVisibilityChoices(
  note: Pick<NoteSummary, "visibility" | "visible_role" | "created_by" | "created_by_role"> | null | undefined,
  viewerId: string | undefined,
  labels: NotesCopy,
  roleName: (role: string) => string,
): Record<NoteVisibility, string> {
  if (!note || !viewerId || note.created_by === viewerId) return labels.visibilityOwn;
  // "Role" keeps the role the note was shared with; switching to it takes the author's current role.
  const role = note.visibility === "role" && note.visible_role ? note.visible_role : note.created_by_role;
  return {
    private: labels.visibilityOther.private,
    role: role ? labels.visibilityAuthorRole(roleName(role)) : labels.visibilityAuthorRoleUnknown,
    staff: labels.visibilityOther.staff,
  };
}

/**
 * The badge of a note: the author reads the choices of the form ("Только я",
 * "Моя роль", "Все сотрудники"); everyone else (the CEO, a colleague) reads
 * whose note it is ("Только автор", "Роль: …").
 */
export function noteVisibilityLabel(
  note: Pick<NoteSummary, "visibility" | "visible_role" | "created_by">,
  viewerId: string | undefined,
  labels: NotesCopy,
  roleName: (role: string) => string,
): string {
  const visibility = note.visibility ?? "staff";
  if (viewerId && note.created_by === viewerId) return labels.visibilityOwn[visibility];
  if (visibility === "role" && note.visible_role) {
    return `${labels.visibilityOther.role}: ${roleName(note.visible_role)}`;
  }
  return labels.visibilityOther[visibility];
}

/** Server refusals of the notes API in the UI language. */
export function noteErrorMessage(error: unknown, labels: NotesCopy): string {
  const code = error instanceof ApiRequestError ? error.code : undefined;
  switch (code) {
    case "note_visibility_author_only":
      return labels.visibilityAuthorOnly;
    case "note_read_only_role":
      return labels.errorReadOnly;
    case "note_archive_author_only":
      return labels.archiveAuthorOnly;
    case "Note not found":
    case "Attachment not found":
      return labels.errorNotFound;
    case "Note was changed by another user":
      return labels.errorConflict;
    default:
      return error instanceof Error && error.message ? error.message : labels.error;
  }
}

function visibilityTone(visibility: NoteVisibility): string {
  if (visibility === "private") return "border-slate-200 bg-slate-50 text-slate-700";
  if (visibility === "role") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function formatDate(value: string) {
  return formatAppDateTime(value) || value;
}

function formatSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function InternalNotesPage() {
  const { lang, t } = useLang();
  const { user } = useAuth();
  const labels = NOTES_COPY[lang];
  const roleName = useCallback(
    (role: string) => {
      const label = (t as unknown as Record<string, unknown>)[`role_${role}`];
      return typeof label === "string" ? label : role;
    },
    [t],
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<InternalNote | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftVisibility, setDraftVisibility] = useState<NoteVisibility>("private");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  // New notes stay with their author unless the author shares them.
  const [newVisibility, setNewVisibility] = useState<NoteVisibility>("private");
  // "archive": archived notes the viewer may restore (own notes; the CEO all).
  const [view, setView] = useState<"active" | "archive">("active");
  // The CEO Assistant only reads notes (QA E3-03); the server refuses its writes too.
  const readOnly = !canWriteNotes(user?.role);
  // Only the author (or the CEO) decides who reads a note and archives it; the server checks it too.
  const canManage = canManageNote(activeNote, user);
  const canChangeVisibility = canManage;
  const editingOthersNote = Boolean(activeNote && user && activeNote.created_by !== user.id);
  const visibilityChoices = noteVisibilityChoices(activeNote, user?.id, labels, roleName);
  // A plain list: the select reads its <option> children, not a fragment.
  const optionsFor = (choices: Record<NoteVisibility, string>) =>
    NOTE_VISIBILITIES.map((value) => (
      <option key={value} value={value}>
        {choices[value]}
      </option>
    ));
  const archivedNote = view === "archive" ? (notes.find((note) => note.id === selectedId) ?? null) : null;

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await apiFetch<NoteSummary[]>(
        view === "archive" ? "/internal-notes?archived=true" : "/internal-notes",
        { forceFresh: true },
      );
      setNotes(rows);
      setSelectedId((current) => {
        if (current && rows.some((note) => note.id === current)) return current;
        return rows[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(noteErrorMessage(loadError, labels));
    } finally {
      setLoading(false);
    }
  }, [labels, view]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  function switchView(next: "active" | "archive") {
    if (next === view) return;
    setNotice("");
    setActiveNote(null);
    setSelectedId(null);
    setView(next);
  }

  useEffect(() => {
    if (!selectedId || view !== "active") return;
    let cancelled = false;
    void apiFetch<InternalNote>(`/internal-notes/${selectedId}`, { forceFresh: true })
      .then((note) => {
        if (cancelled) return;
        setActiveNote(note);
        setDraftTitle(note.title);
        setDraftBody(note.body ?? "");
        setDraftVisibility(note.visibility ?? "staff");
      })
      .catch((loadError) => {
        if (!cancelled) setError(noteErrorMessage(loadError, labels));
      });
    return () => {
      cancelled = true;
    };
  }, [labels, selectedId, view]);

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
          ...(canChangeVisibility ? { visibility: draftVisibility } : {}),
        }),
      });
      clearApiCache("/internal-notes");
      setActiveNote(saved);
      setSelectedId(saved.id);
      setDraftVisibility(saved.visibility ?? "staff");
      setNotice(labels.saved);
      await loadNotes();
    } catch (saveError) {
      setError(noteErrorMessage(saveError, labels));
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
        body: JSON.stringify({ title, body: newBody.trim() || null, visibility: newVisibility }),
      });
      clearApiCache("/internal-notes");
      setNewNoteOpen(false);
      setNewTitle("");
      setNewBody("");
      setNewVisibility("private");
      setActiveNote(saved);
      setSelectedId(saved.id);
      setDraftVisibility(saved.visibility ?? newVisibility);
      setNotice(labels.saved);
      await loadNotes();
    } catch (saveError) {
      setError(noteErrorMessage(saveError, labels));
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
      setError(noteErrorMessage(uploadError, labels));
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
      setError(noteErrorMessage(deleteError, labels));
    } finally {
      setUploading(false);
    }
  }

  async function archiveNote() {
    if (!activeNote || !window.confirm(labels.confirmArchive)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiFetch<void>(`/internal-notes/${activeNote.id}/archive`, { method: "POST" });
      clearApiCache("/internal-notes");
      setActiveNote(null);
      setSelectedId(null);
      await loadNotes();
    } catch (archiveError) {
      setError(noteErrorMessage(archiveError, labels));
    } finally {
      setSaving(false);
    }
  }

  async function restoreNote(note: NoteSummary) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const restored = await apiFetch<InternalNote>(`/internal-notes/${note.id}/restore`, { method: "POST" });
      clearApiCache("/internal-notes");
      // Back to the current notes with the restored one open.
      setActiveNote(null);
      setSelectedId(restored.id);
      setView("active");
      setNotice(labels.restored);
    } catch (restoreError) {
      setError(noteErrorMessage(restoreError, labels));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-4 lg:space-y-0" data-testid="internal-notes-page">
      <PageHeader
        title={labels.title}
        description={labels.subtitle}
        actions={readOnly ? undefined : (
          <Button
            type="button"
            onClick={() => {
              switchView("active");
              setNewTitle("");
              setNewBody("");
              setNewVisibility("private");
              setNewNoteOpen(true);
            }}
          >
            <Plus />
            {labels.newNote}
          </Button>
        )}
      />

      {readOnly ? <ReadOnlyBanner /> : null}
      {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p> : null}

      <div className="grid min-h-[620px] grid-cols-1 overflow-hidden rounded-lg border border-border/70 bg-card lg:min-h-0 lg:flex-1 lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)]">
        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-border/70 lg:border-r lg:border-b-0">
          <div className="space-y-2 border-b border-border/70 p-3">
            {readOnly ? null : (
              <div className="inline-flex rounded-lg border border-border/70 bg-muted/30 p-0.5" role="group" aria-label={`${labels.viewActive} / ${labels.viewArchive}`}>
                {(["active", "archive"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={view === value}
                    className={cn(
                      "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                      view === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => switchView(value)}
                  >
                    {value === "active" ? labels.viewActive : labels.viewArchive}
                  </button>
                ))}
              </div>
            )}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-9 rounded-lg bg-field pl-9" value={query} placeholder={labels.search} onChange={(event) => setQuery(event.target.value)} />
            </div>
          </div>
          <div className="flex min-h-0 max-h-[280px] flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-2 lg:max-h-none">
            {loading ? <div className="flex justify-center py-10"><LoaderCircle className="size-5 animate-spin text-muted-foreground" /></div> : null}
            {!loading && visibleNotes.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">{view === "archive" ? labels.noArchived : labels.noNotes}</p> : null}
            {visibleNotes.map((note) => (
              <button
                key={note.id}
                type="button"
                className={cn("relative w-full shrink-0 rounded-lg px-2.5 py-2 text-left transition-colors", selectedId === note.id ? "bg-muted/70 before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-[var(--brand)]" : "hover:bg-muted/45")}
                onClick={() => setSelectedId(note.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-1 text-[13px] font-semibold">{note.title}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    <span
                      className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-medium", visibilityTone(note.visibility ?? "staff"))}
                      data-testid="note-visibility-badge"
                    >
                      {noteVisibilityLabel(note, user?.id, labels, roleName)}
                    </span>
                    {note.attachment_count > 0 ? <Badge variant="secondary" className="h-5 shrink-0 rounded-full px-1.5 text-[9px]"><Paperclip className="size-2.5" />{note.attachment_count}</Badge> : null}
                    <span className="inline-flex items-center rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[9px] font-medium tabular-nums text-sky-700">
                      {formatDate(view === "archive" && note.archived_at ? note.archived_at : note.updated_at)}
                    </span>
                  </div>
                </div>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{note.body || "—"}</p>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-w-0 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden">
          {view === "archive" ? (
            archivedNote ? (
              <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain" data-testid="archived-note">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3.5 sm:px-5">
                  <div className="min-w-0">
                    <h2 className="break-words text-base font-semibold text-foreground">{archivedNote.title}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {labels.archivedOn(formatDate(archivedNote.archived_at ?? archivedNote.updated_at), archivedNote.updated_by_name)}
                    </p>
                    <span className={cn("mt-2 inline-flex w-fit items-center rounded-md border px-2 py-1 text-xs font-medium", visibilityTone(archivedNote.visibility ?? "staff"))}>
                      {noteVisibilityLabel(archivedNote, user?.id, labels, roleName)}
                    </span>
                  </div>
                  {canManageNote(archivedNote, user) ? (
                    <Button type="button" size="sm" disabled={saving} onClick={() => void restoreNote(archivedNote)}>
                      {saving ? <LoaderCircle className="animate-spin" /> : <ArchiveRestore />}
                      {labels.restore}
                    </Button>
                  ) : null}
                </div>
                <p className="mx-4 mt-3 text-xs text-muted-foreground sm:mx-5">{labels.restoreHint}</p>
                <p className="mx-4 mt-3 mb-4 whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-muted/20 px-3 py-3 text-sm leading-6 sm:mx-5">
                  {archivedNote.body || "—"}
                </p>
              </div>
            ) : (
              <div className="flex min-h-[420px] items-center justify-center text-sm text-muted-foreground">{labels.selectArchived}</div>
            )
          ) : !selectedId ? <div className="flex min-h-[420px] items-center justify-center text-sm text-muted-foreground">{labels.selectNote}</div> : (
            <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3.5 sm:px-5">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-foreground">{activeNote?.title ?? labels.untitled}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{`${labels.updated} ${activeNote ? formatDate(activeNote.updated_at) : ""}`}</p>
                  {activeNote ? <p className="mt-1 text-xs text-muted-foreground">{labels.by} {activeNote.updated_by_name}</p> : null}
                </div>
                {readOnly ? null : (
                  <div className="flex gap-2">
                    {activeNote && canManage ? <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void archiveNote()}><Archive />{labels.archive}</Button> : null}
                    <Button type="button" size="sm" disabled={saving || !draftTitle.trim()} onClick={() => void saveNote()}>
                      {saving ? <LoaderCircle className="animate-spin" /> : <Save />}{saving ? labels.saving : labels.save}
                    </Button>
                  </div>
                )}
              </div>

              <label className="mx-4 mt-4 block space-y-1.5 text-sm font-medium sm:mx-5">
                <span>{labels.noteTitle}</span>
                <Input className="h-9 bg-field" value={draftTitle} maxLength={255} placeholder={labels.untitled} readOnly={readOnly} onChange={(event) => setDraftTitle(event.target.value)} />
              </label>
              {activeNote ? (
                <label className="mx-4 mt-3 block space-y-1.5 text-sm font-medium sm:mx-5">
                  <span>{labels.visibility}</span>
                  {canChangeVisibility ? (
                    <NativeComboboxSelect
                      value={draftVisibility}
                      onChange={(event) => setDraftVisibility(event.target.value as NoteVisibility)}
                      className="h-9 w-full max-w-xs rounded-lg bg-field text-[13px]"
                      aria-label={labels.visibility}
                    >
                      {optionsFor(visibilityChoices)}
                    </NativeComboboxSelect>
                  ) : (
                    <span className={cn("inline-flex w-fit items-center rounded-md border px-2 py-1 text-xs font-medium", visibilityTone(activeNote.visibility ?? "staff"))}>
                      {noteVisibilityLabel(activeNote, user?.id, labels, roleName)}
                    </span>
                  )}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {canChangeVisibility
                      ? editingOthersNote
                        ? labels.visibilityHintOther(activeNote.created_by_name)
                        : labels.visibilityHint
                      : readOnly
                        ? labels.errorReadOnly
                        : `${labels.visibilityAuthorOnly} ${labels.archiveAuthorOnly}`}
                  </span>
                </label>
              ) : null}
              <label className="mx-4 mt-3 block space-y-1.5 text-sm font-medium sm:mx-5">
                <span>{labels.noteBody}</span>
                <textarea
                  className="field-sizing-content min-h-[30rem] w-full resize-y rounded-lg border border-input bg-field px-3 py-3 text-sm font-normal leading-6 outline-none placeholder:font-normal placeholder:text-muted-foreground/45 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                  value={draftBody}
                  maxLength={20_000}
                  placeholder={labels.bodyPlaceholder}
                  readOnly={readOnly}
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
                    {readOnly ? null : (
                      <Button type="button" variant="outline" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                        {uploading ? <LoaderCircle className="animate-spin" /> : <Paperclip />}{labels.attach}
                      </Button>
                    )}
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
                        {readOnly ? null : <Button type="button" size="icon-sm" variant="ghost" title={labels.deleteFile} disabled={uploading} onClick={() => void deleteAttachment(attachment)}><Trash2 /></Button>}
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
              <span>{labels.visibility}</span>
              <NativeComboboxSelect
                value={newVisibility}
                onChange={(event) => setNewVisibility(event.target.value as NoteVisibility)}
                className="h-9 w-full rounded-lg bg-field text-[13px]"
                aria-label={labels.visibility}
              >
                {optionsFor(labels.visibilityOwn)}
              </NativeComboboxSelect>
              <span className="text-xs font-normal text-muted-foreground">{labels.visibilityHint}</span>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              <span>{labels.noteBody}</span>
              <textarea
                className="min-h-52 w-full resize-y rounded-lg border border-input bg-field px-3 py-3 text-sm font-normal leading-6 outline-none placeholder:font-normal placeholder:text-muted-foreground/45 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
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
