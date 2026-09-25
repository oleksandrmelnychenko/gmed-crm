import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, FilePlus2, LoaderCircle, RefreshCw } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { StaffLink } from "@/components/staff-link";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { Banner, Field, StatusBadge } from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  invoiceCreationErrorMessage,
} from "@/pages/invoices/model/billing-release";
import { isQuoteClosedForInvoicing } from "@/pages/invoices/model/invoice-model";
import type { InvoiceLineItem, InvoiceType, QuoteOption } from "@/pages/invoices/model/types";
import { PatientTerminationSettlements } from "@/pages/invoices/termination-settlement/ui";

type BillingOrder = {
  id: string;
  order_number: string;
  status: string;
  phase: string;
  currency: string;
  billing_release_status: string;
  package_coverage_status: string;
  services: Array<{ id: string; status: string }>;
  cancellation_reason?: string | null;
  termination_settlement?: {
    id: string;
    status: "open" | "settled";
    terminated_at: string;
    accrued_gross: string;
    balance_gross: string;
    uninvoiced_gross: string;
    final_invoice_id: string | null;
  } | null;
};

type BillingExpense = {
  id: string;
  external_invoice_number: string;
  provider_name: string | null;
  invoice_date: string | null;
  status: string;
  paid_by: "patient" | "agency" | "unpaid";
  currency: string;
  amount_gross: string;
  company_paid_gross: string;
  remaining_provider_liability_gross: string;
  patient_receivable_gross: string;
  allocated_receivable_gross: string;
  remaining_receivable_gross: string;
  source_order_id: string | null;
  source_order_number: string | null;
  latest_patient_invoice_id: string | null;
  latest_patient_invoice_number: string | null;
  latest_patient_invoice_status: string | null;
  billable: boolean;
};

type BillingWorkspace = {
  patient_id: string;
  patient_pid: string;
  patient_name: string;
  orders: BillingOrder[];
  expenses: BillingExpense[];
};

type CreatedInvoice = { id: string; invoice_number: string };

