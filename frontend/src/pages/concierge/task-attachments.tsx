import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileImage, FileText, LoaderCircle, Paperclip, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiFetch, clearApiCache, downloadApiFile } from "@/lib/api";
import type { Lang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";

import { conciergeTaskErrorMessage } from "./model";

export type ConciergeTaskAttachment = {
  id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded_by: string;
  uploaded_by_name: string;
  created_at: string;
};

export const TASK_ATTACHMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx";
export const TASK_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

const allowedExtensions = new Set(["pdf", "png", "jpg", "jpeg", "webp", "doc", "docx"]);
const ATTACHMENT_REALTIME_EVENTS = [
  "concierge_operational_item.attachment_added",
  "concierge_operational_item.attachment_deleted",
] as const;

export function taskAttachmentValidationError(file: Pick<File, "name" | "size">) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!allowedExtensions.has(extension)) return "type" as const;
  if (file.size > TASK_ATTACHMENT_MAX_BYTES) return "size" as const;
  return null;
}

export function formatTaskAttachmentSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function taskAttachmentFileKey(file: Pick<File, "name" | "size" | "lastModified">) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function mergeTaskAttachmentFiles(current: File[], incoming: File[]) {
  const known = new Set(current.map(taskAttachmentFileKey));
  return [...current, ...incoming.filter((file) => {
    const key = taskAttachmentFileKey(file);
    if (known.has(key)) return false;
    known.add(key);
    return true;
  })];
}

export function filesMissingFromTaskAttachments(files: File[], attachments: ConciergeTaskAttachment[]) {
  const existing = new Set(attachments.map((attachment) => `${attachment.file_name}:${attachment.file_size}`));
  return files.filter((file) => !existing.has(`${file.name}:${file.size}`));
}

export async function uploadConciergeTaskAttachment(taskId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return apiFetch<ConciergeTaskAttachment>(
    `/concierge-operational-items/${taskId}/attachments`,
    { method: "POST", body, timeoutMs: 60_000 },
  );
}

export function listConciergeTaskAttachments(taskId: string) {
  return apiFetch<ConciergeTaskAttachment[]>(
    `/concierge-operational-items/${taskId}/attachments`,
    { forceFresh: true },
  );
}

const copy = {
  de: {
    title: "Anhänge",
    add: "Dateien anhängen",
    allowed: "PDF, Bilder oder Word · maximal 20 MB pro Datei",
    empty: "Noch keine Dateien angehängt",
    remove: "Datei entfernen",
    confirmRemove: "Diesen Anhang entfernen?",
    loadFailed: "Anhänge konnten nicht geladen werden.",
    uploadFailed: "Die Datei konnte nicht hochgeladen werden.",
    downloadFailed: "Die Datei konnte nicht heruntergeladen werden.",
    removeFailed: "Die Datei konnte nicht entfernt werden.",
    invalidType: "Erlaubt sind PDF, Bilder und Word-Dateien.",
    tooLarge: "Die Datei darf maximal 20 MB groß sein.",
  },
  ru: {
    title: "Файлы",
    add: "Прикрепить файлы",
    allowed: "PDF, изображения или Word · до 20 МБ на файл",
    empty: "Прикреплённых файлов пока нет",
    remove: "Удалить файл",
    confirmRemove: "Удалить этот файл?",
    loadFailed: "Не удалось загрузить список файлов.",
    uploadFailed: "Не удалось прикрепить файл.",
    downloadFailed: "Не удалось скачать файл.",
    removeFailed: "Не удалось удалить файл.",
    invalidType: "Можно прикреплять PDF, изображения и документы Word.",
    tooLarge: "Размер файла не должен превышать 20 МБ.",
  },
} as const;

