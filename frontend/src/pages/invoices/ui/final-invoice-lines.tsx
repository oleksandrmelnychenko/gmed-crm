import { useEffect, useState, type ReactNode, type SetStateAction } from "react";
import { LoaderCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import { inputClass } from "@/components/ui-shell";
import { agencyServiceNameLabel, agencyServiceUnitCount } from "@/lib/agency-service-labels";
import { useLang } from "@/lib/i18n";
import { roundCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import { fetchFinalInvoicePreview } from "../data/invoice-api";
import {
  finalInvoiceSummary,
  finalLineAmounts,
  finalLineComparison,
  finalLineQuantity,
  finalOrderServicesPayload,
  finalServiceAmounts,
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

/** How the billed quantity deviates from the estimate, with the signed difference («+2 ч · +203,50 €»). */
export type InvoiceLineDeviation = { kind: "above" | "below" | "not_delivered"; difference?: string | null };

/**
 * The facts of one invoice position as pills (owner 2026-11-18/19): unit
 * price, VAT, discount, origin (by the estimate / added during the order) and
 * one pill for the deviation from the estimate with its signed difference.
 * `trailing` closes the row (the «+ Примечание» button).
 */
export function InvoiceLinePills({ unitPrice, vatRate, discountPercent, origin, deviation, money, trailing }: {
  unitPrice: unknown;
  vatRate: unknown;
  discountPercent?: unknown;
  origin?: InvoiceLineOrigin | null;
  deviation?: InvoiceLineDeviation | null;
  money: (value: unknown) => string;
  trailing?: ReactNode;
}) {
  const { lang } = useLang();
  const de = lang === "de";
  const discount = Number(discountPercent ?? 0);
  const percent = (value: unknown) => Number(value ?? 0).toLocaleString("de-DE", { maximumFractionDigits: 2 });
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1" data-testid="invoice-line-pills">
      <StatusChip tone="neutral" className={cn(pillClass, "font-mono tabular-nums")} data-testid="invoice-line-unit-price">{money(unitPrice)} / {de ? "Einh." : "ед."}</StatusChip>
      <StatusChip tone="neutral" className={cn(pillClass, "tabular-nums")}>{de ? "MwSt." : "НДС"} {percent(vatRate)} %</StatusChip>
      {Number.isFinite(discount) && discount > 0 ? (
        <StatusChip tone="success" className={cn(pillClass, "tabular-nums")} data-testid="invoice-line-discount">{de ? "Rabatt" : "Скидка"} {percent(discount)} %</StatusChip>
      ) : null}
      {origin?.kind === "estimate" ? (
        <StatusChip tone="info" className={pillClass} data-testid="invoice-line-origin-estimate">{de ? "laut Angebot" : "по смете"} {origin.quantity}</StatusChip>
      ) : origin?.kind === "added" ? (
        <StatusChip tone="neutral" className={cn(pillClass, "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200")} data-testid="invoice-line-origin-added">{de ? "im Auftrag hinzugefügt" : "добавлено в ходе заказа"}</StatusChip>
      ) : null}
      {deviation ? <InvoiceLineDeviationPill deviation={deviation} /> : null}
      {trailing}
    </div>
  );
}

const DEVIATION_STYLE = {
  above: { testId: "final-line-above-estimate", de: "über Angebot", ru: "больше сметы",
    className: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200" },
  below: { testId: "final-line-below-estimate", de: "unter Angebot", ru: "меньше сметы",
    className: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300" },
  not_delivered: { testId: "final-line-not-delivered", de: "nicht erbracht", ru: "не оказано",
    className: "border-rose-200 bg-rose-50/70 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300" },
} as const;

/** One pill for the deviation from the estimate: «больше сметы · +2 ч · +203,50 €». */
export function InvoiceLineDeviationPill({ deviation }: { deviation: InvoiceLineDeviation }) {
  const { lang } = useLang();
  const style = DEVIATION_STYLE[deviation.kind];
  return (
    <StatusChip tone="neutral" className={cn(pillClass, "gap-1", style.className)} data-testid="invoice-line-deviation">
      <span data-testid={style.testId}>{lang === "de" ? style.de : style.ru}</span>
      {deviation.difference ? (
        <>
          <span aria-hidden>·</span>
          <span className="font-mono tabular-nums" data-testid="final-line-difference">{deviation.difference}</span>
        </>
      ) : null}
    </StatusChip>
  );
}

/** Amounts of one position: gross bold, net and the discount small under it. */
export function InvoiceLineAmount({ gross, net, discount, money }: {
  gross: number;
  net: number;
  discount: number;
  money: (value: unknown) => string;
}) {
  const { lang } = useLang();
  const de = lang === "de";
  return (
    <div className="min-w-0 text-right font-mono tabular-nums" data-testid="invoice-line-amount">
      <p className="whitespace-nowrap text-sm font-semibold text-foreground">{money(gross)}</p>
      {net > 0 && net !== gross ? (
        <p className="whitespace-nowrap text-[11px] leading-4 text-muted-foreground" data-testid="invoice-line-net">{de ? "netto" : "нетто"} {money(net)}</p>
      ) : null}
      {discount > 0 ? (
        <p className="whitespace-nowrap text-[11px] leading-4 text-emerald-700 dark:text-emerald-300" data-testid="invoice-line-discount-amount">{de ? "Rabatt" : "скидка"} −{money(discount)}</p>
      ) : null}
    </div>
  );
}

/** The discount of a billed part: list price of the quantity less its net. */
export function invoiceLineDiscountAmount(quantity: number, unitPrice: unknown, net: number) {
  const list = roundCents(quantity * Number(unitPrice ?? 0));
  return Number.isFinite(list) && quantity > 0 ? Math.max(0, roundCents(list - net)) : 0;
}

export const invoiceLineQuantityInputClass = cn(inputClass, "h-8 w-24 text-right tabular-nums");

/**
 * One row of «Позиции счёта» (owner 2026-11-19): name and pills on the
 * left, a compact quantity and the amounts in fixed columns on the right, the
 * remark under the row behind a small «+ Примечание» at the end of the pills.
 */
export function InvoiceLineRow({ testId, leading, name, pills, details, quantity, amount, remark, muted, nested, children }: {
  testId?: string;
  leading?: ReactNode;
  name: string;
  pills: Omit<Parameters<typeof InvoiceLinePills>[0], "trailing">;
  details?: ReactNode;
  quantity: ReactNode;
  amount: ReactNode;
  remark?: { value: string; busy: boolean; onChange: (value: string) => void } | null;
  muted?: boolean;
  nested?: boolean;
  children?: ReactNode;
}) {
  const { lang } = useLang();
  const de = lang === "de";
  const remarkValue = remark?.value ?? "";
  const [remarkOpen, setRemarkOpen] = useState(remarkValue.trim() !== "");
  const showRemark = Boolean(remark) && (remarkOpen || remarkValue.trim() !== "");
  const span = leading ? "col-start-2 min-w-0 sm:col-span-3" : "min-w-0 sm:col-span-3";
  return (
    <div data-testid={testId} className={cn(
      "grid gap-x-3 gap-y-1.5 px-3 py-2.5",
      leading ? "grid-cols-[1.25rem_minmax(0,1fr)] sm:grid-cols-[1.25rem_minmax(0,1fr)_6rem_8.5rem]" : "grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_6rem_8.5rem]",
      nested && "border-l-2 border-amber-300 pl-5 dark:border-amber-700",
    )}>
      {leading}
      <div className={cn("min-w-0", muted && "opacity-60")}>
        <p className="break-words text-sm font-medium leading-5">{name}</p>
        <InvoiceLinePills {...pills} trailing={remark && !showRemark ? (
          <Button type="button" variant="ghost" size="sm" disabled={remark.busy}
            aria-label={`${de ? "Anmerkung hinzufügen" : "Добавить примечание"}: ${name}`}
            className="h-5 gap-0.5 rounded-full px-1.5 text-[11px] font-normal text-muted-foreground hover:text-foreground"
            onClick={() => setRemarkOpen(true)}>
            <Plus className="size-3" aria-hidden />{de ? "Anmerkung" : "Примечание"}
          </Button>
        ) : null} />
        {details}
      </div>
      <div className={cn("flex min-w-0 items-start justify-between gap-3 sm:contents", leading && "col-start-2", muted && "opacity-60")}>
        <div className="w-24 space-y-0.5 text-[11px] leading-4 text-muted-foreground">{quantity}</div>
        {amount}
      </div>
      {remark && showRemark ? (
        <div className={span}>
          <Input type="text" maxLength={INVOICE_LINE_COMMENT_MAX_LENGTH} disabled={remark.busy} autoFocus={remarkValue === ""}
            aria-label={`${de ? "Anmerkung auf der Rechnung" : "Примечание в счёте"}: ${name}`}
            placeholder={de ? "z. B. 2. und 3. Quartal 2026" : "например: за 2 и 3 квартал 2026"}
            value={remarkValue}
            className={cn(inputClass, "h-7 w-full min-w-0 text-xs")}
            onChange={(event) => remark.onChange(event.target.value)} />
        </div>
      ) : null}
      {children ? <div className={cn(span, "space-y-1")}>{children}</div> : null}
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
  const quantityLabel = de ? "Menge" : "Количество";
  const actualLabel = de ? "erbracht" : "фактически";
  const unitCount = (value: string, unit?: string | null) => agencyServiceUnitCount(value, unit, t, lang);
  const outside = extras.filter((extra) => extra.quote_line_index == null || !lines[extra.quote_line_index]);

  const serviceRow = (extra: DeliveredOrderService, nested: boolean) => {
    const quantity = finalServiceQuantity(form, extra.order_leistung_id);
    const invalid = !Number.isFinite(quantity) || quantity < 0;
    const name = agencyServiceNameLabel(undefined, extra.description || extra.name, t);
    const amounts = finalServiceAmounts(extra, quantity);
    return (
      <InvoiceLineRow key={extra.order_leistung_id} testId="final-order-service" nested={nested} name={name}
        muted={!(quantity > 0)}
        pills={{ unitPrice: extra.unit_price, vatRate: extra.vat_rate, discountPercent: extra.discount_percent, origin: { kind: "added" }, money }}
        quantity={(
          <>
            <Input type="number" min="0" step="0.01" disabled={busy}
              aria-label={`${quantityLabel}: ${name}`} aria-invalid={invalid || undefined}
              value={form.orderServiceQuantities?.[extra.order_leistung_id] ?? ""}
              className={invoiceLineQuantityInputClass}
              onChange={(event) => onFormChange((current) => ({
                ...current,
                orderServiceQuantities: { ...current.orderServiceQuantities, [extra.order_leistung_id]: event.target.value },
              }))} />
            <p>{actualLabel} {unitCount(formatQuantity(Number(extra.quantity)), extra.unit)}</p>
          </>
        )}
        amount={<InvoiceLineAmount gross={amounts.gross} net={amounts.net} discount={invoiceLineDiscountAmount(quantity, extra.unit_price, amounts.net)} money={money} />}
        remark={{
          value: form.orderServiceComments?.[extra.order_leistung_id] ?? "",
          busy,
          onChange: (value) => onFormChange((current) => ({
            ...current,
            orderServiceComments: { ...current.orderServiceComments, [extra.order_leistung_id]: value },
          })),
        }} />
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
        const amounts = finalLineAmounts(line, quantity);
        const difference = comparison.difference !== 0
          ? comparison.notDelivered
            ? `${comparison.differenceGross > 0 ? "+" : "−"}${money(Math.abs(comparison.differenceGross))}`
            : formatFinalDifference(comparison.difference, comparison.differenceGross, (value) => unitCount(value, line.unit), (value) => money(value))
          : null;
        const deviationKind = comparison.notDelivered ? "not_delivered" : comparison.aboveEstimate ? "above" : comparison.recorded && comparison.difference < 0 ? "below" : null;
        return (
          <div key={index} data-testid="final-invoice-line" className="divide-y divide-border/60">
            <InvoiceLineRow name={name} muted={comparison.notDelivered}
              pills={{
                unitPrice: line.unit_price, vatRate: line.vat_rate, discountPercent: line.discount_percent,
                origin: { kind: "estimate", quantity: unitCount(formatQuantity(comparison.estimate), line.unit) },
                deviation: deviationKind ? { kind: deviationKind, difference } : null,
                money,
              }}
              quantity={(
                <>
                  <Input type="number" min="0" step="0.01" disabled={busy}
                    aria-label={`${quantityLabel}: ${name}`} aria-invalid={invalid || undefined}
                    value={form.lineQuantities[String(index)] ?? ""}
                    className={invoiceLineQuantityInputClass}
                    onChange={(event) => onFormChange((current) => ({ ...current, lineQuantities: { ...current.lineQuantities, [String(index)]: event.target.value } }))} />
                  {comparison.recorded ? <p data-testid="final-line-comparison">{actualLabel} {unitCount(formatQuantity(comparison.actual), line.unit)}</p> : null}
                </>
              )}
              amount={<InvoiceLineAmount gross={amounts.gross} net={amounts.net} discount={invoiceLineDiscountAmount(quantity, line.unit_price, amounts.net)} money={money} />}
              remark={{
                value: form.lineComments[String(index)] ?? "",
                busy,
                onChange: (value) => onFormChange((current) => ({ ...current, lineComments: { ...current.lineComments, [String(index)]: value } })),
              }}>
              {invalid ? <p role="alert" className="text-xs text-destructive">{de ? "Menge muss 0 oder größer sein." : "Количество должно быть 0 или больше."}</p> : null}
            </InvoiceLineRow>
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
