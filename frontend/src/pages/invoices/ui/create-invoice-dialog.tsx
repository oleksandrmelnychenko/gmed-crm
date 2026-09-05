import { useEffect, useState, type FormEvent, type ReactNode, type SetStateAction } from "react";
import { CheckCircle2, FileText, LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Banner, inputClass, selectClass, textareaClass } from "@/components/ui-shell";
import { agencyServiceNameLabel } from "@/lib/agency-service-labels";
import { useAuth } from "@/lib/auth";
import { clearApiCache } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { fetchInvoiceBillingRelease, grantInvoiceBillingRelease } from "../data/invoice-api";
import { canGrantInvoiceBillingRelease, hasInvoiceBillingRelease } from "../model/billing-release";
import {
  INVOICE_TYPES,
  calculateInvoiceSelectionTotals,
  createInvoiceLineSelection,
  formatCurrency,
  invoiceLineQuantityAvailable,
  isInvoiceSelectionValid,
} from "../model/invoice-model";
import type { CreateForm, InvoiceBillingRelease, InvoiceType, QuoteOption } from "../model/types";

type BillingReleaseState = {
  orderId: string;
  loading: boolean;
  release: InvoiceBillingRelease | null;
  error: string | null;
};

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
  const { user } = useAuth();
  const de = lang === "de";
  const orderId = selectedQuote?.order_id ?? "";
  const canGrant = canGrantInvoiceBillingRelease(user?.role);
  const [billingState, setBillingState] = useState<BillingReleaseState | null>(null);
  const [billingReload, setBillingReload] = useState(0);
  const [grantBusy, setGrantBusy] = useState(false);
  const billing = billingState?.orderId === orderId ? billingState : null;
  const billingLoading = Boolean(orderId) && (!billing || billing.loading);
  const billingGranted = hasInvoiceBillingRelease(billing?.release);
  const formBusy = busy || grantBusy;
  const releaseLoadError = de
    ? "Die Abrechnungsfreigabe konnte nicht geprüft werden. Versuchen Sie es erneut."
    : "Не удалось проверить разрешение бухгалтерии. Повторите проверку.";

  useEffect(() => {
    if (!open || !orderId) return;
    let ignore = false;
    setBillingState({ orderId, loading: true, release: null, error: null });
    void fetchInvoiceBillingRelease(orderId).then(
      (release) => { if (!ignore) setBillingState({ orderId, loading: false, release, error: null }); },
      () => { if (!ignore) setBillingState({ orderId, loading: false, release: null, error: releaseLoadError }); },
    );
    return () => { ignore = true; };
  }, [open, orderId, billingReload, error, releaseLoadError]);

  async function handleGrantRelease() {
    if (!canGrant || formBusy || billingLoading || !billing?.release || billingGranted) return;
    setGrantBusy(true);
    try {
      await grantInvoiceBillingRelease(orderId, billing.release.billing_release_note);
      clearApiCache();
      const release = await fetchInvoiceBillingRelease(orderId);
      setBillingState((current) => current?.orderId === orderId
        ? { orderId, loading: false, release, error: null } : current);
    } catch {
      setBillingState((current) => current?.orderId === orderId ? {
        ...current,
        error: de ? "Die Freigabe konnte nicht bestätigt werden. Prüfen Sie den Status erneut."
          : "Не удалось подтвердить разрешение. Проверьте статус ещё раз.",
      } : current);
    } finally {
      setGrantBusy(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formBusy || billingLoading || !billingGranted || billing?.error || !orderId) return;
    onSubmit(event);
  }
  const lines = selectedQuote?.line_items ?? [];
  const totals = calculateInvoiceSelectionTotals(lines, form.selectedLineIndexes, form.lineQuantities);
  const valid = Boolean(selectedQuote) && isInvoiceSelectionValid(lines, form) && totals.gross > 0;
  const final = form.invoiceType === "final";
  const typeLabels = {
    advance: t.revenue_invoice_type_advance,
    interim: t.revenue_invoice_type_interim,
    final: t.revenue_invoice_type_final,
  };
  const typeHints = {
    advance: de
      ? "Vorauszahlung für ausgewählte Positionen. Der Bruttobetrag kann später auf Folgerechnungen angerechnet werden."
      : "Предоплата по выбранным позициям. Сумму с НДС можно будет зачесть в следующих счетах.",
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
  const availableCount = lines.filter((line) => invoiceLineQuantityAvailable(line, form.invoiceType) > 0).length;
  const selectableQuotes = selectedQuote && !quotes.some((quote) => quote.id === selectedQuote.id)
    ? [selectedQuote, ...quotes] : quotes;

  return (
    <Dialog dirty={dirty} open={open} onOpenChange={(nextOpen) => { if (!formBusy) onOpenChange(nextOpen); }}>
      <DialogContent
        showCloseButton={!formBusy}
        className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[min(90dvh,54rem)] sm:w-[calc(100vw-3rem)] sm:max-w-5xl sm:pb-0"
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12">
          <DialogTitle>{t.invoices_new}</DialogTitle>
          <DialogDescription className="text-xs">
            {de ? "Rechnung für einen Patienten auf Grundlage eines Angebots erstellen." : "Создание счёта пациенту на основании предложения."}
          </DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {error ? <div role="alert" className="px-5 pt-4"><Banner tone="error">{error}</Banner></div> : null}
            <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <fieldset disabled={formBusy} className="min-w-0 space-y-5 p-5">
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
                {optionsError ? (
                  <div role="alert" className="space-y-2">
                    <Banner tone="error">{optionsError}</Banner>
                    <Button type="button" variant="outline" size="sm" disabled={optionsBusy} onClick={onRetry}>{t.invoices_workspace_refresh}</Button>
                  </div>
                ) : !optionsBusy && !selectableQuotes.length ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {de ? "Keine Angebote für die aktuelle Auswahl. Erstellen Sie ein Angebot im Auftrag oder ändern Sie die Seitenfilter." : "Для текущего выбора нет предложений. Создайте предложение в заказе или измените фильтры страницы."}
                  </p>
                ) : null}
                {orderId ? (
                  <section aria-label={de ? "Abrechnungsfreigabe" : "Разрешение бухгалтерии"}
                    className={cn("space-y-2 rounded-lg border p-3", billingGranted && !billing?.error
                      ? "border-border bg-muted/25" : "border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/15")}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {billingLoading ? <LoaderCircle className="size-4 animate-spin" /> : billingGranted ? <CheckCircle2 className="size-4 text-emerald-600" /> : null}
                        {billingLoading ? (de ? "Abrechnungsfreigabe wird geprüft…" : "Проверяем разрешение бухгалтерии…")
                          : billingGranted ? (de ? "Abrechnungsfreigabe erteilt" : "Выставление счетов разрешено")
                          : billing?.release?.billing_release_status === "denied"
                            ? (de ? "Abrechnungsfreigabe abgelehnt" : "Разрешение бухгалтерии отклонено")
                            : (de ? "Abrechnungsfreigabe erforderlich" : "Нужно разрешение бухгалтерии")}
                      </p>
                      <Button type="button" variant="ghost" size="sm" disabled={formBusy || billingLoading}
                        onClick={() => setBillingReload((current) => current + 1)}>
                        <RefreshCw className="size-3.5" />{de ? "Erneut prüfen" : "Проверить снова"}
                      </Button>
                    </div>
                    {!billingLoading && !billingGranted && billing?.release ? (
                      <>
                        <p className="text-xs leading-5 text-muted-foreground">
                          {de ? "Buchhaltung oder Geschäftsführung müssen die Abrechnung freigeben. Die Freigabe gilt für den gesamten Auftrag."
                            : "Бухгалтер или директор должен разрешить выставление счетов. Разрешение действует для всего заказа."}
                          {billing.release.package_coverage_status === "covered"
                            ? (de ? " Die Paketdeckung ersetzt diese Freigabe nicht." : " Покрытие пакетом не заменяет это разрешение.") : null}
                        </p>
                        {billing.release.billing_release_note ? <p className="whitespace-pre-line text-xs leading-5"><strong>{de ? "Anmerkung" : "Комментарий"}: </strong>{billing.release.billing_release_note}</p> : null}
                        {canGrant ? (
                          <Button type="button" variant="outline" size="sm" disabled={formBusy || Boolean(billing.error)} onClick={() => void handleGrantRelease()}>
                            {grantBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                            {de ? "Abrechnung freigeben" : "Разрешить выставление счетов"}
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                    {billing?.error ? <p role="alert" className="text-xs text-destructive">{billing.error}</p> : null}
                  </section>
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

                <section aria-label={de ? "Rechnungspositionen" : "Позиции счёта"} className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{de ? "Rechnungspositionen" : "Позиции счёта"}
                      {selectedQuote ? <span className="ml-2 font-normal text-muted-foreground">{form.selectedLineIndexes.length} / {lines.length}</span> : null}
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
                    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
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
                              className="mt-0.5 size-4 accent-primary"
                              onChange={(event) => {
                                const checked = event.target.checked;
                                onFormChange((current) => ({ ...current, selectedLineIndexes: checked
                                  ? [...new Set([...current.selectedLineIndexes, index])].sort((a, b) => a - b)
                                  : current.selectedLineIndexes.filter((item) => item !== index) }));
                              }} />
                            <div className="min-w-0">
                              <p className="break-words text-sm font-medium">{name}</p>
                              <p className="mt-1 text-xs leading-5 text-muted-foreground">{de ? "Preis netto" : "Цена без НДС"}: {formatCurrency(line.unit_price)} · {t.invoices_vat}: {line.vat_rate}%</p>
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
                                <p className="text-sm font-medium tabular-nums">{formatCurrency(totals.lineGrossByIndex[index] ?? 0)}</p>
                              </div>
                            </div>
                            {available <= 0 ? <p className="col-start-2 text-xs text-muted-foreground sm:col-span-3">{de ? "Bereits vollständig abgerechnet" : "Уже выставлено полностью"}</p> : null}
                            {invalid ? <p role="alert" className="col-start-2 text-xs text-destructive sm:col-span-3">{de ? `Menge muss größer als 0 und höchstens ${available} sein.` : `Количество должно быть больше 0 и не больше ${available}.`}</p> : null}
                          </div>
                        );
                      })}
                      {!availableCount ? <p role="status" className="p-4 text-sm text-muted-foreground">{de ? "Keine abrechenbaren Positionen für diesen Rechnungstyp." : "Для этого типа счёта нет доступных позиций."}</p> : null}
                    </div>
                  )}
                </section>
                <FormField label={t.invoices_workspace_notes}>
                  <textarea rows={2} className={cn(textareaClass, "min-h-20")} value={form.notes}
                    onChange={(event) => onFormChange((current) => ({ ...current, notes: event.target.value }))}
                    placeholder={t.invoices_workspace_billing_note_placeholder} />
                </FormField>
              </fieldset>

              <aside className="min-w-0 border-t border-border bg-muted/25 p-5 lg:border-t-0 lg:border-l">
                <div className="space-y-5 lg:sticky lg:top-5">
                  <h3 className="text-sm font-semibold">{de ? "Rechnungsübersicht" : "Итог счёта"}</h3>
                  {selectedQuote ? (
                    <dl className="space-y-3 text-sm">
                      <SummaryField label={t.invoices_patient} value={selectedQuote.patient_name} />
                      {selectedQuote.patient_pid ? <SummaryField label={t.revenue_common_patient_id} value={selectedQuote.patient_pid} /> : null}
                      <SummaryField label={t.orders_title} value={selectedQuote.order_number} />
                      <SummaryField label={t.revenue_invoices_section_quote} value={selectedQuote.quote_number} />
                    </dl>
                  ) : <p className="text-xs leading-5 text-muted-foreground">{de ? "Patient und Auftrag erscheinen nach der Angebotsauswahl." : "Пациент и заказ появятся после выбора предложения."}</p>}
                  <dl className="space-y-3 border-t border-border pt-4 text-sm tabular-nums">
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{de ? "Netto" : "Без НДС"}</dt><dd>{formatCurrency(totals.net)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t.invoices_vat}</dt><dd>{formatCurrency(totals.vat)}</dd></div>
                    <div className="flex justify-between gap-3 border-t border-border pt-3 font-semibold"><dt>{t.invoices_total}</dt><dd className="text-lg">{formatCurrency(totals.gross)}</dd></div>
                  </dl>
                  <p className="text-xs leading-5 text-muted-foreground">{de ? "Die Rechnung wird als Entwurf erstellt. Bereits geleistete Vorauszahlungen können anschließend angerechnet werden." : "Счёт будет создан как черновик. Полученные предоплаты можно зачесть после создания."}</p>
                  {selectedQuote && availableCount > 0 && !form.selectedLineIndexes.length ? <p role="status" className="text-xs text-destructive">{de ? "Wählen Sie mindestens eine Position." : "Выберите хотя бы одну позицию."}</p> : null}
                </div>
              </aside>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <p className="text-sm tabular-nums"><span className="text-muted-foreground">{t.invoices_total}: </span><strong>{formatCurrency(totals.gross)}</strong></p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={formBusy} onClick={() => onOpenChange(false)}>{t.common_cancel}</Button>
              <Button type="submit" disabled={formBusy || billingLoading || !billingGranted || Boolean(billing?.error) || optionsBusy || Boolean(optionsError) || !valid}>
                {formBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {de ? "Rechnung erstellen" : "Создать счёт"}
              </Button>
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
