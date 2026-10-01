import { useEffect, useId, useState, type ReactNode } from "react";
import { Download, Eye, FileWarning, LoaderCircle, type LucideIcon } from "lucide-react";

import type { ColumnDef } from "@/components/data-table/types";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { CountBadge, Field, textareaClass, tokens } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { downloadBlob } from "@/lib/api";
import { getLang, useLang, type Translations } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { canPreviewInline } from "./model";
import { localizePersonnelError } from "./server-errors";

/** Server message in the UI language (see `server-errors.ts`), or `fallback`. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message
    ? localizePersonnelError(error.message, getLang())
    : fallback;
}

/** Translated category name; the archive label (e.g. "Stundenzettel") when unknown. */
export function categoryLabel(t: Translations, code: string, fallback?: string): string {
  const tr = t as unknown as Record<string, string | undefined>;
  return tr[`personnel_category_${code}`] ?? fallback ?? code;
}

/** Short category name for narrow column headers (completeness matrix). */
export function categoryShortLabel(t: Translations, code: string, fallback?: string): string {
  const tr = t as unknown as Record<string, string | undefined>;
  return tr[`personnel_category_short_${code}`] ?? categoryLabel(t, code, fallback);
}

export function sourceLabel(t: Translations, source: string): string {
  const tr = t as unknown as Record<string, string | undefined>;
  return tr[`personnel_source_${source}`] ?? source;
}

/** The archive file name, monospaced: it is the legally relevant identifier. */
export function ArchiveName({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("break-all font-mono text-xs text-foreground", className)}>{name}</span>
  );
}

/** Muted one-line notice (the app's read-only banner look). */
export function MutedNote({
  icon: Icon,
  children,
  className,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-sm text-muted-foreground",
        className,
      )}
    >
      {Icon ? <Icon aria-hidden className="mt-0.5 size-4 shrink-0" /> : null}
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** Section title at the start of a table toolbar (like the providers' interaction history). */
export function TableTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <>
      <span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
        {children}
        {count !== undefined ? <CountBadge>{count}</CountBadge> : null}
      </span>
      <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
    </>
  );
}

/**
 * The eye-icon preview column of the app's document tables. Personnel files
 * are not GMed documents, so the shared column (with its e-signature action)
 * is not used here.
 */
export function previewColumn<T>({
  label,
  getTitle,
  onPreview,
}: {
  label: string;
  getTitle: (row: T) => string;
  onPreview: (row: T) => void;
}): ColumnDef<T> {
  return {
    id: "preview",
    label,
    accessor: () => "",
    sortable: false,
    required: true,
    pinned: "left",
    width: 56,
    cellClassName: "flex items-center justify-center",
    render: (row) => (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title={label}
        aria-label={`${label}: ${getTitle(row)}`}
        onClick={(event) => {
          event.stopPropagation();
          onPreview(row);
        }}
      >
        <Eye className="size-4" />
      </Button>
    ),
  };
}

/** Icon-only row action of the app's tables (ghost, 3.5 icon, title + aria-label). */
export function RowIconAction({
  icon: Icon,
  label,
  onClick,
  destructive = false,
  disabled = false,
  busy = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        destructive && "size-7 shrink-0 rounded-md text-destructive hover:bg-destructive/10 hover:text-destructive",
      )}
      title={label}
      aria-label={label}
      disabled={disabled || busy}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
    </Button>
  );
}

type LoadedFile = { blob: Blob; contentType: string; filename: string | null };

/** Same rule as the documents pages: PDFs keep the viewer, everything else is fully sandboxed. */
function previewSandbox(mimeType: string): string | undefined {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() === "application/pdf" ? undefined : "";
}

/**
 * Shows a stored file in the app's document preview shell through a blob URL
 * (the API needs the bearer token, so a plain link cannot open it). TIFF and
 * unknown types are offered as a download only.
 */