const checkboxClass = "size-4 rounded border-border accent-[var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function availableQuantity(line: InvoiceLineItem) {
  const value = Number(line.remaining_quantity ?? line.quantity);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function PatientBillingTab({ patientId }: { patientId: string }) {
  const { lang, t } = useLang();
  const { user } = useAuth();
  const de = lang === "de";
  const canCreate = ["ceo", "patient_manager", "billing"].includes(user?.role ?? "");
  const [workspace, setWorkspace] = useState<BillingWorkspace | null>(null);
  const [quotes, setQuotes] = useState<QuoteOption[]>([]);
  const [orderId, setOrderId] = useState("");
  const [billingCurrency, setBillingCurrency] = useState("EUR");
  const [quoteId, setQuoteId] = useState("");
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("interim");
  const [dueDate, setDueDate] = useState("");
  const [selectedExpenses, setSelectedExpenses] = useState<string[]>([]);
  const [selectedLines, setSelectedLines] = useState<number[]>([]);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvoice | null>(null);

  const copy = de ? {
    title: "Patientenabrechnung", subtitle: "Leistungen und von GMed bezahlte Fremdkosten in einer Rechnung zusammenstellen.",
    order: "Bezugsauftrag (optional)", noOrder: "Ohne Auftrag", currency: "Währung", quote: "Angebot für Leistungen", noQuote: "Nur Fremdkosten – ohne Angebot", type: "Rechnungsart",
    interim: "Zwischenrechnung", final: "Schlussrechnung", due: "Fällig am", services: "Leistungen", expenses: "Weiterberechenbare Kosten",
    waiting: "Weitere Kosten", amount: "Betrag", source: "Ursprung", payment: "Zahlung", patientInvoice: "Patientenrechnung",
    noServices: "Für diesen Auftrag gibt es keine offenen Angebotspositionen.", noExpenses: "Keine von GMed bezahlten, noch nicht berechneten Kosten.",
    create: "Rechnungsentwurf erstellen", creating: "Entwurf wird erstellt…", retry: "Aktualisieren", failed: "Die Abrechnungsdaten konnten nicht geladen werden.",
    saveFailed: "Der Rechnungsentwurf konnte nicht erstellt werden. Prüfen Sie die ausgewählten Positionen.",
    success: "Der Rechnungsentwurf wurde erstellt und die gewählten Kosten wurden reserviert.", open: "Entwurf öffnen",
    late: "Kosten können auftragsübergreifend oder ohne Auftrag berechnet werden. Auch später eingehende Belege bleiben verfügbar.",
    total: "Summe des Entwurfs", choose: "Mindestens eine Leistung oder einen Kostenbeleg auswählen.", patientPaid: "Patient selbst", gmedPaid: "GMed", unpaid: "Unbezahlt",
    ready: "Nicht berechnet", reserved: "Im Entwurf / berechnet", afterPayment: "Nach Zahlung", notRequired: "Nicht erforderlich",
  } : {
    title: "Выставление пациенту", subtitle: "Соберите услуги и оплаченные GMed внешние расходы в одном счёте.",
    order: "Заказ (необязательно)", noOrder: "Без заказа", currency: "Валюта", quote: "Предложение с услугами", noQuote: "Только расходы — без предложения", type: "Тип счёта",
    interim: "Промежуточный", final: "Финальный", due: "Срок оплаты", services: "Услуги", expenses: "Расходы для перевыставления",
    waiting: "Остальные расходы", amount: "Сумма", source: "Источник", payment: "Оплата", patientInvoice: "Счёт пациенту",
    noServices: "По этому заказу нет доступных позиций предложения.", noExpenses: "Нет оплаченных GMed расходов, которые ещё не выставлены пациенту.",
    create: "Создать черновик счёта", creating: "Создаём черновик…", retry: "Обновить", failed: "Не удалось загрузить данные для выставления.",
    saveFailed: "Не удалось создать черновик. Проверьте выбранные позиции.",
    success: "Черновик создан, выбранные расходы зарезервированы за ним.", open: "Открыть черновик",
    late: "Расходы можно объединить по пациенту из разных заказов или выставить без заказа. Поздние документы также остаются доступными.",
    total: "Сумма черновика", choose: "Выберите хотя бы одну услугу или расход.", patientPaid: "Сам пациент", gmedPaid: "GMed", unpaid: "Не оплачен",
    ready: "Не выставлено", reserved: "В черновике / выставлено", afterPayment: "После оплаты", notRequired: "Не требуется",
  };

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    Promise.all([
      apiFetch<BillingWorkspace>(`/patients/${patientId}/billing-workspace`, { forceFresh: true, signal: controller.signal }),
      apiFetch<QuoteOption[]>(`/quotes?patient_id=${encodeURIComponent(patientId)}`, { forceFresh: true, signal: controller.signal }),
    ]).then(([nextWorkspace, nextQuotes]) => {
      if (controller.signal.aborted) return;
      setWorkspace(nextWorkspace);
      setQuotes(nextQuotes);
      setOrderId((current) => current && nextWorkspace.orders.some(order => order.id === current)
        ? current
        : "");
      setBillingCurrency((current) => {
        const currencies = [...nextWorkspace.orders, ...nextWorkspace.expenses]
          .map(item => item.currency?.trim().toUpperCase())
          .filter(Boolean);
        return currencies.includes(current) ? current : currencies[0] ?? "EUR";
      });
      setError(null);
    }).catch(() => { if (!controller.signal.aborted) setError(copy.failed); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [patientId, revision]);

  const order = workspace?.orders.find(item => item.id === orderId) ?? null;
  const orderQuotes = quotes.filter(quote => quote.order_id === orderId && !isQuoteClosedForInvoicing(quote.status));
  const quote = orderQuotes.find(item => item.id === quoteId) ?? null;
  const serviceLines = quote?.line_items ?? [];
  const currencyOptions = Array.from(new Set(
    [...(workspace?.orders ?? []), ...(workspace?.expenses ?? [])]
      .map(item => item.currency?.trim().toUpperCase())
      .filter(Boolean),
  ));
  if (!currencyOptions.includes("EUR")) currencyOptions.push("EUR");
  const activeCurrency = order?.currency || billingCurrency;
  const readyExpenses = (workspace?.expenses ?? []).filter(expense => expense.billable && expense.currency === activeCurrency);
  const otherExpenses = (workspace?.expenses ?? []).filter(expense => !readyExpenses.some(item => item.id === expense.id));

  useEffect(() => {
    if (quoteId && !quotes.some(item => item.id === quoteId && item.order_id === orderId)) {
      setQuoteId("");
      setSelectedLines([]);
    }
    setSelectedExpenses(current => {
      const next = current.filter(id => (workspace?.expenses ?? []).some(expense => expense.id === id && expense.billable && expense.currency === activeCurrency));
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [activeCurrency, orderId, quoteId, quotes, workspace]);

  const serviceTotal = selectedLines.reduce((sum, index) => {
    const line = serviceLines[index];
    return sum + (line ? availableQuantity(line) * Number(line.line_gross || 0) / Math.max(Number(line.quantity || 1), 1) : 0);
  }, 0);
  const expenseTotal = readyExpenses.filter(expense => selectedExpenses.includes(expense.id))
    .reduce((sum, expense) => sum + Number(expense.remaining_receivable_gross || 0), 0);
  const total = serviceTotal + expenseTotal;

  function selectQuote(nextId: string) {
    const next = orderQuotes.find(item => item.id === nextId) ?? null;
    setQuoteId(next?.id ?? "");
    setSelectedLines(next ? next.line_items.map((line, index) => availableQuantity(line) > 0 ? index : -1).filter(index => index >= 0) : []);
    setCreated(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (total <= 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const invoice = await apiFetch<CreatedInvoice>(`/patients/${patientId}/billing-invoices`, {
        method: "POST",
        body: JSON.stringify({
          request_id: requestId,
          order_id: order?.id ?? null,
          quote_id: quote?.id || null,
          currency: activeCurrency,
          invoice_type: invoiceType,
          due_date: dueDate || null,
          line_items: quote ? selectedLines.map(line_index => ({ line_index, quantity: String(availableQuantity(serviceLines[line_index])) })) : null,
          external_invoice_ids: selectedExpenses,
        }),
      });
      setCreated(invoice);
      setRequestId(crypto.randomUUID());
      setSelectedExpenses([]);
      setQuoteId("");
      setSelectedLines([]);
      setRevision(value => value + 1);
    } catch (saveError) {
      setError(invoiceCreationErrorMessage(saveError, lang, copy.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  const expenseState = (expense: BillingExpense) => {
    if (expense.paid_by === "patient") return copy.notRequired;
    if (Number(expense.remaining_receivable_gross) <= 0 && Number(expense.patient_receivable_gross) > 0) return copy.reserved;
    if (expense.billable) return copy.ready;
    return copy.afterPayment;
  };
  const paymentLabel = (expense: BillingExpense) => expense.paid_by === "patient"
    ? copy.patientPaid : Number(expense.company_paid_gross) > 0 ? copy.gmedPaid : copy.unpaid;
  const expenseColumns: ColumnDef<BillingExpense>[] = [
    { id: "select", label: "", accessor: row => selectedExpenses.includes(row.id), width: 52, required: true, render: row => <input className={checkboxClass} type="checkbox" disabled={!row.billable || row.currency !== activeCurrency || saving} checked={selectedExpenses.includes(row.id)} aria-label={`${copy.expenses}: ${row.external_invoice_number}`} onChange={event => setSelectedExpenses(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))} /> },
    { id: "document", label: de ? "Beleg" : "Документ", accessor: row => row.external_invoice_number, width: 190, render: row => <span className="font-mono font-semibold">{row.external_invoice_number}</span> },
    { id: "provider", label: de ? "Leistungserbringer" : "Поставщик", accessor: row => row.provider_name ?? "", width: 210, render: row => row.provider_name || "—" },
    { id: "source", label: copy.source, accessor: row => row.source_order_number ?? "", width: 170, render: row => row.source_order_number ? <span className="font-mono text-xs">{row.source_order_number}</span> : <StatusBadge tone="neutral">{de ? "Ohne Auftrag" : "Без заказа"}</StatusBadge> },
    { id: "payment", label: copy.payment, accessor: paymentLabel, width: 135, render: row => <StatusBadge tone={row.paid_by === "patient" ? "info" : Number(row.company_paid_gross) > 0 ? "success" : "neutral"}>{paymentLabel(row)}</StatusBadge> },
    { id: "patient_invoice", label: copy.patientInvoice, accessor: expenseState, width: 190, render: row => row.latest_patient_invoice_id ? <StaffLink className="font-mono text-xs font-semibold text-primary" to={`/invoices?invoice=${row.latest_patient_invoice_id}`}>{row.latest_patient_invoice_number || expenseState(row)}</StaffLink> : <StatusBadge tone={row.billable ? "warning" : "neutral"}>{expenseState(row)}</StatusBadge> },
    { id: "amount", label: copy.amount, accessor: row => Number(row.remaining_receivable_gross), width: 145, render: row => <span className="block text-right font-mono font-semibold tabular-nums">{formatMoneyAmount(row.billable ? row.remaining_receivable_gross : row.amount_gross, row.currency)}</span> },
  ];

  return <div className="mt-4 min-w-0 space-y-4" data-testid="patient-billing">
    <PatientTerminationSettlements patientId={patientId} lang={lang} />
    <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div><h2 className="flex items-center gap-2 text-sm font-semibold"><span className="size-2 rounded-full bg-[var(--brand)]" />{copy.title}</h2><p className="mt-1 text-xs text-muted-foreground">{copy.subtitle}</p></div>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setRevision(value => value + 1)}><RefreshCw className={cn("size-3.5", busy && "animate-spin")} />{copy.retry}</Button>
      </div>
      <p className="border-b border-border/60 bg-muted/20 px-4 py-2.5 text-xs leading-5 text-muted-foreground">{copy.late}</p>
      <form className="space-y-4 p-4" onSubmit={submit}>
        <div className="grid gap-3 lg:grid-cols-5">
          <Field label={copy.order}><NativeComboboxSelect value={orderId || "__none__"} disabled={busy || saving} onChange={event => { const nextOrderId = event.target.value === "__none__" ? "" : event.target.value; const nextOrder = workspace?.orders.find(item => item.id === nextOrderId); setOrderId(nextOrderId); if (nextOrder) setBillingCurrency(nextOrder.currency); setQuoteId(""); setSelectedLines([]); setSelectedExpenses([]); setCreated(null); }}><option value="__none__">{copy.noOrder}</option>{workspace?.orders.map(item => <option key={item.id} value={item.id}>{item.order_number} · {item.cancellation_reason === "contract_terminated" ? (de ? "gekündigt" : "расторгнут") : item.status} · {item.currency}</option>)}</NativeComboboxSelect></Field>
          <Field label={copy.currency}><NativeComboboxSelect value={activeCurrency} disabled={Boolean(order) || busy || saving} onChange={event => { setBillingCurrency(event.target.value); setSelectedExpenses([]); setCreated(null); }}>{currencyOptions.map(currency => <option key={currency} value={currency}>{currency}</option>)}</NativeComboboxSelect></Field>
          <Field label={copy.quote}><NativeComboboxSelect value={quoteId || "__empty__"} disabled={!order || busy || saving} onChange={event => selectQuote(event.target.value === "__empty__" ? "" : event.target.value)}><option value="__empty__">{copy.noQuote}</option>{orderQuotes.map(item => <option key={item.id} value={item.id}>{item.quote_number}</option>)}</NativeComboboxSelect></Field>
          <Field label={copy.type}><NativeComboboxSelect value={invoiceType} disabled={saving} onChange={event => { const value = event.target.value as InvoiceType; setInvoiceType(value); if (value === "final") setSelectedLines(serviceLines.map((line, index) => availableQuantity(line) > 0 ? index : -1).filter(index => index >= 0)); }}><option value="interim">{copy.interim}</option><option value="final">{copy.final}</option></NativeComboboxSelect></Field>
          <Field label={copy.due}><Input type="date" disabled={saving} value={dueDate} onChange={event => setDueDate(event.target.value)} /></Field>
        </div>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {created ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><div className="flex flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-2"><CheckCircle2 className="size-4" />{copy.success}</span><StaffLink className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground" to={`/invoices?invoice=${created.id}`}>{copy.open}</StaffLink></div></div> : null}

        <section className="overflow-hidden rounded-xl border border-border/70">
          <div className="border-b border-border/60 px-4 py-3"><AdminSectionTitle>{copy.services}</AdminSectionTitle></div>
          {!quote ? <p className="px-4 py-5 text-sm text-muted-foreground">{copy.noServices}</p> : <div className="divide-y divide-border/60">
            {serviceLines.map((line, index) => {
              const available = availableQuantity(line);
              if (available <= 0) return null;
              const checked = selectedLines.includes(index);
              return <label key={`${quote.id}-${index}`} className={cn("grid cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3", !checked && "bg-muted/15")}>
                <input className={checkboxClass} type="checkbox" checked={checked} disabled={saving || invoiceType === "final"} onChange={event => setSelectedLines(current => event.target.checked ? [...current, index] : current.filter(value => value !== index))} />
                <span className="min-w-0"><span className="block text-sm font-medium">{line.description}</span><span className="mt-1 block text-xs text-muted-foreground">{available} × {formatMoneyAmount(line.unit_price, activeCurrency)} · {de ? "MwSt." : "НДС"} {line.vat_rate}%</span></span>
                <span className="whitespace-nowrap font-mono text-sm font-semibold tabular-nums">{formatMoneyAmount(String(available * Number(line.line_gross || 0) / Math.max(Number(line.quantity || 1), 1)), activeCurrency)}</span>
              </label>;
            })}
          </div>}
        </section>

        <DataTableSurface rows={[...readyExpenses, ...otherExpenses]} columns={expenseColumns} rowId={row => row.id} dictionary={t as unknown as Record<string, string>} defaultDensity="compact" storageKey={`patient-billing-expenses-${patientId}`} mobilePrimaryColumnId="document" mobileDetailColumnIds={["provider", "payment", "patient_invoice", "amount"]} emptyState={copy.noExpenses} toolbarStart={<AdminSectionTitle>{copy.expenses}</AdminSectionTitle>} />

        <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
          <div><p className="text-xs text-muted-foreground">{copy.total}</p><p className="font-mono text-lg font-semibold tabular-nums">{formatMoneyAmount(String(total), activeCurrency)}</p></div>
          <div className="text-right"><Button type="submit" disabled={!canCreate || saving || total <= 0}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}{saving ? copy.creating : copy.create}</Button>{total <= 0 ? <p className="mt-1 text-xs text-muted-foreground">{copy.choose}</p> : null}</div>
        </div>
      </form>
    </section>
  </div>;
}
