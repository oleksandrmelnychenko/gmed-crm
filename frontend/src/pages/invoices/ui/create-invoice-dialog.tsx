import { useEffect, type FormEvent, type ReactNode, type SetStateAction } from "react";
import { AlertCircle, FileText, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CountBadge, checkboxClass, inputClass, selectClass, textareaClass, tokens } from "@/components/ui-shell";
import { agencyServiceNameLabel } from "@/lib/agency-service-labels";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  INVOICE_LINE_COMMENT_MAX_LENGTH,
  INVOICE_TYPES,
  calculateInvoiceSelectionTotals,
  createInvoiceLineSelection,
  formatCurrency,
  invoiceLineQuantityAvailable,
  isInvoiceSelectionValid,
  effectiveAdvanceBasis,
  isQuoteAvailableForInvoice,
  prepaymentAdvanceSplit,
  quoteRequiredPrepayment,
} from "../model/invoice-model";
import type { CreateForm, InvoiceType, QuoteOption } from "../model/types";

type Props = {
  open: boolean;
  busy: boolean;
  dirty: boolean;
  optionsBusy: boolean;
  error: string | null;
  optionsError: string | null;
  form: CreateForm;
  quotes: QuoteOption[];
  selectedQuote: QuoteOption | null;
  onOpenChange: (open: boolean) => void;
  onFormChange: (value: SetStateAction<CreateForm>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRetry: () => void;
};

export function CreateInvoiceDialog({ open, busy, dirty, optionsBusy, error, optionsError, form, quotes, selectedQuote, onOpenChange, onFormChange, onSubmit, onRetry }: Props) {
  const { t, lang } = useLang();
  const de = lang === "de";
  const money = (value: unknown) => formatCurrency(value, lang, selectedQuote?.currency);
  const orderId = selectedQuote?.order_id ?? "";
  const formBusy = busy;

  useEffect(() => {
    if (!open) return;
    const refresh = () => onRetry();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [open, onRetry]);

  useEffect(() => {
    if (!open || optionsBusy || optionsError || !selectedQuote || isQuoteAvailableForInvoice(selectedQuote, form.invoiceType)) return;
    onFormChange((current) => ({ ...current, quoteId: "", selectedLineIndexes: [], lineQuantities: {}, lineComments: {} }));
  }, [open, optionsBusy, optionsError, selectedQuote, form.invoiceType, onFormChange]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formBusy || !orderId || optionsBusy || optionsError || !valid) return;
    onSubmit(event);
  }
  const lines = selectedQuote?.line_items ?? [];
  const requiredPrepayment = quoteRequiredPrepayment(selectedQuote);
  const advanceBasis = effectiveAdvanceBasis(form, selectedQuote);
  const prepaymentBasis = advanceBasis === "prepayment";
  const prepaymentSplit = prepaymentBasis && requiredPrepayment != null
    ? prepaymentAdvanceSplit(lines, requiredPrepayment)
    : null;
  const selectionTotals = calculateInvoiceSelectionTotals(lines, form.selectedLineIndexes, form.lineQuantities);
  const totals = prepaymentSplit
    ? { ...selectionTotals, net: prepaymentSplit.net, vat: prepaymentSplit.vat, gross: prepaymentSplit.gross }
    : selectionTotals;
  const quoteAvailable = Boolean(selectedQuote && isQuoteAvailableForInvoice(selectedQuote, form.invoiceType));
  const valid = prepaymentSplit
    ? quoteAvailable && !prepaymentSplit.exceedsQuote && prepaymentSplit.gross > 0
    : quoteAvailable && isInvoiceSelectionValid(lines, form) && totals.gross > 0;
  const footerMessage = error || optionsError || (selectedQuote && !valid
    ? prepaymentSplit?.exceedsQuote
      ? (de ? "Die erforderliche Vorauszahlung übersteigt die Angebotssumme. Wählen Sie Positionen." : "Требуемая предоплата больше суммы предложения. Выберите позиции.")
      : (de ? "Prüfen Sie die ausgewählten Positionen und Mengen." : "Проверьте выбранные позиции и количество.")
    : null);
  const footerError = Boolean(error || optionsError);
  const final = form.invoiceType === "final";
  const typeLabels = {
    advance: t.revenue_invoice_type_advance,
    interim: t.revenue_invoice_type_interim,
    final: t.revenue_invoice_type_final,
  };
  const typeHints = {
    advance: de
      ? "Vorauszahlung in Höhe der erforderlichen Vorauszahlung des Auftrags oder für ausgewählte Positionen. Der Bruttobetrag kann später auf Folgerechnungen angerechnet werden."
      : "Предоплата на требуемую по заказу сумму или по выбранным позициям. Сумму с НДС можно будет зачесть в следующих счетах.",
    interim: de
      ? "Wählen Sie die Positionen und Mengen für diese Teilrechnung aus."
      : "Выберите позиции и количество для частичного выставления счёта.",
    final: de
      ? "Alle noch nicht abgerechneten Mengen sind enthalten. Für eine Teilauswahl verwenden Sie eine Zwischenrechnung."
      : "Включён весь остаток по предложению. Для выбора отдельных позиций используйте промежуточный счёт.",
  };
  const quantityLabel = de ? "Menge" : "Количество";
  const availableLabel = de ? "Verfügbar" : "Доступно";
  const descriptionLabel = de ? "Leistungsbeschreibung" : "Описание услуги";
  const commentLabel = de ? "Anmerkung auf der Rechnung" : "Примечание в счёте";
  const commentPlaceholder = de ? "z. B. 2. und 3. Quartal 2026" : "например: за 2 и 3 квартал 2026";
  const availableCount = lines.filter((line) => invoiceLineQuantityAvailable(line, form.invoiceType) > 0).length;
  const selectableQuotes = quotes.filter((quote) => isQuoteAvailableForInvoice(quote, form.invoiceType));

  return (
    <Dialog dirty={dirty} open={open} onOpenChange={(nextOpen) => { if (!formBusy) onOpenChange(nextOpen); }}>
      <DialogContent
        showCloseButton={!formBusy}
        className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[min(90dvh,54rem)] sm:w-[calc(100vw-3rem)] sm:max-w-5xl sm:pb-0"
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2"><span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />{t.invoices_new}</DialogTitle>
          <DialogDescription className="text-xs">
            {de ? "Rechnung für einen Patienten auf Grundlage eines Angebots erstellen." : "Создание счёта пациенту на основании предложения."}
          </DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <fieldset disabled={formBusy} className="min-w-0 space-y-4 p-4 sm:p-5">
                <FormField label={t.revenue_invoices_section_quote}>
                  <NativeComboboxSelect
                    aria-label={t.revenue_invoices_section_quote}
                    disabled={formBusy || optionsBusy}
                    value={form.quoteId || "__empty__"}
                    onChange={(event) => {
                      const quote = selectableQuotes.find((item) => item.id === event.target.value);
                      onFormChange((current) => ({
                        ...current, quoteId: quote?.id ?? "",
                        ...createInvoiceLineSelection(quote?.line_items ?? [], current.invoiceType),
                        // Remarks belong to the positions of the previous quote.
                        lineComments: {},
                      }));
                    }}
                    className={cn(selectClass, "w-full min-w-0")}
                  >
                    <option value="__empty__">{optionsBusy ? t.common_loading : t.invoices_workspace_choose_quote}</option>
                    {selectableQuotes.map((quote) => (
                      <option key={quote.id} value={quote.id}>
                        {[quote.quote_number, quote.patient_name, quote.order_number, quote.patient_pid].filter(Boolean).join(" · ")}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                </FormField>
                {!optionsError && !optionsBusy && !selectableQuotes.length ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {de ? "Keine abrechenbaren Angebote für diese Auswahl. Bereits abgerechnete, abgelehnte und abgelaufene Angebote werden nicht angezeigt." : "Для текущего выбора нет доступных предложений. Уже выставленные, отклонённые и просроченные предложения скрыты."}
                  </p>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label={t.invoices_type}>
                    <NativeComboboxSelect
                      aria-label={t.invoices_type}
                      disabled={formBusy}
                      value={form.invoiceType}
                      onChange={(event) => {
                        const invoiceType = event.target.value as InvoiceType;
                        onFormChange((current) => ({ ...current, invoiceType, ...createInvoiceLineSelection(lines, invoiceType) }));
                      }}
                      className={selectClass}
                    >
                      {INVOICE_TYPES.map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}
                    </NativeComboboxSelect>
                  </FormField>
                  <FormField label={t.invoices_due_at}>
                    <Input type="date" aria-label={t.invoices_due_at} disabled={formBusy} value={form.dueDate} className={cn(inputClass, "w-full min-w-0")}
                      onChange={(event) => onFormChange((current) => ({ ...current, dueDate: event.target.value }))} />
                  </FormField>
                </div>
                <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">{typeHints[form.invoiceType]}</p>
                <p className="text-xs leading-5 text-muted-foreground" data-testid="invoice-draft-numbering-hint">
                  {de
                    ? "Die Rechnung wird als Entwurf ohne Nummer angelegt. Nummer und Rechnungsdatum erhält sie erst bei der Ausstellung; das Fälligkeitsdatum darf dann nicht vor dem Rechnungsdatum liegen."
                    : "Счёт создаётся черновиком без номера. Номер и дату счёта он получает только при выпуске; срок оплаты тогда не может быть раньше даты счёта."}
                </p>

                {form.invoiceType === "advance" && selectedQuote && requiredPrepayment != null ? (
                  <fieldset className="grid gap-2 rounded-xl border border-border bg-card p-3">
                    <legend className="px-1 text-xs font-medium text-muted-foreground">{de ? "Grundlage der Vorauszahlungsrechnung" : "Основание счёта на предоплату"}</legend>
                    {([
                      ["prepayment", de ? `Erforderliche Vorauszahlung · ${money(requiredPrepayment)}` : `Требуемая предоплата · ${money(requiredPrepayment)}`],
                      ["positions", de ? "Ausgewählte Angebotspositionen" : "Выбранные позиции предложения"],
                    ] as const).map(([basis, label]) => (
                      <label key={basis} className="flex items-center gap-2 text-sm text-foreground">
                        <input type="radio" name="advance-basis" value={basis} checked={advanceBasis === basis} disabled={formBusy}
                          onChange={() => onFormChange((current) => ({ ...current, advanceBasis: basis }))} />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                ) : null}

                {prepaymentSplit ? (
                  <section aria-label={de ? "Anzahlung" : "Предоплата"} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card" data-testid="invoice-prepayment-advance">
                    <div className="border-b border-border px-3 py-2.5">
                      <h3 className={cn(tokens.text.sectionTitle, "flex items-center gap-2")}><span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />{de ? "Anzahlung" : "Предоплата"}</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {de
                          ? `Anzahlung gemäß Angebot ${selectedQuote?.quote_number ?? ""}. Die Umsatzsteuer wird wie im Angebot anteilig aufgeteilt.`
                          : `Предоплата по предложению ${selectedQuote?.quote_number ?? ""}. НДС распределяется пропорционально позициям предложения.`}
                      </p>
                    </div>
                    <div className="divide-y divide-border">
                      {prepaymentSplit.lines.map((line) => (
                        <div key={`${line.isCostPassthrough}-${line.vatRate}`} className="flex flex-wrap items-baseline justify-between gap-3 p-3 text-sm">
                          <span>
                            {line.isCostPassthrough
                              ? (de ? "Anteil Auslagen (ohne USt.)" : "Доля перевыставляемых расходов (без НДС)")
                              : (de ? `Anteil ${line.vatRate} % USt.` : `Доля с НДС ${line.vatRate} %`)}
                            <span className="ml-2 text-xs text-muted-foreground">{de ? "netto" : "нетто"} {money(line.net)} · {t.invoices_vat} {money(line.vat)}</span>
                          </span>
                          <span className="font-mono tabular-nums">{money(line.gross)}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {prepaymentSplit ? null : (
                <section aria-label={de ? "Rechnungspositionen" : "Позиции счёта"} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                    <h3 className={cn(tokens.text.sectionTitle, "flex items-center gap-2")}><span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />{de ? "Rechnungspositionen" : "Позиции счёта"}
                      {selectedQuote ? <CountBadge>{form.selectedLineIndexes.length} / {availableCount}</CountBadge> : null}
                    </h3>
                    {selectedQuote && !final && availableCount > 0 ? (
                      <Button type="button" variant="ghost" size="sm" disabled={busy}
                        onClick={() => onFormChange((current) => ({ ...current, ...createInvoiceLineSelection(lines, current.invoiceType) }))}>
                        {de ? "Alle auswählen" : "Выбрать все"}
                      </Button>
                    ) : null}
                  </div>
                  {!selectedQuote ? (
                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-5 py-8 text-center text-muted-foreground">
                      <FileText className="size-6" />
                      <p className="text-sm">{t.invoices_workspace_choose_quote}</p>
                      <p className="max-w-xs text-xs leading-5">{de ? "Die Leistungen, Preise und Steuersätze werden aus dem Angebot übernommen." : "Позиции, цены и ставки НДС будут взяты из предложения."}</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {lines.map((line, index) => {
                        const selected = form.selectedLineIndexes.includes(index);
                        const available = invoiceLineQuantityAvailable(line, form.invoiceType);
                        const quantity = Number(form.lineQuantities[String(index)]);
                        const invalid = selected && (!Number.isFinite(quantity) || quantity <= 0 || quantity > available);
                        const name = agencyServiceNameLabel(undefined, line.description, t);
                        const notes = line.notes?.trim();
                        return (
                          <div key={`${selectedQuote.id}-${index}`} className={cn("grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2.5 gap-y-3 p-3 sm:grid-cols-[1.25rem_minmax(0,1fr)_6rem_6.5rem]", !selected && "bg-muted/30")}>
                            <input type="checkbox" aria-label={`${de ? "Position" : "Позиция"}: ${name}`}
                              checked={selected} disabled={busy || available <= 0 || final}
                              className={cn(checkboxClass, "mt-0.5")}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                onFormChange((current) => ({ ...current, selectedLineIndexes: checked
                                  ? [...new Set([...current.selectedLineIndexes, index])].sort((a, b) => a - b)
                                  : current.selectedLineIndexes.filter((item) => item !== index) }));
                              }} />
                            <div className="min-w-0">
                              <p className="break-words text-sm font-medium">{name}</p>
                              <p className="mt-1 text-xs leading-5 text-muted-foreground">{de ? "Preis netto" : "Цена без НДС"}: {money(line.unit_price)} · {t.invoices_vat}: {line.vat_rate}%</p>
                              {notes && notes !== line.description.trim() ? (
                                <details className="mt-1 text-xs text-muted-foreground">
                                  <summary className="w-fit cursor-pointer rounded-sm py-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">{descriptionLabel}</summary>
                                  <p className="mt-1 whitespace-pre-line break-words leading-5">{notes}</p>
                                </details>
                              ) : null}
                            </div>
                            <div className="col-start-2 flex min-w-0 flex-wrap items-start justify-between gap-3 sm:contents">
                              <label className="w-24 shrink-0 space-y-1 text-xs text-muted-foreground">
                                <span>{quantityLabel}</span>
                                <Input type="number" required min="0.01" step="0.01" max={String(available)}
                                  disabled={busy || !selected || available <= 0} readOnly={final}
                                  aria-label={`${quantityLabel}: ${name}`} aria-invalid={invalid || undefined}
                                  value={form.lineQuantities[String(index)] ?? ""}
                                  className={cn(inputClass, "h-8 text-right tabular-nums", final && "border-transparent bg-transparent shadow-none")}
                                  onChange={(event) => onFormChange((current) => ({ ...current, lineQuantities: { ...current.lineQuantities, [String(index)]: event.target.value } }))} />
                                <span className="block">{availableLabel}: {available}</span>
                              </label>
                              <div className="min-w-24 text-right">
                                <p className="mb-1 text-xs text-muted-foreground">{de ? "Brutto" : "Сумма с НДС"}</p>
                                <p className="whitespace-nowrap font-mono text-sm font-medium tabular-nums">{money(totals.lineGrossByIndex[index] ?? 0)}</p>
                              </div>
                            </div>
                            {selected ? (
                              <label className="col-start-2 block min-w-0 space-y-1 text-xs text-muted-foreground sm:col-span-3">
                                <span>{commentLabel}</span>
                                <Input type="text" maxLength={INVOICE_LINE_COMMENT_MAX_LENGTH} disabled={busy}
                                  aria-label={`${commentLabel}: ${name}`} placeholder={commentPlaceholder}
                                  value={form.lineComments[String(index)] ?? ""}
                                  className={cn(inputClass, "h-8 w-full min-w-0")}
                                  onChange={(event) => onFormChange((current) => ({ ...current, lineComments: { ...current.lineComments, [String(index)]: event.target.value } }))} />
                              </label>
                            ) : null}
                            {available <= 0 ? <p className="col-start-2 text-xs text-muted-foreground sm:col-span-3">{de ? "Bereits vollständig abgerechnet" : "Уже выставлено полностью"}</p> : null}
                            {invalid ? <p role="alert" className="col-start-2 text-xs text-destructive sm:col-span-3">{de ? `Menge muss größer als 0 und höchstens ${available} sein.` : `Количество должно быть больше 0 и не больше ${available}.`}</p> : null}
                          </div>
                        );
                      })}
                      {!availableCount ? <p role="status" className="p-4 text-sm text-muted-foreground">{de ? "Keine abrechenbaren Positionen für diesen Rechnungstyp." : "Для этого типа счёта нет доступных позиций."}</p> : null}
                    </div>
                  )}
                </section>
                )}
                <FormField label={t.invoices_workspace_notes}>
                  <textarea rows={2} className={cn(textareaClass, "min-h-20")} value={form.notes}
                    onChange={(event) => onFormChange((current) => ({ ...current, notes: event.target.value }))}
                    placeholder={t.invoices_workspace_billing_note_placeholder} />
                </FormField>
              </fieldset>

              <aside className="min-w-0 border-t border-border bg-muted/25 p-5 lg:border-t-0 lg:border-l">
                <div className="space-y-5 lg:sticky lg:top-5">
                  <h3 className={cn(tokens.text.sectionTitle, "flex items-center gap-2")}><span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />{de ? "Rechnungsübersicht" : "Итог счёта"}</h3>
                  {selectedQuote ? (
                    <dl className="space-y-3 text-sm">
                      <SummaryField label={t.invoices_patient} value={selectedQuote.patient_name} />
                      {selectedQuote.patient_pid ? <SummaryField label={t.revenue_common_patient_id} value={selectedQuote.patient_pid} /> : null}
                      <SummaryField label={t.orders_title} value={selectedQuote.order_number} />
                      <SummaryField label={t.revenue_invoices_section_quote} value={selectedQuote.quote_number} />
                    </dl>
                  ) : <p className="text-xs leading-5 text-muted-foreground">{de ? "Patient und Auftrag erscheinen nach der Angebotsauswahl." : "Пациент и заказ появятся после выбора предложения."}</p>}
                  <dl className="space-y-3 border-t border-border pt-4 text-sm tabular-nums [&_dd]:whitespace-nowrap [&_dd]:font-mono">
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{de ? "Netto" : "Без НДС"}</dt><dd>{money(totals.net)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t.invoices_vat}</dt><dd>{money(totals.vat)}</dd></div>
                    <div className="flex justify-between gap-3 border-t border-border pt-3 font-semibold"><dt>{t.invoices_total}</dt><dd className="text-lg">{money(totals.gross)}</dd></div>
                  </dl>
                  <p className="text-xs leading-5 text-muted-foreground">{de ? "Die Rechnung wird als Entwurf erstellt. Bereits geleistete Vorauszahlungen können nach dem Versand der Rechnung angerechnet werden." : "Счёт будет создан как черновик. Полученные предоплаты можно зачесть после отправки счёта."}</p>
                  {selectedQuote && !prepaymentSplit && availableCount > 0 && !form.selectedLineIndexes.length ? <p role="status" className="text-xs text-destructive">{de ? "Wählen Sie mindestens eine Position." : "Выберите хотя бы одну позицию."}</p> : null}
                </div>
              </aside>
            </div>
          </div>
          <div className="shrink-0 border-t border-border bg-card" data-testid="invoice-create-footer">
            {footerMessage ? <div role={footerError ? "alert" : "status"} className={cn("flex max-h-[min(24dvh,9rem)] items-start gap-2 overflow-y-auto border-b px-4 py-2.5 text-xs leading-5 sm:px-5", footerError ? "border-destructive/20 bg-destructive/5 text-destructive" : "border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300")}>
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1 break-words">{footerMessage}
              </div>
              <Button type="button" size="sm" variant="outline" className="h-7 shrink-0" disabled={formBusy || optionsBusy} onClick={onRetry}>{de ? "Prüfen" : "Проверить"}</Button>
            </div> : null}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
            <p className="text-sm tabular-nums"><span className="text-muted-foreground">{t.invoices_total}: </span><strong>{money(totals.gross)}</strong></p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={formBusy} onClick={() => onOpenChange(false)}>{t.common_cancel}</Button>
              <Button type="submit" requireChanges={false} disabled={formBusy || optionsBusy || Boolean(optionsError) || !valid}>
                {formBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {de ? "Rechnung erstellen" : "Создать счёт"}
              </Button>
            </div>
          </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1.5 text-xs text-muted-foreground"><span>{label}</span>{children}</label>;
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words font-medium">{value}</dd></div>;
}
