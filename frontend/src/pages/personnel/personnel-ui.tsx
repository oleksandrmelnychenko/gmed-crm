import { useEffect, useState, type ReactNode } from "react";
import { Download, ExternalLink, LoaderCircle } from "lucide-react";

import { Banner, checkboxClass, textareaClass } from "@/components/ui-shell";
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
import { formatUiText, useLang, type Translations } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { canPreviewInline } from "./model";

export const PERSONNEL_TEXTAREA_CLASS = textareaClass;
export const PERSONNEL_CHECKBOX_CLASS = checkboxClass;

/** Error text of a failed call. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Translated category name; the archive label (e.g. "Stundenzettel") when unknown. */
export function categoryLabel(t: Translations, code: string, fallback?: string): string {
  const tr = t as unknown as Record<string, string | undefined>;
  return tr[`personnel_category_${code}`] ?? fallback ?? code;
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

type LoadedFile = { blob: Blob; contentType: string; filename: string | null };

/**
 * Shows a stored file in a dialog through a blob URL (the API needs the bearer
 * token, so a plain link cannot open it). TIFF and unknown types are offered
 * as a download only.
 */
export function FilePreviewDialog({
  open,
  title,
  fileName,
  mimeType,
  load,
  onClose,
  footerNote,
}: {
  open: boolean;
  title: ReactNode;
  fileName: string;
  mimeType: string;
  load: () => Promise<LoadedFile>;
  onClose: () => void;
  footerNote?: ReactNode;
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
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            <ArchiveName name={fileName} />
          </DialogDescription>
        </DialogHeader>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {loading ? (
          <div className="flex h-48 items-center justify-center text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin" />
          </div>
        ) : null}
        {url && mimeType === "application/pdf" ? (
          <iframe title={fileName} src={url} className="h-[70vh] w-full rounded-lg border border-border" />
        ) : null}
        {url && mimeType !== "application/pdf" ? (
          <div className="flex max-h-[70vh] justify-center overflow-auto rounded-lg border border-border bg-muted/20 p-2">
            <img src={url} alt={fileName} className="max-w-full object-contain" />
          </div>
        ) : null}
        {file && !url ? (
          <p className="text-sm text-muted-foreground">{t.personnel_preview_unavailable}</p>
        ) : null}
        <DialogFooter>
          {footerNote ? (
            <p className="mr-auto self-center text-xs text-muted-foreground">{footerNote}</p>
          ) : null}
          {url ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink />
              {t.personnel_open_new_tab}
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={!file}
            onClick={() => file && downloadBlob(file.blob, file.filename || fileName)}
          >
            <Download />
            {t.personnel_download}
          </Button>
        </DialogFooter>
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
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
      setError("");
    }
  }, [open]);

  const submit = async () => {
    if (!optional && !reason.trim()) {
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">
            {optional ? t.personnel_reason_optional : t.personnel_reason}
          </span>
          <textarea
            className={PERSONNEL_TEXTAREA_CLASS}
            value={reason}
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t.common_cancel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "{count} …" with the count filled in. */
export function countText(template: string, count: number): string {
  return formatUiText(template, { count });
}
