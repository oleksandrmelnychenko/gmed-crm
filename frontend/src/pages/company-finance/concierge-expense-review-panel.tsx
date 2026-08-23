import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  ReceiptText,
  RefreshCw,
  Undo2,
  XCircle,
} from "lucide-react";

import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StaffLink } from "@/components/staff-link";
import { Banner as ShellBanner, selectClass as shellSelectClassName } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";

import {
  buildExpensePostPayload,
  eligibleExpenseOrderServices,
  eligibleExpenseOrders,
  filterConciergeExpenseQueue,
  resolveStableRequestId,
  validateExpensePostForm,
  validateExpenseRejection,
  type ExpensePostForm,
  type ExpensePostValidationError,
  type ExpenseReviewFilter,
  type StableRequestIdEntry,
} from "./concierge-expense-review-model";
import {
  downloadCompanyConciergeExpenseReceipt,
  fetchCompanyConciergeExpenseContext,
  fetchCompanyConciergeExpenseQueue,
  fetchCompanyConciergeExpenseReceipt,
  postCompanyConciergeExpense,
  rejectCompanyConciergeExpense,
  reverseCompanyConciergeExpense,
} from "./data";
import type {
  CompanyConciergeExpenseContext,
  CompanyConciergeExpenseReviewRow,
  CompanyFinancialAccount,
} from "./types";

type Props = {
  accounts: CompanyFinancialAccount[];
  locale: string;
  onChanged: () => void;
  onPendingCountChange: (count: number) => void;
  requestedExpenseId?: string | null;
};

const EXPENSE_REALTIME_EVENTS = [
  "concierge_expense.submitted",
  "concierge_expense.posted",
  "concierge_expense.rejected",
  "concierge_expense.reversed",
] as const;

type PreviewState = {
  url: string;
  contentType: string;
  filename: string;
};

const emptyForm: ExpensePostForm = {
  orderId: "",
  orderLeistungId: "",
  financialAccountId: "",
  paidOn: "",
  paymentMethod: "bank_transfer",
  paymentReference: "",
};

