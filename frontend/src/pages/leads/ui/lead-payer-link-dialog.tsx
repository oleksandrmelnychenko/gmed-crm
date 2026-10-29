import { useState } from "react";
import { Check, Copy, Link as LinkIcon, LoaderCircle, Mail } from "lucide-react";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Banner } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusChip } from "@/components/ui/status-chip";
import { copyText } from "@/lib/copy-text";
import { cn } from "@/lib/utils";
import { PAYER_LINK_LANGUAGES, type PayerLinkLanguage, type PayerLinkShare } from "../data/lead-payer-link-api";
import type { Tx } from "../model/lead-payer-link";

const LANGUAGE_LABELS: Record<PayerLinkLanguage, string> = { de: "DE", en: "EN", uk: "UA", ru: "RU" };

export function LeadPayerLinkDialog({ share, language, onLanguage, busy, canSend, error, notice, tx, onSend, onClose }: {
  share: PayerLinkShare;
  language: PayerLinkLanguage;
  onLanguage: (language: PayerLinkLanguage) => void;
  busy: boolean;
  canSend: boolean;
  error: string;
  notice: string;
  tx: Tx;
  onSend: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"link" | "message" | null>(null);
  const [copyError, setCopyError] = useState(false);
  async function copy(kind: "link" | "message", container: Element | null) {
    const ok = await copyText(kind === "link" ? share.url : share.messages[language], container);
    setCopied(ok ? kind : null);
    setCopyError(!ok);
  }
  return (
    <Dialog open dirty={false} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:w-[calc(100vw-3rem)] sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><LinkIcon className="size-5 text-[var(--brand)]" />{tx("Ссылка для плательщика", "Zahler-Link")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 bg-muted/30 p-4 sm:p-5">
          <section className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <AdminSectionTitle>{tx("Получатель", "Empfänger")}</AdminSectionTitle>
              <StatusChip tone="warning" className="min-w-0 break-all"><Mail className="size-3.5" />{share.email}</StatusChip>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input aria-label={tx("Ссылка", "Link")} readOnly value={share.url} className="h-9 min-w-0 basis-full sm:basis-0 flex-1 rounded-lg border bg-muted/20 px-3 font-mono text-xs text-foreground" />
              <Button type="button" size="sm" onClick={(event) => void copy("link", event.currentTarget.closest("[role='dialog']"))}>
                {copied === "link" ? <Check className="size-4" /> : <Copy className="size-4" />}{tx("Скопировать ссылку", "Link kopieren")}
              </Button>
            </div>
          </section>
          <section className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <AdminSectionTitle>{tx("Сообщение для плательщика", "Nachricht für den Zahler")}</AdminSectionTitle>
              <div className="inline-flex gap-1 rounded-lg border bg-muted/30 p-1" role="group" aria-label={tx("Язык сообщения", "Sprache der Nachricht")}>
                {PAYER_LINK_LANGUAGES.map((option) => <button key={option} type="button" disabled={busy} aria-pressed={language === option}
                  className={cn("h-7 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", language === option ? "bg-[var(--brand)] text-white shadow-sm" : "text-foreground hover:bg-muted")}
                  onClick={() => { onLanguage(option); setCopied(null); }}>{LANGUAGE_LABELS[option]}</button>)}
              </div>
            </div>
            <div className="max-h-[35vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/25 p-3 text-sm leading-6 text-foreground">{share.messages[language]}</div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={(event) => void copy("message", event.currentTarget.closest("[role='dialog']"))}>
                {copied === "message" ? <Check className="size-4" /> : <Copy className="size-4" />}{tx("Скопировать сообщение", "Nachricht kopieren")}
              </Button>
              <Button type="button" size="sm" disabled={busy || !canSend} onClick={onSend}>
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Mail className="size-4" />}{tx("Отправить по e-mail", "Per E-Mail senden")}
              </Button>
            </div>
            {!canSend && <p className="text-xs text-muted-foreground">{tx("Отправка по e-mail сейчас недоступна. Сообщение можно скопировать.", "E-Mail-Versand ist derzeit nicht verfügbar. Sie können die Nachricht kopieren.")}</p>}
          </section>
          {copyError && <Banner tone="error">{tx("Не удалось скопировать. Выделите и скопируйте текст вручную.", "Kopieren fehlgeschlagen. Bitte den Text markieren und manuell kopieren.")}</Banner>}
          {error && <Banner tone="error">{error}</Banner>}
          {notice && <StatusChip tone="success" role="status">{notice}</StatusChip>}
          {copied && <span className="sr-only" role="status">{tx("Скопировано", "Kopiert")}</span>}
        </div>
        <DialogFooter><Button type="button" disabled={busy} onClick={onClose}>{tx("Готово", "Fertig")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
