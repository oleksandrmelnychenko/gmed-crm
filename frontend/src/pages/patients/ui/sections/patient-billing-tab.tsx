import { useEffect, useState, type FormEvent } from "react";
import { Ban, BriefcaseMedical, CheckCircle2, ConciergeBell, Eye, FilePlus2, LoaderCircle, ReceiptText, RefreshCw, Undo2, Wallet } from "lucide-react";

import { SectionHeading } from "@/components/ui/section-heading";
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
import { formatAppDate } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  invoiceCreationErrorMessage,
  partlyCreditedHint,
} from "@/pages/invoices/model/billing-release";
import { INVOICE_LINE_COMMENT_MAX_LENGTH, isOverageOnlyInvoice, isQuoteClosedForInvoicing } from "@/pages/invoices/model/invoice-model";
import type { InvoiceLineItem, InvoiceType, QuoteOption } from "@/pages/invoices/model/types";
import { PatientTerminationSettlements } from "@/pages/invoices/termination-settlement/ui";
import { doubleBillingWarnings, proposedOrderForExpense } from "./patient-billing-double-billing";
import {
  conciergeLineAmounts,
  conciergeServiceState,
  hasSalePrice,
  type BillingConciergeService,
  type ConciergeServiceState,
} from "./patient-billing-concierge";

