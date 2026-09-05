import { useEffect, useRef, useState } from "react";
import { Download, Eye, FileText, LoaderCircle, Shield, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { chatAttachmentMime, chatAttachmentPreviewKind, downloadChatAttachment } from "../model/attachments";
import { formatSize } from "../model/chat-model";
import type { Message } from "../model/types";

function useBlobUrl(blob: Blob | null) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) { setUrl(""); return; }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function AttachmentPreview({ blob, filename, onClose }: { blob: Blob; filename: string; onClose: () => void }) {
  const { t } = useLang();
  const url = useBlobUrl(blob);
  const kind = chatAttachmentPreviewKind(filename);
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (kind === "text") void blob.slice(0, 256_000).text().then((value) => { if (!cancelled) setText(value); });
    if (kind === "pdf") void blob.slice(0, 5).text().then((value) => { if (!cancelled && value !== "%PDF-") setFailed(true); });
    return () => { cancelled = true; };
  }, [blob, kind]);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} dirty={false}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="break-all">{filename}</DialogTitle>
          <DialogDescription>{formatSize(blob.size)}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-auto rounded-lg border bg-muted/20">
          {failed || !kind ? <p className="p-5 text-sm text-muted-foreground">{t.chat_attachment_preview_unavailable}</p>
            : kind === "image" ? <img src={url || undefined} alt={filename} onError={() => setFailed(true)} className="mx-auto max-h-[65dvh] object-contain" />
            : kind === "pdf" ? <iframe src={url || undefined} title={filename} className="h-[65dvh] w-full" referrerPolicy="no-referrer" />
            : <pre className="max-h-[65dvh] whitespace-pre-wrap break-words p-4 text-sm">{text}{blob.size > 256_000 ? `\n\n${t.chat_attachment_preview_truncated}` : ""}</pre>}
        </div>
        <div className="flex justify-end"><Button type="button" onClick={() => downloadChatAttachment(blob, filename)}><Download />{t.chat_attachment_download}</Button></div>
      </DialogContent>
    </Dialog>
  );
}

export function PendingAttachment({ file, busy, onRemove }: { file: File; busy: boolean; onRemove: () => void }) {
  const { t } = useLang();
  const [preview, setPreview] = useState(false);
  const kind = chatAttachmentPreviewKind(file.name);
  const [blob] = useState(() => new Blob([file], { type: chatAttachmentMime(file.name) }));
  const thumbnail = useBlobUrl(kind === "image" ? blob : null);
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-background px-2 py-1.5">
      <button type="button" disabled={!kind || busy} onClick={() => setPreview(true)} aria-label={`${t.chat_attachment_preview}: ${file.name}`} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {thumbnail ? <img src={thumbnail} alt="" className="size-10 shrink-0 rounded object-cover" /> : <FileText className="size-5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{file.name}</span><span className="text-[10px] text-muted-foreground">{formatSize(file.size)}</span></span>
      </button>
      <Button type="button" variant="ghost" size="icon-sm" disabled={busy} onClick={onRemove} aria-label={`${t.common_remove}: ${file.name}`}><X className="size-4" /></Button>
      {preview ? <AttachmentPreview blob={blob} filename={file.name} onClose={() => setPreview(false)} /> : null}
    </div>
  );
}

export function ChatAttachment({ message, mine, loadBlob }: { message: Message; mine: boolean; loadBlob: (message: Message) => Promise<Blob> }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Blob | null>(null);
  const mounted = useRef(true);
  const lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const filename = message.attachment_filename || "attachment";
  const canPreview = Boolean(chatAttachmentPreviewKind(filename));
  async function open(action: "preview" | "download") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const blob = await loadBlob(message);
      if (!mounted.current) return;
      if (action === "preview") setPreview(blob);
      else downloadChatAttachment(blob, filename);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : t.chat_attachment_load_failed);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div data-testid={`chat-attachment-${message.id}`} className="mb-1 w-full max-w-[340px]">
      <div className={cn("rounded-xl px-3 py-2", mine ? "bg-foreground/90 text-background" : "bg-muted")}>
        <button type="button" onClick={() => void open("download")} disabled={busy} aria-label={`${t.chat_attachment_download}: ${filename}`} className="flex w-full min-w-0 items-center gap-2.5 text-left disabled:opacity-60">
          {busy ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : message.attachment_is_e2e ? <Shield className="size-4 shrink-0" /> : <FileText className="size-4 shrink-0" />}
          <span className="min-w-0 flex-1"><span className="block break-all text-xs font-medium">{filename}</span><span className="text-[10px] opacity-70">{formatSize(message.attachment_size ?? 0)}</span></span>
          <Download className="size-3.5 shrink-0 opacity-70" />
        </button>
        {canPreview ? <button type="button" disabled={busy} onClick={() => void open("preview")} className="mt-2 flex items-center gap-1.5 text-[11px] underline underline-offset-2 disabled:opacity-60" aria-label={`${t.chat_attachment_preview}: ${filename}`}><Eye className="size-3.5" />{t.chat_attachment_preview}</button> : null}
        {message.attachment_is_e2e ? <p className="mt-1 text-[10px] opacity-70">{t.chat_secure_attachment_unscanned}</p> : null}
      </div>
      {error ? <p role="alert" className="mt-1 break-words text-xs text-destructive">{error}</p> : null}
      {preview ? <AttachmentPreview blob={preview} filename={filename} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}
