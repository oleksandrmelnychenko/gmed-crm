import { useEffect, useState, type SetStateAction } from "react";
import { LoaderCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
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
import type { ServicePeriodForm } from "../model/document-terms";
import { INVOICE_LINE_COMMENT_MAX_LENGTH, invoiceLineSelectionPayload } from "../model/invoice-model";
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

const pillClass = "px-1.5 py-0 text-[11px] leading-4";

/** Where a position comes from: the cost estimate, or added while the order ran. */
export type InvoiceLineOrigin = { kind: "estimate"; quantity: string } | { kind: "added" };

/**
 * The facts of one invoice position as pills (owner 2026-11-18): net price,
 * VAT, discount, origin (by the estimate / added during the order) and how
 * the billed quantity deviates from the estimate.
 */
export function InvoiceLinePills({ unitPrice, vatRate, discountPercent, origin, deviation, money }: {
  unitPrice: unknown;
  vatRate: unknown;
  discountPercent?: unknown;
  origin: InvoiceLineOrigin;
  deviation?: "above" | "below" | "not_delivered" | null;
  money: (value: unknown) => string;
}) {
  const { lang } = useLang();
  const de = lang === "de";
  const discount = Number(discountPercent ?? 0);
  const percent = (value: unknown) => Number(value ?? 0).toLocaleString("de-DE", { maximumFractionDigits: 2 });
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1" data-testid="invoice-line-pills">
      <StatusChip tone="neutral" className={cn(pillClass, "font-mono tabular-nums")}>{money(unitPrice)} {de ? "netto" : "нетто"}</StatusChip>
      <StatusChip tone="neutral" className={cn(pillClass, "tabular-nums")}>{de ? "MwSt." : "НДС"} {percent(vatRate)} %</StatusChip>
      {Number.isFinite(discount) && discount > 0 ? (
        <StatusChip tone="success" className={cn(pillClass, "tabular-nums")} data-testid="invoice-line-discount">{de ? "Rabatt" : "Скидка"} {percent(discount)} %</StatusChip>
      ) : null}
      {origin.kind === "estimate" ? (
        <StatusChip tone="info" className={pillClass} data-testid="invoice-line-origin-estimate">{de ? "laut Angebot" : "по смете"} {origin.quantity}</StatusChip>
      ) : (
        <StatusChip tone="neutral" className={cn(pillClass, "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200")} data-testid="invoice-line-origin-added">{de ? "im Auftrag hinzugefügt" : "добавлено в ходе заказа"}</StatusChip>
      )}
      {deviation === "above" ? (
        <StatusChip tone="warning" className={pillClass} data-testid="final-line-above-estimate">{de ? "über Angebot" : "больше сметы"}</StatusChip>
      ) : deviation === "below" ? (
        <StatusChip tone="neutral" className={pillClass} data-testid="final-line-below-estimate">{de ? "unter Angebot" : "меньше сметы"}</StatusChip>
      ) : deviation === "not_delivered" ? (
        <StatusChip tone="neutral" className={pillClass} data-testid="final-line-not-delivered">{de ? "nicht erbracht" : "не оказано"}</StatusChip>
      ) : null}
    </div>
  );
}

/**
 * The remark printed under a position: a compact «+ Примечание» button that
 * opens the field; open from the start when a remark exists.
 */
