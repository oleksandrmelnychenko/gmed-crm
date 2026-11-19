import { SectionHeading } from "@/components/ui/section-heading";
import { useEffect, useState, type FormEvent, type ReactNode, type SetStateAction } from "react";
import { FilePlus2, ReceiptText, NotebookPen, Banknote, BookMarked, ListOrdered, Calculator, AlertCircle, FileText, LoaderCircle, CalendarRange, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Input } from "@/components/ui/input";
import { CountBadge, checkboxClass, inputClass, selectClass, textareaClass, tokens } from "@/components/ui-shell";
import { INTERNAL_NOTE_MAX_LENGTH } from "@/lib/internal-note";
import { agencyServiceNameLabel } from "@/lib/agency-service-labels";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { hasCapability } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { transitLineRebilledWarning } from "@/pages/patients/ui/sections/patient-billing-double-billing";
import { useOrderRebilledReceipts } from "@/pages/patients/ui/sections/use-order-rebilled-receipts";
import {
  NEW_INVOICE_TYPES,
  calculateInvoiceSelectionTotals,
  invoiceSelectionPackageOverage,
  createInvoiceLineSelection,
  formatCurrency,
  invoiceLineQuantityAvailable,
  invoiceSelectionLineAmounts,
  isInvoiceSelectionValid,
  effectiveAdvanceBasis,
  interimLimitBesideOpenAdvance,
  isOverageOnlyInvoice,
  isClosingFinalPossible,
  quoteUnavailableReason,
  isQuoteAvailableForInvoice,
  prepaymentExceedsUnbilledQuote,
  quoteRequiredPrepayment,
} from "../model/invoice-model";
import { roundCents } from "@/lib/money";
import { OrderBudgetIndicator } from "@/components/order-budget/order-budget-indicator";
import { ownServicesGrossOfSelection } from "@/components/order-budget/order-budget";
import { fetchPrepaymentAdvancePreview } from "../data/invoice-api";
import { localizeInvoiceError } from "../model/invoice-errors";
import { finalInvoiceTotals, finalOwnExtrasGross } from "../model/final-invoice";
import { FinalInvoiceLines, FinalInvoiceSettlement, InvoiceLineAmount, InvoiceLineRow, invoiceLineDiscountAmount, invoiceLineQuantityInputClass } from "./final-invoice-lines";
import { StatusChip } from "@/components/ui/status-chip";
import { formatAppDate } from "@/lib/app-time-zone";
import type { CreateForm, InvoiceType, PrepaymentAdvancePreview, QuoteOption } from "../model/types";
import { appDateKey } from "@/lib/app-time-zone";
import { INVOICE_PAYMENT_METHODS } from "../model/payment-correction";
import {
  paymentMethodLabel,
  periodSuggestionLabel,
  periodSuggestions,
  receivedPaymentExcess,
  receivedPaymentExcessText,
  receivedPaymentProblem,
  receivedPaymentProblemText,
  servicePeriodProblem,
  servicePeriodProblemText,
  type ServicePeriodForm,
} from "../model/document-terms";
import { GuardedDateInput } from "./guarded-date-input";
import { ReleaseDueDateField } from "./release-due-date-field";

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
  const prepaymentBlocked = prepaymentExceedsUnbilledQuote(selectedQuote);
  // The split comes from the server, built by the code that creates the
  // advance (money QA 2026-11-15, S2-1): what is shown is what is created.
  const prepaymentMode = prepaymentBasis && requiredPrepayment != null;
  const previewQuoteId = prepaymentMode ? selectedQuote?.id ?? "" : "";
  const [preview, setPreview] = useState<{ quoteId: string; data?: PrepaymentAdvancePreview; error?: string } | null>(null);
  useEffect(() => {
    if (!open || !previewQuoteId) return;
    let cancelled = false;
    setPreview({ quoteId: previewQuoteId });
    fetchPrepaymentAdvancePreview(previewQuoteId)
      .then((data) => { if (!cancelled) setPreview({ quoteId: previewQuoteId, data }); })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPreview({
            quoteId: previewQuoteId,
            error: localizeInvoiceError(error, lang, de ? "Vorschau nicht verfügbar." : "Предпросмотр недоступен."),
          });
        }
      });
    return () => { cancelled = true; };
  }, [open, previewQuoteId, requiredPrepayment, lang, de]);
  const currentPreview = preview && preview.quoteId === previewQuoteId ? preview : null;
  const prepaymentSplit = prepaymentMode && currentPreview?.data
    ? {
        lines: currentPreview.data.lines.map((line) => ({
          isCostPassthrough: line.is_cost_passthrough,
          vatRate: Number(line.vat_rate),
          net: Number(line.net),
          vat: Number(line.vat),
          gross: Number(line.gross),
        })),
        net: Number(currentPreview.data.total_net),
        vat: Number(currentPreview.data.total_vat),
        gross: Number(currentPreview.data.total_gross),
      }
    : null;
  const previewError = prepaymentMode ? currentPreview?.error ?? null : null;
  const final = form.invoiceType === "final";
  // Delivered services of the order outside the quote: a final invoice proposes them (owner 2026-11-17).
  const extras = selectedQuote?.delivered_services_outside_quote ?? [];
  const selectionTotals = final
    ? finalInvoiceTotals(lines, form, extras)
    : calculateInvoiceSelectionTotals(lines, form.selectedLineIndexes, form.lineQuantities);
  const packageOverage = prepaymentMode
    ? { net: 0, vat: 0, gross: 0 }
    : invoiceSelectionPackageOverage(selectedQuote, lines, form);
  const totals = prepaymentMode
    ? { ...selectionTotals, net: prepaymentSplit?.net ?? 0, vat: prepaymentSplit?.vat ?? 0, gross: prepaymentSplit?.gross ?? 0 }
    : {
        ...selectionTotals,
        net: roundCents(selectionTotals.net + packageOverage.net),
        vat: roundCents(selectionTotals.vat + packageOverage.vat),
        gross: roundCents(selectionTotals.gross + packageOverage.gross),
      };
  const quoteAvailable = Boolean(selectedQuote && isQuoteAvailableForInvoice(selectedQuote, form.invoiceType));
  const overageOnly = isOverageOnlyInvoice(selectedQuote, form);
  const closingFinal = isClosingFinalPossible(selectedQuote, form);
  const interimLimit = overageOnly ? null : interimLimitBesideOpenAdvance(selectedQuote, lines, form);
  const overOpenAdvance = interimLimit != null && selectionTotals.gross > interimLimit.maxGross;
  const selectionValid = prepaymentMode
    ? quoteAvailable && Boolean(prepaymentSplit && prepaymentSplit.gross > 0)
    : quoteAvailable && (overageOnly || closingFinal || isInvoiceSelectionValid(lines, form, extras)) && (totals.gross > 0 || final) && !overOpenAdvance;
  // Money received before the invoice (Billing/CEO) and the service period
  // (owner 2026-11-17); the release records the payment with its day.
  const canRecordPayment = hasCapability(user, "invoices.finance");
  const [receivedDateRefused, setReceivedDateRefused] = useState(false);
  // Not prefilled (owner 2026-11-18): empty fields, the programme dates of
  // the order offered as pills under them; left empty, the server prints the
  // period of the lines or the order as before.
  const emptyPeriod: ServicePeriodForm = { from: "", to: "" };
  const period = form.servicePeriod ?? emptyPeriod;
  const fromSuggestions = periodSuggestions(selectedQuote, "from");
  const toSuggestions = periodSuggestions(selectedQuote, "to");
  const periodProblem = servicePeriodProblem(period);
  const received = form.receivedPayment;
  // Left empty, the amount is what the invoice leaves to pay at its release:
  // «К оплате» after the advance set-off on a final (QA verify2 B-2).
  const [finalDue, setFinalDue] = useState<number | null>(null);
  const receivedDefault = final ? finalDue : totals.gross;
  const receivedProblem = receivedPaymentProblem(received, receivedDefault ?? totals.gross, appDateKey());
  const receivedExcess = receivedPaymentExcess(received, receivedDefault);
  const termsProblem = periodProblem
    ? servicePeriodProblemText(periodProblem, de)
    : receivedProblem && (received.receivedOn || receivedProblem !== "missing_date")
      ? receivedPaymentProblemText(receivedProblem, de)
      : null;
  const valid = selectionValid && !periodProblem && !receivedProblem && !receivedDateRefused;
  const footerMessage = error || optionsError || previewError || (selectedQuote && termsProblem ? termsProblem : null) || (selectedQuote && !selectionValid && !(prepaymentMode && !prepaymentSplit)
    ? overOpenAdvance
      ? (de
          ? `Die offene Vorauszahlungsrechnung fordert bereits ${money(interimLimit.openAdvance)} für dieses Angebot. Diese Zwischenrechnung darf höchstens ${money(interimLimit.maxGross)} betragen.`
          : `Неоплаченный счёт на предоплату уже требует ${money(interimLimit.openAdvance)} по этому предложению. Этот промежуточный счёт — не больше ${money(interimLimit.maxGross)}.`)
      : (de ? "Prüfen Sie die ausgewählten Positionen und Mengen." : "Проверьте выбранные позиции и количество.")
    : null);
  const footerError = Boolean(error || optionsError || previewError);
  // Transit lines billed while receipts of the order are already re-billed:
  // the same cost may be billed twice (owner 2026-11-12, C-2). Warning only.
  const selectedTransitLines = prepaymentMode
    ? []
    : form.selectedLineIndexes.map((index) => lines[index]).filter((line) => line?.is_cost_passthrough);
  const transitRebilledReceipts = useOrderRebilledReceipts({
    patientId: selectedQuote?.patient_id,
    orderId,
    enabled: open && selectedTransitLines.length > 0 && hasCapability(user, "invoices.view"),
  });
  const transitRebilledWarning = selectedTransitLines.length
    ? transitLineRebilledWarning(lang, selectedTransitLines.map((line) => line.description), transitRebilledReceipts)
    : null;
  const typeLabels = {
    advance: t.revenue_invoice_type_advance,
    interim: t.revenue_invoice_type_interim,
    final: t.revenue_invoice_type_final,
  };
  const quantityLabel = de ? "Menge" : "Количество";
  const availableLabel = de ? "Verfügbar" : "Доступно";
  const descriptionLabel = de ? "Leistungsbeschreibung" : "Описание услуги";
  const availableCount = final
    ? lines.length + extras.length
    : lines.filter((line) => invoiceLineQuantityAvailable(line, form.invoiceType) > 0).length;
  const selectableQuotes = quotes.filter((quote) => isQuoteAvailableForInvoice(quote, form.invoiceType));
  // An open quote this type cannot bill is listed disabled with the reason
  // (QA2 D S2-4: a second positions advance silently vanished).
  const blockedQuotes = quotes
    .map((quote) => ({ quote, reason: quoteUnavailableReason(quote, form.invoiceType, de ? "de" : "ru") }))
    .filter((item): item is { quote: QuoteOption; reason: string } => item.reason != null);
  // The select offers the quotes this type can bill; no list of the hidden
  // ones under the field (owner 2026-11-19). Under «Промежуточный» a quote
  // only an interim invoice can bill is marked in its option.
  const interimOnlyLabel = de ? "nur Zwischenrechnung" : "только промежуточный";
  const interimOnly = (quote: QuoteOption) => form.invoiceType === "interim"
    && !isQuoteAvailableForInvoice(quote, "final") && !isQuoteAvailableForInvoice(quote, "advance");

  return (
    <Dialog dirty={dirty} open={open} onOpenChange={(nextOpen) => { if (!formBusy) onOpenChange(nextOpen); }}>
      <DialogContent
        showCloseButton={!formBusy}
        overlayClassName="bg-[color-mix(in_srgb,var(--overlay,#000)_40%,transparent)]"
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:w-[calc(100vw-3rem)] sm:max-w-5xl sm:pb-0"
      >
        <DialogHeader className="shrink-0 border-b border-border/50 bg-card px-4 py-3 pr-14 text-left">
          <DialogTitle className="text-[15px] font-semibold"><SectionHeading icon={FilePlus2}>{t.invoices_new}</SectionHeading></DialogTitle>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted">
            <div className="grid min-w-0 gap-3 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
              <fieldset disabled={formBusy} className="min-w-0 space-y-3">
                <section className="space-y-3 rounded-xl border border-border/50 bg-card p-3.5">
                <AdminSectionTitle icon={ReceiptText}>{de ? "Rechnungsdaten" : "Данные счёта"}</AdminSectionTitle>
                <FormField label={t.revenue_invoices_section_quote}>
                  <NativeComboboxSelect
                    aria-label={t.revenue_invoices_section_quote}
                    disabled={formBusy || optionsBusy}
                    value={form.quoteId || "__empty__"}
                    onChange={(event) => {
                      const quote = selectableQuotes.find((item) => item.id === event.target.value);
                      onFormChange((current) => ({
                        ...current, quoteId: quote?.id ?? "",
                        ...createInvoiceLineSelection(quote?.line_items ?? [], current.invoiceType, quote?.delivered_services_outside_quote),
                        // Remarks belong to the positions of the previous quote.
                        lineComments: {},
                      }));
                    }}
                    className={cn(selectClass, "w-full min-w-0")}
                  >
                    <option value="__empty__">{optionsBusy ? t.common_loading : t.invoices_workspace_choose_quote}</option>
                    {selectableQuotes.map((quote) => (
                      <option key={quote.id} value={quote.id}>
                        {[quote.quote_number, quote.patient_name, quote.order_number, quote.patient_pid, interimOnly(quote) ? interimOnlyLabel : null].filter(Boolean).join(" · ")}
                      </option>
                    ))}
                    {blockedQuotes.map(({ quote, reason }) => (
                      <option key={quote.id} value={quote.id} disabled>
                        {[quote.quote_number, quote.patient_name, quote.order_number, reason].filter(Boolean).join(" · ")}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                </FormField>
                {!optionsError && !optionsBusy && !selectableQuotes.length && !blockedQuotes.length ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {de ? "Keine abrechenbaren Angebote für diese Auswahl." : "Для текущего выбора нет доступных предложений."}
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
                        onFormChange((current) => ({ ...current, invoiceType, ...createInvoiceLineSelection(lines, invoiceType, extras) }));
                      }}
                      className={selectClass}
                    >
                      {NEW_INVOICE_TYPES.map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}
                    </NativeComboboxSelect>
                  </FormField>
                  <FormField label={t.invoices_due_at}>
                    <ReleaseDueDateField ariaLabel={t.invoices_due_at} disabled={formBusy} value={form.dueDate} className={cn(inputClass, "w-full min-w-0")}
                      termDays={selectedQuote?.payment_term_days}
                      onChange={(value) => onFormChange((current) => ({ ...current, dueDate: value }))} />
                  </FormField>
                </div>
                {transitRebilledWarning ? (
                  <p role="status" data-testid="invoice-transit-rebilled-warning" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                    {transitRebilledWarning}
                  </p>
                ) : null}
                </section>

                <section className="space-y-3 rounded-xl border border-border/50 bg-card p-3.5" data-testid="invoice-service-period">
                  <AdminSectionTitle icon={CalendarRange}>
                    {form.invoiceType === "advance"
                      ? (de ? "Voraussichtlicher Leistungszeitraum" : "Предполагаемый период оказания услуг")
                      : (de ? "Leistungszeitraum" : "Период оказания услуг")}
                  </AdminSectionTitle>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="min-w-0 space-y-1.5">
                      <FormField label={de ? "Von" : "С"}>
                        <Input type="date" aria-label={de ? "Leistungszeitraum von" : "Период услуг с"} disabled={formBusy} value={period.from}
                          className={cn(inputClass, "w-full min-w-0")}
                          onChange={(event) => onFormChange((current) => ({ ...current, servicePeriod: { ...(current.servicePeriod ?? emptyPeriod), from: event.target.value } }))} />
                      </FormField>
                      {fromSuggestions.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {fromSuggestions.map((suggestion) => (
                            <button key={suggestion.kind} type="button" disabled={formBusy}
                              data-testid={suggestion.kind === "programme" ? "invoice-period-program-start" : "invoice-period-first-visit"}
                              onClick={() => onFormChange((current) => ({ ...current, servicePeriod: { ...(current.servicePeriod ?? emptyPeriod), from: suggestion.date } }))}
                              className="rounded-full focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">
                              <StatusChip tone={suggestion.kind === "programme" ? "info" : "neutral"} className="cursor-pointer px-2 py-0 text-[11px] tabular-nums hover:bg-sky-100">
                                {periodSuggestionLabel(suggestion, de)} {formatAppDate(suggestion.date)}
                              </StatusChip>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <FormField label={de ? "Bis" : "По"}>
                        <Input type="date" aria-label={de ? "Leistungszeitraum bis" : "Период услуг по"} disabled={formBusy} value={period.to}
                          className={cn(inputClass, "w-full min-w-0")}
                          onChange={(event) => onFormChange((current) => ({ ...current, servicePeriod: { ...(current.servicePeriod ?? emptyPeriod), to: event.target.value } }))} />
                      </FormField>
                      {toSuggestions.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {toSuggestions.map((suggestion) => (
                            <button key={suggestion.kind} type="button" disabled={formBusy}
                              data-testid={suggestion.kind === "programme" ? "invoice-period-program-end" : "invoice-period-last-visit"}
                              onClick={() => onFormChange((current) => ({ ...current, servicePeriod: { ...(current.servicePeriod ?? emptyPeriod), to: suggestion.date } }))}
                              className="rounded-full focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">
                              <StatusChip tone={suggestion.kind === "programme" ? "info" : "neutral"} className="cursor-pointer px-2 py-0 text-[11px] tabular-nums hover:bg-sky-100">
                                {periodSuggestionLabel(suggestion, de)} {formatAppDate(suggestion.date)}
                              </StatusChip>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </section>

                {canRecordPayment ? (
                  <section className="space-y-3 rounded-xl border border-border/50 bg-card p-3.5" data-testid="invoice-received-payment">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <input type="checkbox" className={checkboxClass} checked={received.enabled} disabled={formBusy}
                        onChange={(event) => {
                          const enabled = event.target.checked;
                          onFormChange((current) => ({ ...current, receivedPayment: { ...current.receivedPayment, enabled } }));
                        }} />
                      <Wallet className="size-4 text-muted-foreground" aria-hidden />
                      {de ? "Zahlung bereits eingegangen" : "Оплата уже поступила"}
                    </label>
                    {received.enabled ? (
                      <div className="grid gap-4 sm:grid-cols-3">
                        <FormField label={de ? "Eingangsdatum" : "Дата поступления"}>
                          <GuardedDateInput aria-label={de ? "Eingangsdatum" : "Дата поступления"} max={appDateKey()} disabled={formBusy}
                            value={received.receivedOn} className={cn(inputClass, "w-full min-w-0")}
                            onRefusedChange={setReceivedDateRefused}
                            onChange={(event) => onFormChange((current) => ({ ...current, receivedPayment: { ...current.receivedPayment, receivedOn: event.target.value } }))} />
                        </FormField>
                        <FormField label={de ? "Betrag" : "Сумма"}>
                          <Input inputMode="decimal" aria-label={de ? "Betrag der Zahlung" : "Сумма оплаты"} disabled={formBusy}
                            value={received.amount} placeholder={receivedDefault != null ? money(receivedDefault) : ""}
                            className={cn(inputClass, "w-full min-w-0 text-right tabular-nums", receivedExcess > 0 && "border-amber-400 focus-visible:ring-amber-300")}
                            onChange={(event) => onFormChange((current) => ({ ...current, receivedPayment: { ...current.receivedPayment, amount: event.target.value } }))} />
                        </FormField>
                        <FormField label={de ? "Zahlungsart" : "Способ оплаты"}>
                          <NativeComboboxSelect aria-label={de ? "Zahlungsart" : "Способ оплаты"} disabled={formBusy} value={received.method} className={selectClass}
                            onChange={(event) => onFormChange((current) => ({ ...current, receivedPayment: { ...current.receivedPayment, method: event.target.value } }))}>
                            {INVOICE_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{paymentMethodLabel(method, de)}</option>)}
                          </NativeComboboxSelect>
                        </FormField>
                      </div>
                    ) : null}
                    {received.enabled && receivedExcess > 0 && receivedDefault != null ? (
                      <p role="status" data-testid="invoice-received-excess" className="text-xs leading-5 text-amber-700 dark:text-amber-300">
                        {receivedPaymentExcessText(money(receivedDefault), money(receivedExcess), de)}
                      </p>
                    ) : null}
                  </section>
                ) : null}

                {form.invoiceType === "advance" && selectedQuote && requiredPrepayment != null ? (
                  <fieldset className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
                    <legend className="sr-only">{de ? "Grundlage der Vorauszahlungsrechnung" : "Основание счёта на предоплату"}</legend>
                    <div className="border-b border-border px-3 py-2.5" aria-hidden="true">
                      <h3 className={cn(tokens.text.sectionTitle, "flex items-center gap-2")}><SectionHeading icon={BookMarked}>{de ? "Grundlage der Vorauszahlungsrechnung" : "Основание счёта на предоплату"}</SectionHeading></h3>
                    </div>
                    <div className="grid gap-2 p-3">
                    {([
                      ["prepayment", de ? `Erforderliche Vorauszahlung · ${money(requiredPrepayment)}` : `Требуемая предоплата · ${money(requiredPrepayment)}`],
                      ["positions", de ? "Ausgewählte Angebotspositionen" : "Выбранные позиции предложения"],
                    ] as const).map(([basis, label]) => (
                      <label key={basis} className="flex items-center gap-2 text-sm text-foreground">
                        <input type="radio" name="advance-basis" value={basis} checked={advanceBasis === basis} disabled={formBusy || (basis === "prepayment" && prepaymentBlocked) || (basis === "positions" && Boolean(selectedQuote.active_invoice_types?.includes("advance")))}
                          onChange={() => onFormChange((current) => ({ ...current, advanceBasis: basis }))} />
                        {label}
                      </label>
                    ))}
                    {prepaymentBlocked ? (
                      <p role="status" data-testid="invoice-prepayment-blocked" className="text-xs leading-5 text-muted-foreground">
                        {de
                          ? "Die erforderliche Vorauszahlung übersteigt den noch nicht abgerechneten Betrag des Angebots. Die offenen Positionen sind ausgewählt."
                          : "Требуемая предоплата больше суммы, ещё не выставленной по предложению. Выбраны открытые позиции."}
                      </p>
                    ) : null}
                    </div>
                  </fieldset>
                ) : null}

                {prepaymentMode ? (
                  <section aria-label={de ? "Anzahlung" : "Предоплата"} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card" data-testid="invoice-prepayment-advance">
                    <div className="border-b border-border px-3 py-2.5">
                      <h3 className={cn(tokens.text.sectionTitle, "flex items-center gap-2")}><SectionHeading icon={Banknote}>{de ? "Anzahlung" : "Предоплата"}</SectionHeading></h3>
                    </div>
                    {!prepaymentSplit && !previewError ? (
                      <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground" role="status">
                        <LoaderCircle className="size-4 animate-spin" aria-hidden />
                      </div>
                    ) : null}
                    <div className="divide-y divide-border">
                      {(prepaymentSplit?.lines ?? []).map((line) => (
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

                {prepaymentMode ? null : (
                <section aria-label={de ? "Rechnungspositionen" : "Позиции счёта"} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                    <h3 className={cn(tokens.text.sectionTitle, "flex items-center gap-2")}><SectionHeading icon={ListOrdered}>{de ? "Rechnungspositionen" : "Позиции счёта"}</SectionHeading>
                      {selectedQuote && !final ? <CountBadge>{form.selectedLineIndexes.length} / {availableCount}</CountBadge> : null}
                    </h3>
                    {selectedQuote && !final && availableCount > 0 ? (
                      <Button type="button" variant="ghost" size="sm" disabled={busy}
                        onClick={() => onFormChange((current) => ({ ...current, ...createInvoiceLineSelection(lines, current.invoiceType) }))}>
                        {de ? "Alle auswählen" : "Выбрать все"}
                      </Button>
                    ) : null}
                  </div>
                  {overageOnly ? (
                    <p role="status" data-testid="invoice-overage-only" className="border-b border-border px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                      {de
                        ? `Alle Positionen sind abgerechnet. Diese Zwischenrechnung berechnet nur den Mehrverbrauch aus dem Tarif: ${money(packageOverage.gross)}.`
                        : `Все позиции выставлены. Этот промежуточный счёт выставит только превышение по тарифу: ${money(packageOverage.gross)}.`}
                    </p>
                  ) : null}
                  {!selectedQuote ? (
                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-5 py-8 text-center text-muted-foreground">
                      <FileText className="size-6" />
                      <p className="text-sm">{t.invoices_workspace_choose_quote}</p>
                    </div>
                  ) : final ? (
                    <FinalInvoiceLines lines={lines} extras={extras} form={form} busy={busy} money={money} onFormChange={onFormChange} />
                  ) : (
                    <div className="divide-y divide-border">
                      {lines.map((line, index) => {
                        const selected = form.selectedLineIndexes.includes(index);
                        const available = invoiceLineQuantityAvailable(line, form.invoiceType);
                        const quantity = Number(form.lineQuantities[String(index)]);
                        const invalid = selected && (!Number.isFinite(quantity) || quantity <= 0 || quantity > available);
                        // One spelling for the limit: decimal comma, as in the catalogue and on the invoice.
                        const availableText = available.toLocaleString("de-DE", { maximumFractionDigits: 4 });
                        const name = agencyServiceNameLabel(undefined, line.description, t);
                        // No «Описание услуги» over a description without any text
                        // (markup or separators only, QA 2026-11-16 B-2).
                        const notes = line.notes?.trim();
                        const hasNotes = /[\p{L}\p{N}]/u.test(notes?.replace(/<[^>]*>/g, "") ?? "");
                        const amounts = selected ? invoiceSelectionLineAmounts(line, quantity) : null;
                        return (
                          <InvoiceLineRow key={`${selectedQuote.id}-${index}`} name={name} muted={!selected}
                            leading={(
                              <input type="checkbox" aria-label={`${de ? "Position" : "Позиция"}: ${name}`}
                                checked={selected} disabled={busy || available <= 0}
                                className={cn(checkboxClass, "mt-0.5")}
                                onChange={(event) => {
                                  const checked = event.target.checked;
                                  onFormChange((current) => ({ ...current, selectedLineIndexes: checked
                                    ? [...new Set([...current.selectedLineIndexes, index])].sort((a, b) => a - b)
                                    : current.selectedLineIndexes.filter((item) => item !== index) }));
                                }} />
                            )}
                            pills={{
                              unitPrice: line.unit_price, vatRate: line.vat_rate, discountPercent: line.discount_percent,
                              origin: { kind: "estimate", quantity: Number(line.quantity).toLocaleString("de-DE", { maximumFractionDigits: 4 }) },
                              money,
                            }}
                            details={hasNotes && notes !== line.description.trim() ? (
                              <details className="mt-1 text-xs text-muted-foreground">
                                <summary className="w-fit cursor-pointer rounded-sm py-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">{descriptionLabel}</summary>
                                <p className="mt-1 whitespace-pre-line break-words leading-5">{notes}</p>
                              </details>
                            ) : null}
                            quantity={(
                              <>
                                <Input type="number" required min="0.01" step="0.01" max={String(available)}
                                  disabled={busy || !selected || available <= 0}
                                  aria-label={`${quantityLabel}: ${name}`} aria-invalid={invalid || undefined}
                                  value={form.lineQuantities[String(index)] ?? ""}
                                  className={invoiceLineQuantityInputClass}
                                  onChange={(event) => onFormChange((current) => ({ ...current, lineQuantities: { ...current.lineQuantities, [String(index)]: event.target.value } }))} />
                                <p>{availableLabel}: {availableText}</p>
                              </>
                            )}
                            amount={<InvoiceLineAmount gross={amounts?.gross ?? 0} net={amounts?.net ?? 0}
                              discount={amounts ? invoiceLineDiscountAmount(quantity, line.unit_price, amounts.net) : 0} money={money} />}
                            remark={selected ? {
                              value: form.lineComments[String(index)] ?? "",
                              busy,
                              onChange: (value) => onFormChange((current) => ({ ...current, lineComments: { ...current.lineComments, [String(index)]: value } })),
                            } : null}>
                            {available <= 0 ? <p className="text-xs text-muted-foreground">{de ? "Bereits vollständig abgerechnet" : "Уже выставлено полностью"}</p> : null}
                            {invalid ? <p role="alert" className="text-xs text-destructive">{de ? `Menge muss größer als 0 und höchstens ${availableText} sein.` : `Количество должно быть больше 0 и не больше ${availableText}.`}</p> : null}
                          </InvoiceLineRow>
                        );
                      })}
                      {!availableCount ? <p role="status" className="p-4 text-sm text-muted-foreground">{de ? "Keine abrechenbaren Positionen für diesen Rechnungstyp." : "Для этого типа счёта нет доступных позиций."}</p> : null}
                    </div>
                  )}
                </section>
                )}
                <section className="space-y-3 rounded-xl border border-border/50 bg-card p-3.5">
                <AdminSectionTitle icon={NotebookPen}>{de ? "Anmerkungen" : "Примечания"}</AdminSectionTitle>
                <FormField label={t.invoices_workspace_notes}>
                  <textarea rows={2} className={cn(textareaClass, "min-h-20")} value={form.notes}
                    onChange={(event) => onFormChange((current) => ({ ...current, notes: event.target.value }))}
                    placeholder={t.invoices_workspace_billing_note_placeholder} />
                  {/* Printed on the issued, immutable invoice (QA D-62). */}
                </FormField>
                <FormField label={t.finance_internal_note}>
                  <textarea rows={2} className={cn(textareaClass, "min-h-20")} value={form.internalNote}
                    maxLength={INTERNAL_NOTE_MAX_LENGTH}
                    onChange={(event) => onFormChange((current) => ({ ...current, internalNote: event.target.value }))} />
                  {/* Staff only: never printed, never in the portal (owner 2026-10-12). */}
                </FormField>
                </section>
              </fieldset>

              <aside className="min-w-0">
                <div className="space-y-4 rounded-xl border border-border/50 bg-card p-3.5 lg:sticky lg:top-0">
                  <h3 className={cn(tokens.text.sectionTitle, "flex items-center gap-2")}><SectionHeading icon={Calculator}>{de ? "Rechnungsübersicht" : "Итог счёта"}</SectionHeading></h3>
                  {selectedQuote ? (
                    <dl className="space-y-3 text-sm">
                      <SummaryField label={t.invoices_patient} value={selectedQuote.patient_name} />
                      {selectedQuote.patient_pid ? <SummaryField label={t.revenue_common_patient_id} value={selectedQuote.patient_pid} /> : null}
                      <SummaryField label={t.orders_title} value={selectedQuote.order_number} />
                      <SummaryField label={t.revenue_invoices_section_quote} value={selectedQuote.quote_number} />
                    </dl>
                  ) : null}
                  <dl className="space-y-3 border-t border-border pt-4 text-sm tabular-nums [&_dd]:whitespace-nowrap [&_dd]:font-mono">
                    {packageOverage.gross > 0 ? <div className="flex justify-between gap-3" data-testid="invoice-package-overage"><dt className="text-muted-foreground">{de ? "Darin Mehrverbrauch aus dem Tarif" : "В том числе превышение по тарифу"}</dt><dd>{money(packageOverage.gross)}</dd></div> : null}
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{de ? "Netto" : "Без НДС"}</dt><dd>{money(totals.net)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t.invoices_vat}</dt><dd>{money(totals.vat)}</dd></div>
                    <div className="flex justify-between gap-3 border-t border-border pt-3 font-semibold"><dt>{t.invoices_total}</dt><dd className="text-lg">{money(totals.gross)}</dd></div>
                  </dl>
                  {selectedQuote && form.invoiceType !== "advance" ? <OrderBudgetIndicator orderId={orderId} lang={lang} basis="invoiced" variant="pill" deltaGross={ownServicesGrossOfSelection(lines, form.selectedLineIndexes, totals.lineGrossByIndex, packageOverage.gross) + (final ? finalOwnExtrasGross(form, extras) : 0)} testId="invoice-create-budget" /> : null}
                  {selectedQuote && final ? <FinalInvoiceSettlement open={open} quote={selectedQuote} extras={extras} form={form} money={money} onDueChange={setFinalDue} /> : null}
                  {selectedQuote && !prepaymentMode && !final && availableCount > 0 && !form.selectedLineIndexes.length ? <p role="status" className="text-xs text-destructive">{de ? "Wählen Sie mindestens eine Position." : "Выберите хотя бы одну позицию."}</p> : null}
                </div>
              </aside>
            </div>
          </div>
          <div className="shrink-0 border-t border-border bg-card" data-testid="invoice-create-footer">
            {/* The message row keeps its height when empty, so the form above does not jump (QA2 S3). */}
            {footerMessage ? <div role={footerError ? "alert" : "status"} className={cn("flex min-h-11 max-h-[min(24dvh,9rem)] items-start gap-2 overflow-y-auto border-b px-4 py-2.5 text-xs leading-5 sm:px-5", footerError ? "border-destructive/20 bg-destructive/5 text-destructive" : "border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300")}>
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1 break-words">{footerMessage}
              </div>
              <Button type="button" size="sm" variant="outline" className="h-7 shrink-0" disabled={formBusy || optionsBusy} onClick={onRetry}>{de ? "Prüfen" : "Проверить"}</Button>
            </div> : <div aria-hidden="true" data-testid="invoice-create-footer-reserve" className="min-h-11 border-b border-transparent" />}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
            <p className="text-sm tabular-nums"><span className="text-muted-foreground">{t.invoices_total}: </span><strong>{money(totals.gross)}</strong></p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={formBusy} onClick={() => onOpenChange(false)}>{t.common_cancel}</Button>
              <Button type="submit" size="sm" requireChanges={false} disabled={formBusy || optionsBusy || Boolean(optionsError) || !valid}>
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