export function FilePreviewDialog({
  open,
  fileName,
  mimeType,
  load,
  onClose,
  note,
}: {
  open: boolean;
  fileName: string;
  mimeType: string;
  load: () => Promise<LoadedFile>;
  onClose: () => void;
  /** Shown after the MIME type, e.g. that the access is logged. */
  note?: ReactNode;
}) {
  const { t } = useLang();
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError("");
    setFile(null);
    setUrl(null);
    load()
      .then((loaded) => {
        if (cancelled) return;
        setFile(loaded);
        if (canPreviewInline(mimeType)) {
          objectUrl = URL.createObjectURL(
            loaded.blob.type ? loaded.blob : new Blob([loaded.blob], { type: mimeType }),
          );
          setUrl(objectUrl);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorMessage(reason, t.common_failed_load));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // `load` is recreated by callers on every render; the file is identified by name.
  }, [open, fileName, mimeType]);

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)} allowImplicitDismissal>
      <DialogContent className="flex h-[86vh] w-[94vw] max-w-none flex-col overflow-hidden rounded-xl p-0 duration-0 data-closed:animate-none data-open:animate-none sm:w-[78vw] sm:max-w-[1500px]">
        <DialogHeader className="border-b border-border/70 px-5 py-4">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-4 pr-10">
            <div className="min-w-0">
              <DialogTitle className="truncate font-mono text-base" title={fileName}>
                {fileName || t.personnel_preview}
              </DialogTitle>
              <DialogDescription className="truncate">
                {[mimeType, note].filter(Boolean).map((part, index) => (
                  <span key={index}>
                    {index > 0 ? " · " : ""}
                    {part}
                  </span>
                ))}
              </DialogDescription>
            </div>
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 gap-1.5 rounded-lg"
              disabled={!file}
              onClick={() => file && downloadBlob(file.blob, file.filename || fileName)}
            >
              <Download className="size-3.5" />
              {t.personnel_download}
            </Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 bg-slate-50 p-3">
          {loading ? (
            <div className="flex h-full min-h-80 items-center justify-center rounded-lg border border-border bg-white text-sm text-muted-foreground">
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              {t.common_loading}
            </div>
          ) : error ? (
            <div
              role="alert"
              className="flex h-full min-h-80 items-center justify-center rounded-lg border border-destructive/30 bg-white p-8 text-center text-sm text-destructive"
            >
              {error}
            </div>
          ) : url ? (
            <iframe
              title={fileName || t.personnel_preview}
              src={url}
              sandbox={previewSandbox(mimeType)}
              className="h-full min-h-[560px] w-full rounded-lg border border-border bg-white"
            />
          ) : file ? (
            <div className="flex h-full min-h-80 flex-col items-center justify-center rounded-lg border border-border bg-white p-8 text-center">
              <FileWarning className="mb-3 size-8 text-muted-foreground" />
              <p className="max-w-md text-sm text-muted-foreground">{t.personnel_preview_unavailable}</p>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Asks for a mandatory reason before a recorded action (discard, delete, legal hold). */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  optional = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** The reason may stay empty (e.g. releasing a legal hold). */
  optional?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLang();
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
      setError("");
    }
  }, [open]);

  const reasonValid = optional || Boolean(reason.trim());

  const submit = async () => {
    if (!reasonValid) {
      setError(t.personnel_reason_required);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (reasonError) {
      setError(errorMessage(reasonError, t.common_failed_update));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)} dirty={Boolean(reason)}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field
            label={optional ? t.personnel_reason_optional : t.personnel_reason}
            htmlFor={reasonId}
            required={!optional}
          >
            <textarea
              id={reasonId}
              className={cn(textareaClass, "min-h-24")}
              value={reason}
              maxLength={2000}
              disabled={busy}
              aria-invalid={Boolean(error) && !reasonValid}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {error ? (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <p>{error}</p>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t.common_cancel}
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={busy || !reasonValid}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A titled soft card grouping related fields, as in the other admin sheets. */
export function FormSection({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className={cn("space-y-4 rounded-xl p-3.5", tokens.surface.softCard)}>
      <div className="space-y-1">
        <AdminSectionTitle>{title}</AdminSectionTitle>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}