export function ConciergeTaskAttachments({
  taskId,
  lang,
  canModify,
}: {
  taskId: string;
  lang: Lang;
  canModify: boolean;
}) {
  const labels = copy[lang];
  const inputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<ConciergeTaskAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  const refreshFromRealtime = useCallback((event: { entity_id: string }) => {
    if (event.entity_id === taskId) setVersion((current) => current + 1);
  }, [taskId]);

  useDebouncedRealtimeSubscription(ATTACHMENT_REALTIME_EVENTS, refreshFromRealtime, 250);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void listConciergeTaskAttachments(taskId)
      .then((rows) => {
        if (!cancelled) setAttachments(rows);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : labels.loadFailed);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [labels.loadFailed, taskId, version]);

  async function uploadFiles(files: File[]) {
    if (!canModify || busy || files.length === 0) return;
    setBusy(true);
    setError("");
    try {
      for (const file of files) {
        const validationError = taskAttachmentValidationError(file);
        if (validationError === "type") throw new Error(labels.invalidType);
        if (validationError === "size") throw new Error(labels.tooLarge);
        const created = await uploadConciergeTaskAttachment(taskId, file);
        setAttachments((current) => current.some((item) => item.id === created.id)
          ? current
          : [...current, created]);
      }
      clearApiCache(`/concierge-operational-items/${taskId}/attachments`);
    } catch (uploadError) {
      setError(conciergeTaskErrorMessage(uploadError, lang, labels.uploadFailed));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function downloadAttachment(attachment: ConciergeTaskAttachment) {
    setError("");
    try {
      await downloadApiFile(
        `/concierge-operational-items/${taskId}/attachments/${attachment.id}/download`,
        attachment.file_name,
      );
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : labels.downloadFailed);
    }
  }

  async function removeAttachment(attachment: ConciergeTaskAttachment) {
    if (!canModify || busy || !window.confirm(labels.confirmRemove)) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch<void>(
        `/concierge-operational-items/${taskId}/attachments/${attachment.id}`,
        { method: "DELETE" },
      );
      clearApiCache(`/concierge-operational-items/${taskId}/attachments`);
      setAttachments((current) => current.filter((item) => item.id !== attachment.id));
    } catch (removeError) {
      setError(conciergeTaskErrorMessage(removeError, lang, labels.removeFailed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card" data-testid="concierge-task-attachments">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-3.5 py-2.5">
        <div>
          <div className="flex items-center gap-2"><span className="size-2 shrink-0 rounded-full bg-[var(--brand)]" /><h3 className="text-[13px] font-semibold tracking-tight">{labels.title}</h3></div>
          <p className="mt-0.5 text-xs text-muted-foreground">{labels.allowed}</p>
        </div>
        {canModify ? (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              accept={TASK_ATTACHMENT_ACCEPT}
              onChange={(event) => void uploadFiles(Array.from(event.target.files ?? []))}
            />
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Paperclip />}{labels.add}
            </Button>
          </>
        ) : null}
      </div>
      {error ? <p role="alert" className="mx-3 mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p> : null}
      <div className="divide-y divide-border/60">
        {loading ? <p className="flex items-center justify-center p-5 text-xs text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />{labels.title}</p> : null}
        {!loading && attachments.length === 0 ? <p className="p-5 text-center text-xs text-muted-foreground">{labels.empty}</p> : null}
        {attachments.map((attachment) => (
          <div key={attachment.id} className="flex items-center gap-3 px-3 py-2.5">
            {attachment.mime_type.startsWith("image/") ? <FileImage className="size-5 shrink-0 text-violet-600" /> : <FileText className="size-5 shrink-0 text-sky-600" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{attachment.file_name}</p>
              <p className="text-xs text-muted-foreground">{formatTaskAttachmentSize(attachment.file_size)} · {attachment.uploaded_by_name}</p>
            </div>
            <Button type="button" size="icon-sm" variant="ghost" title={attachment.file_name} disabled={busy} onClick={() => void downloadAttachment(attachment)}><Download /></Button>
            {canModify ? <Button type="button" size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" title={labels.remove} disabled={busy} onClick={() => void removeAttachment(attachment)}><Trash2 /></Button> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ConciergeTaskStagedAttachments({
  files,
  lang,
  disabled,
  externalError = "",
  onChange,
}: {
  files: File[];
  lang: Lang;
  disabled: boolean;
  externalError?: string;
  onChange: (files: File[]) => void;
}) {
  const labels = copy[lang];
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  function addFiles(incoming: File[]) {
    const invalid = incoming.find((file) => taskAttachmentValidationError(file));
    if (invalid) {
      setError(taskAttachmentValidationError(invalid) === "size" ? labels.tooLarge : labels.invalidType);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setError("");
    onChange(mergeTaskAttachmentFiles(files, incoming));
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card" data-testid="concierge-task-staged-attachments">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-3.5 py-2.5">
        <div>
          <div className="flex items-center gap-2"><span className="size-2 shrink-0 rounded-full bg-[var(--brand)]" /><h3 className="text-[13px] font-semibold tracking-tight">{labels.title}</h3></div>
          <p className="mt-0.5 text-xs text-muted-foreground">{labels.allowed}</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept={TASK_ATTACHMENT_ACCEPT}
          onChange={(event) => addFiles(Array.from(event.target.files ?? []))}
        />
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => inputRef.current?.click()}>{disabled ? <LoaderCircle className="animate-spin" /> : <Paperclip />}{labels.add}</Button>
      </div>
      {error || externalError ? <p role="alert" className="mx-3 mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error || externalError}</p> : null}
      <div className="divide-y divide-border/60">
        {files.length === 0 ? <p className="p-5 text-center text-xs text-muted-foreground">{labels.empty}</p> : null}
        {files.map((file) => (
          <div key={taskAttachmentFileKey(file)} className="flex items-center gap-3 px-3 py-2.5">
            {file.type.startsWith("image/") ? <FileImage className="size-5 shrink-0 text-violet-600" /> : <FileText className="size-5 shrink-0 text-sky-600" />}
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file.name}</p><p className="text-xs text-muted-foreground">{formatTaskAttachmentSize(file.size)}</p></div>
            <Button type="button" size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" title={labels.remove} disabled={disabled} onClick={() => onChange(files.filter((item) => taskAttachmentFileKey(item) !== taskAttachmentFileKey(file)))}><Trash2 /></Button>
          </div>
        ))}
      </div>
    </section>
  );
}