type BillingOrder = {
  id: string;
  order_number: string;
  status: string;
  phase: string;
  currency: string;
  package_coverage_status: string;
  services: Array<{ id: string; status: string; is_cost_passthrough?: boolean; name?: string | null }>;
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
  /** The order of the cost: its own, else the order of its Concierge service. */
  proposed_order_id?: string | null;
  concierge_receipt?: boolean;
  /** The order's settlement is closed: its waivers stay. */
  settlement_closed?: boolean;
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
  /** Ready concierge services of the patient (F-C8). */
  concierge_services?: BillingConciergeService[];
  /** VAT rate of the default tax profile the concierge lines take. */
  concierge_vat_rate?: string | null;
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
  const [proposedOrderId, setProposedOrderId] = useState<string | null>(null);
  const [billingCurrency, setBillingCurrency] = useState("EUR");
  const [quoteId, setQuoteId] = useState("");
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("interim");
  const [dueDate, setDueDate] = useState("");
  const [selectedExpenses, setSelectedExpenses] = useState<string[]>([]);
  const [selectedConcierge, setSelectedConcierge] = useState<string[]>([]);
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
    noServices: "Für diesen Auftrag gibt es keine offenen Angebotspositionen.", selectQuote: "Kein Angebot gewählt: Wählen Sie oben ein Angebot, um seine Positionen abzurechnen.", noOrderQuotes: "Für diesen Auftrag gibt es kein offenes Angebot.", noOrderForQuote: "Angebotspositionen gibt es nur mit einem Bezugsauftrag.", noExpenses: "Keine von GMED bezahlten, noch nicht berechneten Kosten.",
    create: "Rechnungsentwurf erstellen", creating: "Entwurf wird erstellt…", retry: "Aktualisieren", failed: "Die Abrechnungsdaten konnten nicht geladen werden.",
    saveFailed: "Der Rechnungsentwurf konnte nicht erstellt werden. Prüfen Sie die ausgewählten Positionen.",
    success: "Der Rechnungsentwurf wurde erstellt und die gewählten Kosten wurden reserviert.", open: "Entwurf öffnen",
    total: "Summe des Entwurfs", choose: "Mindestens eine Leistung oder einen Kostenbeleg auswählen.", patientPaid: "Patient selbst", gmedPaid: "GMED", unpaid: "Unbezahlt",
    ready: "Nicht berechnet", reserved: "Im Entwurf / berechnet", afterPayment: "Nach Zahlung", notRequired: "Nicht erforderlich",
    orderService: "Über die Auftragsleistung",
    viaConciergeService: "Auftrag der Concierge-Leistung",
    proposedOrder: (order: string) => `Auftrag ${order} aus dem Beleg bzw. seiner Concierge-Leistung übernommen. Bei Bedarf einen anderen wählen.`,
    transitWarning: (order: string, lines: string) => `Auftrag ${order} enthält eine Durchlaufposition (${lines}). Concierge-Kosten werden über die Belege weiterberechnet; eine Durchlaufposition gilt nur für einen vorab bekannten Preis. Prüfen, dass diese Kosten nicht zusätzlich über die Durchlaufposition berechnet werden.`,
    rebilledWarning: (lines: string, receipts: string) => `Die Durchlaufposition (${lines}) wird berechnet, obwohl Belege dieses Auftrags bereits weiterberechnet werden (${receipts}). Prüfen, dass der Patient dieselben Kosten nicht doppelt zahlt.`,
    overageOnly: (amount: string) => `Alle Positionen sind abgerechnet. Der Entwurf wird eine Zwischenrechnung über den Mehrverbrauch aus dem Tarif: ${amount}.`,
    orderStatus: { active: "aktiv", paused: "pausiert", completed: "abgeschlossen", cancelled: "storniert" } as Record<string, string>,
    comment: "Anmerkung auf der Rechnung", commentHint: "z. B. 2. und 3. Quartal 2026",
    actions: "Aktion", waived: "Trägt GMED", waive: "Nicht weiterberechnen", unwaive: "Wieder weiterberechnen",
    waiveTitle: "Kosten trägt GMED",
    waiveDescription: (amount: string) => `Der nicht berechnete Rest von ${amount} ist keine Forderung an den Patienten mehr und verschwindet aus den weiterberechenbaren Kosten. Lieferantenrechnung, Zahlung und Buchung bleiben unverändert.`,
    unwaiveTitle: "Kosten wieder weiterberechnen",
    unwaiveDescription: (amount: string) => `${amount} sind wieder eine Forderung an den Patienten und erscheinen bei den weiterberechenbaren Kosten.`,
    reason: "Grund", reasonHint: "3 bis 1000 Zeichen. Erscheint im Kontoauszug (nur für Mitarbeitende) und im Protokoll.",
    cancel: "Abbrechen", waiverFailed: "Die Änderung konnte nicht gespeichert werden.",
    waivedBy: (amount: string, reason: string) => `${amount} trägt GMED: ${reason}`,
    concierge: "Concierge-Leistungen zur Abrechnung",
    conciergeEmpty: "Keine abrechnungsbereiten Concierge-Leistungen mit Verkaufspreis.",
    conciergeHint: (rate: string) => `Verkaufspreis netto zzgl. ${rate} % MwSt.; mit der Ausstellung gilt die Leistung als berechnet.`,
    conciergeState: {
      in_draft: "Im Entwurf",
      other_order: "Anderer Auftrag",
      other_currency: "Andere Währung",
      no_price: "Kein Verkaufspreis",
      selectable: "",
    } satisfies Record<ConciergeServiceState, string>,
    conciergeNoPrice: (count: number) => `${count} abrechnungsbereite Concierge-Leistung(en) ohne Verkaufspreis werden nicht angeboten. Preis in der Leistung erfassen:`,
    readOnly: "Nur Ansicht: Rechnungen erstellen Billing, CEO oder der Patientenmanager.",
    noOrderShort: "Ohne Auftrag",
  } : {
    title: "Выставление пациенту",
    order: "Заказ (необязательно)", noOrder: "Без заказа", currency: "Валюта", quote: "Предложение с услугами", noQuote: "Только расходы — без предложения", type: "Тип счёта",
    interim: "Промежуточный", final: "Финальный", due: "Срок оплаты", services: "Услуги", expenses: "Расходы для перевыставления",
    waiting: "Остальные расходы", amount: "Сумма", source: "Источник", payment: "Оплата", patientInvoice: "Счёт пациенту",
    noServices: "По этому заказу нет доступных позиций предложения.", selectQuote: "Предложение не выбрано: выберите предложение выше, чтобы выставить его позиции.", noOrderQuotes: "По этому заказу нет открытого предложения.", noOrderForQuote: "Позиции предложения доступны только при выбранном заказе.", noExpenses: "Нет оплаченных GMED расходов, которые ещё не выставлены пациенту.",
    create: "Создать черновик счёта", creating: "Создаём черновик…", retry: "Обновить", failed: "Не удалось загрузить данные для выставления.",
    saveFailed: "Не удалось создать черновик. Проверьте выбранные позиции.",
    success: "Черновик создан, выбранные расходы зарезервированы за ним.", open: "Открыть черновик",
    total: "Сумма черновика", choose: "Выберите хотя бы одну услугу или расход.", patientPaid: "Сам пациент", gmedPaid: "GMED", unpaid: "Не оплачен",
    ready: "Не выставлено", reserved: "В черновике / выставлено", afterPayment: "После оплаты", notRequired: "Не требуется",
    orderService: "Через услугу заказа",
    viaConciergeService: "Заказ услуги Concierge",
    proposedOrder: (order: string) => `Подставлен заказ ${order} из расхода или его услуги Concierge. При необходимости выберите другой.`,
    transitWarning: (order: string, lines: string) => `В заказе ${order} есть транзитная позиция (${lines}). Расходы Concierge выставляются через перевыставление чеков; транзитная позиция — только для заранее известной цены. Проверьте, что эти расходы не выставляются ещё раз через транзитную позицию.`,
    rebilledWarning: (lines: string, receipts: string) => `Выставляется транзитная позиция (${lines}), хотя расходы этого заказа уже перевыставлены по чекам (${receipts}). Проверьте, что пациент не оплатит одни и те же расходы дважды.`,
    overageOnly: (amount: string) => `Все позиции выставлены. Черновик станет промежуточным счётом на превышение по тарифу: ${amount}.`,
    orderStatus: { active: "активен", paused: "на паузе", completed: "завершён", cancelled: "отменён" } as Record<string, string>,
    comment: "Примечание в счёте", commentHint: "например: за 2 и 3 квартал 2026",
    actions: "Действие", waived: "За счёт GMED", waive: "Не перевыставлять", unwaive: "Вернуть в перевыставление",
    waiveTitle: "Расход за счёт GMED",
    waiveDescription: (amount: string) => `Невыставленный остаток ${amount} больше не будет долгом пациента и исчезнет из расходов для перевыставления. Счёт поставщика, его оплата и проводка не меняются.`,
    unwaiveTitle: "Вернуть расход в перевыставление",
    unwaiveDescription: (amount: string) => `${amount} снова станут долгом пациента и появятся в расходах для перевыставления.`,
    reason: "Причина", reasonHint: "От 3 до 1000 символов. Видна сотрудникам в выписке пациента и в журнале.",
    cancel: "Отмена", waiverFailed: "Не удалось сохранить изменение.",
    waivedBy: (amount: string, reason: string) => `${amount} за счёт GMED: ${reason}`,
    concierge: "Услуги Concierge к выставлению",
    conciergeEmpty: "Нет готовых к выставлению услуг Concierge с ценой продажи.",
    conciergeHint: (rate: string) => `Цена продажи нетто плюс НДС ${rate} %; после выпуска счёта услуга считается выставленной.`,
    conciergeState: {
      in_draft: "В черновике",
      other_order: "Другой заказ",
      other_currency: "Другая валюта",
      no_price: "Нет цены продажи",
      selectable: "",
    } satisfies Record<ConciergeServiceState, string>,
    conciergeNoPrice: (count: number) => `Готовые услуги Concierge без цены продажи (${count}) не предлагаются. Укажите цену в услуге:`,
    readOnly: "Только просмотр: счёт создают Billing, CEO или менеджер пациента.",
    noOrderShort: "Без заказа",
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
        const currencies = [...nextWorkspace.orders, ...nextWorkspace.expenses, ...(nextWorkspace.concierge_services ?? [])]
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
    [...(workspace?.orders ?? []), ...(workspace?.expenses ?? []), ...(workspace?.concierge_services ?? [])]
      .map(item => item.currency?.trim().toUpperCase())
      .filter(Boolean),
  ));
  if (!currencyOptions.includes("EUR")) currencyOptions.push("EUR");
  const activeCurrency = order?.currency || billingCurrency;
  const readyExpenses = (workspace?.expenses ?? []).filter(expense => expense.billable && expense.currency === activeCurrency);
  const otherExpenses = (workspace?.expenses ?? []).filter(expense => !readyExpenses.some(item => item.id === expense.id));
  // Ready concierge services at their sale price (F-C8). One without a price
  // is not offered; staff set it on the service.
  const readOnly = !canCreate;
  const conciergeServices = workspace?.concierge_services ?? [];
  const pricedConcierge = conciergeServices.filter(hasSalePrice);
  const unpricedConcierge = conciergeServices.filter(service => !hasSalePrice(service));
  const conciergeVatRate = workspace?.concierge_vat_rate ?? null;
  const conciergeDraft = { orderId, currency: activeCurrency };
  const billableConciergeIds = selectedConcierge.filter(id => {
    const service = pricedConcierge.find(item => item.id === id);
    return Boolean(service) && conciergeServiceState(service as BillingConciergeService, conciergeDraft) === "selectable";
  });

  useEffect(() => {
    if (quoteId && !quotes.some(item => item.id === quoteId && item.order_id === orderId)) {
      setQuoteId("");
      setSelectedLines([]);
    }
    setSelectedExpenses(current => {
      const next = current.filter(id => (workspace?.expenses ?? []).some(expense => expense.id === id && expense.billable && expense.currency === activeCurrency));
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
    setSelectedConcierge(current => {
      const next = current.filter(id => {
        const service = (workspace?.concierge_services ?? []).find(item => item.id === id);
        return Boolean(service) && conciergeServiceState(service as BillingConciergeService, { orderId, currency: activeCurrency }) === "selectable";
      });
      return next.length === current.length ? current : next;
    });
  }, [activeCurrency, orderId, quoteId, quotes, workspace]);

  const serviceTotal = selectedLines.reduce((sum, index) => {
    const line = serviceLines[index];
    return sum + (line ? availableQuantity(line) * Number(line.line_gross || 0) / Math.max(Number(line.quantity || 1), 1) : 0);
  }, 0);
  const expenseTotal = readyExpenses.filter(expense => selectedExpenses.includes(expense.id))
    .reduce((sum, expense) => sum + Number(expense.remaining_receivable_gross || 0), 0);
  // The approved overage the server adds to the invoice of the last open lines.
  const billsAllOpenLines = selectedLines.length > 0
    && serviceLines.every((line, index) => availableQuantity(line) <= 0 || selectedLines.includes(index));
  // Every line is billed: an interim invoice bills the overage alone (QA 2026-11-01, X3 NEW-1).
  const overageOnly = isOverageOnlyInvoice(quote, { invoiceType: "interim" });
  const overageTotal = billsAllOpenLines || overageOnly ? Number(quote?.open_package_overage_gross ?? 0) : 0;
  const conciergeTotal = billableConciergeIds.reduce((sum, id) => {
    const service = pricedConcierge.find(item => item.id === id);
    return sum + (service ? conciergeLineAmounts(service, conciergeVatRate).gross : 0);
  }, 0);
  const total = serviceTotal + expenseTotal + overageTotal + conciergeTotal;
  const billingWarnings = doubleBillingWarnings({
    orders: workspace?.orders ?? [],
    expenses: workspace?.expenses ?? [],
    selectedExpenseIds: selectedExpenses,
    orderId,
    selectedQuoteLines: selectedLines.map(index => serviceLines[index]).filter((line): line is InvoiceLineItem => Boolean(line)),
  });

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
      // A quote without an open position bills nothing: the draft takes the
      // ticked costs alone (QA 2026-11-01, it answered «check the positions»).
      const billedQuote = selectedLines.length || overageOnly ? quote : null;
      const invoice = await apiFetch<CreatedInvoice>(`/patients/${patientId}/billing-invoices`, {
        method: "POST",
        body: JSON.stringify({
          request_id: requestId,
          order_id: order?.id ?? null,
          quote_id: billedQuote?.id || null,
          currency: activeCurrency,
          invoice_type: overageOnly ? "interim" : invoiceType,
          due_date: dueDate || null,
          line_items: billedQuote && !overageOnly ? selectedLines.map(line_index => {
            const comment = (lineComments[line_index] ?? "").trim();
            return { line_index, quantity: String(availableQuantity(serviceLines[line_index])), ...(comment ? { comment } : {}) };
          }) : null,
          external_invoice_ids: selectedExpenses,
          concierge_service_ids: billableConciergeIds,
        }),
      });
      setCreated(invoice);
      setRequestId(crypto.randomUUID());
      setSelectedExpenses([]);
      setSelectedConcierge([]);
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
  const linkedOrderNumber = (expense: BillingExpense) => expense.proposed_order_id
    ? workspace?.orders.find(item => item.id === expense.proposed_order_id)?.order_number ?? null
    : null;
  // Ticking a receipt while no order is chosen proposes the order of the
  // receipt or of its Concierge service, so the re-billed revenue lands in
  // that order's economics (QA 2026-11-12 C-1). Staff may still change it.
  function toggleExpense(expense: BillingExpense, checked: boolean) {
    if (checked && !orderId) {
      const proposed = proposedOrderForExpense(expense, workspace?.orders ?? []);
      if (proposed) {
        setOrderId(proposed.id);
        setBillingCurrency(proposed.currency);
        setProposedOrderId(proposed.id);
      }
    }
    setSelectedExpenses(current => checked ? [...current, expense.id] : current.filter(id => id !== expense.id));
  }
  // Ticking a concierge service while no order is chosen takes the service's
  // order: its sale price belongs to that order's economics (F-C8).
  function toggleConcierge(service: BillingConciergeService, checked: boolean) {
    if (checked && !orderId && service.order_id) {
      const serviceOrder = workspace?.orders.find(item => item.id === service.order_id);
      if (serviceOrder) {
        setOrderId(serviceOrder.id);
        setBillingCurrency(serviceOrder.currency);
        setProposedOrderId(serviceOrder.id);
      }
    }
    setCreated(null);
    setSelectedConcierge(current => checked ? [...current, service.id] : current.filter(id => id !== service.id));
  }
  const paymentLabel = (expense: BillingExpense) => expense.paid_by === "patient"
    ? copy.patientPaid : Number(expense.company_paid_gross) > 0 ? copy.gmedPaid : copy.unpaid;
  const expenseColumns: ColumnDef<BillingExpense>[] = [
    { id: "select", label: "", accessor: row => selectedExpenses.includes(row.id), width: 52, required: true, render: row => <input className={checkboxClass} type="checkbox" disabled={!row.billable || row.currency !== activeCurrency || saving} checked={selectedExpenses.includes(row.id)} aria-label={`${copy.expenses}: ${row.external_invoice_number}`} onChange={event => toggleExpense(row, event.target.checked)} /> },
    { id: "document", label: de ? "Beleg" : "Документ", accessor: row => row.external_invoice_number, width: 190, render: row => <span className="font-mono font-semibold">{row.external_invoice_number}</span> },
    { id: "provider", label: de ? "Leistungserbringer" : "Поставщик", accessor: row => row.provider_name ?? "", width: 210, render: row => row.provider_name || "—" },
    { id: "source", label: copy.source, accessor: row => row.source_order_number ?? linkedOrderNumber(row) ?? "", width: 170, render: row => row.source_order_number ? <span className="font-mono text-xs">{row.source_order_number}</span> : linkedOrderNumber(row) ? <span className="font-mono text-xs" title={copy.viaConciergeService}>{linkedOrderNumber(row)}</span> : <StatusBadge tone="neutral">{de ? "Ohne Auftrag" : "Без заказа"}</StatusBadge> },
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
          {canWaive && !row.settlement_closed ? <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={saving} onClick={() => openWaiverAction({ kind: "reverse", expense: row, waiver })}><Undo2 className="size-3.5" />{copy.unwaive}</Button> : null}
        </span>)}
        {canWaiveRow ? <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={saving} onClick={() => openWaiverAction({ kind: "waive", expense: row, requestId: crypto.randomUUID() })}><Ban className="size-3.5" />{copy.waive}</Button> : null}
      </div>;
    } },
  ];
  const waiverAmount = waiverAction
    ? formatMoneyAmount(waiverAction.kind === "waive" ? waiverAction.expense.remaining_receivable_gross : waiverAction.waiver.amount_gross, waiverAction.expense.currency)
    : "";
  const waiverReasonValid = waiverReason.trim().length >= 3 && waiverReason.trim().length <= 1000;

  const knownOrderIds = new Set((workspace?.orders ?? []).map(item => item.id));
  const conciergeSection = <section className="overflow-hidden rounded-xl border border-border/70" data-testid="patient-billing-concierge">
    <div className="border-b border-border/60 px-4 py-3">
      <AdminSectionTitle icon={ConciergeBell}>{copy.concierge}</AdminSectionTitle>
      {pricedConcierge.length && conciergeVatRate !== null && !readOnly ? <p className="mt-1 text-xs text-muted-foreground">{copy.conciergeHint(conciergeVatRate)}</p> : null}
    </div>
    {pricedConcierge.length === 0 ? <p className="px-4 py-5 text-sm text-muted-foreground">{copy.conciergeEmpty}</p> : <div className="divide-y divide-border/60">
      {pricedConcierge.map(service => {
        // An order the tab does not list (e.g. cancelled) cannot anchor it.
        const state: ConciergeServiceState = service.order_id && !knownOrderIds.has(service.order_id)
          ? "other_order"
          : conciergeServiceState(service, conciergeDraft);
        const checked = state === "selectable" && selectedConcierge.includes(service.id);
        const amounts = conciergeLineAmounts(service, conciergeVatRate);
        const details = [
          service.service_date ? formatAppDate(service.service_date) : null,
          service.order_number ?? copy.noOrderShort,
          `${Number(service.quantity)} × ${formatMoneyAmount(service.unit_price ?? "0", service.currency)}`,
          conciergeVatRate !== null ? `${de ? "MwSt." : "НДС"} ${conciergeVatRate}%` : null,
        ].filter(Boolean).join(" · ");
        const body = <>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{service.title}</span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{details}</span>
              {state !== "selectable" ? <StatusBadge tone="neutral">{copy.conciergeState[state]}</StatusBadge> : null}
              {service.invoice_id ? <StaffLink className="font-mono font-semibold text-primary hover:underline" to={`/invoices?invoice=${encodeURIComponent(service.invoice_id)}`}>{service.invoice_number || copy.open}</StaffLink> : null}
            </span>
          </span>
          <span className="whitespace-nowrap font-mono text-sm font-semibold tabular-nums">{formatMoneyAmount(String(amounts.gross), service.currency)}</span>
        </>;
        if (readOnly) {
          return <div key={service.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3">{body}</div>;
        }
        return <label key={service.id} className={cn("grid cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3", !checked && "bg-muted/15")}>
          <input className={checkboxClass} type="checkbox" checked={checked} disabled={saving || state !== "selectable"} aria-label={`${copy.concierge}: ${service.title}`} onChange={event => toggleConcierge(service, event.target.checked)} />
          {body}
        </label>;
      })}
    </div>}
    {unpricedConcierge.length ? <p className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground" data-testid="patient-billing-concierge-no-price">
      {copy.conciergeNoPrice(unpricedConcierge.length)}{" "}
      {unpricedConcierge.map((service, index) => <span key={service.id}>{index ? ", " : ""}<StaffLink className="font-medium text-primary hover:underline" to={`/services?service=${encodeURIComponent(service.id)}`}>{service.title}</StaffLink></span>)}
    </p> : null}
  </section>;

  return <div className="mt-4 min-w-0 space-y-4" data-testid="patient-billing">
    <PatientTerminationSettlements patientId={patientId} lang={lang} onChanged={() => setRevision(value => value + 1)} />
    <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><SectionHeading icon={Wallet}>{copy.title}</SectionHeading></h2>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setRevision(value => value + 1)}><RefreshCw className={cn("size-3.5", busy && "animate-spin")} />{copy.retry}</Button>
      </div>
      {readOnly ? <div className="space-y-4 p-4" data-testid="patient-billing-read-only">
        {/* Read only (e.g. the CEO assistant): what is billable, no billing
            form and no write control (screens QA 2026-11-12, F-C11). */}
        <p className="flex items-center gap-2 rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground"><Eye className="size-4 shrink-0" />{copy.readOnly}</p>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {conciergeSection}
        <DataTableSurface rows={[...readyExpenses, ...otherExpenses]} columns={expenseColumns.filter(column => column.id !== "select" && column.id !== "waiver")} rowId={row => row.id} dictionary={t as unknown as Record<string, string>} defaultDensity="compact" storageKey={`patient-billing-expenses-read-${patientId}`} mobilePrimaryColumnId="document" mobileDetailColumnIds={["provider", "payment", "patient_invoice", "amount"]} emptyState={copy.noExpenses} toolbarStart={<AdminSectionTitle icon={ReceiptText}>{copy.expenses}</AdminSectionTitle>} />
      </div> : <form className="space-y-4 p-4" onSubmit={submit}>
        <div className="grid gap-3 lg:grid-cols-5">
          <Field label={copy.order}><NativeComboboxSelect value={orderId || "__none__"} disabled={busy || saving} onChange={event => { const nextOrderId = event.target.value === "__none__" ? "" : event.target.value; const nextOrder = workspace?.orders.find(item => item.id === nextOrderId); setOrderId(nextOrderId); setProposedOrderId(null); if (nextOrder) setBillingCurrency(nextOrder.currency); setQuoteId(""); setSelectedLines([]); setLineComments({}); setSelectedExpenses([]); setSelectedConcierge([]); setCreated(null); }}><option value="__none__">{copy.noOrder}</option>{workspace?.orders.map(item => <option key={item.id} value={item.id}>{item.order_number} · {item.cancellation_reason === "contract_terminated" ? (de ? "gekündigt" : "расторгнут") : copy.orderStatus[item.status] ?? item.status} · {item.currency}</option>)}</NativeComboboxSelect></Field>
          <Field label={copy.currency}><NativeComboboxSelect value={activeCurrency} disabled={Boolean(order) || busy || saving} onChange={event => { setBillingCurrency(event.target.value); setSelectedExpenses([]); setCreated(null); }}>{currencyOptions.map(currency => <option key={currency} value={currency}>{currency}</option>)}</NativeComboboxSelect></Field>
          <Field label={copy.quote}><NativeComboboxSelect value={quoteId || "__empty__"} disabled={!order || busy || saving} onChange={event => selectQuote(event.target.value === "__empty__" ? "" : event.target.value)}><option value="__empty__">{copy.noQuote}</option>{orderQuotes.map(item => <option key={item.id} value={item.id}>{item.quote_number}</option>)}</NativeComboboxSelect></Field>
          <Field label={copy.type}><NativeComboboxSelect value={invoiceType} disabled={saving} onChange={event => { const value = event.target.value as InvoiceType; setInvoiceType(value); if (value === "final") setSelectedLines(serviceLines.map((line, index) => availableQuantity(line) > 0 ? index : -1).filter(index => index >= 0)); }}><option value="interim">{copy.interim}</option><option value="final">{copy.final}</option></NativeComboboxSelect></Field>
          <Field label={copy.due}><Input type="date" disabled={saving} value={dueDate} onChange={event => setDueDate(event.target.value)} /></Field>
        </div>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {proposedOrderId && proposedOrderId === orderId && order ? <p className="text-xs text-muted-foreground" data-testid="patient-billing-proposed-order">{copy.proposedOrder(order.order_number)}</p> : null}
        {billingWarnings.transitForSelectedExpenses.map(item => <div key={item.order.id} data-testid="patient-billing-transit-warning"><Banner tone="warning">{copy.transitWarning(item.order.order_number, item.names.join(", "))}</Banner></div>)}
        {billingWarnings.rebilledForTransitLines ? <div data-testid="patient-billing-rebilled-warning"><Banner tone="warning">{copy.rebilledWarning(billingWarnings.rebilledForTransitLines.lines.join(", "), billingWarnings.rebilledForTransitLines.expenses.map(expense => expense.latest_patient_invoice_number || expense.external_invoice_number).join(", "))}</Banner></div> : null}
        {created ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><div className="flex flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-2"><CheckCircle2 className="size-4" />{copy.success}</span><StaffLink className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground" to={`/invoices?invoice=${created.id}`}>{copy.open}</StaffLink></div></div> : null}

        <section className="overflow-hidden rounded-xl border border-border/70">
          <div className="border-b border-border/60 px-4 py-3"><AdminSectionTitle icon={BriefcaseMedical}>{copy.services}</AdminSectionTitle></div>
          {!quote || !serviceLines.some(line => availableQuantity(line) > 0) ? <p className="px-4 py-5 text-sm text-muted-foreground">{overageOnly ? copy.overageOnly(formatMoneyAmount(String(overageTotal), activeCurrency)) : <>{!order ? copy.noOrderForQuote : !quote ? (orderQuotes.length > 0 ? copy.selectQuote : copy.noOrderQuotes) : copy.noServices}{quote ? ` ${partlyCreditedHint(lang)}` : ""}</>}</p> : <div className="divide-y divide-border/60">
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

        {conciergeSection}

        <DataTableSurface rows={[...readyExpenses, ...otherExpenses]} columns={expenseColumns} rowId={row => row.id} dictionary={t as unknown as Record<string, string>} defaultDensity="compact" storageKey={`patient-billing-expenses-${patientId}`} mobilePrimaryColumnId="document" mobileDetailColumnIds={["provider", "payment", "patient_invoice", "amount", "waiver"]} emptyState={copy.noExpenses} toolbarStart={<AdminSectionTitle icon={ReceiptText}>{copy.expenses}</AdminSectionTitle>} />

        <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
          <div><p className="text-xs text-muted-foreground">{copy.total}</p><p className="font-mono text-lg font-semibold tabular-nums">{formatMoneyAmount(String(total), activeCurrency)}</p></div>
          <div className="text-right"><Button type="submit" disabled={!canCreate || saving || total <= 0}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}{saving ? copy.creating : copy.create}</Button>{total <= 0 ? <p className="mt-1 text-xs text-muted-foreground">{copy.choose}</p> : null}</div>
        </div>
      </form>}
    </section>
    <Dialog open={waiverAction !== null} onOpenChange={open => { if (!open && !waiverBusy) setWaiverAction(null); }}>
      <DialogContent className="sm:max-w-lg">
        <form className="space-y-4" onSubmit={submitWaiverAction} data-testid="rebilling-waiver-dialog">
          <DialogHeader>
            <DialogTitle><SectionHeading icon={ReceiptText}>{waiverAction?.kind === "reverse" ? copy.unwaiveTitle : copy.waiveTitle}</SectionHeading></DialogTitle>
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
