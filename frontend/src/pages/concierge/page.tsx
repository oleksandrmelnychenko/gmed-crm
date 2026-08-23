import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Columns3,
  List,
  ListChecks,
  LoaderCircle,
  MapPinned,
  MessageSquareText,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui-shell";
import { apiFetch, clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang, type Lang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";

import {
  CONCIERGE_BOARD_COLUMNS,
  conciergeServiceCostVariance,
  conciergeServiceColumn,
  conciergeServiceDisplayTitle,
  conciergeServiceTaxonomyLabel,
  conciergeWorkspaceStats,
  canModifyConciergeTask,
  conciergeTaskErrorMessage,
  filterConciergeServices,
  filterConciergeTaskAssignees,
  isConciergeServiceOverdue,
  nextConciergeServiceStatus,
  nextConciergeTaskStatus,
  sortConciergeServices,
  type ApplyPartnerQuoteResponse,
  type ConciergeAssignee,
  type ConciergeBoardColumnId,
  type ConciergePartnerInteraction,
  type ConciergeProvider,
  type ConciergeService,
  type ConciergeTask,
} from "./model";
import { ConciergeTaskManager } from "./task-manager";
import { ConciergeTaskDetailDialog } from "./task-detail-dialog";
import {
  ConciergePartnerInteractionDialog,
  type RecordPartnerInteractionInput,
} from "./partner-interaction-dialog";
import {
  ConciergeProviderBookingDialog,
  type BookConciergeProviderInput,
  type BookConciergeProviderResponse,
} from "./provider-booking-dialog";
import {
  ConciergeTaskEventDialog,
  type ConciergeTaskPatientOption,
  type SaveConciergeOperationalItemInput,
} from "./task-event-dialog";
import {
  ConciergeAgendaView,
  ConciergeMapView,
  ConciergeTaskQueue,
} from "./workspace-views";
import { ConciergeExpenseReceiptDialog } from "./concierge-expense-receipt-dialog";
import {
  downloadConciergeExpenseReceipt,
  getConciergeExpenseContext,
  getConciergeExpenses,
  uploadConciergeExpense,
} from "./expense-receipt-api";
import type {
  ConciergeExpenseContext,
  ConciergeExpenseItem,
  ConciergeExpenseMutationResponse,
  ConciergeExpenseSubmitInput,
} from "./expense-receipt-model";
import type { PatientSummary } from "@/pages/patients/model/list-model";

const REALTIME_EVENTS = [
  "concierge_service.created",
  "concierge_service.updated",
  "concierge_service.cancelled",
  "concierge_service.billing_ready",
  "concierge_service.key_updated",
  "concierge_service.partner_interaction_recorded",
  "concierge_service.cost_estimate_applied",
  "concierge_service.booking_requested",
  "concierge_service.booking_confirmed",
  "concierge_expense.submitted",
  "concierge_expense.posted",
  "concierge_expense.rejected",
  "concierge_expense.reversed",
  "concierge_operational_item.created",
  "concierge_operational_item.updated",
  "concierge_operational_item.deleted",
  "concierge_operational_item.archived",
  "concierge_operational_item.restored",
  "concierge_operational_item.reminder_sent",
  "concierge_operational_item.comment_added",
  "concierge_operational_item.checklist_item_added",
  "concierge_operational_item.checklist_item_toggled",
] as const;

const text = {
  de: {
    title: "Concierge-Arbeitsbereich",
    subtitle: "Services, Aufgaben und Partneraktivitäten zentral steuern",
    searchLabel: "Suche",
    search: "Service, Patient, Anbieter oder Referenz suchen",
    refresh: "Aktualisieren",
    newTask: "Aufgabe / Termin",
    board: "Board",
    list: "Liste",
    calendar: "Kalender",
    map: "Karte",
    taskManager: "Aufgaben",
    taskManagerTitle: "Aufgabenmanager",
    taskManagerSubtitle: "Aufgaben verteilen, Termine planen und Fristen im Blick behalten",
    active: "Aktive Services",
    today: "Heute geplant",
    overdue: "Überfällig",
    ready: "Bereit zur Abrechnung",
    requests: "Neue Anfragen",
    confirmed: "Bestätigt",
    in_service: "In Durchführung",
    completed: "Abgeschlossen",
    emptyColumn: "Keine Services in diesem Abschnitt",
    empty: "Keine zugewiesenen Services gefunden.",
    patient: "Patient",
    schedule: "Termin",
    provider: "Anbieter",
    reference: "Referenz",
    cost: "Plankosten",
    actualCost: "Ist-Kosten",
    plannedCost: "Plankosten",
    variance: "Abweichung",
    notSet: "Nicht angegeben",
    portal: "Portal-Anfrage",
    advance: "Weiter zu {status}",
    updating: "Status wird aktualisiert",
    loadFailed: "Der Concierge-Arbeitsbereich konnte nicht geladen werden.",
    updateFailed: "Der Servicestatus konnte nicht aktualisiert werden.",
    taskUpdateFailed: "Der Aufgabenstatus konnte nicht aktualisiert werden.",
    taskDeleteTitle: "Aufgabe löschen?",
    taskDeleteMessage: "Die Aufgabe wird aus dem Aufgabenmanager entfernt. Der Audit-Verlauf bleibt erhalten.",
    taskDelete: "Löschen",
    taskDeleteCancel: "Abbrechen",
    taskDeleteFailed: "Die Aufgabe konnte nicht gelöscht werden.",
    taskArchiveFailed: "Die Aufgabe konnte nicht archiviert werden.",
    taskRestoreFailed: "Die Aufgabe konnte nicht wiederhergestellt werden.",
    planned: "Geplant",
    booked: "Gebucht",
    status_confirmed: "Bestätigt",
    status_in_service: "In Durchführung",
    status_completed: "Abgeschlossen",
    cancelled: "Storniert",
    partner: "Partner",
    expenseReceipt: "Ausgabe / Beleg",
  },
  ru: {
    title: "Рабочее пространство консьержа",
    subtitle: "Единое управление услугами, задачами и взаимодействием с партнёрами",
    searchLabel: "Поиск",
    search: "Поиск по услуге, пациенту, поставщику или номеру",
    refresh: "Обновить",
    newTask: "Задача / событие",
    board: "Доска",
    list: "Список",
    calendar: "Календарь",
    map: "Карта",
    taskManager: "Задачи",
    taskManagerTitle: "Менеджер задач",
    taskManagerSubtitle: "Распределение задач, календарь событий и контроль сроков",
    active: "Активные услуги",
    today: "Запланировано сегодня",
    overdue: "Просрочено",
    ready: "Готово к расчёту",
    requests: "Новые запросы",
    confirmed: "Подтверждено",
    in_service: "Выполняется",
    completed: "Завершено",
    emptyColumn: "В этом разделе пока нет услуг",
    empty: "Назначенные вам услуги не найдены.",
    patient: "Пациент",
    schedule: "Время",
    provider: "Поставщик",
    reference: "Номер",
    cost: "Плановые затраты",
    actualCost: "Фактические затраты",
    plannedCost: "Плановые затраты",
    variance: "Отклонение",
    notSet: "Не указано",
    portal: "Запрос из портала",
    advance: "Перевести в статус «{status}»",
    updating: "Обновление статуса",
    loadFailed: "Не удалось загрузить рабочее пространство консьержа.",
    updateFailed: "Не удалось обновить статус услуги.",
    taskUpdateFailed: "Не удалось обновить статус задачи.",
    taskDeleteTitle: "Удалить задачу?",
    taskDeleteMessage: "Задача исчезнет из менеджера задач. Аудит действий будет сохранён.",
    taskDelete: "Удалить",
    taskDeleteCancel: "Отмена",
    taskDeleteFailed: "Не удалось удалить задачу.",
    taskArchiveFailed: "Не удалось переместить задачу в архив.",
    taskRestoreFailed: "Не удалось восстановить задачу из архива.",
    planned: "Запланировано",
    booked: "Забронировано",
    status_confirmed: "Подтверждено",
    status_in_service: "Выполняется",
    status_completed: "Завершено",
    cancelled: "Отменено",
    partner: "Партнёр",
    expenseReceipt: "Расход / документ",
  },
} as const;

type ConciergeText = (typeof text)[Lang];
type ViewMode = "board" | "list" | "calendar" | "map" | "tasks";

function serviceStatusLabel(status: string, labels: ConciergeText) {
  if (status === "confirmed") return labels.status_confirmed;
  if (status === "in_service") return labels.status_in_service;
  if (status === "completed") return labels.status_completed;
  if (status === "planned" || status === "booked" || status === "cancelled") {
    return labels[status];
  }
  return status.replaceAll("_", " ");
}

function statusTone(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "cancelled") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "in_service") return "border-violet-200 bg-violet-50 text-violet-700";
  if (status === "confirmed") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function formatDateTime(value: string | null, lang: Lang, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatMoney(value: string | null, currency: string, lang: Lang, fallback: string) {
  if (value === null || value.trim() === "") return fallback;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  try {
    return new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "de-DE", {
      style: "currency",
      currency: currency || "EUR",
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || "EUR"}`;
  }
}

function serviceAccent(status: ConciergeService["status"], overdue: boolean) {
  if (overdue) return "border-l-rose-400";
  if (status === "completed") return "border-l-emerald-400";
  if (status === "in_progress") return "border-l-sky-400";
  if (status === "booked") return "border-l-indigo-400";
  if (status === "cancelled") return "border-l-slate-300";
  return "border-l-amber-400";
}

function ServiceCard({
  service,
  lang,
  labels,
  updating,
  now,
  onAdvance,
  onOpenPartner,
  onOpenExpense,
  compact = false,
}: {
  service: ConciergeService;
  lang: Lang;
  labels: ConciergeText;
  updating: boolean;
  now: Date;
  onAdvance: (service: ConciergeService) => void;
  onOpenPartner?: (service: ConciergeService) => void;
  onOpenExpense: (service: ConciergeService) => void;
  compact?: boolean;
}) {
  const nextStatus = nextConciergeServiceStatus(service.status);
  const taxonomy = conciergeServiceTaxonomyLabel(service, lang);
  const displayTitle = conciergeServiceDisplayTitle(service, lang);
  const provider = service.appointment_id
    ? service.vendor_name
    : service.provider_name || service.vendor_name;
  const overdue = isConciergeServiceOverdue(service, now);
  const costVariance = conciergeServiceCostVariance(service);

  return (
    <article
      className={cn(
        "rounded-lg border border-l-[3px] border-border/70 bg-card p-3 shadow-sm transition-[border-color,box-shadow] hover:border-border hover:shadow-md",
        serviceAccent(service.status, overdue),
        compact && "lg:grid lg:grid-cols-[minmax(180px,1.2fr)_minmax(160px,1fr)_minmax(170px,1fr)] lg:items-center lg:gap-4",
      )}
      data-testid={`concierge-service-${service.id}`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn("rounded-full text-[10px]", statusTone(service.status))}>
            {serviceStatusLabel(service.status, labels)}
          </Badge>
          {service.request_source === "patient_portal" ? (
            <Badge variant="outline" className="rounded-full border-indigo-200 bg-indigo-50 text-[10px] text-indigo-700">
              {labels.portal}
            </Badge>
          ) : null}
          {overdue ? (
            <Badge variant="outline" className="rounded-full border-rose-200 bg-rose-50 text-[10px] text-rose-700">
              {labels.overdue}
            </Badge>
          ) : null}
          <Badge
            variant="outline"
            className="rounded-full border-border/70 bg-card font-mono text-[9px] font-medium text-muted-foreground"
            title={service.id}
            data-testid={`concierge-service-id-${service.id}`}
          >
            #{service.id.slice(0, 8)}
          </Badge>
        </div>
        <h3 className="mt-2 truncate text-sm font-semibold text-foreground" title={displayTitle}>
          {displayTitle}
        </h3>
        {taxonomy ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{taxonomy}</p> : null}
      </div>

      <div className={cn("mt-3 min-w-0 space-y-2.5 border-t border-border/60 pt-3", compact && "lg:mt-0 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0")}>
        <ServiceFact icon={UserRound} label={labels.patient}>
          <Badge
            variant="outline"
            className="max-w-full rounded-full border-emerald-200 bg-emerald-50 text-[10px] font-medium text-emerald-800"
            title={`${labels.patient}: ${service.patient_name}`}
          >
            <span className="truncate">{service.patient_name}</span>
          </Badge>
          <span className="font-mono text-[10px] text-muted-foreground">{service.patient_pid}</span>
        </ServiceFact>
        <ServiceFact icon={CalendarClock} label={labels.schedule}>
          <span className="truncate">{formatDateTime(service.starts_at, lang, labels.notSet)}</span>
        </ServiceFact>
      </div>

      <div className={cn("mt-3 min-w-0 space-y-2.5 border-t border-border/60 pt-3", compact && "lg:mt-0 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0")}>
        <ServiceFact icon={Clock3} label={labels.provider}>
          {provider ? (
            <Badge
              variant="outline"
              className="max-w-full rounded-full border-amber-200 bg-amber-50 text-[10px] font-medium text-amber-800"
              title={`${labels.provider}: ${provider}`}
            >
              <span className="truncate">{provider}</span>
            </Badge>
          ) : (
            <span className="truncate">{labels.notSet}</span>
          )}
          {service.vendor_contact ? (
            <span className="truncate text-[10px] text-muted-foreground">{service.vendor_contact}</span>
          ) : null}
        </ServiceFact>
        <ServiceFact icon={CircleDollarSign} label={service.actual_cost ? labels.actualCost : labels.cost}>
          <span className="truncate">
            {formatMoney(service.actual_cost ?? service.cost_estimate, service.currency, lang, labels.notSet)}
          </span>
          {service.actual_cost && service.cost_estimate ? (
            <span className="truncate text-[10px] text-muted-foreground">
              {labels.plannedCost}: {formatMoney(service.cost_estimate, service.currency, lang, labels.notSet)}
              {costVariance === null
                ? ""
                : ` · ${labels.variance}: ${costVariance > 0 ? "+" : ""}${formatMoney(String(costVariance), service.currency, lang, labels.notSet)}`}
            </span>
          ) : null}
        </ServiceFact>
        {service.booking_reference ? (
          <p className="truncate border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground">
            {labels.reference}: <span className="font-mono text-foreground">{service.booking_reference}</span>
          </p>
        ) : null}
      </div>

      <div className={cn(
        "mt-3 grid min-w-0 grid-cols-2 gap-2 border-t border-border/60 pt-3",
        compact && "lg:col-span-3 lg:flex lg:max-w-full lg:flex-wrap lg:justify-end lg:justify-self-stretch",
      )}>
        {onOpenPartner ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-full rounded-md bg-card text-xs hover:border-primary/30 hover:bg-primary/5 hover:text-primary sm:w-auto"
            onClick={() => onOpenPartner(service)}
          >
            <MessageSquareText />
            {labels.partner}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 w-full rounded-md bg-card text-xs hover:border-primary/30 hover:bg-primary/5 hover:text-primary sm:w-auto"
          onClick={() => onOpenExpense(service)}
        >
          <ReceiptText />
          {labels.expenseReceipt}
        </Button>
        {nextStatus ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="col-span-2 h-8 w-full rounded-md bg-card text-xs hover:border-primary/30 hover:bg-primary/5 hover:text-primary sm:col-span-1 sm:w-auto"
            disabled={updating}
            aria-label={labels.advance.replace("{status}", serviceStatusLabel(nextStatus, labels))}
            onClick={() => onAdvance(service)}
          >
            {updating ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}
            {serviceStatusLabel(nextStatus, labels)}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function ServiceFact({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof UserRound;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[1.1rem_minmax(0,1fr)] gap-1.5 text-xs">
      <Icon aria-hidden="true" className="mt-3.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">{label}</p>
        <div className="flex min-w-0 items-center justify-between gap-2 text-foreground">{children}</div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone?: "danger" | "success";
  icon: typeof CalendarDays;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-card px-3 py-2.5 shadow-sm">
      <div className="min-w-0">
        <p className="truncate text-[10px] font-medium text-muted-foreground sm:text-[11px]">{label}</p>
        <p className={cn("mt-0.5 font-mono text-lg font-semibold tabular-nums text-foreground sm:text-xl", tone === "danger" && value > 0 && "text-rose-600", tone === "success" && value > 0 && "text-emerald-600")}>{value}</p>
      </div>
      <span className={cn("flex size-7 shrink-0 items-center justify-center text-muted-foreground sm:size-8", tone === "danger" && value > 0 && "text-rose-600", tone === "success" && value > 0 && "text-emerald-600")}>
        <Icon className="size-3 sm:size-3.5" />
      </span>
    </div>
  );
}

export function ConciergeWorkspacePage() {
  const { lang } = useLang();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const labels = text[lang];
  const [services, setServices] = useState<ConciergeService[]>([]);
  const [tasks, setTasks] = useState<ConciergeTask[]>([]);
  const [assignees, setAssignees] = useState<ConciergeAssignee[]>([]);
  const [providers, setProviders] = useState<ConciergeProvider[]>([]);
  const [taskProviders, setTaskProviders] = useState<ConciergeProvider[]>([]);
  const [taskPatients, setTaskPatients] = useState<ConciergeTaskPatientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(() => searchParams.get("view") === "tasks" ? "tasks" : "board");
  const [version, setVersion] = useState(0);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [archivingTaskId, setArchivingTaskId] = useState<string | null>(null);
  const [pendingDeleteTask, setPendingDeleteTask] = useState<ConciergeTask | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ConciergeTask | null>(null);
  const [submittingTask, setSubmittingTask] = useState(false);
  const [taskError, setTaskError] = useState("");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(() => searchParams.get("task"));
  const createTaskRequestIdRef = useRef<string | null>(null);
  const [partnerServiceId, setPartnerServiceId] = useState<string | null>(null);
  const [partnerEvents, setPartnerEvents] = useState<ConciergePartnerInteraction[]>([]);
  const [partnerError, setPartnerError] = useState("");
  const [loadingPartnerEvents, setLoadingPartnerEvents] = useState(false);
  const [submittingPartnerEvent, setSubmittingPartnerEvent] = useState(false);
  const [applyingPartnerQuoteId, setApplyingPartnerQuoteId] = useState<string | null>(null);
  const [bookingProviderId, setBookingProviderId] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState("");
  const [submittingBooking, setSubmittingBooking] = useState(false);
  const [expenseServiceId, setExpenseServiceId] = useState<string | null>(null);
  const [expenseContext, setExpenseContext] = useState<ConciergeExpenseContext | null>(null);
  const [expenseItems, setExpenseItems] = useState<ConciergeExpenseItem[]>([]);
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [expenseError, setExpenseError] = useState("");
  const [submittingExpense, setSubmittingExpense] = useState(false);
  const [expenseProgress, setExpenseProgress] = useState(0);
  const expenseLoadSequenceRef = useRef(0);
  const now = useMemo(() => new Date(), [version, services, tasks]);

  const requestRefresh = useCallback(() => {
    clearApiCache("/concierge-services");
    clearApiCache("/concierge-operational-items");
    clearApiCache("/concierge-operational-items/assignees");
    clearApiCache("/providers");
    clearApiCache("/users");
    setVersion((current) => current + 1);
  }, []);

  const handleRealtimeRefresh = useCallback(() => {
    requestRefresh();
    if (!expenseServiceId) return;
    const loadSequence = expenseLoadSequenceRef.current;
    void getConciergeExpenses(expenseServiceId)
      .then((history) => {
        if (expenseLoadSequenceRef.current === loadSequence) setExpenseItems(history.items);
      })
      .catch(() => {
        // The regular workspace refresh remains authoritative if expense history is unavailable.
      });
  }, [expenseServiceId, requestRefresh]);

  useDebouncedRealtimeSubscription(REALTIME_EVENTS, handleRealtimeRefresh, 250);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (services.length > 0) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const [serviceRows, taskRows, providerRows, assigneeRows, taskProviderRows, patientRows] = await Promise.all([
          apiFetch<ConciergeService[]>(user?.role === "ceo" ? "/concierge-services" : "/concierge-services?mine_only=true", {
            cacheTtlMs: 10_000,
            forceFresh: version > 0,
          }),
          apiFetch<ConciergeTask[]>("/concierge-operational-items?archive=all", {
            cacheTtlMs: 10_000,
            forceFresh: version > 0,
          }),
          apiFetch<ConciergeProvider[]>("/providers?provider_type=non_medical&active_only=true", {
            cacheTtlMs: 30_000,
            forceFresh: version > 0,
          }).catch(() => []),
          user?.role === "ceo"
            ? apiFetch<ConciergeAssignee[]>("/concierge-operational-items/assignees", {
                cacheTtlMs: 30_000,
                forceFresh: version > 0,
              }).then(filterConciergeTaskAssignees)
            : Promise.resolve(user ? [{ id: user.id, name: user.name, email: user.email, role: user.role, is_active: true }] : []),
          apiFetch<ConciergeProvider[]>("/providers?active_only=true", {
            cacheTtlMs: 30_000,
            forceFresh: version > 0,
          }),
          apiFetch<PatientSummary[]>("/patients?active_only=true", {
            cacheTtlMs: 30_000,
            forceFresh: version > 0,
          }),
        ]);
        if (!cancelled) {
          setServices(serviceRows);
          setTasks(taskRows);
          setProviders(providerRows);
          setAssignees(assigneeRows);
          setTaskProviders(taskProviderRows.sort((left, right) => left.name.localeCompare(right.name)));
          setTaskPatients(patientRows.map((patient) => ({
            id: patient.id,
            name: [patient.first_name, patient.last_name].filter(Boolean).join(" ") || patient.patient_id,
          })).sort((left, right) => left.name.localeCompare(right.name)));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : labels.loadFailed);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [labels.loadFailed, user, version]);

  const visibleServices = useMemo(
    () => sortConciergeServices(filterConciergeServices(services, query)),
    [query, services],
  );
  const stats = useMemo(() => conciergeWorkspaceStats(services, now), [now, services]);
  const servicesByColumn = useMemo(() => {
    const groups = new Map<ConciergeBoardColumnId, ConciergeService[]>(
      CONCIERGE_BOARD_COLUMNS.map((column) => [column.id, []]),
    );
    visibleServices.forEach((service) => groups.get(conciergeServiceColumn(service))?.push(service));
    return groups;
  }, [visibleServices]);
  const patientNames = useMemo(
    () => new Map(services.map((service) => [service.patient_id, service.patient_name])),
    [services],
  );
  const providersById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );
  const partnerService = useMemo(
    () => services.find((service) => service.id === partnerServiceId) ?? null,
    [partnerServiceId, services],
  );
  const partnerProvider = useMemo(
    () => partnerService?.provider_id ? providersById.get(partnerService.provider_id) ?? null : null,
    [partnerService, providersById],
  );
  const bookingProvider = useMemo(
    () => providers.find((provider) => provider.id === bookingProviderId) ?? null,
    [bookingProviderId, providers],
  );
  const expenseService = useMemo(
    () => services.find((service) => service.id === expenseServiceId) ?? null,
    [expenseServiceId, services],
  );

  async function openExpenseReceipt(service: ConciergeService) {
    const loadSequence = expenseLoadSequenceRef.current + 1;
    expenseLoadSequenceRef.current = loadSequence;
    setExpenseServiceId(service.id);
    setExpenseContext(null);
    setExpenseItems([]);
    setExpenseError("");
    setExpenseProgress(0);
    setExpenseLoading(true);
    try {
      const [context, history] = await Promise.all([
        getConciergeExpenseContext(service.id),
        getConciergeExpenses(service.id),
      ]);
      if (expenseLoadSequenceRef.current !== loadSequence) return;
      setExpenseContext(context);
      setExpenseItems(history.items);
    } catch (loadError) {
      if (expenseLoadSequenceRef.current !== loadSequence) return;
      setExpenseError(loadError instanceof Error ? loadError.message : labels.loadFailed);
    } finally {
      if (expenseLoadSequenceRef.current === loadSequence) setExpenseLoading(false);
    }
  }

  async function submitExpense(input: ConciergeExpenseSubmitInput): Promise<ConciergeExpenseMutationResponse> {
    if (!expenseService || submittingExpense) throw new Error(labels.updateFailed);
    setSubmittingExpense(true);
    setExpenseError("");
    setExpenseProgress(0);
    try {
      const response = await uploadConciergeExpense(
        expenseService.id,
        input,
        setExpenseProgress,
      );
      setExpenseItems((current) => {
        const withoutSubmitted = current.filter((item) => item.id !== response.item.id);
        return [response.item, ...withoutSubmitted];
      });
      clearApiCache(`/concierge-services/${expenseService.id}/expenses`);
      requestRefresh();
      return response;
    } catch (submitError) {
      setExpenseError(submitError instanceof Error ? submitError.message : labels.updateFailed);
      throw submitError;
    } finally {
      setSubmittingExpense(false);
    }
  }

  async function downloadExpenseReceipt(item: ConciergeExpenseItem) {
    if (!expenseService || !item.receipt) return;
    setExpenseError("");
    try {
      await downloadConciergeExpenseReceipt(
        expenseService.id,
        item.id,
        item.receipt.original_filename,
      );
    } catch (downloadError) {
      setExpenseError(downloadError instanceof Error ? downloadError.message : labels.loadFailed);
      throw downloadError;
    }
  }

  function openProviderBooking(provider: ConciergeProvider) {
    setBookingProviderId(provider.id);
    setBookingError("");
  }

  async function saveProviderBooking(serviceId: string, input: BookConciergeProviderInput) {
    if (submittingBooking) return;
    setSubmittingBooking(true);
    setBookingError("");
    try {
      const response = await apiFetch<BookConciergeProviderResponse>(
        `/concierge-services/${serviceId}/book-provider`,
        { method: "POST", body: JSON.stringify(input) },
      );
      clearApiCache("/concierge-services");
      setServices((current) =>
        current.map((service) => service.id === response.service.id ? response.service : service),
      );
      setBookingProviderId(null);
    } catch (bookingFailure) {
      setBookingError(bookingFailure instanceof Error ? bookingFailure.message : labels.updateFailed);
      throw bookingFailure;
    } finally {
      setSubmittingBooking(false);
    }
  }

  async function openPartnerInteraction(service: ConciergeService) {
    setPartnerServiceId(service.id);
    setPartnerEvents([]);
    setPartnerError("");
    setLoadingPartnerEvents(true);
    try {
      const rows = await apiFetch<ConciergePartnerInteraction[]>(
        `/concierge-services/${service.id}/partner-interactions`,
        { forceFresh: true },
      );
      setPartnerEvents(rows);
    } catch (loadError) {
      setPartnerError(loadError instanceof Error ? loadError.message : labels.loadFailed);
    } finally {
      setLoadingPartnerEvents(false);
    }
  }

  async function recordPartnerInteraction(input: RecordPartnerInteractionInput) {
    if (!partnerService || submittingPartnerEvent) return;
    setSubmittingPartnerEvent(true);
    setPartnerError("");
    try {
      const event = await apiFetch<ConciergePartnerInteraction>(
        `/concierge-services/${partnerService.id}/partner-interactions`,
        { method: "POST", body: JSON.stringify(input) },
      );
      setPartnerEvents((current) => [...current, event]);
    } catch (recordError) {
      setPartnerError(recordError instanceof Error ? recordError.message : labels.updateFailed);
      throw recordError;
    } finally {
      setSubmittingPartnerEvent(false);
    }
  }

  async function applyPartnerQuote(event: ConciergePartnerInteraction) {
    if (!partnerService || applyingPartnerQuoteId) return;
    setApplyingPartnerQuoteId(event.id);
    setPartnerError("");
    try {
      const response = await apiFetch<ApplyPartnerQuoteResponse>(
        `/concierge-services/${partnerService.id}/partner-interactions/${event.id}/apply-cost-estimate`,
        { method: "POST" },
      );
      clearApiCache("/concierge-services");
      setServices((current) =>
        current.map((service) =>
          service.id === partnerService.id
            ? {
                ...service,
                cost_estimate: response.cost_estimate,
                currency: response.currency,
              }
            : service,
        ),
      );
      setPartnerEvents((current) =>
        current.map((interaction) =>
          interaction.id === response.interaction_id
            ? {
                ...interaction,
                applied_as_cost_estimate_at: response.applied_as_cost_estimate_at,
                applied_by: response.applied_by,
                applied_by_name: response.applied_by_name,
              }
            : interaction,
        ),
      );
    } catch (applyError) {
      setPartnerError(applyError instanceof Error ? applyError.message : labels.updateFailed);
      throw applyError;
    } finally {
      setApplyingPartnerQuoteId(null);
    }
  }

  async function advanceService(service: ConciergeService) {
    const status = nextConciergeServiceStatus(service.status);
    if (!status || updatingId) return;

    setUpdatingId(service.id);
    setError("");
    try {
      const updated = await apiFetch<ConciergeService>(
        `/concierge-services/${service.id}/update`,
        { method: "POST", body: JSON.stringify({ status }) },
      );
      clearApiCache("/concierge-services");
      setServices((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : labels.updateFailed);
    } finally {
      setUpdatingId(null);
    }
  }

  async function changeTaskStatus(task: ConciergeTask, requestedStatus?: string) {
    const status = requestedStatus ?? nextConciergeTaskStatus(task.status);
    if (!status || updatingTaskId || !canModifyConciergeTask(task, user?.id, user?.role)) return;

    setUpdatingTaskId(task.id);
    setError("");
    try {
      const updated = await apiFetch<ConciergeTask>(`/concierge-operational-items/${task.id}/update`, {
        method: "POST",
        body: JSON.stringify({
          expected_updated_at: task.updated_at,
          kind: task.kind,
          title: task.title,
          note: task.note,
          concierge_service_id: task.concierge_service_id,
          due_at: task.due_at,
          starts_at: task.starts_at,
          ends_at: task.ends_at,
          location: task.location,
          priority: task.priority,
          status,
          assigned_to: task.assigned_to,
          reminder_at: task.reminder_at,
          task_audience: task.task_audience,
          patient_id: task.patient_id,
          provider_id: task.provider_id,
          external_assignee_type: task.external_assignee_type,
          external_assignee_name: task.external_assignee_name,
          external_assignee_phone: task.external_assignee_phone,
          external_assignee_email: task.external_assignee_email,
        }),
      });
      clearApiCache("/concierge-operational-items");
      setTasks((current) =>
        current.map((item) => item.id === updated.id ? updated : item),
      );
    } catch (updateError) {
      setError(conciergeTaskErrorMessage(updateError, lang, labels.taskUpdateFailed));
    } finally {
      setUpdatingTaskId(null);
    }
  }

  function advanceTask(task: ConciergeTask) {
    void changeTaskStatus(task);
  }

  function openCreateTask() {
    setTaskError("");
    setEditingTask(null);
    createTaskRequestIdRef.current = crypto.randomUUID();
    setTaskDialogOpen(true);
  }

  function openEditTask(task: ConciergeTask) {
    if (!canModifyConciergeTask(task, user?.id, user?.role)) return;
    setTaskError("");
    setEditingTask(task);
    setTaskDialogOpen(true);
  }

  function selectViewMode(mode: ViewMode) {
    setViewMode(mode);
    const next = new URLSearchParams(searchParams);
    if (mode === "tasks") next.set("view", "tasks");
    else next.delete("view");
    if (mode !== "tasks") next.delete("task");
    setSearchParams(next, { replace: true });
  }

  function openTaskDetail(task: ConciergeTask) {
    setViewMode("tasks");
    setDetailTaskId(task.id);
    const next = new URLSearchParams(searchParams);
    next.set("view", "tasks");
    next.set("task", task.id);
    setSearchParams(next, { replace: true });
  }

  function openWorkspaceTaskDetail(task: ConciergeTask) {
    setDetailTaskId(task.id);
    const next = new URLSearchParams(searchParams);
    next.set("task", task.id);
    next.delete("view");
    setSearchParams(next, { replace: true });
  }

  async function saveTask(input: SaveConciergeOperationalItemInput): Promise<ConciergeTask> {
    if (submittingTask) throw new Error(labels.taskUpdateFailed);
    if (editingTask && !canModifyConciergeTask(editingTask, user?.id, user?.role)) throw new Error(labels.taskUpdateFailed);
    setSubmittingTask(true);
    setTaskError("");
    setError("");
    try {
      const { status, ...fields } = input;
      const createRequestId = createTaskRequestIdRef.current ?? crypto.randomUUID();
      if (!editingTask) createTaskRequestIdRef.current = createRequestId;
      const saved = editingTask
        ? await apiFetch<ConciergeTask>(`/concierge-operational-items/${editingTask.id}/update`, {
            method: "POST",
            body: JSON.stringify({
              ...fields,
              status,
              expected_updated_at: editingTask.updated_at,
            }),
          })
        : await apiFetch<ConciergeTask>("/concierge-operational-items", {
            method: "POST",
            body: JSON.stringify({
              ...fields,
              request_id: createRequestId,
            }),
          });
      clearApiCache("/concierge-operational-items");
      setTasks((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists
          ? current.map((item) => item.id === saved.id ? saved : item)
          : [...current, saved];
      });
      return saved;
    } catch (saveError) {
      setTaskError(conciergeTaskErrorMessage(saveError, lang, labels.taskUpdateFailed));
      throw saveError;
    } finally {
      setSubmittingTask(false);
    }
  }

  async function deleteTask(task: ConciergeTask) {
    if (deletingTaskId || !canModifyConciergeTask(task, user?.id, user?.role)) return;
    setDeletingTaskId(task.id);
    setError("");
    try {
      await apiFetch<void>(`/concierge-operational-items/${task.id}`, { method: "DELETE" });
      clearApiCache("/concierge-operational-items");
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setPendingDeleteTask(null);
    } catch (deleteError) {
      setError(conciergeTaskErrorMessage(deleteError, lang, labels.taskDeleteFailed));
    } finally {
      setDeletingTaskId(null);
    }
  }

  async function changeArchiveState(task: ConciergeTask, archive: boolean) {
    if (archivingTaskId || !canModifyConciergeTask(task, user?.id, user?.role)) return;
    setArchivingTaskId(task.id);
    setError("");
    try {
      const updated = await apiFetch<ConciergeTask>(
        `/concierge-operational-items/${task.id}/${archive ? "archive" : "restore"}`,
        { method: "POST" },
      );
      clearApiCache("/concierge-operational-items");
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (archiveError) {
      setError(
        conciergeTaskErrorMessage(
          archiveError,
          lang,
          archive ? labels.taskArchiveFailed : labels.taskRestoreFailed,
        ),
      );
    } finally {
      setArchivingTaskId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        {labels.title}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="concierge-workspace">
      <PageHeader
        title={viewMode === "tasks" ? labels.taskManagerTitle : labels.title}
        description={viewMode === "tasks" ? labels.taskManagerSubtitle : labels.subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {viewMode === "tasks" || user?.role === "concierge" ? (
              <Button type="button" className="h-9 rounded-lg px-3.5" onClick={openCreateTask}>
                <Plus />{labels.newTask}
              </Button>
            ) : null}
            <Button type="button" className="h-9 rounded-lg px-3.5" variant="outline" disabled={refreshing} onClick={requestRefresh}>
              <RefreshCw className={cn(refreshing && "animate-spin")} />
              {labels.refresh}
            </Button>
          </div>
        }
      />

      {viewMode !== "tasks" ? (
        <section aria-label={labels.title} className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <MetricCard label={labels.active} value={stats.active} icon={Columns3} />
          <MetricCard label={labels.today} value={stats.today} icon={CalendarDays} />
          <MetricCard label={labels.overdue} value={stats.overdue} tone="danger" icon={Clock3} />
          <MetricCard label={labels.ready} value={stats.readyForBilling} tone="success" icon={CheckCircle2} />
        </section>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {viewMode !== "tasks" ? (
        <div className="relative z-30 rounded-lg border border-border/70 bg-card p-2.5 shadow-sm sm:px-3 sm:py-2">
          <div className="relative min-w-0">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.search}
            aria-label={labels.search}
            className="h-10 rounded-md bg-field pl-8 text-xs shadow-none sm:h-8"
          />
          </div>
        </div>
      ) : null}

      <div className="-mx-2.5 overflow-x-auto px-2.5 pb-1 sm:mx-0 sm:px-0">
        <div className="mx-auto flex w-max min-w-full flex-nowrap justify-center gap-1 sm:min-w-0">
          {([
            ["board", Columns3, labels.board],
            ["list", List, labels.list],
            ["calendar", CalendarDays, labels.calendar],
            ["map", MapPinned, labels.map],
            ["tasks", ListChecks, labels.taskManager],
          ] as const).map(([mode, Icon, label]) => (
            <Button key={mode} type="button" size="sm" variant={viewMode === mode ? "default" : "ghost"} className="h-9 shrink-0 rounded-md px-2 text-xs sm:h-8 sm:px-3" aria-pressed={viewMode === mode} onClick={() => selectViewMode(mode)}>
              <Icon className="size-3.5" />
              {label}
            </Button>
          ))}
        </div>
      </div>

      {viewMode === "tasks" ? (
        <ConciergeTaskManager
          tasks={tasks}
          assignees={assignees}
          lang={lang}
          now={now}
          canManageTeam={user?.role === "ceo"}
          updatingTaskId={updatingTaskId}
          deletingTaskId={deletingTaskId}
          archivingTaskId={archivingTaskId}
          canModifyTask={(task) => canModifyConciergeTask(task, user?.id, user?.role)}
          onEdit={openEditTask}
          onDelete={setPendingDeleteTask}
          onArchive={(task) => void changeArchiveState(task, true)}
          onRestore={(task) => void changeArchiveState(task, false)}
          onOpen={openTaskDetail}
          onStatusChange={(task, status) => void changeTaskStatus(task, status)}
        />
      ) : viewMode === "calendar" ? (
        <ConciergeAgendaView
          services={visibleServices}
          tasks={tasks}
          providersById={providersById}
          patientNames={patientNames}
          lang={lang}
        />
      ) : viewMode === "map" ? (
        <ConciergeMapView
          services={services}
          tasks={tasks}
          providers={providers}
          lang={lang}
          onBookProvider={openProviderBooking}
        />
      ) : (
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            {visibleServices.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-card px-6 py-16 text-center text-sm text-muted-foreground">
                {labels.empty}
              </div>
            ) : viewMode === "board" ? (
              <section className="grid grid-cols-1 items-start gap-3 md:grid-cols-2" aria-label={labels.board}>
                {CONCIERGE_BOARD_COLUMNS.map((column) => {
                  const rows = servicesByColumn.get(column.id) ?? [];
                  return (
                    <div key={column.id} className="min-w-0 rounded-lg border border-border/70 bg-muted/30 p-2">
                      <div className="mb-2 flex items-center justify-between gap-2 px-1">
                        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {labels[column.id]}
                        </h2>
                        <Badge variant="secondary" className="rounded-full">{rows.length}</Badge>
                      </div>
                      <div className="space-y-2">
                        {rows.length === 0 ? (
                          <p className="rounded-lg border border-dashed border-border/80 bg-card px-3 py-8 text-center text-xs text-muted-foreground">
                            {labels.emptyColumn}
                          </p>
                        ) : (
                          rows.map((service) => (
                            <ServiceCard
                              key={service.id}
                              service={service}
                              lang={lang}
                              labels={labels}
                              updating={updatingId === service.id}
                              now={now}
                              onAdvance={advanceService}
                              onOpenExpense={(item) => void openExpenseReceipt(item)}
                              onOpenPartner={
                                service.provider_id && providersById.has(service.provider_id)
                                  ? openPartnerInteraction
                                  : undefined
                              }
                            />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </section>
            ) : (
              <section className="space-y-2" aria-label={labels.list}>
                {visibleServices.map((service) => (
                  <ServiceCard
                    key={service.id}
                    service={service}
                    lang={lang}
                    labels={labels}
                    updating={updatingId === service.id}
                    now={now}
                    onAdvance={advanceService}
                    onOpenExpense={(item) => void openExpenseReceipt(item)}
                    onOpenPartner={
                      service.provider_id && providersById.has(service.provider_id)
                        ? openPartnerInteraction
                        : undefined
                    }
                    compact
                  />
                ))}
              </section>
            )}
          </div>
          <ConciergeTaskQueue
            tasks={tasks}
            lang={lang}
            now={now}
            updatingTaskId={updatingTaskId}
            onAdvance={advanceTask}
            onEdit={openEditTask}
            onOpen={openWorkspaceTaskDetail}
          />
        </div>
      )}
      <ConciergePartnerInteractionDialog
        service={partnerService}
        provider={partnerProvider}
        lang={lang}
        open={Boolean(partnerServiceId && partnerProvider)}
        events={partnerEvents}
        error={partnerError}
        loading={loadingPartnerEvents}
        submitting={submittingPartnerEvent}
        applyingQuoteId={applyingPartnerQuoteId}
        onOpenChange={(open) => {
          if (!open) setPartnerServiceId(null);
        }}
        onRecord={recordPartnerInteraction}
        onApplyQuote={applyPartnerQuote}
      />
      <ConciergeProviderBookingDialog
        provider={bookingProvider}
        services={services}
        lang={lang}
        open={Boolean(bookingProvider)}
        submitting={submittingBooking}
        error={bookingError}
        onOpenChange={(open) => {
          if (!open) setBookingProviderId(null);
        }}
        onSave={saveProviderBooking}
      />
      <ConciergeExpenseReceiptDialog
        service={expenseService}
        lang={lang}
        open={Boolean(expenseServiceId)}
        context={expenseContext}
        expenses={expenseItems}
        loading={expenseLoading}
        error={expenseError}
        submitting={submittingExpense}
        progress={expenseProgress}
        vendorSuggestions={[
          ...providers.map((provider) => ({
            id: `provider:${provider.id}`,
            value: provider.name,
            description: lang === "ru" ? "Внешний партнёр" : "Externer Partner",
          })),
          ...assignees.map((assignee) => ({
            id: `user:${assignee.id}`,
            value: assignee.name,
            description: lang === "ru"
              ? `Внутренний пользователь · ${assignee.email}`
              : `Interner Benutzer · ${assignee.email}`,
          })),
        ]}
        onOpenChange={(open) => {
          if (open) return;
          expenseLoadSequenceRef.current += 1;
          setExpenseServiceId(null);
          setExpenseContext(null);
          setExpenseItems([]);
          setExpenseError("");
          setExpenseProgress(0);
        }}
        onSubmit={submitExpense}
        onDownload={downloadExpenseReceipt}
      />
      <ConciergeTaskEventDialog
        item={editingTask}
        services={services}
        assignees={assignees}
        currentUserId={user?.id ?? null}
        canAssign={user?.role === "ceo"}
        canModifyAttachments={Boolean(editingTask && canModifyConciergeTask(editingTask, user?.id, user?.role))}
        patients={taskPatients}
        providers={taskProviders}
        lang={lang}
        open={taskDialogOpen}
        submitting={submittingTask}
        error={taskError}
        onOpenChange={(open) => {
          setTaskDialogOpen(open);
          if (!open) {
            setEditingTask(null);
            createTaskRequestIdRef.current = null;
          }
        }}
        onSave={saveTask}
      />
      <ConciergeTaskDetailDialog
        taskId={detailTaskId}
        lang={lang}
        open={Boolean(detailTaskId)}
        onOpenChange={(open) => {
          if (open) return;
          setDetailTaskId(null);
          const next = new URLSearchParams(searchParams);
          next.delete("task");
          setSearchParams(next, { replace: true });
        }}
        onChanged={requestRefresh}
      />
      <DirtyDismissConfirmDialog
        open={Boolean(pendingDeleteTask)}
        title={labels.taskDeleteTitle}
        message={labels.taskDeleteMessage}
        cancelLabel={labels.taskDeleteCancel}
        confirmLabel={labels.taskDelete}
        destructive
        confirmDisabled={Boolean(deletingTaskId)}
        onCancel={() => {
          if (!deletingTaskId) setPendingDeleteTask(null);
        }}
        onConfirm={() => {
          if (pendingDeleteTask) void deleteTask(pendingDeleteTask);
        }}
      />
    </div>
  );
}
