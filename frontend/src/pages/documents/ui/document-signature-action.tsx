import { useContext, useEffect, useRef, useState } from "react";
import { Download, FileSignature, LoaderCircle } from "lucide-react";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OverlayDirtyContext } from "@/components/ui/dismissal-guard";
import { apiFetch, clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { downloadDocumentFile } from "../data/document-api";
import type { DocumentItem } from "../model/types";
import { DocumentSignaturePanel } from "./document-signature-panel";

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
  if (!user || !["ceo", "patient_manager", "it_admin"].includes(user.role)) return null;
  if (!documentId && !scope?.patientId && !scope?.orderId && !scope?.leadId) return null;
  const label = lang === "de" ? "Elektronische Unterschrift" : "Электронная подпись";

  return <>
    <Button
      type="button" variant={iconOnly ? "ghost" : "outline"} size={iconOnly ? "icon-sm" : "sm"}
      title={label} aria-label={`${label}: ${title}`} disabled={disabled}
      data-document-signature-id={documentId}
      onClick={event => { event.stopPropagation(); setOpen(true); }}
      onKeyDown={event => event.stopPropagation()}
    >
      <FileSignature aria-hidden="true" className="size-4" />{!iconOnly ? label : null}
    </Button>
    <Dialog open={open} onOpenChange={nextOpen => {
      setOpen(nextOpen);
      if (!nextOpen) setDirty(false);
      if (!nextOpen && changed.current) { changed.current = false; onDone?.(); }
    }} dirty={dirty}>
      <DialogContent className="grid max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl p-0 sm:max-h-[92dvh] sm:max-w-3xl" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => {
        if (["Enter", " ", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) event.stopPropagation();
      }}>
        <DialogHeader className="border-b border-border/70 px-5 py-4 pr-14">
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription className="break-words text-xs">{title}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto bg-muted/10 p-4 sm:p-5">
          {open ? <SignatureWorkspace key={documentId ?? `${scope?.patientId}:${scope?.orderId}:${scope?.leadId}`} documentId={documentId} scope={scope} title={title} onDirtyChange={setDirty} onDone={() => { changed.current = true; }} /> : null}
        </div>
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
  const [downloading, setDownloading] = useState(false);
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
  return <div className="grid gap-4">
    <section className="rounded-xl border border-border/70 bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <AdminSectionTitle>{tx("Документ для подписи", "Dokument zur Unterschrift")}</AdminSectionTitle>
        {selectedId ? <Button type="button" variant="outline" size="sm" className="h-8 rounded-md" disabled={downloading} onClick={() => {
          setDownloading(true); setError(false);
          void downloadDocumentFile(selectedId, selectedTitle).catch(() => setError(true)).finally(() => setDownloading(false));
        }}><Download className="size-3.5" />{tx("Скачать исходный документ", "Ausgangsdokument herunterladen")}</Button> : null}
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
              const selectDocument = () => { onDirtyChange(false); setSelectedId(nextId); };
              if (!overlay || overlay.confirmDismiss(selectDocument)) selectDocument();
            }}>
              <option value="">{tx("Выберите документ", "Dokument auswählen")}</option>
              {documents.map(row => <option key={row.id} value={row.id}>{row.auto_name || row.original_filename} · v{row.version_number}{row.is_latest_version ? "" : tx(" · предыдущая версия", " · frühere Version")}</option>)}
            </NativeComboboxSelect>
          </label> : null}
        </> : null}
        {error ? <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">{tx("Не удалось загрузить документ. Повторите открытие окна.", "Dokument konnte nicht geladen werden. Öffnen Sie das Fenster erneut.")}</p> : null}
      </div> : null}
    </section>
    {selectedId ? <DocumentSignaturePanel key={selectedId} documentId={selectedId} expanded onDirtyChange={onDirtyChange} onDone={() => {
      clearApiCache("/documents");
      onDone?.();
    }} /> : null}
  </div>;
}
