import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Banner, StatusBadge, inputClass, tokens } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";

import {
  clearInvoiceDunningBlock,
  fetchStornoPdfBlob,
  setInvoiceDunningBlock,
} from "../data/invoice-api";
import { activeDunningBlock, formatDate, formatDateTime, isInvoiceReleased } from "../model/invoice-model";
import { localizeInvoiceError } from "../model/invoice-errors";
import type { InvoiceItem } from "../model/types";

async function downloadStornoPdf(invoiceId: string, fileName: string) {
  const blob = await fetchStornoPdfBlob(invoiceId);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** The cancellation document (Stornorechnung) of a released, cancelled invoice. */
export function StornoDocumentCard({ invoice }: { invoice: InvoiceItem }) {
  const { t, lang } = useLang();
  const [error, setError] = useState<string | null>(null);
  const storno = invoice.storno_document;
  if (!storno) return null;
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const fileName = storno.stored_document?.file_name ?? `STORNORECHNUNG-${storno.document_number}.pdf`;
  return (
    <section
      className="space-y-2 rounded-lg border border-border/70 bg-card p-4"
      data-testid="invoice-storno-document"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {t.revenue_invoices_storno_title} {storno.document_number}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDate(storno.issued_on, locale)} ·{" "}
            <span className="font-mono tabular-nums">
              {formatMoneyAmount(storno.amount_gross, storno.currency)}
            </span>
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-lg"
          onClick={() =>
            void downloadStornoPdf(invoice.id, fileName).catch((cause) =>
              setError(localizeInvoiceError(cause, lang, t.common_error)),
            )
          }
        >
          <Download className="size-3.5" />
          {t.revenue_invoices_storno_download}
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{t.revenue_invoices_storno_description}</p>
      <p className="text-xs text-foreground">
        {t.revenue_invoices_status_reason}: {storno.reason}
      </p>
      {error ? <Banner tone="error">{error}</Banner> : null}
    </section>
  );
}

type DunningBlockPanelProps = {
  invoice: InvoiceItem;
  canManage: boolean;
  onChanged: () => void;
};

/** Dunning block (Mahnsperre): shows the active block and sets or clears it. */
export function DunningBlockPanel({ invoice, canManage, onChanged }: DunningBlockPanelProps) {
  const { t, lang } = useLang();
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = activeDunningBlock(invoice);
  const blockable = isInvoiceReleased(invoice) && invoice.status !== "cancelled";
  if (!active && (!blockable || !canManage)) return null;

  async function submit() {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError(t.revenue_invoices_reason_required);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (active) {
        await clearInvoiceDunningBlock(invoice.id, trimmed);
      } else {
        await setInvoiceDunningBlock(invoice.id, trimmed);
      }
      setReason("");
      onChanged();
    } catch (cause) {
      setError(localizeInvoiceError(cause, lang, t.common_error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="space-y-2 rounded-lg border border-border/70 bg-card p-4"
      data-testid="invoice-dunning-block"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{t.revenue_invoices_dunning_block}</span>
        {active ? (
          <StatusBadge tone="warning">
            {t.revenue_invoices_dunning_block_active.replace("{reason}", active.reason)}
          </StatusBadge>
        ) : null}
      </div>
      {active?.blocked_at ? (
        <p className="text-xs text-muted-foreground">{formatDateTime(active.blocked_at, locale)}</p>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">{t.revenue_invoices_dunning_block_hint}</p>
      {canManage ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[240px] flex-1 flex-col gap-1.5">
            <span className={tokens.text.label}>
              {active ? t.revenue_invoices_dunning_block_clear_reason : t.revenue_invoices_dunning_block_reason}
            </span>
            <input
              className={inputClass}
              value={reason}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant={active ? "outline" : "default"}
            className="h-9 rounded-lg"
            disabled={busy || reason.trim().length < 3}
            onClick={() => void submit()}
          >
            {busy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
            {active ? t.revenue_invoices_dunning_block_clear : t.revenue_invoices_dunning_block_set}
          </Button>
        </div>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
    </section>
  );
}