const textByLanguage = {
  ru: {
    title: "Расходы Concierge",
    subtitle: "Проверка чеков и отражение подтвержденных расходов в финансовом учете.",
    refresh: "Обновить",
    search: "Пациент, услуга, партнёр или заказ",
    all: "Все",
    pending: "Ожидают проверки",
    posted: "Проведены",
    rejected: "Отклонены",
    reversed: "Сторнированы",
    patient: "Пациент",
    service: "Услуга",
    vendor: "Партнёр или исполнитель",
    expenseDate: "Дата расхода",
    submittedAt: "Передано",
    amount: "Сумма",
    payer: "Кто оплатил",
    status: "Статус",
    patientPaid: "Пациент",
    agencyPaid: "GMED",
    unpaid: "Не оплачено",
    loading: "Загрузка расходов Concierge…",
    empty: "Расходов для выбранного фильтра нет.",
    incompleteTitle: "Очередь загружена не полностью",
    incomplete: (loaded: number, total: number) =>
      `Загружено ${loaded} из ${total} расходов. Проведение, отклонение и отмена заблокированы до полного обновления.`,
    detailTitle: "Проверка расхода",
    detailDescription: "Сверьте чек, назначение заказа и финансовые последствия до проведения.",
    postedDetailTitle: "Проведенный расход",
    postedDetailDescription: "Расход отражён в финансовом учёте. Проверьте документ, назначение и историю операции.",
    rejectedDetailTitle: "Отклоненный расход",
    rejectedDetailDescription: "Расход не был проведён. Проверьте чек, причину отклонения и историю операции.",
    reversedDetailTitle: "Сторнированный расход",
    reversedDetailDescription: "Проведение отменено. Проверьте чек, восстановленные балансы и историю сторнирования.",
    contextLoading: "Загрузка финансового контекста…",
    contextFailed: "Не удалось загрузить финансовый контекст. Решение заблокировано.",
    receipt: "Чек",
    noReceipt: "Подтверждающего документа нет",
    preview: "Открыть предпросмотр",
    previewLoading: "Загрузка чека…",
    previewUnavailable: "Для этого формата доступно только скачивание.",
    download: "Скачать",
    fileSize: "Размер",
    net: "Нетто",
    vat: "НДС",
    gross: "Брутто",
    note: "Описание",
    submittedBy: "Передал",
    serviceDelivered: "Услуга оказана",
    yes: "Да",
    no: "Нет",
    mapping: "Назначение в заказе",
    order: "Заказ",
    orderService: "Позиция заказа",
    selectOrder: "Выберите заказ",
    noOrderService: "Без конкретной позиции",
    lockedMapping: "Назначение было указано при передаче и не может быть заменено.",
    agencyPayment: "Оплата GMED",
    paidOn: "Дата оплаты",
    financialAccount: "Счет GMED",
    selectAccount: "Выберите счет",
    paymentMethod: "Способ оплаты",
    bankTransfer: "Банковский перевод",
    cash: "Наличные",
    card: "Карта",
    other: "Другое",
    paymentReference: "Назначение / референс платежа",
    approve: "Подтвердить и провести",
    rejectReason: "Причина отклонения",
    rejectReasonRequired: "Укажите причину отклонения (не более 2000 символов).",
    rejectPlaceholder: "Что необходимо исправить",
    reject: "Отклонить",
    reverseTitle: "Отменить проведение",
    reverseDescription: "Отмена вернёт баланс пациента, расход GMED и расчёт с партнёром в исходное состояние. Операция останется в истории.",
    reverseDate: "Дата отмены",
    reverseReason: "Причина отмены",
    reverseReasonRequired: "Укажите причину отмены (не более 2000 символов).",
    reverseDateInvalid: "Дата отмены должна быть между датой расхода и сегодняшним днем.",
    reversePlaceholder: "Почему финансовое проведение необходимо отменить",
    reverse: "Отменить проведение",
    decisionBlocked: "Финансовое решение доступно только после полной загрузки очереди и контекста.",
    balance: "Финансовые последствия",
    patientReceivable: "К оплате пациентом",
    companyPaid: "Оплачено GMED",
    providerLiability: "Долг поставщику",
    postingPending: "Будет создано после подтверждения",
    externalInvoice: "Проведенный документ",
    invoiceStatus: "Статус документа",
    settlementStatus: "Расчет с поставщиком",
    history: "История",
    submitted: "Передано на проверку",
    reason: "Причина",
    noReason: "Без комментария",
    loadFailed: "Не удалось загрузить очередь расходов.",
    previewFailed: "Не удалось открыть чек.",
    downloadFailed: "Не удалось скачать чек.",
    postFailed: "Не удалось провести расход.",
    rejectFailed: "Не удалось отклонить расход.",
    reverseFailed: "Не удалось отменить проведение расхода.",
    approvedSuccess: "Расход проведен.",
    rejectedSuccess: "Расход отклонен.",
    reversedSuccess: "Проведение расхода отменено, балансы пересчитаны.",
    validation: {
      order_required: "Выберите заказ.",
      order_invalid: "Выбранный заказ недоступен или имеет другую валюту.",
      order_locked: "Нельзя заменить заказ, указанный при передаче чека.",
      order_service_invalid: "Выбранная позиция заказа недоступна для этого поставщика.",
      order_service_locked: "Нельзя заменить позицию, указанную при передаче чека.",
      provider_required: "Для этого расхода выберите позицию с поставщиком.",
      paid_on_required: "Укажите дату оплаты GMED.",
      paid_on_invalid: "Дата оплаты должна быть между датой расхода и сегодняшним днем.",
      financial_account_required: "Выберите счет GMED.",
      financial_account_invalid: "Счет должен быть активным, в той же валюте и открытым на дату оплаты.",
      payment_reference_required: "Укажите назначение или референс платежа.",
    },
  },
  de: {
    title: "Concierge-Auslagen",
    subtitle: "Belege prüfen und bestätigte Auslagen in die Finanzbuchhaltung übernehmen.",
    refresh: "Aktualisieren",
    search: "Patient, Leistung, Partner oder Auftrag",
    all: "Alle",
    pending: "Zur Prüfung",
    posted: "Gebucht",
    rejected: "Abgelehnt",
    reversed: "Storniert",
    patient: "Patient",
    service: "Leistung",
    vendor: "Partner oder Leistungserbringer",
    expenseDate: "Auslagendatum",
    submittedAt: "Eingereicht",
    amount: "Betrag",
    payer: "Bezahlt durch",
    status: "Status",
    patientPaid: "Patient",
    agencyPaid: "GMED",
    unpaid: "Unbezahlt",
    loading: "Concierge-Auslagen werden geladen…",
    empty: "Keine Auslagen für den gewählten Filter.",
    incompleteTitle: "Prüfliste unvollständig geladen",
    incomplete: (loaded: number, total: number) =>
      `${loaded} von ${total} Auslagen wurden geladen. Buchen, Ablehnen und Stornieren bleiben bis zur vollständigen Aktualisierung gesperrt.`,
    detailTitle: "Auslage prüfen",
    detailDescription: "Beleg, Auftragszuordnung und finanzielle Auswirkungen vor der Buchung abgleichen.",
    postedDetailTitle: "Gebuchte Auslage",
    postedDetailDescription: "Die Auslage wurde verbucht. Dokument, Zuordnung und Vorgangshistorie prüfen.",
    rejectedDetailTitle: "Abgelehnte Auslage",
    rejectedDetailDescription: "Die Auslage wurde nicht verbucht. Beleg, Ablehnungsgrund und Vorgangshistorie prüfen.",
    reversedDetailTitle: "Stornierte Auslage",
    reversedDetailDescription: "Die Buchung wurde storniert. Beleg, zurückgesetzte Salden und Stornohistorie prüfen.",
    contextLoading: "Finanzkontext wird geladen…",
    contextFailed: "Der Finanzkontext konnte nicht geladen werden. Die Entscheidung ist gesperrt.",
    receipt: "Beleg",
    noReceipt: "Kein Beleg vorhanden",
    preview: "Vorschau öffnen",
    previewLoading: "Beleg wird geladen…",
    previewUnavailable: "Für dieses Format ist nur der Download verfügbar.",
    download: "Herunterladen",
    fileSize: "Größe",
    net: "Netto",
    vat: "MwSt.",
    gross: "Brutto",
    note: "Beschreibung",
    submittedBy: "Eingereicht von",
    serviceDelivered: "Leistung erbracht",
    yes: "Ja",
    no: "Nein",
    mapping: "Auftragszuordnung",
    order: "Auftrag",
    orderService: "Auftragsposition",
    selectOrder: "Auftrag auswählen",
    noOrderService: "Ohne konkrete Position",
    lockedMapping: "Die beim Einreichen angegebene Zuordnung kann nicht ersetzt werden.",
    agencyPayment: "GMED-Zahlung",
    paidOn: "Zahlungsdatum",
    financialAccount: "GMED-Konto",
    selectAccount: "Konto auswählen",
    paymentMethod: "Zahlungsart",
    bankTransfer: "Überweisung",
    cash: "Bar",
    card: "Karte",
    other: "Sonstiges",
    paymentReference: "Verwendungszweck / Zahlungsreferenz",
    approve: "Bestätigen und buchen",
    rejectReason: "Ablehnungsgrund",
    rejectReasonRequired: "Bitte einen Ablehnungsgrund mit höchstens 2000 Zeichen angeben.",
    rejectPlaceholder: "Was muss korrigiert werden?",
    reject: "Ablehnen",
    reverseTitle: "Buchung stornieren",
    reverseDescription: "Die Stornierung setzt Patientensaldo, GMED-Auslage und Partnerabrechnung zurück. Der Vorgang bleibt in der Historie erhalten.",
    reverseDate: "Stornodatum",
    reverseReason: "Stornogrund",
    reverseReasonRequired: "Bitte einen Stornogrund mit höchstens 2000 Zeichen angeben.",
    reverseDateInvalid: "Das Stornodatum muss zwischen Auslagendatum und heute liegen.",
    reversePlaceholder: "Warum muss diese Finanzbuchung storniert werden?",
    reverse: "Buchung stornieren",
    decisionBlocked: "Eine Finanzentscheidung ist erst nach vollständigem Laden von Prüfliste und Kontext möglich.",
    balance: "Finanzielle Auswirkungen",
    patientReceivable: "Patientenforderung",
    companyPaid: "Von GMED bezahlt",
    providerLiability: "Anbieterverbindlichkeit",
    postingPending: "Wird erst nach Bestätigung erzeugt",
    externalInvoice: "Gebuchter Beleg",
    invoiceStatus: "Belegstatus",
    settlementStatus: "Anbieterabrechnung",
    history: "Historie",
    submitted: "Zur Prüfung eingereicht",
    reason: "Grund",
    noReason: "Ohne Kommentar",
    loadFailed: "Die Auslagen-Prüfliste konnte nicht geladen werden.",
    previewFailed: "Der Beleg konnte nicht geöffnet werden.",
    downloadFailed: "Der Beleg konnte nicht heruntergeladen werden.",
    postFailed: "Die Auslage konnte nicht gebucht werden.",
    rejectFailed: "Die Auslage konnte nicht abgelehnt werden.",
    reverseFailed: "Die Buchung der Auslage konnte nicht storniert werden.",
    approvedSuccess: "Die Auslage wurde gebucht.",
    rejectedSuccess: "Die Auslage wurde abgelehnt.",
    reversedSuccess: "Die Auslagenbuchung wurde storniert und die Salden wurden neu berechnet.",
    validation: {
      order_required: "Bitte einen Auftrag auswählen.",
      order_invalid: "Der Auftrag ist nicht verfügbar oder hat eine andere Währung.",
      order_locked: "Der beim Einreichen angegebene Auftrag kann nicht ersetzt werden.",
      order_service_invalid: "Die Auftragsposition ist für diesen Anbieter nicht verfügbar.",
      order_service_locked: "Die beim Einreichen angegebene Position kann nicht ersetzt werden.",
      provider_required: "Bitte eine Auftragsposition mit Anbieter auswählen.",
      paid_on_required: "Bitte das GMED-Zahlungsdatum angeben.",
      paid_on_invalid: "Das Zahlungsdatum muss zwischen Auslagendatum und heute liegen.",
      financial_account_required: "Bitte ein GMED-Konto auswählen.",
      financial_account_invalid: "Das Konto muss aktiv, währungsgleich und am Zahlungsdatum eröffnet sein.",
      payment_reference_required: "Bitte Verwendungszweck oder Zahlungsreferenz angeben.",
    },
  },
} as const;

