import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Columns3,
  List,
  LoaderCircle,
  MapPinned,
  KeyRound,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  filterConciergeServices,
  isConciergeServiceOverdue,
  nextConciergeServiceStatus,
  nextConciergeTaskStatus,
  sortConciergeServices,
  type ApplyPartnerQuoteResponse,
  type ConciergeBoardColumnId,
  type ConciergeKeyAction,
  type ConciergeKeyEvent,
  type ConciergePartnerInteraction,
  type ConciergeProvider,
  type RecordConciergeKeyEventResponse,
  type ConciergeService,
  type ConciergeTask,
} from "./model";
import {
  ConciergeKeyHandoverDialog,
  conciergeKeyActionLabel,
} from "./key-handover-dialog";
import {
  ConciergePartnerInteractionDialog,
  type RecordPartnerInteractionInput,
} from "./partner-interaction-dialog";
import {
  ConciergeTaskEventDialog,
  type SaveConciergeOperationalItemInput,
} from "./task-event-dialog";
import {
  ConciergeAgendaView,
  ConciergeMapView,
  ConciergeTaskQueue,
} from "./workspace-views";

const REALTIME_EVENTS = [
  "concierge_service.created",
  "concierge_service.updated",
  "concierge_service.cancelled",
  "concierge_service.billing_ready",
  "concierge_service.key_updated",
  "concierge_service.partner_interaction_recorded",
  "concierge_service.cost_estimate_applied",
  "concierge_operational_item.created",
  "concierge_operational_item.updated",
] as const;

const text = {
  de: {
    title: "Concierge-Arbeitsbereich",
    search: "Service, Patient, Anbieter oder Referenz suchen",
    refresh: "Aktualisieren",
    newTask: "Aufgabe / Termin",
    board: "Board",
    list: "Liste",
    calendar: "Kalender",
    map: "Karte",
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
    planned: "Geplant",
    booked: "Gebucht",
    status_confirmed: "Bestätigt",
    status_in_service: "In Durchführung",
    status_completed: "Abgeschlossen",
    cancelled: "Storniert",
    key: "Schlüssel",
    partner: "Partner",
  },
  ru: {
    title: "Рабочее пространство консьержа",
    search: "Поиск по услуге, пациенту, поставщику или номеру",
    refresh: "Обновить",
    newTask: "Задача / событие",
    board: "Доска",
    list: "Список",
    calendar: "Календарь",
    map: "Карта",
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
    planned: "Запланировано",
    booked: "Забронировано",
    status_confirmed: "Подтверждено",
    status_in_service: "Выполняется",
    status_completed: "Завершено",
    cancelled: "Отменено",
    key: "Ключ",
    partner: "Партнёр",
  },
} as const;

type ConciergeText = (typeof text)[Lang];
type ViewMode = "board" | "list" | "calendar" | "map";

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