export function InvoiceLineRemark({ name, value, busy, onChange, className }: {
  name: string;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  className?: string;
}) {
  const { lang } = useLang();
  const de = lang === "de";
  const [open, setOpen] = useState(value.trim() !== "");
  const label = de ? "Anmerkung auf der Rechnung" : "Примечание в счёте";
  if (!open && value.trim() === "") {
    return (
      <div className={className}>
        <Button type="button" variant="ghost" size="sm" disabled={busy}
          aria-label={`${de ? "Anmerkung hinzufügen" : "Добавить примечание"}: ${name}`}
          className="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
          onClick={() => setOpen(true)}>
          <Plus className="size-3" aria-hidden />{de ? "Anmerkung" : "Примечание"}
        </Button>
      </div>
    );
  }
  return (
    <div className={className}>
      <Input type="text" maxLength={INVOICE_LINE_COMMENT_MAX_LENGTH} disabled={busy} autoFocus={value === ""}
        aria-label={`${label}: ${name}`}
        placeholder={de ? "z. B. 2. und 3. Quartal 2026" : "например: за 2 и 3 квартал 2026"}
        value={value}
        className={cn(inputClass, "h-7 w-full min-w-0 text-xs")}
        onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

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
  // The remark printed under a position (e.g. «за 2 и 3 квартал 2026»), on
  // every final line as before fix-96.
  const remarkField = (name: string, value: string, onChange: (value: string) => void) => (
    <InvoiceLineRemark className="col-span-3" name={name} value={value} busy={busy} onChange={onChange} />
  );

  const serviceRow = (extra: DeliveredOrderService, nested: boolean) => {
    const quantity = finalServiceQuantity(form, extra.order_leistung_id);
    const invalid = !Number.isFinite(quantity) || quantity < 0;
    const name = agencyServiceNameLabel(undefined, extra.description || extra.name, t);
    return (
      <div key={extra.order_leistung_id} data-testid="final-order-service"
        className={cn("grid grid-cols-[minmax(0,1fr)_6rem_6.5rem] gap-x-2.5 gap-y-1 p-3", nested && "border-l-2 border-amber-300 bg-muted/20 pl-4")}>
        <div className="min-w-0">
          <p className="break-words text-sm font-medium">{name}</p>
          <InvoiceLinePills unitPrice={extra.unit_price} vatRate={extra.vat_rate} discountPercent={extra.discount_percent} origin={{ kind: "added" }} money={money} />
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
        {remarkField(name, form.orderServiceComments?.[extra.order_leistung_id] ?? "", (value) => onFormChange((current) => ({
          ...current,
          orderServiceComments: { ...current.orderServiceComments, [extra.order_leistung_id]: value },
        })))}
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
                <InvoiceLinePills unitPrice={line.unit_price} vatRate={line.vat_rate} discountPercent={line.discount_percent}
                  origin={{ kind: "estimate", quantity: unitCount(formatQuantity(comparison.estimate), line.unit) }}
                  deviation={comparison.notDelivered ? "not_delivered" : comparison.aboveEstimate ? "above" : comparison.recorded && comparison.difference < 0 ? "below" : null}
                  money={money} />
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs leading-5" data-testid="final-line-comparison">
                  {comparison.recorded ? (
                    <span className="text-muted-foreground">{de ? "erbracht" : "фактически"} {unitCount(formatQuantity(comparison.actual), line.unit)}</span>
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
              {remarkField(name, form.lineComments[String(index)] ?? "", (value) => onFormChange((current) => ({
                ...current,
                lineComments: { ...current.lineComments, [String(index)]: value },
              })))}
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
  /** «К оплате» after the advance set-off (rests set off included), for the default of «Оплата уже поступила». */
  onDueChange?: (due: number | null) => void;
  /** The Leistungszeitraum the issued invoice prints for these lines (verify2-A S2-4). */
  onServicePeriod?: (period: ServicePeriodForm | null) => void;
};

function categoryLabel(row: { kind: string; vat_rate: string }, de: boolean) {
  if (row.kind === "passthrough") return de ? "Auslagen" : "Перевыставляемые расходы";
  return `${Number(row.vat_rate).toLocaleString("de-DE")} %`;
}

/**
 * The final invoice against the estimate, and the set-off its release makes
 * (`POST /quotes/{id}/final-preview`, the server's own rules).
 */
export function FinalInvoiceSettlement({ open, quote, extras, form, money, onDueChange, onServicePeriod }: SettlementProps) {
  const { lang } = useLang();
  const de = lang === "de";
  const summary = finalInvoiceSummary(quote, form, extras);
  const valid = isFinalSelectionValid(quote.line_items, form, extras);
  const payload = valid
    // Remarks change no amount: the preview ignores them.
    ? JSON.stringify({ line_items: invoiceLineSelectionPayload({ ...form, lineComments: {} }), order_services: finalOrderServicesPayload({ ...form, orderServiceComments: {} }, extras) })
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
  const due = data ? Number(data.due_gross) : null;
  useEffect(() => {
    onDueChange?.(due != null && Number.isFinite(due) ? due : null);
  }, [due, onDueChange]);
  const periodFrom = data?.service_period?.from ?? "";
  const periodTo = data?.service_period?.to ?? "";
  useEffect(() => {
    if (!data || !onServicePeriod) return;
    onServicePeriod(periodTo ? { from: periodFrom, to: periodTo } : null);
  }, [data, periodFrom, periodTo, onServicePeriod]);

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
                {Number(advance.rest_applied_gross ?? 0) > 0 ? (
                  <p className="flex justify-between gap-3" data-testid="final-preview-advance-rest">
                    <span>{de ? "Restbetrag der Anzahlung verrechnet" : "Остаток аванса зачтён"}</span>
                    <span className="font-mono tabular-nums">−{money(advance.rest_applied_gross)}</span>
                  </p>
                ) : null}
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