function formatMoney(value: string, currency: string, locale: string) {
  const parsed = Number(value);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(parsed) ? parsed : 0);
}

function formatDate(value: string | null, locale: string, withTime = false) {
  if (!value) return "—";
  const date = new Date(withTime ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return withTime
    ? date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })
    : date.toLocaleDateString(locale);
}

function formatFileSize(value: number | null) {
  if (!value || value < 1) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function createRequestId() {
  return crypto.randomUUID();
}

export function ConciergeExpenseReviewPanel({
  accounts,
  locale,
  onChanged,
  onPendingCountChange,
  requestedExpenseId,
}: Props) {
  const { lang } = useLang();
  const text = textByLanguage[lang];
  const [queue, setQueue] = useState<Awaited<ReturnType<typeof fetchCompanyConciergeExpenseQueue>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ExpenseReviewFilter>("pending_review");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CompanyConciergeExpenseReviewRow | null>(null);
  const [context, setContext] = useState<CompanyConciergeExpenseContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [form, setForm] = useState<ExpensePostForm>(emptyForm);
  const [rejectReason, setRejectReason] = useState("");
  const [reverseReason, setReverseReason] = useState("");
  const [reversedOn, setReversedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [mutationBusy, setMutationBusy] = useState<"post" | "reject" | "reverse" | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const queueRequestRef = useRef(0);
  const contextRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  const requestIdsRef = useRef(new Map<string, StableRequestIdEntry>());
  const openedRequestedExpenseRef = useRef(false);

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreview(null);
  }, []);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const loadQueue = useCallback(async (forceFresh: boolean) => {
    const request = ++queueRequestRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await fetchCompanyConciergeExpenseQueue(forceFresh);
      if (queueRequestRef.current !== request) return;
      setQueue(result);
      setSelected((current) => (
        current ? result.rows.find((row) => row.id === current.id) ?? current : null
      ));
    } catch (error) {
      if (queueRequestRef.current !== request) return;
      setQueue(null);
      setLoadError(error instanceof Error ? error.message : text.loadFailed);
    } finally {
      if (queueRequestRef.current === request) setLoading(false);
    }
  }, [text.loadFailed]);

  useEffect(() => {
    void loadQueue(true);
    const timer = window.setInterval(() => {
      void loadQueue(true);
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [loadQueue]);

  useDebouncedRealtimeSubscription(EXPENSE_REALTIME_EVENTS, () => {
    void loadQueue(true);
  }, 250);

  const pendingCount = queue?.rows.filter((row) => row.status === "pending_review").length ?? 0;
  useEffect(() => {
    onPendingCountChange(pendingCount);
  }, [onPendingCountChange, pendingCount]);

  const filteredRows = useMemo(
    () => filterConciergeExpenseQueue(queue?.rows ?? [], statusFilter, query),
    [query, queue?.rows, statusFilter],
  );

  const statusLabel = useCallback((status: CompanyConciergeExpenseReviewRow["status"]) => ({
    pending_review: text.pending,
    posted: text.posted,
    rejected: text.rejected,
    reversed: text.reversed,
  })[status], [text]);

  const payerLabel = useCallback((paidBy: CompanyConciergeExpenseReviewRow["paid_by"]) => ({
    patient: text.patientPaid,
    agency: text.agencyPaid,
    unpaid: text.unpaid,
  })[paidBy], [text]);

  const statusBadge = useCallback((row: CompanyConciergeExpenseReviewRow) => (
    <Badge
      variant={row.status === "rejected" ? "destructive" : "outline"}
      className={cn(
        row.status === "pending_review" && "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
        row.status === "posted" && "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300",
        row.status === "reversed" && "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-500/10 dark:text-slate-300",
      )}
    >
      {statusLabel(row.status)}
    </Badge>
  ), [statusLabel]);

  const selectedDetailCopy = selected ? ({
    pending_review: { title: text.detailTitle, description: text.detailDescription },
    posted: { title: text.postedDetailTitle, description: text.postedDetailDescription },
    rejected: { title: text.rejectedDetailTitle, description: text.rejectedDetailDescription },
    reversed: { title: text.reversedDetailTitle, description: text.reversedDetailDescription },
  } as const)[selected.status] : null;

  const columns = useMemo<ColumnDef<CompanyConciergeExpenseReviewRow>[]>(() => [
    {
      id: "patient",
      label: text.patient,
      accessor: (row) => `${row.service.patient_name} ${row.service.patient_pid}`,
      searchable: true,
      sortable: true,
      required: true,
      pinned: "left",
      width: 230,
      render: (row) => (
        <div className="min-w-0">
          <StaffLink
            to={`/patients/${row.patient_id}?tab=invoices`}
            className="block truncate font-medium hover:text-primary hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {row.service.patient_name || row.service.patient_pid}
          </StaffLink>
          <span className="text-[10px] text-muted-foreground">{row.service.patient_pid}</span>
        </div>
      ),
    },
    {
      id: "service",
      label: text.service,
      accessor: (row) => row.service.title,
      searchable: true,
      sortable: true,
      width: 220,
      render: (row) => <span className="line-clamp-2" title={row.service.title}>{row.service.title}</span>,
    },
    {
      id: "vendor",
      label: text.vendor,
      accessor: (row) => row.vendor,
      searchable: true,
      sortable: true,
      width: 190,
    },
    {
      id: "date",
      label: text.expenseDate,
      accessor: (row) => row.expense_date,
      filterType: "date",
      sortable: true,
      width: 135,
      render: (row) => (
        <div>
          <div>{formatDate(row.expense_date, locale)}</div>
          <div className="text-[10px] text-muted-foreground">{text.submittedAt}: {formatDate(row.submitted_at, locale, true)}</div>
        </div>
      ),
    },
    {
      id: "amount",
      label: text.amount,
      accessor: (row) => Number(row.amount_gross),
      filterType: "number",
      sortable: true,
      width: 145,
      render: (row) => <span className="font-semibold tabular-nums">{formatMoney(row.amount_gross, row.currency, locale)}</span>,
    },
    {
      id: "payer",
      label: text.payer,
      accessor: (row) => row.paid_by,
      filterType: "enum",
      sortable: true,
      width: 130,
      render: (row) => payerLabel(row.paid_by),
    },
    {
      id: "status",
      label: text.status,
      accessor: (row) => row.status,
      filterType: "enum",
      sortable: true,
      width: 150,
      render: statusBadge,
    },
  ], [locale, payerLabel, statusBadge, text]);

  const openExpense = useCallback(async (row: CompanyConciergeExpenseReviewRow) => {
    const request = ++contextRequestRef.current;
    previewRequestRef.current += 1;
    revokePreview();
    setSelected(row);
    setContext(null);
    setContextError(null);
    setContextLoading(true);
    setMutationError(null);
    setSuccessMessage(null);
    setRejectReason("");
    setReverseReason("");
    setReversedOn(new Date().toISOString().slice(0, 10));
    setReceiptError(null);
    const defaultAccount = accounts.find((account) => (
      account.is_active && account.currency.toLocaleUpperCase() === row.currency.toLocaleUpperCase()
    ));
    setForm({
      ...emptyForm,
      orderId: row.order_id ?? "",
      orderLeistungId: row.order_leistung_id ?? "",
      paidOn: row.paid_by === "agency" ? new Date().toISOString().slice(0, 10) : "",
      financialAccountId: row.paid_by === "agency" ? defaultAccount?.id ?? "" : "",
    });
    try {
      const result = await fetchCompanyConciergeExpenseContext(row.concierge_service_id);
      if (contextRequestRef.current === request) setContext(result);
    } catch (error) {
      if (contextRequestRef.current === request) {
        setContextError(error instanceof Error ? error.message : text.contextFailed);
      }
    } finally {
      if (contextRequestRef.current === request) setContextLoading(false);
    }
  }, [accounts, revokePreview, text.contextFailed]);

  useEffect(() => {
    if (!requestedExpenseId || !queue || openedRequestedExpenseRef.current) return;
    const requested = queue.rows.find((row) => row.id === requestedExpenseId);
    if (!requested) return;
    openedRequestedExpenseRef.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("expense");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    void openExpense(requested);
  }, [openExpense, queue, requestedExpenseId]);

  function closeExpense() {
    contextRequestRef.current += 1;
    previewRequestRef.current += 1;
    revokePreview();
    setSelected(null);
    setContext(null);
    setContextError(null);
    setMutationError(null);
    setSuccessMessage(null);
    setReceiptError(null);
    setPreviewBusy(false);
  }

  async function loadReceiptPreview() {
    const receipt = selected?.receipt;
    if (!selected || !receipt) return;
    const request = ++previewRequestRef.current;
    setPreviewBusy(true);
    setReceiptError(null);
    try {
      const result = await fetchCompanyConciergeExpenseReceipt(
        selected.concierge_service_id,
        selected.id,
      );
      if (previewRequestRef.current !== request) return;
      revokePreview();
      const url = URL.createObjectURL(result.blob);
      previewUrlRef.current = url;
      setPreview({
        url,
        contentType: result.contentType || receipt.mime_type || "",
        filename: result.filename || receipt.original_filename || "receipt",
      });
    } catch (error) {
      if (previewRequestRef.current === request) {
        setReceiptError(error instanceof Error ? error.message : text.previewFailed);
      }
    } finally {
      if (previewRequestRef.current === request) setPreviewBusy(false);
    }
  }

  async function downloadReceipt() {
    const receipt = selected?.receipt;
    if (!selected || !receipt) return;
    setReceiptError(null);
    try {
      await downloadCompanyConciergeExpenseReceipt(
        selected.concierge_service_id,
        selected.id,
        receipt.original_filename || "receipt",
      );
    } catch (error) {
      setReceiptError(error instanceof Error ? error.message : text.downloadFailed);
    }
  }

  function replaceReviewedItem(item: CompanyConciergeExpenseReviewRow) {
    setQueue((current) => current ? {
      ...current,
      rows: current.rows.map((row) => row.id === item.id ? item : row),
    } : current);
    setSelected(item);
  }

  async function postExpense() {
    if (!selected || !context || !queue?.complete || loading || selected.status !== "pending_review") return;
    const validation = validateExpensePostForm(
      selected,
      context,
      accounts,
      form,
      new Date().toISOString().slice(0, 10),
    );
    if (validation.length) {
      setMutationError(validation.map((code) => text.validation[code]).join(" "));
      return;
    }
    const draft = buildExpensePostPayload(selected, form, "");
    const requestId = resolveStableRequestId(
      requestIdsRef.current,
      `post:${selected.id}`,
      { ...draft, request_id: undefined },
      createRequestId,
    );
    setMutationBusy("post");
    setMutationError(null);
    setSuccessMessage(null);
    try {
      const response = await postCompanyConciergeExpense(
        selected.concierge_service_id,
        selected.id,
        { ...draft, request_id: requestId },
      );
      requestIdsRef.current.delete(`post:${selected.id}`);
      replaceReviewedItem({ ...response.item, service: selected.service });
      setSuccessMessage(text.approvedSuccess);
      onChanged();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : text.postFailed);
    } finally {
      setMutationBusy(null);
    }
  }

  async function rejectExpense() {
    if (!selected || !context || !queue?.complete || loading || selected.status !== "pending_review") return;
    const reason = rejectReason.trim();
    if (!validateExpenseRejection(reason)) {
      setMutationError(text.rejectReasonRequired);
      return;
    }
    const requestId = resolveStableRequestId(
      requestIdsRef.current,
      `reject:${selected.id}`,
      { reason },
      createRequestId,
    );
    setMutationBusy("reject");
    setMutationError(null);
    setSuccessMessage(null);
    try {
      const response = await rejectCompanyConciergeExpense(
        selected.concierge_service_id,
        selected.id,
        { request_id: requestId, reason },
      );
      requestIdsRef.current.delete(`reject:${selected.id}`);
      replaceReviewedItem({ ...response.item, service: selected.service });
      setSuccessMessage(text.rejectedSuccess);
      onChanged();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : text.rejectFailed);
    } finally {
      setMutationBusy(null);
    }
  }

  async function reverseExpense() {
    if (!selected || !queue?.complete || loading || selected.status !== "posted") return;
    const reason = reverseReason.trim();
    if (!validateExpenseRejection(reason)) {
      setMutationError(text.reverseReasonRequired);
      return;
    }
    if (!reversedOn || reversedOn < selected.expense_date || reversedOn > new Date().toISOString().slice(0, 10)) {
      setMutationError(text.reverseDateInvalid);
      return;
    }
    const requestId = resolveStableRequestId(
      requestIdsRef.current,
      `reverse:${selected.id}`,
      { reason, reversed_on: reversedOn },
      createRequestId,
    );
    setMutationBusy("reverse");
    setMutationError(null);
    setSuccessMessage(null);
    try {
      const response = await reverseCompanyConciergeExpense(
        selected.concierge_service_id,
        selected.id,
        { request_id: requestId, reason, reversed_on: reversedOn },
      );
      requestIdsRef.current.delete(`reverse:${selected.id}`);
      setReverseReason("");
      setReversedOn(new Date().toISOString().slice(0, 10));
      replaceReviewedItem({ ...response.item, service: selected.service });
      setSuccessMessage(text.reversedSuccess);
      onChanged();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : text.reverseFailed);
    } finally {
      setMutationBusy(null);
    }
  }

  const availableOrders = selected && context ? eligibleExpenseOrders(selected, context) : [];
  const availableOrderServices = selected && context
    ? eligibleExpenseOrderServices(selected, context, form.orderId)
    : [];
  const availableAccounts = selected ? accounts.filter((account) => (
    account.is_active && account.currency.toLocaleUpperCase() === selected.currency.toLocaleUpperCase()
  )) : [];
  const today = new Date().toISOString().slice(0, 10);
  const postValidation: ExpensePostValidationError[] = selected && context
    ? validateExpensePostForm(
      selected,
      context,
      accounts,
      form,
      today,
    )
    : [];
  const decisionReady = Boolean(
    selected
    && selected.status === "pending_review"
    && context
    && queue?.complete
    && !loading
    && !contextLoading
    && !contextError,
  );
  const reverseReady = Boolean(
    selected
    && selected.status === "posted"
    && queue?.complete
    && !loading
    && validateExpenseRejection(reverseReason)
    && reversedOn >= selected.expense_date
    && reversedOn <= today,
  );

  return (
    <section className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/70 bg-card p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ReceiptText className="size-4 text-primary" />
            {text.title}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{text.subtitle}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full shrink-0 sm:w-auto"
          disabled={loading}
          onClick={() => void loadQueue(true)}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          {text.refresh}
        </Button>
      </div>

      {loadError ? <ShellBanner tone="error">{loadError || text.loadFailed}</ShellBanner> : null}
      {queue && !queue.complete ? (
        <ShellBanner tone="error" withIcon>
          <span className="font-medium">{text.incompleteTitle}.</span>{" "}
          {text.incomplete(queue.loaded_count, queue.total_count)}
        </ShellBanner>
      ) : null}

      <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/70 bg-card p-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-wrap gap-1">
          {([
            ["pending_review", text.pending, pendingCount],
            ["posted", text.posted, queue?.rows.filter((row) => row.status === "posted").length ?? 0],
            ["rejected", text.rejected, queue?.rows.filter((row) => row.status === "rejected").length ?? 0],
            ["reversed", text.reversed, queue?.rows.filter((row) => row.status === "reversed").length ?? 0],
            ["all", text.all, queue?.rows.length ?? 0],
          ] as const).map(([value, label, count]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              className="h-8 rounded-md px-2.5 text-xs"
              variant={statusFilter === value ? "default" : "ghost"}
              onClick={() => setStatusFilter(value)}
            >
              {label} <span className="font-mono text-[10px] opacity-75">{count}</span>
            </Button>
          ))}
        </div>
        <Input
          type="search"
          className="h-8 min-w-0 flex-1 rounded-md bg-field text-xs sm:ml-auto sm:max-w-sm"
          placeholder={text.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {loading && !queue ? (
        <div className="rounded-lg border border-border/70 bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 size-5 animate-spin" />
          {text.loading}
        </div>
      ) : (
        <>
          <div className="space-y-2 sm:hidden">
            {filteredRows.length ? filteredRows.map((row) => (
              <button
                key={row.id}
                type="button"
                className="w-full min-w-0 rounded-lg border border-border/70 bg-card p-3 text-left shadow-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => void openExpense(row)}
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{row.service.patient_name || row.service.patient_pid}</div>
                    <div className="truncate text-xs text-muted-foreground">{row.service.patient_pid} · {row.service.title}</div>
                  </div>
                  {statusBadge(row)}
                </div>
                <div className="mt-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div className="min-w-0"><span className="block text-[10px] text-muted-foreground">{text.vendor}</span><span className="block truncate">{row.vendor}</span></div>
                  <div><span className="block text-[10px] text-muted-foreground">{text.expenseDate}</span>{formatDate(row.expense_date, locale)}</div>
                  <div><span className="block text-[10px] text-muted-foreground">{text.payer}</span>{payerLabel(row.paid_by)}</div>
                  <div><span className="block text-[10px] text-muted-foreground">{text.amount}</span><span className="font-semibold tabular-nums">{formatMoney(row.amount_gross, row.currency, locale)}</span></div>
                </div>
              </button>
            )) : (
              <div className="rounded-lg border border-border/70 bg-card px-4 py-10 text-center text-sm text-muted-foreground">{text.empty}</div>
            )}
          </div>
          <div className="hidden min-w-0 sm:block">
            <DataTableSurface
              rows={filteredRows}
              columns={columns}
              rowId={(row) => row.id}
              storageKey="company-finance-concierge-expenses"
              defaultDensity="compact"
              defaultSort={[{ field: "date", dir: "desc" }]}
              emptyState={text.empty}
              pagination={{ pageSize: 25, resetKey: `${statusFilter}:${query}` }}
              onRowClick={(row) => void openExpense(row)}
            />
          </div>
        </>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) closeExpense(); }}>
        <DialogContent className="flex max-h-[94vh] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 sm:w-[min(96vw,72rem)] sm:max-w-[72rem]">
          {selected ? (
            <>
              <DialogHeader className="border-b border-border bg-muted/20 px-4 py-4 pr-14 sm:px-5">
                <div className="flex min-w-0 items-start gap-3">
                  <div className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-lg border",
                    selected.status === "pending_review" && "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-500/10 dark:text-amber-300",
                    selected.status === "posted" && "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-300",
                    selected.status === "rejected" && "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-500/10 dark:text-rose-300",
                    selected.status === "reversed" && "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-500/10 dark:text-slate-300",
                  )}>
                    {selected.status === "pending_review" ? <ReceiptText className="size-5" /> : null}
                    {selected.status === "posted" ? <CheckCircle2 className="size-5" /> : null}
                    {selected.status === "rejected" ? <XCircle className="size-5" /> : null}
                    {selected.status === "reversed" ? <Undo2 className="size-5" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <DialogTitle>{selectedDetailCopy?.title}</DialogTitle>
                      {statusBadge(selected)}
                    </div>
                    <DialogDescription className="mt-1 max-w-3xl">{selectedDetailCopy?.description}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(20rem,.95fr)]">
                  <div className="min-w-0 space-y-4">
                    <section className="min-w-0 rounded-lg border border-border/70 bg-muted/20 p-3">
                      {selected.receipt ? (
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold">{text.receipt}</h3>
                            <p className="truncate text-xs text-muted-foreground" title={selected.receipt.original_filename ?? undefined}>
                              {selected.receipt.original_filename || "receipt"} · {text.fileSize}: {formatFileSize(selected.receipt.file_size)}
                            </p>
                          </div>
                          <div className="flex w-full gap-2 sm:w-auto">
                            <Button type="button" size="sm" variant="outline" className="min-w-0 flex-1 sm:flex-none" disabled={previewBusy} onClick={() => void loadReceiptPreview()}>
                              {previewBusy ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                              {text.preview}
                            </Button>
                            <Button type="button" size="sm" variant="outline" className="min-w-0 flex-1 sm:flex-none" onClick={() => void downloadReceipt()}>
                              <Download className="size-4" />
                              {text.download}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <h3 className="text-sm font-semibold">{text.receipt}</h3>
                          <p className="mt-1 text-xs text-muted-foreground">{text.noReceipt}</p>
                        </div>
                      )}
                      {receiptError ? <div className="mt-3"><ShellBanner tone="error">{receiptError}</ShellBanner></div> : null}
                      {preview ? (
                        <div className="mt-3 min-w-0 overflow-hidden rounded-md border border-border bg-background">
                          {preview.contentType.startsWith("image/") ? (
                            <img src={preview.url} alt={preview.filename} className="max-h-[34rem] w-full object-contain" />
                          ) : preview.contentType === "application/pdf" ? (
                            <iframe src={preview.url} title={preview.filename} className="h-[28rem] w-full bg-white sm:h-[34rem]" />
                          ) : (
                            <p className="px-4 py-10 text-center text-sm text-muted-foreground">{text.previewUnavailable}</p>
                          )}
                        </div>
                      ) : null}
                    </section>

                    <section className="rounded-lg border border-border/70 bg-card p-3">
                      <div className="grid min-w-0 grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                        <div className="min-w-0"><span className="block text-[11px] text-muted-foreground">{text.patient}</span><StaffLink to={`/patients/${selected.patient_id}?tab=invoices`} className="block truncate font-medium hover:underline">{selected.service.patient_name || selected.service.patient_pid}</StaffLink></div>
                        <div className="min-w-0"><span className="block text-[11px] text-muted-foreground">{text.service}</span><span className="block truncate font-medium">{selected.service.title}</span></div>
                        <div className="min-w-0"><span className="block text-[11px] text-muted-foreground">{text.vendor}</span><span className="block truncate font-medium">{selected.vendor}</span></div>
                        <div><span className="block text-[11px] text-muted-foreground">{text.expenseDate}</span>{formatDate(selected.expense_date, locale)}</div>
                        <div><span className="block text-[11px] text-muted-foreground">{text.payer}</span>{payerLabel(selected.paid_by)}</div>
                        <div><span className="block text-[11px] text-muted-foreground">{text.serviceDelivered}</span>{selected.service_delivered ? text.yes : text.no}</div>
                        <div><span className="block text-[11px] text-muted-foreground">{text.net}</span>{formatMoney(selected.amount_net, selected.currency, locale)}</div>
                        <div><span className="block text-[11px] text-muted-foreground">{text.vat}</span>{formatMoney(selected.amount_vat, selected.currency, locale)}</div>
                        <div><span className="block text-[11px] text-muted-foreground">{text.gross}</span><span className="font-semibold">{formatMoney(selected.amount_gross, selected.currency, locale)}</span></div>
                      </div>
                      <div className="mt-3 border-t border-border/60 pt-3 text-sm">
                        <span className="block text-[11px] text-muted-foreground">{text.note}</span>
                        <p className="whitespace-pre-wrap break-words">{selected.note || "—"}</p>
                      </div>
                      <div className="mt-3 text-xs text-muted-foreground">
                        {text.submittedBy}: {selected.submitted_by.display_name || "—"} · {formatDate(selected.submitted_at, locale, true)}
                      </div>
                    </section>

                    <section className="rounded-lg border border-border/70 bg-card p-3">
                      <h3 className="text-sm font-semibold">{text.balance}</h3>
                      {selected.balance_consequence.posting_pending ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{text.postingPending}</p> : null}
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {([
                          [text.patientReceivable, selected.balance_consequence.posting_pending ? selected.balance_consequence.intended_patient_receivable_gross : selected.balance_consequence.patient_receivable_gross],
                          [text.companyPaid, selected.balance_consequence.posting_pending ? selected.balance_consequence.intended_company_paid_gross : selected.balance_consequence.company_paid_gross],
                          [text.providerLiability, selected.balance_consequence.posting_pending ? selected.balance_consequence.intended_provider_liability_gross : selected.balance_consequence.provider_liability_gross],
                        ] as const).map(([label, value]) => (
                          <div key={label} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                            <span className="block text-[10px] text-muted-foreground">{label}</span>
                            <span className="font-semibold tabular-nums">{formatMoney(value, selected.currency, locale)}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>

                  <div className="min-w-0 space-y-4">
                    {contextLoading ? <div role="status" className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />{text.contextLoading}</div> : null}
                    {contextError ? <ShellBanner tone="error">{contextError || text.contextFailed}</ShellBanner> : null}
                    {selected.status === "pending_review" && context ? (
                      <>
                        {!queue?.complete ? <ShellBanner tone="error">{text.decisionBlocked}</ShellBanner> : null}
                        <section className="rounded-lg border border-border/70 bg-card p-3">
                          <h3 className="text-sm font-semibold">{text.mapping}</h3>
                          {(selected.order_id || selected.order_leistung_id) ? <p className="mt-1 text-xs text-muted-foreground">{text.lockedMapping}</p> : null}
                          <div className="mt-3 space-y-3">
                            <label className="block text-xs font-medium">
                              {text.order} <span className="text-destructive">*</span>
                              <select
                                className={cn(shellSelectClassName, "mt-1 h-9 w-full min-w-0 rounded-md bg-field text-xs")}
                                value={form.orderId}
                                disabled={Boolean(selected.order_id) || mutationBusy !== null}
                                onChange={(event) => setForm((current) => ({ ...current, orderId: event.target.value, orderLeistungId: "" }))}
                              >
                                <option value="">{text.selectOrder}</option>
                                {availableOrders.map((order) => <option key={order.id} value={order.id}>{order.order_number} · {order.currency}</option>)}
                              </select>
                            </label>
                            <label className="block text-xs font-medium">
                              {text.orderService}
                              <select
                                className={cn(shellSelectClassName, "mt-1 h-9 w-full min-w-0 rounded-md bg-field text-xs")}
                                value={form.orderLeistungId}
                                disabled={!form.orderId || Boolean(selected.order_leistung_id) || mutationBusy !== null}
                                onChange={(event) => setForm((current) => ({ ...current, orderLeistungId: event.target.value }))}
                              >
                                <option value="">{text.noOrderService}</option>
                                {availableOrderServices.map((service) => <option key={service.id} value={service.id}>{service.name}{service.description ? ` · ${service.description}` : ""}</option>)}
                              </select>
                            </label>
                          </div>
                        </section>

                        {selected.paid_by === "agency" ? (
                          <section className="rounded-lg border border-border/70 bg-card p-3">
                            <h3 className="text-sm font-semibold">{text.agencyPayment}</h3>
                            <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                              <label className="block text-xs font-medium">
                                {text.paidOn} <span className="text-destructive">*</span>
                                <Input type="date" className="mt-1 h-9 bg-field text-xs" min={selected.expense_date} max={new Date().toISOString().slice(0, 10)} value={form.paidOn} disabled={mutationBusy !== null} onChange={(event) => setForm((current) => ({ ...current, paidOn: event.target.value }))} />
                              </label>
                              <label className="block text-xs font-medium">
                                {text.financialAccount} <span className="text-destructive">*</span>
                                <select className={cn(shellSelectClassName, "mt-1 h-9 w-full min-w-0 rounded-md bg-field text-xs")} value={form.financialAccountId} disabled={mutationBusy !== null} onChange={(event) => setForm((current) => ({ ...current, financialAccountId: event.target.value }))}>
                                  <option value="">{text.selectAccount}</option>
                                  {availableAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
                                </select>
                              </label>
                              <label className="block text-xs font-medium">
                                {text.paymentMethod} <span className="text-destructive">*</span>
                                <select className={cn(shellSelectClassName, "mt-1 h-9 w-full min-w-0 rounded-md bg-field text-xs")} value={form.paymentMethod} disabled={mutationBusy !== null} onChange={(event) => setForm((current) => ({ ...current, paymentMethod: event.target.value as ExpensePostForm["paymentMethod"] }))}>
                                  <option value="bank_transfer">{text.bankTransfer}</option>
                                  <option value="cash">{text.cash}</option>
                                  <option value="card">{text.card}</option>
                                  <option value="other">{text.other}</option>
                                </select>
                              </label>
                              <label className="block min-w-0 text-xs font-medium">
                                {text.paymentReference} <span className="text-destructive">*</span>
                                <Input className="mt-1 h-9 min-w-0 bg-field text-xs" maxLength={500} value={form.paymentReference} disabled={mutationBusy !== null} onChange={(event) => setForm((current) => ({ ...current, paymentReference: event.target.value }))} />
                              </label>
                            </div>
                          </section>
                        ) : null}

                        {postValidation.length ? (
                          <ShellBanner tone="warning">{postValidation.map((code) => text.validation[code]).join(" ")}</ShellBanner>
                        ) : null}
                        {mutationError ? <ShellBanner tone="error">{mutationError}</ShellBanner> : null}
                        {successMessage ? <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-300">{successMessage}</div> : null}

                        <div className="grid min-w-0 gap-3 rounded-lg border border-border/70 bg-card p-3">
                          <Button type="button" className="w-full" disabled={!decisionReady || postValidation.length > 0 || mutationBusy !== null} onClick={() => void postExpense()}>
                            {mutationBusy === "post" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                            {text.approve}
                          </Button>
                          <div className="border-t border-border/60 pt-3">
                            <label className="block text-xs font-medium">
                              {text.rejectReason} <span className="text-destructive">*</span>
                              <textarea
                                className="mt-1 min-h-24 w-full resize-y rounded-md border border-input bg-field px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
                                maxLength={2000}
                                placeholder={text.rejectPlaceholder}
                                value={rejectReason}
                                disabled={mutationBusy !== null}
                                onChange={(event) => setRejectReason(event.target.value)}
                              />
                            </label>
                            <Button type="button" variant="destructive" className="mt-2 w-full" disabled={!decisionReady || !validateExpenseRejection(rejectReason) || mutationBusy !== null} onClick={() => void rejectExpense()}>
                              {mutationBusy === "reject" ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
                              {text.reject}
                            </Button>
                          </div>
                        </div>
                      </>
                    ) : null}

                    {selected.external_invoice ? (
                      <section className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-500/5">
                        <h3 className="text-sm font-semibold">{text.externalInvoice}</h3>
                        <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                          <div className="min-w-0"><span className="block text-muted-foreground">ID</span><span className="block break-all font-mono">{selected.external_invoice.id}</span></div>
                          <div><span className="block text-muted-foreground">{text.invoiceStatus}</span>{selected.external_invoice.status || "—"}</div>
                          <div><span className="block text-muted-foreground">{text.payer}</span>{selected.external_invoice.paid_by || "—"}</div>
                          <div><span className="block text-muted-foreground">{text.settlementStatus}</span>{selected.external_invoice.settlement_status || "—"}</div>
                        </div>
                        {selected.order_id ? <StaffLink to={`/orders/${selected.order_id}`} className="mt-3 inline-block text-xs font-medium text-primary hover:underline">{text.order}: {selected.order_number || selected.order_id}</StaffLink> : null}
                      </section>
                    ) : null}

                    {selected.status === "posted" ? (
                      <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                        <h3 className="flex items-center gap-2 text-sm font-semibold">
                          <Undo2 className="size-4 text-destructive" />
                          {text.reverseTitle}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">{text.reverseDescription}</p>
                        {!queue?.complete ? <div className="mt-3"><ShellBanner tone="error">{text.decisionBlocked}</ShellBanner></div> : null}
                        <div className="mt-3 grid gap-3">
                          <label className="block text-xs font-medium">
                            {text.reverseDate} <span className="text-destructive">*</span>
                            <Input
                              type="date"
                              className="mt-1 h-9 bg-field text-xs"
                              min={selected.expense_date}
                              max={today}
                              value={reversedOn}
                              disabled={mutationBusy !== null}
                              onChange={(event) => setReversedOn(event.target.value)}
                            />
                          </label>
                          <label className="block text-xs font-medium">
                            {text.reverseReason} <span className="text-destructive">*</span>
                            <textarea
                              className="mt-1 min-h-24 w-full resize-y rounded-md border border-input bg-field px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
                              maxLength={2000}
                              placeholder={text.reversePlaceholder}
                              value={reverseReason}
                              disabled={mutationBusy !== null}
                              onChange={(event) => setReverseReason(event.target.value)}
                            />
                          </label>
                          {reversedOn && (reversedOn < selected.expense_date || reversedOn > today) ? (
                            <ShellBanner tone="warning">{text.reverseDateInvalid}</ShellBanner>
                          ) : null}
                          <Button
                            type="button"
                            variant="destructive"
                            className="w-full"
                            disabled={!reverseReady || mutationBusy !== null}
                            onClick={() => void reverseExpense()}
                          >
                            {mutationBusy === "reverse" ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
                            {text.reverse}
                          </Button>
                        </div>
                      </section>
                    ) : null}

                    {selected.status !== "pending_review" && mutationError ? <ShellBanner tone="error">{mutationError}</ShellBanner> : null}
                    {selected.status !== "pending_review" && successMessage ? <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-300">{successMessage}</div> : null}

                    <section className="rounded-lg border border-border/70 bg-card p-3">
                      <h3 className="text-sm font-semibold">{text.history}</h3>
                      <ol className="mt-3 space-y-3">
                        {selected.history.map((event, index) => (
                          <li key={`${event.action}:${event.created_at ?? index}`} className="relative border-l border-border pl-3 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-1">
                              <span className="font-semibold">{event.action === "submitted" ? text.submitted : statusLabel(event.action)}</span>
                              <span className="text-muted-foreground">{formatDate(event.created_at, locale, true)}</span>
                            </div>
                            <div className="mt-0.5 text-muted-foreground">{event.actor.display_name || "—"}</div>
                            {event.reason ? <p className="mt-1 whitespace-pre-wrap break-words"><span className="text-muted-foreground">{text.reason}: </span>{event.reason}</p> : null}
                          </li>
                        ))}
                      </ol>
                    </section>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
