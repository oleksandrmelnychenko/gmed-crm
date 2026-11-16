import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";

import { Banner } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { copyText } from "@/lib/copy-text";

import type { PayerLinkIssuedCode } from "../data/lead-payer-link-api";
import type { Tx } from "../model/lead-payer-link";

/**
 * The code the CEO issued by hand (2026-11-16), shown once: closing the
 * dialog drops it; the server keeps only its hash.
 */
export function LeadPayerManualCodeDialog({ issued, tx, onClose }: { issued: PayerLinkIssuedCode; tx: Tx; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  async function copy(container: Element | null) {
    const ok = await copyText(issued.code, container);
    setCopied(ok);
    setCopyError(!ok);
  }
  return (
    <Dialog open dirty={false} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined} data-testid="lead-payer-manual-code-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-[var(--brand)]" />
            {tx("Код для плательщика", "Code für den Zahler")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <output
              className="select-all rounded-lg border bg-muted/30 px-4 py-2 font-mono text-3xl font-semibold tracking-[0.3em] text-foreground"
              data-testid="lead-payer-manual-code"
            >
              {issued.code}
            </output>
            <Button type="button" size="sm" onClick={(event) => void copy(event.currentTarget.closest("[role='dialog']"))}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {tx("Скопировать", "Kopieren")}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground" data-testid="lead-payer-manual-code-valid">
            {tx("Действует до", "Gültig bis")} {formatAppDateTime(issued.expires_at)}
          </p>
          {copyError ? <Banner tone="error">{tx("Не удалось скопировать.", "Kopieren fehlgeschlagen.")}</Banner> : null}
          {copied ? <span className="sr-only" role="status">{tx("Скопировано", "Kopiert")}</span> : null}
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>{tx("Закрыть", "Schließen")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
