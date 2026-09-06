import { useEffect, useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/i18n";
import { createDocumentPreviewObjectUrl, revokeDocumentPreviewObjectUrl } from "../data/document-api";

export function SignatureDocumentPreview({ documentId, onReady }: { documentId: string; onReady: (id: string) => void }) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    void createDocumentPreviewObjectUrl(documentId).then(preview => {
      objectUrl = preview.url;
      if (cancelled) { revokeDocumentPreviewObjectUrl(objectUrl); return; }
      if (preview.contentType.split(";", 1)[0] !== "application/pdf") {
        revokeDocumentPreviewObjectUrl(objectUrl); objectUrl = ""; setError(true); return;
      }
      setUrl(objectUrl); onReady(documentId);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; if (objectUrl) revokeDocumentPreviewObjectUrl(objectUrl); };
  }, [documentId, onReady, revision]);
  return <div className="m-3 flex min-h-[360px] flex-1 overflow-hidden rounded-lg border border-border/70 bg-white shadow-sm lg:min-h-0">
    {url ? <iframe title={tx("PDF для подписи", "PDF zur Unterschrift")} src={`${url}#toolbar=1&view=FitH`} className="min-h-[360px] w-full flex-1 bg-white lg:min-h-0" />
      : <div className="flex flex-1 flex-col items-center justify-center gap-3 p-5 text-center text-xs leading-5 text-muted-foreground">
        {error ? <><FileText className="size-7" /><p role="alert">{tx("Не удалось открыть PDF. Повторите загрузку превью перед отправкой.", "PDF konnte nicht geöffnet werden. Laden Sie die Vorschau vor dem Versand erneut.")}</p><Button type="button" size="sm" variant="outline" onClick={() => { setError(false); setRevision(value => value + 1); }}>{tx("Повторить загрузку", "Erneut laden")}</Button></>
          : <><LoaderCircle aria-hidden="true" className="size-5 animate-spin" /><p role="status">{tx("Загрузка PDF…", "PDF wird geladen…")}</p></>}
      </div>}
  </div>;
}
