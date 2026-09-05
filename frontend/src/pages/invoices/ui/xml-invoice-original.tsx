import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

export function XmlInvoiceOriginal({ file, url }: { file: File; url: string }) {
  const { lang } = useLang();
  const [content, setContent] = useState<{ file: File; text: string; truncated: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void file.text().then((text) => {
      if (!cancelled) setContent({ file, text: text.slice(0, 200_000), truncated: text.length > 200_000 });
    }).catch(() => {
      if (!cancelled) setContent({ file, text: lang === "de" ? "Original konnte nicht gelesen werden." : "Не удалось прочитать оригинал.", truncated: false });
    });
    return () => { cancelled = true; };
  }, [file, lang]);
  const current = content?.file === file ? content : null;
  return <div className="m-3 flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm lg:min-h-0">
    <div className="flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2 text-xs">
      <span>{lang === "de" ? "XML-Original als Text" : "Оригинал XML как текст"}</span>
      <a href={url} download={file.name} className="underline underline-offset-2">{lang === "de" ? "Original herunterladen" : "Скачать оригинал"}</a>
    </div>
    {current?.truncated ? <p className="p-3 text-xs text-muted-foreground">{lang === "de" ? "Vorschau gekürzt. Der Download enthält die vollständige Datei." : "Предпросмотр сокращён. Скачивание содержит весь файл."}</p> : null}
    <pre aria-label={lang === "de" ? "XML-Inhalt" : "Содержимое XML"} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-3 text-xs">{current?.text ?? (lang === "de" ? "Wird gelesen…" : "Читаем…")}</pre>
  </div>;
}
