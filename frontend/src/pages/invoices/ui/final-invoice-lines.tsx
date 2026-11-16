import { useEffect, useState, type SetStateAction } from "react";
import { LoaderCircle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { inputClass } from "@/components/ui-shell";
import { agencyServiceNameLabel, agencyServiceUnitCount } from "@/lib/agency-service-labels";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { fetchFinalInvoicePreview } from "../data/invoice-api";
import {
  finalInvoiceSummary,
  finalInvoiceTotals,
  finalLineComparison,
  finalLineQuantity,
  finalOrderServicesPayload,
  finalServiceQuantity,
  formatFinalDifference,
  formatQuantity,
  isFinalSelectionValid,
  type FinalInvoicePreview,
} from "../model/final-invoice";
import { invoiceLineSelectionPayload } from "../model/invoice-model";
import { localizeInvoiceError } from "../model/invoice-errors";
import type { CreateForm, DeliveredOrderService, InvoiceLineItem, QuoteOption } from "../model/types";

type LinesProps = {
  lines: InvoiceLineItem[];
  extras: DeliveredOrderService[];
  form: CreateForm;
  busy: boolean;
  money: (value: unknown) => string;
  onFormChange: (value: SetStateAction<CreateForm>) => void;
};

const markerClass = "rounded-sm px-1.5 py-0.5 text-[11px] font-medium leading-4";

/**
 * Final invoice positions (owner 2026-11-17): every estimate line with the
 * delivered quantity proposed and editable (0 = not delivered), the services
 * delivered beyond the estimate under their line or on their own.
 */
export function FinalInvoiceLines({ lines, extras, form, busy, money, onFormChange }: LinesProps) {
  const { t, lang } = useLang();
  const de = lang === "de";
  const totals = finalInvoiceTotals(lines, form, extras);
  const quantityLabel = de ? "Menge" : "Количество";
  const unitCount = (value: string, unit?: string | null) => agencyServiceUnitCount(value, unit, t, lang);
  const outside = extras.filter((extra) => extra.quote_line_index == null || !lines[extra.quote_line_index]);

  const serviceRow = (extra: DeliveredOrderService, nested: boolean) => {
    const quantity = finalServiceQuantity(form, extra.order_leistung_id);
    const invalid = !Number.isFinite(quantity) || quantity < 0;
    const name = agencyServiceNameLabel(undefined, extra.description || extra.name, t);
    return (
      <div key={extra.order_leistung_id} data-testid="final-order-service"
        className={cn("grid grid-cols-[minmax(0,1fr)_6rem_6.5rem] gap-x-2.5 gap-y-1 p-3", nested && "border-l-2 border-amber-300 bg-muted/20 pl-4")}>
        <div className="min-w-0">
          <p className="break-words text-sm">{name}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {de ? "Preis netto" : "Цена без НДС"}: {money(extra.unit_price)} · {t.invoices_vat}: {extra.vat_rate}%
            {" · "}<span className={cn(markerClass, "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300")}>{de ? "nicht im Angebot" : "вне сметы"}</span>
          </p>
        </div>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>{quantityLabel}</span>
          <Input type="number" min="0" step="0.01" disabled={busy}
            aria-label={`${quantityLabel}: ${name}`} aria-invalid={invalid || undefined}
            value={form.orderServiceQuantities?.[extra.order_leistung_id] ?? ""}
            className={cn(inputClass, "h-8 text-right tabular-nums")}
            onChange={(event) => onFormChange((current) => ({
              ...current,
              orderServiceQuantities: { ...current.orderServiceQuantities, [extra.order_leistung_id]: event.target.value },
            }))} />
          <span className="block">{de ? "erbracht" : "фактически"} {unitCount(formatQuantity(Number(extra.quantity)), extra.unit)}</span>
        </label>
        <p className="whitespace-nowrap pt-5 text-right font-mono text-sm font-medium tabular-nums">{money(totals.serviceGrossById[extra.order_leistung_id] ?? 0)}</p>
      </div>
    );
  };

  return (
    <div className="divide-y divide-border" data-testid="final-invoice-lines">
      {lines.map((line, index) => {
        const quantity = finalLineQuantity(form, index);
        const invalid = !Number.isFinite(quantity) || quantity < 0;
        const comparison = finalLineComparison(line, index, form, extras);
        const name = agencyServiceNameLabel(undefined, line.description, t);
        const siblings = extras.filter((extra) => extra.quote_line_index === index);
        return (
          <div key={index} data-testid="final-invoice-line">
            <div className={cn("grid grid-cols-[minmax(0,1fr)_6rem_6.5rem] gap-x-2.5 gap-y-1 p-3", comparison.notDelivered && "bg-muted/30")}>
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">{name}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{de ? "Preis netto" : "Цена без НДС"}: {money(line.unit_price)} · {t.invoices_vat}: {line.vat_rate}%</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs leading-5" data-testid="final-line-comparison">
                  <span className="text-muted-foreground">
                    {de ? "laut Angebot" : "по смете"} {unitCount(formatQuantity(comparison.estimate), line.unit)}
                    {comparison.recorded ? ` · ${de ? "erbracht" : "фактически"} ${unitCount(formatQuantity(comparison.actual), line.unit)}` : ""}
                  </span>
                  {!comparison.recorded ? (
                    <span className={cn(markerClass, "bg-muted text-muted-foreground")}>{de ? "laut Angebot" : "по смете"}</span>
                  ) : null}
                  {comparison.notDelivered ? (
                    <span className={cn(markerClass, "bg-muted text-muted-foreground")} data-testid="final-line-not-delivered">{de ? "nicht erbracht" : "не оказано"}</span>
                  ) : null}
                  {comparison.aboveEstimate ? (
                    <span className={cn(markerClass, "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300")} data-testid="final-line-above-estimate">{de ? "über Angebot" : "больше сметы"}</span>
                  ) : null}
                  {comparison.difference !== 0 ? (
                    <span className={cn("font-mono tabular-nums", comparison.difference > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")} data-testid="final-line-difference">
                      {formatFinalDifference(comparison.difference, comparison.differenceGross, (value) => unitCount(value, line.unit), (value) => money(value))}
                    </span>
                  ) : null}
                </p>
              </div>
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>{quantityLabel}</span>
                <Input type="number" min="0" step="0.01" disabled={busy}
                  aria-label={`${quantityLabel}: ${name}`} aria-invalid={invalid || undefined}
                  value={form.lineQuantities[String(index)] ?? ""}
                  className={cn(inputClass, "h-8 text-right tabular-nums")}
                  onChange={(event) => onFormChange((current) => ({ ...current, lineQuantities: { ...current.lineQuantities, [String(index)]: event.target.value } }))} />
              </label>
              <p className="whitespace-nowrap pt-5 text-right font-mono text-sm font-medium tabular-nums">{money(totals.lineGrossByIndex[index] ?? 0)}</p>
              {invalid ? <p role="alert" className="col-span-3 text-xs text-destructive">{de ? "Menge muss 0 oder größer sein." : "Количество должно быть 0 или больше."}</p> : null}
            </div>
            {siblings.map((extra) => serviceRow(extra, true))}
          </div>
        );
      })}
      {outside.map((extra) => serviceRow(extra, false))}
    </div>
  );
}

type SettlementProps = {
  open: boolean;
  quote: QuoteOption;
  extras: DeliveredOrderService[];
  form: CreateForm;
  money: (value: unknown) => string;
};

function categoryLabel(row: { kind: string; vat_rate: string }, de: boolean) {
  if (row.kind === "passthrough") return de ? "Auslagen" : "Перевыставляемые расходы";
  return `${Number(row.vat_rate).toLocaleString("de-DE")} %`;
}

/**
 * The final invoice against the estimate, and the set-off its release makes
 * (`POST /quotes/{id}/final-preview`, the server's own rules).
 */
export function FinalInvoiceSettlement({ open, quote, extras, form, money }: SettlementProps) {
  const { lang } = useLang();
  const de = lang === "de";
  const summary = finalInvoiceSummary(quote, form, extras);
  const valid = isFinalSelectionValid(quote.line_items, form, extras);
  const payload = valid
    ? JSON.stringify({ line_items: invoiceLineSelectionPayload(form), order_services: finalOrderServicesPayload(form, extras) })
    : "";
  const [preview, setPreview] = useState<{ key: string; data?: FinalInvoicePreview; error?: string } | null>(null);
  useEffect(() => {
    if (!open || !payload) return;
    let cancelled = false;
    const key = `${quote.id}:${payload}`;
    const timer = window.setTimeout(() => {
      setPreview({ key });
      fetchFinalInvoicePreview(quote.id, JSON.parse(payload) as Record<string, unknown>)
        .then((data) => { if (!cancelled) setPreview({ key, data }); })
        .catch((error: unknown) => {
          if (!cancelled) setPreview({ key, error: localizeInvoiceError(error, lang, de ? "Vorschau nicht verfügbar." : "Предпросмотр недоступен.") });
        });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, quote.id, payload, lang, de]);
  const current = preview && preview.key === `${quote.id}:${payload}` ? preview : null;
  const data = current?.data;

  return (
    <div className="space-y-3 border-t border-border pt-4 text-sm" data-testid="final-invoice-settlement">
      <dl className="space-y-2 tabular-nums [&_dd]:whitespace-nowrap [&_dd]:font-mono">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{de ? "Laut Angebot" : "По смете"}</dt><dd data-testid="final-summary-estimate">{money(summary.estimate)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{de ? "Erbracht" : "Фактически"}</dt><dd data-testid="final-summary-actual">{money(summary.actual)}</dd></div>
        {summary.difference !== 0 ? (
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{de ? "Differenz" : "Разница"}</dt>
            <dd data-testid="final-summary-difference" className={summary.difference > 0 ? "text-amber-700 dark:text-amber-300" : undefined}>{summary.difference > 0 ? "+" : "−"}{money(Math.abs(summary.difference))}</dd></div>
        ) : null}
      </dl>
      {valid && !data && !current?.error ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden /> : null}
      {current?.error ? <p role="alert" className="text-xs text-destructive">{current.error}</p> : null}
      {data && data.interim_invoices.length ? (
        <div className="space-y-1 border-t border-border pt-3" data-testid="final-preview-interims">
          <p className="text-xs font-medium">{de ? "Zwischenrechnungen" : "Промежуточные счета"}</p>
          {data.interim_invoices.map((invoice) => (
            <p key={invoice.invoice_id} className="flex justify-between gap-3 text-xs text-muted-foreground">
              <span>{invoice.invoice_number ?? "—"}</span><span className="font-mono tabular-nums">{money(invoice.total_gross)}</span>
            </p>
          ))}
        </div>
      ) : null}
      {data && data.advances.length ? (
        <div className="space-y-2 border-t border-border pt-3" data-testid="final-preview-advances">
          <p className="text-xs font-medium">{de ? "Verrechnung der Anzahlungen" : "Зачёт предоплаты"}</p>
          {data.advances.map((advance) => {
            const paid = Number(advance.paid_gross);
            return (
              <div key={advance.invoice_id} className="space-y-0.5 text-xs" data-testid="final-preview-advance">
                <p className="flex justify-between gap-3">
                  <span>{advance.invoice_number ?? "—"}</span>
                  <span className="font-mono tabular-nums">{Number(advance.deduction_gross) > 0 ? `−${money(advance.deduction_gross)}` : money(0)}</span>
                </p>
                <p className="text-muted-foreground">
                  {paid > 0
                    ? `${de ? "bezahlt" : "оплачено"} ${money(advance.paid_gross)} ${de ? "von" : "из"} ${money(advance.total_gross)}`
                    : (de ? "nicht bezahlt — wird nicht verrechnet" : "не оплачен — не зачитывается")}
                </p>
                {advance.deduction_rows.map((row) => (
                  <p key={`${row.kind}-${row.vat_rate}`} className="flex justify-between gap-3 pl-2 text-muted-foreground">
                    <span>{categoryLabel(row, de)}</span><span className="font-mono tabular-nums">−{money(row.gross)}</span>
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
      {data ? (
        <p className="flex justify-between gap-3 border-t border-border pt-3 font-semibold" data-testid="final-preview-due">
          <span>{de ? "Zu zahlen" : "К оплате"}</span><span className="font-mono tabular-nums">{money(data.due_gross)}</span>
        </p>
      ) : null}
    </div>
  );
}