function ServiceCard({
  service,
  lang,
  labels,
  updating,
  now,
  onAdvance,
  onOpenKey,
  onOpenPartner,
  compact = false,
}: {
  service: ConciergeService;
  lang: Lang;
  labels: ConciergeText;
  updating: boolean;
  now: Date;
  onAdvance: (service: ConciergeService) => void;
  onOpenKey: (service: ConciergeService) => void;
  onOpenPartner?: (service: ConciergeService) => void;
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
        "rounded-xl border bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
        overdue ? "border-rose-200" : "border-border/70",
        compact && "sm:grid sm:grid-cols-[minmax(220px,1.4fr)_minmax(170px,1fr)_minmax(180px,1fr)_auto] sm:items-center sm:gap-4",
      )}
      data-testid={`concierge-service-${service.id}`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={statusTone(service.status)}>
            {serviceStatusLabel(service.status, labels)}
          </Badge>
          {service.request_source === "patient_portal" ? (
            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
              {labels.portal}
            </Badge>
          ) : null}
          {overdue ? (
            <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
              {labels.overdue}
            </Badge>
          ) : null}
          {service.key_status ? (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
              <KeyRound className="size-3" />
              {conciergeKeyActionLabel(service.key_status, lang)}
            </Badge>
          ) : null}
        </div>
        <h3 className="mt-2 truncate text-sm font-semibold text-foreground" title={displayTitle}>
          {displayTitle}
        </h3>
        {taxonomy ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{taxonomy}</p> : null}
      </div>

      <div className={cn("mt-3 space-y-1.5", compact && "sm:mt-0")}>
        <ServiceFact icon={UserRound} label={labels.patient}>
          <span className="truncate">{service.patient_name}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{service.patient_pid}</span>
        </ServiceFact>
        <ServiceFact icon={CalendarClock} label={labels.schedule}>
          <span className="truncate">{formatDateTime(service.starts_at, lang, labels.notSet)}</span>
        </ServiceFact>
      </div>

      <div className={cn("mt-3 space-y-1.5", compact && "sm:mt-0")}>
        <ServiceFact icon={Clock3} label={labels.provider}>
          <span className="truncate">{provider || labels.notSet}</span>
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
          <p className="truncate pl-5 text-[11px] text-muted-foreground">
            {labels.reference}: <span className="font-mono text-foreground">{service.booking_reference}</span>
          </p>
        ) : null}
      </div>

      <div className={cn("mt-3 grid grid-cols-2 gap-2", compact && "sm:mt-0 sm:flex sm:justify-self-end")}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full sm:w-auto"
          onClick={() => onOpenKey(service)}
        >
          <KeyRound />
          {labels.key}
        </Button>
        {onOpenPartner ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => onOpenPartner(service)}
          >
            <MessageSquareText />
            {labels.partner}
          </Button>
        ) : null}
        {nextStatus ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="col-span-2 w-full sm:col-span-1 sm:w-auto"
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
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="sr-only">{label}: </span>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">{children}</div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger" | "success";
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground",
          tone === "danger" && value > 0 && "text-rose-600",
          tone === "success" && value > 0 && "text-emerald-600",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function ConciergeWorkspacePage() {
  const { lang } = useLang();
  const { user } = useAuth();
  const labels = text[lang];
  const [services, setServices] = useState<ConciergeService[]>([]);
  const [tasks, setTasks] = useState<ConciergeTask[]>([]);
  const [providers, setProviders] = useState<ConciergeProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [version, setVersion] = useState(0);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ConciergeTask | null>(null);
  const [submittingTask, setSubmittingTask] = useState(false);
  const [taskError, setTaskError] = useState("");
  const [keyServiceId, setKeyServiceId] = useState<string | null>(null);
  const [keyEvents, setKeyEvents] = useState<ConciergeKeyEvent[]>([]);
  const [loadingKeyEvents, setLoadingKeyEvents] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [submittingKeyAction, setSubmittingKeyAction] = useState<ConciergeKeyAction | null>(null);
  const [partnerServiceId, setPartnerServiceId] = useState<string | null>(null);
  const [partnerEvents, setPartnerEvents] = useState<ConciergePartnerInteraction[]>([]);
  const [partnerError, setPartnerError] = useState("");
  const [loadingPartnerEvents, setLoadingPartnerEvents] = useState(false);
  const [submittingPartnerEvent, setSubmittingPartnerEvent] = useState(false);
  const [applyingPartnerQuoteId, setApplyingPartnerQuoteId] = useState<string | null>(null);
  const now = useMemo(() => new Date(), [version, services, tasks]);

  const requestRefresh = useCallback(() => {
    clearApiCache("/concierge-services");
    clearApiCache("/concierge-operational-items");
    clearApiCache("/providers");
    setVersion((current) => current + 1);
  }, []);

  useDebouncedRealtimeSubscription(REALTIME_EVENTS, requestRefresh, 250);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (services.length > 0) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const [serviceRows, taskRows, providerRows] = await Promise.all([
          apiFetch<ConciergeService[]>("/concierge-services?mine_only=true", {
            cacheTtlMs: 10_000,
            forceFresh: version > 0,
          }),
          apiFetch<ConciergeTask[]>("/concierge-operational-items", {
            cacheTtlMs: 10_000,
            forceFresh: version > 0,
          }),
          apiFetch<ConciergeProvider[]>("/providers?provider_type=non_medical&active_only=true", {
            cacheTtlMs: 30_000,
            forceFresh: version > 0,
          }).catch(() => []),
        ]);
        if (!cancelled) {
          setServices(serviceRows);
          setTasks(taskRows);
          setProviders(providerRows);
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
  }, [labels.loadFailed, version]);

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
  const keyService = useMemo(
    () => services.find((service) => service.id === keyServiceId) ?? null,
    [keyServiceId, services],
  );
  const partnerService = useMemo(
    () => services.find((service) => service.id === partnerServiceId) ?? null,
    [partnerServiceId, services],
  );
  const partnerProvider = useMemo(
    () => partnerService?.provider_id ? providersById.get(partnerService.provider_id) ?? null : null,
    [partnerService, providersById],
  );

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

  async function openKeyHandover(service: ConciergeService) {
    setKeyServiceId(service.id);
    setKeyEvents([]);
    setLoadingKeyEvents(true);
    setKeyError("");
    try {
      const rows = await apiFetch<ConciergeKeyEvent[]>(
        `/concierge-services/${service.id}/key-events`,
        { forceFresh: true },
      );
      setKeyEvents(rows);
    } catch (loadError) {
      setKeyError(loadError instanceof Error ? loadError.message : labels.loadFailed);
    } finally {
      setLoadingKeyEvents(false);
    }
  }

  async function recordKeyEvent(action: ConciergeKeyAction, occurredAt: string, note: string) {
    if (!keyService || submittingKeyAction) return;
    setSubmittingKeyAction(action);
    setKeyError("");
    try {
      const response = await apiFetch<RecordConciergeKeyEventResponse>(
        `/concierge-services/${keyService.id}/key-events`,
        {
          method: "POST",
          body: JSON.stringify({
            action,
            occurred_at: new Date(occurredAt).toISOString(),
            note: note.trim() || null,
          }),
        },
      );
      clearApiCache("/concierge-services");
      setServices((current) =>
        current.map((service) =>
          service.id === keyService.id
            ? {
                ...service,
                key_status: response.key_status,
                key_responsible_user_id: response.key_responsible_user_id,
                key_responsible_user_name: response.key_responsible_user_name,
                key_status_at: response.key_status_at,
              }
            : service,
        ),
      );
      setKeyEvents((current) => [...current, response.event]);
    } catch (recordError) {
      setKeyError(recordError instanceof Error ? recordError.message : labels.updateFailed);
      throw recordError;
    } finally {
      setSubmittingKeyAction(null);
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

  async function advanceTask(task: ConciergeTask) {
    const status = nextConciergeTaskStatus(task.status);
    if (!status || updatingTaskId) return;

    setUpdatingTaskId(task.id);
    setError("");
    try {
      const updated = await apiFetch<ConciergeTask>(`/concierge-operational-items/${task.id}/update`, {
        method: "POST",
        body: JSON.stringify({
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
        }),
      });
      clearApiCache("/concierge-operational-items");
      setTasks((current) =>
        current.map((item) => item.id === updated.id ? updated : item),
      );
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : labels.taskUpdateFailed);
    } finally {
      setUpdatingTaskId(null);
    }
  }

  function openCreateTask() {
    setTaskError("");
    setEditingTask(null);
    setTaskDialogOpen(true);
  }

  function openEditTask(task: ConciergeTask) {
    setTaskError("");
    setEditingTask(task);
    setTaskDialogOpen(true);
  }

  async function saveTask(input: SaveConciergeOperationalItemInput) {
    if (submittingTask) return;
    setSubmittingTask(true);
    setTaskError("");
    setError("");
    try {
      const { status, ...fields } = input;
      const saved = editingTask
        ? await apiFetch<ConciergeTask>(`/concierge-operational-items/${editingTask.id}/update`, {
            method: "POST",
            body: JSON.stringify({ ...fields, status }),
          })
        : await apiFetch<ConciergeTask>("/concierge-operational-items", {
            method: "POST",
            body: JSON.stringify(fields),
          });
      clearApiCache("/concierge-operational-items");
      setTasks((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists
          ? current.map((item) => item.id === saved.id ? saved : item)
          : [...current, saved];
      });
      setTaskDialogOpen(false);
      setEditingTask(null);
    } catch (saveError) {
      setTaskError(saveError instanceof Error ? saveError.message : labels.taskUpdateFailed);
      throw saveError;
    } finally {
      setSubmittingTask(false);
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
    <div className="space-y-4" data-testid="concierge-workspace">
      <PageHeader
        title={labels.title}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {user?.role === "concierge" ? (
              <Button type="button" size="sm" onClick={openCreateTask}>
                <Plus />{labels.newTask}
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="outline" disabled={refreshing} onClick={requestRefresh}>
              <RefreshCw className={cn(refreshing && "animate-spin")} />
              {labels.refresh}
            </Button>
          </div>
        }
      />

      <section aria-label={labels.title} className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MetricCard label={labels.active} value={stats.active} />
        <MetricCard label={labels.today} value={stats.today} />
        <MetricCard label={labels.overdue} value={stats.overdue} tone="danger" />
        <MetricCard label={labels.ready} value={stats.readyForBilling} tone="success" />
      </section>

      {error ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card p-2 shadow-sm sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.search}
            aria-label={labels.search}
            className="pl-9"
          />
        </div>
        <div className="grid grid-cols-4 gap-1 overflow-x-auto rounded-lg bg-muted p-1" aria-label={labels.title}>
          <Button
            type="button"
            size="sm"
            variant={viewMode === "board" ? "secondary" : "ghost"}
            aria-pressed={viewMode === "board"}
            onClick={() => setViewMode("board")}
          >
            <Columns3 />
            {labels.board}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewMode === "list" ? "secondary" : "ghost"}
            aria-pressed={viewMode === "list"}
            onClick={() => setViewMode("list")}
          >
            <List />
            {labels.list}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewMode === "calendar" ? "secondary" : "ghost"}
            aria-pressed={viewMode === "calendar"}
            onClick={() => setViewMode("calendar")}
          >
            <CalendarDays />
            {labels.calendar}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewMode === "map" ? "secondary" : "ghost"}
            aria-pressed={viewMode === "map"}
            onClick={() => setViewMode("map")}
          >
            <MapPinned />
            {labels.map}
          </Button>
        </div>
      </div>

      {viewMode === "calendar" ? (
        <ConciergeAgendaView
          services={visibleServices}
          tasks={tasks}
          providersById={providersById}
          patientNames={patientNames}
          lang={lang}
        />
      ) : viewMode === "map" ? (
        <ConciergeMapView services={visibleServices} providers={providers} lang={lang} />
      ) : (
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            {visibleServices.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
                {labels.empty}
              </div>
            ) : viewMode === "board" ? (
              <section className="grid grid-cols-1 items-start gap-3 md:grid-cols-2" aria-label={labels.board}>
                {CONCIERGE_BOARD_COLUMNS.map((column) => {
                  const rows = servicesByColumn.get(column.id) ?? [];
                  return (
                    <div key={column.id} className="min-w-0 rounded-xl border border-border/70 bg-muted/30 p-2">
                      <div className="flex items-center justify-between gap-2 px-1 pb-2">
                        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {labels[column.id]}
                        </h2>
                        <Badge variant="secondary">{rows.length}</Badge>
                      </div>
                      <div className="space-y-2">
                        {rows.length === 0 ? (
                          <p className="rounded-lg border border-dashed border-border bg-card/60 px-3 py-8 text-center text-xs text-muted-foreground">
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
                              onOpenKey={openKeyHandover}
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
                    onOpenKey={openKeyHandover}
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
          />
        </div>
      )}
      <ConciergeKeyHandoverDialog
        service={keyService}
        lang={lang}
        open={Boolean(keyServiceId)}
        events={keyEvents}
        error={keyError}
        loading={loadingKeyEvents}
        submittingAction={submittingKeyAction}
        onOpenChange={(open) => {
          if (!open) setKeyServiceId(null);
        }}
        onRecord={recordKeyEvent}
      />
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
      <ConciergeTaskEventDialog
        item={editingTask}
        services={services}
        lang={lang}
        open={taskDialogOpen}
        submitting={submittingTask}
        error={taskError}
        onOpenChange={(open) => {
          setTaskDialogOpen(open);
          if (!open) setEditingTask(null);
        }}
        onSave={saveTask}
      />
    </div>
  );
}
