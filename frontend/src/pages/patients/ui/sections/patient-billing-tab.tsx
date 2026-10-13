import { useEffect, useState, type FormEvent } from "react";
import { Ban, CheckCircle2, FilePlus2, LoaderCircle, RefreshCw, Undo2 } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { StaffLink } from "@/components/staff-link";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Banner, Field, StatusBadge, textareaClass } from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  invoiceCreationErrorMessage,
} from "@/pages/invoices/model/billing-release";
import { INVOICE_LINE_COMMENT_MAX_LENGTH, isQuoteClosedForInvoicing } from "@/pages/invoices/model/invoice-model";
import type { InvoiceLineItem, InvoiceType, QuoteOption } from "@/pages/invoices/model/types";
import { PatientTerminationSettlements } from "@/pages/invoices/termination-settlement/ui";

type BillingOrder = {
  id: string;
  order_number: string;
  status: string;
  phase: string;
  currency: string;
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
  /** Attributed to an order service billed to the patient: not re-billed. */
  order_service_billed?: boolean;
  /** Part GMED bears instead of re-billing it (active waivers). */
  waived_receivable_gross?: string;
  rebilling_waivers?: RebillingWaiver[];
  source_order_id: string | null;
  source_order_number: string | null;
  latest_patient_invoice_id: string | null;
  latest_patient_invoice_number: string | null;
  latest_patient_invoice_status: string | null;
  billable: boolean;
};

/**
 * A supplier cost (part) GMED bears instead of re-billing it to the patient;
 * reversed once to put it back into re-billing (owner 2026-10-12).
 */
type RebillingWaiver = {
  id: string;
  amount_gross: string;
  reason: string;
  created_at: string;
  created_by_name?: string | null;
  reversed_at?: string | null;
  reversal_reason?: string | null;
};

