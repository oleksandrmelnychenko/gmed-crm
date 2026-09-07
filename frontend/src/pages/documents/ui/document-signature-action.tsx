import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OverlayDirtyContext } from "@/components/ui/dismissal-guard";
import { apiFetch, clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import type { DocumentItem } from "../model/types";
import { DocumentSignaturePanel } from "./document-signature-panel";
import { SignatureDocumentPreview } from "./signature-document-preview";
import { refreshSignatureSummaries, useSignatureSummary } from "../data/use-signature-summary";
import type { SignatureRequest, SignatureState } from "../data/document-signature-api";
import { signaturePresentation } from "./signature-status";

type DocumentScope = { patientId?: string | null; orderId?: string | null; leadId?: string | null };
type Props = {
  title: string;
  iconOnly?: boolean;
  disabled?: boolean;
  onDone?: () => void;
} & ({ documentId: string; scope?: never } | { documentId?: never; scope: DocumentScope });

// Opening a dialog is read-only. The existing signing API remains the authority
// for document ACLs, PDF eligibility and permission to send invitations.
export function DocumentSignatureAction({ documentId, scope, title, iconOnly, disabled, onDone }: Props) {
  const { user } = useAuth();
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const changed = useRef(false);
  const summary = useSignatureSummary(user && ["ceo", "patient_manager", "it_admin"].includes(user.role) ? user.id : undefined, documentId);
  const presentation = signaturePresentation(summary, lang);
  if (!user || !["ceo", "patient_manager", "it_admin"].includes(user.role)) return null;
  if (!documentId && !scope?.patientId && !scope?.orderId && !scope?.leadId) return null;
  const label = lang === "de" ? "Elektronische Unterschrift" : "Электронная подпись";

  return <>
    <Button
      type="button" variant={iconOnly ? "ghost" : "outline"} size={iconOnly ? "icon-sm" : "sm"}
      title={presentation.label} aria-label={`${label}: ${title}`} disabled={disabled}
      aria-description={summary ? presentation.label : undefined}
      className={presentation.className} data-signature-status={summary?.status ?? "none"}
      data-document-signature-id={documentId}
      onClick={event => { event.stopPropagation(); setOpen(true); }}
      onKeyDown={event => event.stopPropagation()}
    >
      <presentation.Icon aria-hidden="true" className="size-4" />{!iconOnly ? presentation.label : null}
    </Button>
    <Dialog open={open} onOpenChange={nextOpen => {
      setOpen(nextOpen);
      if (!nextOpen) setDirty(false);
      if (!nextOpen && changed.current) { changed.current = false; onDone?.(); }
    }} dirty={dirty}>
      <DialogContent className="grid h-[min(940px,calc(100dvh-1rem))] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl p-0 sm:h-[min(92dvh,940px)] sm:w-[96vw] sm:max-w-[1480px]" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => {
        if (["Enter", " ", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) event.stopPropagation();
      }}>
        <DialogHeader className="border-b border-border/70 px-5 py-4 pr-14">
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription className="break-words text-xs">{title}</DialogDescription>
        </DialogHeader>
          {open ? <SignatureWorkspace key={documentId ?? `${scope?.patientId}:${scope?.orderId}:${scope?.leadId}`} documentId={documentId} scope={scope} title={title} onDirtyChange={setDirty} onDone={() => { changed.current = true; }} /> : null}
      </DialogContent>
    </Dialog>
  </>;
}

function SignatureWorkspace({ documentId, scope, title, onDone, onDirtyChange }: {
  documentId?: string; scope?: DocumentScope; title: string; onDone?: () => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const { lang } = useLang();
  const overlay = useContext(OverlayDirtyContext);
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selectedId, setSelectedId] = useState(documentId ?? "");
  const [loading, setLoading] = useState(!documentId);
  const [error, setError] = useState(false);
  const [previewedId, setPreviewedId] = useState("");
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [previewedDocuments, setPreviewedDocuments] = useState<string[]>([]);
  const handlePreviewReady = useCallback((id: string) => {
    setPreviewedId(id);
    if (id) setPreviewedDocuments(current => current.includes(id) ? current : [...current, id]);
  }, []);
  const [signatureState, setSignatureState] = useState<SignatureState | null>(null);
  const [resultPreview, setResultPreview] = useState<SignatureRequest | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [composingNew, setComposingNew] = useState(false);
  const lastResult = useRef<string | null>(null);
  const receiveState = useCallback((next: SignatureState) => {
    const resultId = next.requests[0]?.result_document_id ?? null;
    if (resultId && resultId !== lastResult.current) { setResultPreview(null); setShowOriginal(false); setComposingNew(false); }
    lastResult.current = resultId;
    setSignatureState(next);
  }, []);
  const latestResult = signatureState?.requests[0]?.result_document_id ? signatureState.requests[0] : null;
  const availableResult = resultPreview ?? latestResult;
  const displayedResult = showOriginal ? null : availableResult;
  const originalId = composingNew ? selectedId : availableResult?.source_document_id ?? selectedId;
  const previewId = attachmentPreview ?? displayedResult?.result_document_id ?? (showOriginal ? originalId : selectedId);
  const patientId = scope?.patientId;
  const orderId = scope?.orderId;
  const leadId = scope?.leadId;

  useEffect(() => {
    if (documentId) return;
    let cancelled = false;
    const params = new URLSearchParams();
    if (patientId) params.set("patient_id", patientId);
    if (orderId) params.set("order_id", orderId);
    if (leadId) params.set("lead_id", leadId);
    void apiFetch<DocumentItem[]>(`/documents?${params}`, { forceFresh: true })
      .then(rows => {
        if (!cancelled) setDocuments(rows.filter(row => row.has_stored_file && row.mime_type?.split(";", 1)[0]?.trim().toLowerCase() === "application/pdf"));
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [documentId, patientId, orderId, leadId]);

  const selectedTitle = documentId ? title : documents.find(row => row.id === selectedId)?.auto_name ?? title;
  return <div className="grid min-h-0 overflow-y-auto lg:grid-cols-[minmax(0,1.1fr)_minmax(26rem,0.9fr)] lg:overflow-hidden">
    <section aria-label={tx("Документ для подписи", "Dokument zur Unterschrift")} className="flex min-h-[28rem] min-w-0 flex-col border-b border-border/70 bg-muted/15 lg:min-h-0 lg:border-r lg:border-b-0">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-card px-4 py-3">
        <AdminSectionTitle>{attachmentPreview ? tx("Приложение для ознакомления", "Anlage zur Kenntnisnahme") : displayedResult ? `${displayedResult.test_mode ? "TEST · " : ""}${tx("Подписанный PDF", "Signiertes PDF")}` : tx("Документ для подписи", "Dokument zur Unterschrift")}</AdminSectionTitle>
        {attachmentPreview ? <Button type="button" size="sm" variant="outline" onClick={() => setAttachmentPreview(null)}>{tx("К основному документу", "Zum Hauptdokument")}</Button> : null}
        {selectedId && !attachmentPreview ? <span className="min-w-0 break-words text-xs text-muted-foreground">{selectedTitle}</span> : null}
        {availableResult && !attachmentPreview ? <div className="flex w-full flex-wrap gap-2" aria-label={tx("Версия PDF", "PDF-Version")}>
          <Button type="button" size="sm" variant={displayedResult ? "outline" : "default"} aria-pressed={!displayedResult} onClick={() => setShowOriginal(true)}>{tx("Исходный PDF", "Original-PDF")}</Button>
          <Button type="button" size="sm" variant={displayedResult ? "default" : "outline"} aria-pressed={!!displayedResult} onClick={() => setShowOriginal(false)}>{availableResult.test_mode ? "TEST · " : ""}{tx("Подписанный PDF", "Signiertes PDF")}</Button>
        </div> : null}
      </div>
      {!documentId || error ? <div className="space-y-3 p-4">
        {!documentId ? <>
          <p className="text-xs leading-5 text-muted-foreground">{tx("Выберите сохранённый PDF. Запрос подписи относится к выбранному документу.", "Wählen Sie die gespeicherte PDF. Die Signaturanfrage gilt für das ausgewählte Dokument.")}</p>
          {loading ? <p role="status" className="text-sm"><LoaderCircle className="mr-2 inline size-4 animate-spin" />{tx("Загрузка…", "Wird geladen…")}</p> : null}
          {!loading && !error && documents.length === 0 ? <p className="text-sm">{tx("В этой карточке пока нет сохранённых PDF. Сначала создайте или загрузите документ.", "In dieser Karte gibt es noch keine gespeicherten PDFs. Erstellen oder laden Sie zuerst ein Dokument hoch.")}</p> : null}
          {documents.length > 0 ? <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">{tx("Выберите PDF", "PDF auswählen")}
            <NativeComboboxSelect className="h-10 bg-field text-sm font-normal text-foreground" value={selectedId} onChange={event => {
              const nextId = event.target.value;
              if (nextId === selectedId) return;
              const selectDocument = () => { onDirtyChange(false); setPreviewedId(""); setAttachmentPreview(null); setPreviewedDocuments([]); setSignatureState(null); setResultPreview(null); setShowOriginal(false); setComposingNew(false); setSelectedId(nextId); };
              if (!overlay || overlay.confirmDismiss(selectDocument)) selectDocument();
            }}>
              <option value="">{tx("Выберите документ", "Dokument auswählen")}</option>
              {documents.map(row => <option key={row.id} value={row.id}>{row.auto_name || row.original_filename} · v{row.version_number}{row.is_latest_version ? "" : tx(" · предыдущая версия", " · frühere Version")}</option>)}
            </NativeComboboxSelect>
          </label> : null}
        </> : null}
        {error ? <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">{tx("Не удалось загрузить документ. Повторите открытие окна.", "Dokument konnte nicht geladen werden. Öffnen Sie das Fenster erneut.")}</p> : null}
      </div> : null}
      {previewId ? <SignatureDocumentPreview key={previewId} documentId={previewId} onReady={handlePreviewReady} /> : null}
    </section>
    <section aria-label={tx("Подписание документа", "Dokument unterzeichnen")} className="min-w-0 space-y-4 bg-muted/10 p-3.5 lg:overflow-y-auto">
    {selectedId ? <DocumentSignaturePanel key={selectedId} documentId={selectedId} previewReady={previewedId === selectedId && !displayedResult && !attachmentPreview} previewedDocumentIds={previewedDocuments} onPreviewAttachment={setAttachmentPreview} expanded onDirtyChange={onDirtyChange} onStateChange={receiveState} onPreviewResult={request => { setAttachmentPreview(null); setResultPreview(request); setShowOriginal(false); }} onComposeNew={() => { setAttachmentPreview(null); setComposingNew(true); setShowOriginal(true); setResultPreview(null); }} onDone={() => {
      clearApiCache("/documents");
      refreshSignatureSummaries();
      onDone?.();
    }} /> : null}
    </section>
  </div>;
}