type WaiverAction =
  | { kind: "waive"; expense: BillingExpense; requestId: string }
  | { kind: "reverse"; expense: BillingExpense; waiver: RebillingWaiver };

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
  // Dropping a cost from re-billing is a finance decision (invoices.finance).
  const canWaive = ["ceo", "billing"].includes(user?.role ?? "");
  const [waiverAction, setWaiverAction] = useState<WaiverAction | null>(null);
  const [waiverReason, setWaiverReason] = useState("");
  const [waiverBusy, setWaiverBusy] = useState(false);
  const [waiverError, setWaiverError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<BillingWorkspace | null>(null);
  const [quotes, setQuotes] = useState<QuoteOption[]>([]);
  const [orderId, setOrderId] = useState("");
  const [billingCurrency, setBillingCurrency] = useState("EUR");
  const [quoteId, setQuoteId] = useState("");
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("interim");
  const [dueDate, setDueDate] = useState("");
  const [selectedExpenses, setSelectedExpenses] = useState<string[]>([]);
  const [selectedLines, setSelectedLines] = useState<number[]>([]);
  // Remarks printed under the selected positions, by quote line index.
  const [lineComments, setLineComments] = useState<Record<number, string>>({});
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvoice | null>(null);

  const copy = de ? {
    title: "Patientenabrechnung",
    order: "Bezugsauftrag (optional)", noOrder: "Ohne Auftrag", currency: "Währung", quote: "Angebot für Leistungen", noQuote: "Nur Fremdkosten – ohne Angebot", type: "Rechnungsart",
    interim: "Zwischenrechnung", final: "Schlussrechnung", due: "Fällig am", services: "Leistungen", expenses: "Weiterberechenbare Kosten",
    waiting: "Weitere Kosten", amount: "Betrag", source: "Ursprung", payment: "Zahlung", patientInvoice: "Patientenrechnung",
    noServices: "Für diesen Auftrag gibt es keine offenen Angebotspositionen.", noExpenses: "Keine von GMed bezahlten, noch nicht berechneten Kosten.",
    create: "Rechnungsentwurf erstellen", creating: "Entwurf wird erstellt…", retry: "Aktualisieren", failed: "Die Abrechnungsdaten konnten nicht geladen werden.",
    saveFailed: "Der Rechnungsentwurf konnte nicht erstellt werden. Prüfen Sie die ausgewählten Positionen.",
    success: "Der Rechnungsentwurf wurde erstellt und die gewählten Kosten wurden reserviert.", open: "Entwurf öffnen",
    total: "Summe des Entwurfs", choose: "Mindestens eine Leistung oder einen Kostenbeleg auswählen.", patientPaid: "Patient selbst", gmedPaid: "GMed", unpaid: "Unbezahlt",
    ready: "Nicht berechnet", reserved: "Im Entwurf / berechnet", afterPayment: "Nach Zahlung", notRequired: "Nicht erforderlich",
    orderService: "Über die Auftragsleistung",
    comment: "Anmerkung auf der Rechnung", commentHint: "z. B. 2. und 3. Quartal 2026",
    actions: "Aktion", waived: "Trägt GMED", waive: "Nicht weiterberechnen", unwaive: "Wieder weiterberechnen",
    waiveTitle: "Kosten trägt GMED",
    waiveDescription: (amount: string) => `Der nicht berechnete Rest von ${amount} ist keine Forderung an den Patienten mehr und verschwindet aus den weiterberechenbaren Kosten. Lieferantenrechnung, Zahlung und Buchung bleiben unverändert.`,
    unwaiveTitle: "Kosten wieder weiterberechnen",
    unwaiveDescription: (amount: string) => `${amount} sind wieder eine Forderung an den Patienten und erscheinen bei den weiterberechenbaren Kosten.`,
    reason: "Grund", reasonHint: "3 bis 1000 Zeichen. Erscheint im Kontoauszug (nur für Mitarbeitende) und im Protokoll.",
    cancel: "Abbrechen", waiverFailed: "Die Änderung konnte nicht gespeichert werden.",
    waivedBy: (amount: string, reason: string) => `${amount} trägt GMED: ${reason}`,
  } : {
    title: "Выставление пациенту",
    order: "Заказ (необязательно)", noOrder: "Без заказа", currency: "Валюта", quote: "Предложение с услугами", noQuote: "Только расходы — без предложения", type: "Тип счёта",
    interim: "Промежуточный", final: "Финальный", due: "Срок оплаты", services: "Услуги", expenses: "Расходы для перевыставления",
    waiting: "Остальные расходы", amount: "Сумма", source: "Источник", payment: "Оплата", patientInvoice: "Счёт пациенту",
    noServices: "По этому заказу нет доступных позиций предложения.", noExpenses: "Нет оплаченных GMed расходов, которые ещё не выставлены пациенту.",
    create: "Создать черновик счёта", creating: "Создаём черновик…", retry: "Обновить", failed: "Не удалось загрузить данные для выставления.",
    saveFailed: "Не удалось создать черновик. Проверьте выбранные позиции.",
    success: "Черновик создан, выбранные расходы зарезервированы за ним.", open: "Открыть черновик",
    total: "Сумма черновика", choose: "Выберите хотя бы одну услугу или расход.", patientPaid: "Сам пациент", gmedPaid: "GMed", unpaid: "Не оплачен",
    ready: "Не выставлено", reserved: "В черновике / выставлено", afterPayment: "После оплаты", notRequired: "Не требуется",
    orderService: "Через услугу заказа",
    comment: "Примечание в счёте", commentHint: "например: за 2 и 3 квартал 2026",
    actions: "Действие", waived: "За счёт GMED", waive: "Не перевыставлять", unwaive: "Вернуть в перевыставление",
    waiveTitle: "Расход за счёт GMED",
    waiveDescription: (amount: string) => `Невыставленный остаток ${amount} больше не будет долгом пациента и исчезнет из расходов для перевыставления. Счёт поставщика, его оплата и проводка не меняются.`,
    unwaiveTitle: "Вернуть расход в перевыставление",
    unwaiveDescription: (amount: string) => `${amount} снова станут долгом пациента и появятся в расходах для перевыставления.`,
    reason: "Причина", reasonHint: "От 3 до 1000 символов. Видна сотрудникам в выписке пациента и в журнале.",
    cancel: "Отмена", waiverFailed: "Не удалось сохранить изменение.",
    waivedBy: (amount: string, reason: string) => `${amount} за счёт GMED: ${reason}`,
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
    setLineComments({});
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
          line_items: quote ? selectedLines.map(line_index => {
            const comment = (lineComments[line_index] ?? "").trim();
            return { line_index, quantity: String(availableQuantity(serviceLines[line_index])), ...(comment ? { comment } : {}) };
          }) : null,
          external_invoice_ids: selectedExpenses,
        }),
      });
      setCreated(invoice);
      setRequestId(crypto.randomUUID());
      setSelectedExpenses([]);
      setQuoteId("");
      setSelectedLines([]);
      setLineComments({});
      setRevision(value => value + 1);
    } catch (saveError) {
      setError(invoiceCreationErrorMessage(saveError, lang, copy.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  function openWaiverAction(action: WaiverAction) {
    setWaiverAction(action);
    setWaiverReason("");
    setWaiverError(null);
  }

  async function submitWaiverAction(event: FormEvent) {
    event.preventDefault();
    if (!waiverAction || waiverBusy) return;
    const reason = waiverReason.trim();
    if (reason.length < 3 || reason.length > 1000) return;
    setWaiverBusy(true);
    setWaiverError(null);
    try {
      const base = `/external-invoices/${waiverAction.expense.id}/rebilling-waivers`;
      if (waiverAction.kind === "waive") {
        await apiFetch(base, {
          method: "POST",
          body: JSON.stringify({ request_id: waiverAction.requestId, reason }),
        });
      } else {
        await apiFetch(`${base}/${waiverAction.waiver.id}/reversal`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        });
      }
      setWaiverAction(null);
      setSelectedExpenses(current => current.filter(id => id !== waiverAction.expense.id));
      setRevision(value => value + 1);
    } catch (actionError) {
      setWaiverError(actionError instanceof Error ? actionError.message : copy.waiverFailed);
    } finally {
      setWaiverBusy(false);
    }
  }

  const activeWaivers = (expense: BillingExpense) =>
    (expense.rebilling_waivers ?? []).filter(waiver => !waiver.reversed_at);
  const expenseState = (expense: BillingExpense) => {
    if (expense.paid_by === "patient") return copy.notRequired;
    // GMED's cost of an order service: the patient pays the service line.
    if (expense.order_service_billed) return copy.orderService;
    // GMED bears the whole rest: nothing of it is (still) on a patient invoice.
    if (Number(expense.remaining_receivable_gross) <= 0
      && Number(expense.waived_receivable_gross ?? 0) > 0
      && Number(expense.allocated_receivable_gross) <= 0) return copy.waived;
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
    // CEO and Billing drop an unbilled rest from re-billing (GMED bears it)
    // or put a waived part back (owner 2026-10-12).
    { id: "waiver", label: copy.actions, accessor: row => activeWaivers(row).length, width: 230, render: row => {
      const waivers = activeWaivers(row);
      const canWaiveRow = canWaive && row.paid_by !== "patient" && !row.order_service_billed
        && Number(row.remaining_receivable_gross) > 0;
      if (!waivers.length && !canWaiveRow) return null;
      return <div className="flex flex-col items-end gap-1">
        {waivers.map(waiver => <span key={waiver.id} className="flex flex-wrap items-center justify-end gap-1">
          <span title={copy.waivedBy(formatMoneyAmount(waiver.amount_gross, row.currency), waiver.reason)}><StatusBadge tone="neutral">{copy.waived} · {formatMoneyAmount(waiver.amount_gross, row.currency)}</StatusBadge></span>
          {canWaive ? <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={saving} onClick={() => openWaiverAction({ kind: "reverse", expense: row, waiver })}><Undo2 className="size-3.5" />{copy.unwaive}</Button> : null}
        </span>)}
        {canWaiveRow ? <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={saving} onClick={() => openWaiverAction({ kind: "waive", expense: row, requestId: crypto.randomUUID() })}><Ban className="size-3.5" />{copy.waive}</Button> : null}
      </div>;
    } },
  ];
  const waiverAmount = waiverAction
    ? formatMoneyAmount(waiverAction.kind === "waive" ? waiverAction.expense.remaining_receivable_gross : waiverAction.waiver.amount_gross, waiverAction.expense.currency)
    : "";
  const waiverReasonValid = waiverReason.trim().length >= 3 && waiverReason.trim().length <= 1000;

  return <div className="mt-4 min-w-0 space-y-4" data-testid="patient-billing">
    <PatientTerminationSettlements patientId={patientId} lang={lang} />
    <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><span className="size-2 rounded-full bg-[var(--brand)]" />{copy.title}</h2>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setRevision(value => value + 1)}><RefreshCw className={cn("size-3.5", busy && "animate-spin")} />{copy.retry}</Button>
      </div>
      <form className="space-y-4 p-4" onSubmit={submit}>
        <div className="grid gap-3 lg:grid-cols-5">
          <Field label={copy.order}><NativeComboboxSelect value={orderId || "__none__"} disabled={busy || saving} onChange={event => { const nextOrderId = event.target.value === "__none__" ? "" : event.target.value; const nextOrder = workspace?.orders.find(item => item.id === nextOrderId); setOrderId(nextOrderId); if (nextOrder) setBillingCurrency(nextOrder.currency); setQuoteId(""); setSelectedLines([]); setLineComments({}); setSelectedExpenses([]); setCreated(null); }}><option value="__none__">{copy.noOrder}</option>{workspace?.orders.map(item => <option key={item.id} value={item.id}>{item.order_number} · {item.cancellation_reason === "contract_terminated" ? (de ? "gekündigt" : "расторгнут") : item.status} · {item.currency}</option>)}</NativeComboboxSelect></Field>
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
              return <div key={`${quote.id}-${index}`} className={cn(!checked && "bg-muted/15")}><label className="grid cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3">
                <input className={checkboxClass} type="checkbox" checked={checked} disabled={saving || invoiceType === "final"} onChange={event => setSelectedLines(current => event.target.checked ? [...current, index] : current.filter(value => value !== index))} />
                <span className="min-w-0"><span className="block text-sm font-medium">{line.description}</span><span className="mt-1 block text-xs text-muted-foreground">{available} × {formatMoneyAmount(line.unit_price, activeCurrency)} · {de ? "MwSt." : "НДС"} {line.vat_rate}%</span></span>
                <span className="whitespace-nowrap font-mono text-sm font-semibold tabular-nums">{formatMoneyAmount(String(available * Number(line.line_gross || 0) / Math.max(Number(line.quantity || 1), 1)), activeCurrency)}</span>
              </label>
                {checked ? <label className="block space-y-1 px-4 pb-3 pl-[2.75rem] text-xs text-muted-foreground"><span>{copy.comment}</span><Input type="text" maxLength={INVOICE_LINE_COMMENT_MAX_LENGTH} disabled={saving} aria-label={`${copy.comment}: ${line.description}`} placeholder={copy.commentHint} value={lineComments[index] ?? ""} onChange={event => setLineComments(current => ({ ...current, [index]: event.target.value }))} /></label> : null}
              </div>;
            })}
          </div>}
        </section>

        <DataTableSurface rows={[...readyExpenses, ...otherExpenses]} columns={expenseColumns} rowId={row => row.id} dictionary={t as unknown as Record<string, string>} defaultDensity="compact" storageKey={`patient-billing-expenses-${patientId}`} mobilePrimaryColumnId="document" mobileDetailColumnIds={["provider", "payment", "patient_invoice", "amount", "waiver"]} emptyState={copy.noExpenses} toolbarStart={<AdminSectionTitle>{copy.expenses}</AdminSectionTitle>} />

        <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
          <div><p className="text-xs text-muted-foreground">{copy.total}</p><p className="font-mono text-lg font-semibold tabular-nums">{formatMoneyAmount(String(total), activeCurrency)}</p></div>
          <div className="text-right"><Button type="submit" disabled={!canCreate || saving || total <= 0}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}{saving ? copy.creating : copy.create}</Button>{total <= 0 ? <p className="mt-1 text-xs text-muted-foreground">{copy.choose}</p> : null}</div>
        </div>
      </form>
    </section>
    <Dialog open={waiverAction !== null} onOpenChange={open => { if (!open && !waiverBusy) setWaiverAction(null); }}>
      <DialogContent className="sm:max-w-lg">
        <form className="space-y-4" onSubmit={submitWaiverAction} data-testid="rebilling-waiver-dialog">
          <DialogHeader>
            <DialogTitle>{waiverAction?.kind === "reverse" ? copy.unwaiveTitle : copy.waiveTitle}</DialogTitle>
            <DialogDescription>
              {waiverAction?.expense.external_invoice_number}
              {waiverAction?.expense.provider_name ? ` · ${waiverAction.expense.provider_name}` : ""}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm leading-6 text-foreground">
            {waiverAction?.kind === "reverse" ? copy.unwaiveDescription(waiverAmount) : copy.waiveDescription(waiverAmount)}
          </p>
          <Field label={copy.reason}>
            <textarea className={cn(textareaClass, "min-h-20")} value={waiverReason} maxLength={1000} disabled={waiverBusy} aria-label={copy.reason} onChange={event => setWaiverReason(event.target.value)} />
            <p className="text-xs text-muted-foreground">{copy.reasonHint}</p>
          </Field>
          {waiverError ? <Banner tone="error">{waiverError}</Banner> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={waiverBusy} onClick={() => setWaiverAction(null)}>{copy.cancel}</Button>
            <Button type="submit" disabled={waiverBusy || !waiverReasonValid}>
              {waiverBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {waiverAction?.kind === "reverse" ? copy.unwaive : copy.waive}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}
