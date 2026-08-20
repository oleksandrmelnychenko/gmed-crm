import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CalendarClock,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  ExternalLink,
  History,
  ListTodo,
  LoaderCircle,
  MapPin,
  Navigation,
  Phone,
  Pencil,
  Route,
  Star,
} from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  buildConciergeAgenda,
  buildConciergeRouteStops,
  buildGoogleMapsRoutePlan,
  conciergeProviderAddress,
  conciergeProviderTaxonomyLabel,
  conciergeServiceDisplayTitle,
  conciergeServiceRouteAddress,
  conciergeTaskDisplayTitle,
  eligibleConciergeServicesForProvider,
  filterConciergeProviders,
  googleMapsDirectionsUrl,
  googleMapsSearchUrl,
  isConciergeTaskActive,
  isConciergeTaskOverdue,
  nextConciergeTaskStatus,
  sortConciergeProviders,
  sortConciergeTasks,
  type ConciergeAgendaItem,
  type ConciergeProvider,
  type ConciergeProviderCategory,
  type ConciergeRouteStop,
  type ConciergeService,
  type ConciergeTask,
} from "./model";

const copy = {
  de: {
    tasks: "Meine Aufgaben",
    task: "Aufgabe",
    event: "Termin",
    editTask: "Bearbeiten",
    taskHistory: "Verlauf",
    activeTasks: "Aktiv",
    openTasks: "offen",
    noTasks: "Keine offenen Concierge-Aufgaben.",
    noTaskHistory: "Noch keine abgeschlossenen oder stornierten Einträge.",
    overdue: "Überfällig",
    due: "Fällig",
    assignedBy: "Von",
    taskOpen: "Offen",
    taskProgress: "In Arbeit",
    taskCompleted: "Erledigt",
    taskCancelled: "Storniert",
    priorityUrgent: "Dringend",
    priorityHigh: "Hoch",
    priorityNormal: "Normal",
    priorityLow: "Niedrig",
    advanceTask: "Weiter zu {status}",
    agenda: "Service- und Aufgabenagenda",
    noAgenda: "Keine terminierten Services oder Aufgaben.",
    service: "Service",
    route: "Route",
    location: "Standort",
    routeUnavailable: "Adresse des Partners oder Leistungserbringers fehlt",
    destinations: "Serviceziele",
    partners: "Empfohlene Partner",
    partnerSubtitle: "Aktive nicht-medizinische Partner und Leistungserbringer nach Kategorie und Bewertung.",
    providerSearch: "Partner oder Ort suchen",
    all: "Alle",
    restaurants: "Restaurants",
    drivers: "Fahrer",
    hotels: "Hotels",
    other: "Weitere",
    noPartners: "Keine passenden Partner gefunden.",
    noDestinations: "Für die aktuellen Services sind noch keine Partner- oder Ausführungsadressen hinterlegt.",
    rating: "Bewertung",
    openServices: "aktive Services",
    details: "Profil",
    phone: "Anrufen",
    openMap: "Karte",
    directions: "Route öffnen",
    book: "Partner buchen",
    routePlanner: "Tagesroute",
    routePlannerSubtitle: "Services, Aufgaben und Termine mit operativer Adresse in einer Route öffnen.",
    routeDate: "Datum",
    selectAll: "Alle auswählen",
    clearSelection: "Auswahl leeren",
    noRouteStops: "Für dieses Datum gibt es keine aktiven Services, Aufgaben oder Termine.",
    missingAddress: "Adresse fehlt",
    routeSelected: "{selected} von {total} Stopps ausgewählt",
    routeSegment: "Route {current} von {total} öffnen",
    routeOpen: "Route in Google Maps öffnen",
    splitRoute: "Die Route wurde wegen der Google-Maps-Limits in {count} Abschnitte geteilt.",
    omittedStops: "{count} Einträge können wegen fehlender oder zu langer Adressen nicht geöffnet werden.",
    duplicateStops: "{count} doppelte Adressen werden nur einmal angefahren.",
    moveEarlier: "Früher anfahren",
    moveLater: "Später anfahren",
  },
  ru: {
    tasks: "Мои задачи",
    task: "Задача",
    event: "Событие",
    editTask: "Изменить",
    taskHistory: "История",
    activeTasks: "Активные",
    openTasks: "открыто",
    noTasks: "Открытых задач консьержа нет.",
    noTaskHistory: "Завершённых или отменённых записей пока нет.",
    overdue: "Просрочено",
    due: "Срок",
    assignedBy: "Поставил",
    taskOpen: "Открыта",
    taskProgress: "В работе",
    taskCompleted: "Выполнена",
    taskCancelled: "Отменена",
    priorityUrgent: "Срочно",
    priorityHigh: "Высокий",
    priorityNormal: "Обычный",
    priorityLow: "Низкий",
    advanceTask: "Перевести в статус «{status}»",
    agenda: "Календарь услуг и задач",
    noAgenda: "Нет запланированных услуг или задач.",
    service: "Услуга",
    route: "Маршрут",
    location: "Место",
    routeUnavailable: "Адрес партнёра или исполнителя не указан",
    destinations: "Адреса услуг",
    partners: "Рекомендованные партнёры",
    partnerSubtitle: "Активные немедицинские партнёры и исполнители по категории и рейтингу.",
    providerSearch: "Поиск партнёра или города",
    all: "Все",
    restaurants: "Рестораны",
    drivers: "Водители",
    hotels: "Отели",
    other: "Другие",
    noPartners: "Подходящие партнёры не найдены.",
    noDestinations: "Для текущих услуг ещё не указаны адреса партнёров или исполнителей.",
    rating: "Оценка",
    openServices: "активных услуг",
    details: "Профиль",
    phone: "Позвонить",
    openMap: "Карта",
    directions: "Открыть маршрут",
    book: "Забронировать",
    routePlanner: "Маршрут на день",
    routePlannerSubtitle: "Откройте услуги, задачи и события с рабочими адресами одним маршрутом.",
    routeDate: "Дата",
    selectAll: "Выбрать все",
    clearSelection: "Снять выбор",
    noRouteStops: "На эту дату нет активных услуг, задач или событий.",
    missingAddress: "Адрес не указан",
    routeSelected: "Выбрано остановок: {selected} из {total}",
    routeSegment: "Открыть маршрут {current} из {total}",
    routeOpen: "Открыть маршрут в Google Maps",
    splitRoute: "Из-за ограничений Google Maps маршрут разделён на {count} частей.",
    omittedStops: "Невозможно открыть записи без адреса или со слишком длинным адресом: {count}.",
    duplicateStops: "Повторяющиеся адреса ({count}) включены в маршрут один раз.",
    moveEarlier: "Переместить выше",
    moveLater: "Переместить ниже",
  },
} as const;

function dateTime(value: string | null, lang: Lang, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function dayHeading(value: string, lang: Lang) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function localDateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function taskStatusLabel(status: string, lang: Lang) {
  const labels = copy[lang];
  if (status === "open") return labels.taskOpen;
  if (status === "in_progress") return labels.taskProgress;
  if (status === "completed") return labels.taskCompleted;
  if (status === "cancelled") return labels.taskCancelled;
  return status.replaceAll("_", " ");
}

function priorityLabel(priority: string, lang: Lang) {
  const labels = copy[lang];
  if (priority === "urgent") return labels.priorityUrgent;
  if (priority === "high") return labels.priorityHigh;
  if (priority === "low") return labels.priorityLow;
  return labels.priorityNormal;
}

function priorityTone(priority: string) {
  if (priority === "urgent") return "border-rose-200 bg-rose-50 text-rose-700";
  if (priority === "high") return "border-orange-200 bg-orange-50 text-orange-700";
  if (priority === "low") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function taskAccent(priority: string, overdue: boolean) {
  if (overdue || priority === "urgent") return "border-l-rose-400";
  if (priority === "high") return "border-l-orange-400";
  if (priority === "low") return "border-l-slate-300";
  return "border-l-sky-400";
}

export function ConciergeTaskQueue({
  tasks,
  lang,
  now,
  updatingTaskId,
  onAdvance,
  onEdit,
}: {
  tasks: ConciergeTask[];
  lang: Lang;
  now: Date;
  updatingTaskId: string | null;
  onAdvance: (task: ConciergeTask) => void;
  onEdit: (task: ConciergeTask) => void;
}) {
  const labels = copy[lang];
  const [showCompleted, setShowCompleted] = useState(false);
  const rows = useMemo(
    () => sortConciergeTasks(tasks).filter((task) => isConciergeTaskActive(task) !== showCompleted),
    [showCompleted, tasks],
  );
  const openCount = tasks.filter(isConciergeTaskActive).length;

  return (
    <aside className="rounded-lg border border-border/70 bg-card shadow-sm" aria-label={labels.tasks}>
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <ListTodo className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">{labels.tasks}</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="rounded-full text-[10px]">{openCount} {labels.openTasks}</Badge>
          <Button
            type="button"
            size="icon-sm"
            variant={showCompleted ? "secondary" : "ghost"}
            aria-label={showCompleted ? labels.activeTasks : labels.taskHistory}
            title={showCompleted ? labels.activeTasks : labels.taskHistory}
            onClick={() => setShowCompleted((value) => !value)}
          >
            {showCompleted ? <ListTodo className="size-3.5" /> : <History className="size-3.5" />}
          </Button>
        </div>
      </div>
      <div className="max-h-[42rem] space-y-2 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">{showCompleted ? labels.noTaskHistory : labels.noTasks}</p>
        ) : (
          rows.map((task) => {
            const nextStatus = nextConciergeTaskStatus(task.status);
            const overdue = isConciergeTaskOverdue(task, now);
            const scheduledAt = task.kind === "event" ? task.starts_at : task.due_at;
            return (
              <article
                key={task.id}
                className={cn(
                  "rounded-lg border border-l-[3px] bg-background p-3 shadow-xs transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:shadow-sm",
                  taskAccent(task.priority, overdue),
                  overdue ? "border-rose-200" : "border-border/70",
                  ["completed", "cancelled"].includes(task.status) && "opacity-65",
                )}
                data-testid={`concierge-task-${task.id}`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className={cn("rounded-full text-[10px]", priorityTone(task.priority))}>
                    {priorityLabel(task.priority, lang)}
                  </Badge>
                  <Badge variant="secondary" className="rounded-full text-[10px]">
                    {task.kind === "event" ? <CalendarClock className="size-3" /> : <ListTodo className="size-3" />}
                    {labels[task.kind]}
                  </Badge>
                  <Badge variant="outline" className="rounded-full text-[10px]">{taskStatusLabel(task.status, lang)}</Badge>
                  {overdue ? (
                    <Badge variant="outline" className="rounded-full border-rose-200 bg-rose-50 text-[10px] text-rose-700">
                      {labels.overdue}
                    </Badge>
                  ) : null}
                </div>
                <h3 className="mt-2 text-sm font-semibold leading-5">
                  {conciergeTaskDisplayTitle(task, lang)}
                </h3>
                {task.note ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.note}</p> : null}
                <div className="mt-2 space-y-1.5 rounded-md bg-muted/35 p-2.5 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{labels.due}: {dateTime(scheduledAt, lang)}</p>
                  {task.location ? <p className="flex items-center gap-1.5"><MapPin className="size-3.5" />{task.location}</p> : null}
                  <p className="truncate border-t border-border/60 pt-1.5">{labels.assignedBy}: <span className="font-medium text-foreground">{task.assigned_by_name}</span></p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3">
                  <Button type="button" size="sm" variant="ghost" className="h-8 rounded-md text-xs" aria-label={labels.editTask} onClick={() => onEdit(task)}>
                    <Pencil />{labels.editTask}
                  </Button>
                  {nextStatus ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-md text-xs"
                      disabled={updatingTaskId === task.id}
                      aria-label={labels.advanceTask.replace("{status}", taskStatusLabel(nextStatus, lang))}
                      onClick={() => onAdvance(task)}
                    >
                      {updatingTaskId === task.id ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}
                      {taskStatusLabel(nextStatus, lang)}
                    </Button>
                  ) : <span />}
                </div>
              </article>
            );
          })
        )}
      </div>
    </aside>
  );
}

export function ConciergeAgendaView({
  services,
  tasks,
  providersById,
  patientNames,
  lang,
}: {
  services: ConciergeService[];
  tasks: ConciergeTask[];
  providersById: Map<string, ConciergeProvider>;
  patientNames: Map<string, string>;
  lang: Lang;
}) {
  const labels = copy[lang];
  const agenda = useMemo(
    () => buildConciergeAgenda(services, tasks, patientNames, lang),
    [lang, patientNames, services, tasks],
  );
  const grouped = useMemo(() => {
    const result: Array<{ date: string; items: ConciergeAgendaItem[] }> = [];
    for (const item of agenda) {
      const key = item.date.slice(0, 10);
      const current = result.at(-1);
      if (!current || current.date !== key) result.push({ date: key, items: [item] });
      else current.items.push(item);
    }
    return result;
  }, [agenda]);

  if (grouped.length === 0) {
    return <EmptySurface icon={CalendarDays} text={labels.noAgenda} />;
  }

  return (
    <section className="space-y-3" aria-label={labels.agenda}>
      {grouped.map((group) => (
        <div key={group.date} className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
          <div className="border-b border-border/70 bg-muted/40 px-4 py-2.5">
            <h2 className="text-sm font-semibold capitalize">{dayHeading(group.items[0].date, lang)}</h2>
          </div>
          <div className="divide-y divide-border/60">
            {group.items.map((item) => {
              const provider = item.providerId ? providersById.get(item.providerId) : null;
              const address = item.address || conciergeProviderAddress(provider);
              const directions = googleMapsDirectionsUrl(address);
              return (
                <article key={`${item.kind}:${item.id}`} className="grid gap-2 px-4 py-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center">
                  <div className="font-mono text-xs text-muted-foreground">
                    {dateTime(item.date, lang).split(", ").at(-1)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={item.kind === "service" ? "default" : "secondary"} className="rounded-full text-[10px]">
                        {labels[item.kind]}
                      </Badge>
                      {item.priority ? <Badge variant="outline" className={cn("rounded-full text-[10px]", priorityTone(item.priority))}>{priorityLabel(item.priority, lang)}</Badge> : null}
                    </div>
                    <h3 className="mt-1.5 truncate text-sm font-semibold">{item.title}</h3>
                    {item.patientName ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.patientName}</p> : null}
                  </div>
                  {directions ? (
                    <Button nativeButton={false} render={<a href={directions} target="_blank" rel="noreferrer" />} variant="outline" size="sm">
                      <Navigation />{labels.route}
                    </Button>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

export function ConciergeMapView({
  services,
  tasks,
  providers,
  lang,
  onBookProvider,
}: {
  services: ConciergeService[];
  tasks: ConciergeTask[];
  providers: ConciergeProvider[];
  lang: Lang;
  onBookProvider: (provider: ConciergeProvider) => void;
}) {
  const labels = copy[lang];
  const [category, setCategory] = useState<ConciergeProviderCategory>("all");
  const [providerQuery, setProviderQuery] = useState("");
  const [routeDate, setRouteDate] = useState(() => localDateInputValue(new Date()));
  const [routeOrder, setRouteOrder] = useState<string[]>([]);
  const [selectedRouteStopIds, setSelectedRouteStopIds] = useState<Set<string>>(() => new Set());
  const knownRouteStopIdsRef = useRef<Set<string>>(new Set());
  const providersById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers]);
  const routeStops = useMemo(
    () => buildConciergeRouteStops(services, tasks, providersById, routeDate, lang),
    [lang, providersById, routeDate, services, tasks],
  );
  useEffect(() => {
    const availableIds = new Set(routeStops.map((stop) => stop.id));
    const newRoutableIds = routeStops
      .filter((stop) => stop.address && !knownRouteStopIdsRef.current.has(stop.id))
      .map((stop) => stop.id);
    setRouteOrder((current) => [
      ...current.filter((id) => availableIds.has(id)),
      ...routeStops.map((stop) => stop.id).filter((id) => !current.includes(id)),
    ]);
    setSelectedRouteStopIds((current) => {
      const next = new Set([...current].filter((id) => availableIds.has(id)));
      newRoutableIds.forEach((id) => next.add(id));
      return next;
    });
    knownRouteStopIdsRef.current = availableIds;
  }, [routeStops]);
  const routeStopsById = useMemo(
    () => new Map(routeStops.map((stop) => [stop.id, stop])),
    [routeStops],
  );
  const orderedRouteStops = useMemo(
    () => routeOrder.flatMap((id) => {
      const stop = routeStopsById.get(id);
      return stop ? [stop] : [];
    }),
    [routeOrder, routeStopsById],
  );
  const selectedRouteStops = useMemo(
    () => orderedRouteStops.filter((stop) => selectedRouteStopIds.has(stop.id)),
    [orderedRouteStops, selectedRouteStopIds],
  );
  const routePlan = useMemo(
    () => buildGoogleMapsRoutePlan(selectedRouteStops),
    [selectedRouteStops],
  );
  const routableStops = routeStops.filter((stop) => Boolean(stop.address));
  const missingAddressCount = routeStops.length - routableStops.length;
  const destinations = useMemo(() => {
    return services.flatMap((service) => {
      if (!service.provider_id) return [];
      const provider = providersById.get(service.provider_id);
      const address = conciergeServiceRouteAddress(service, provider);
      if (!provider || !address) return [];
      return [{ service, provider, address }];
    });
  }, [providersById, services]);
  const recommendations = useMemo(
    () => sortConciergeProviders(filterConciergeProviders(providers, category, providerQuery)),
    [category, providerQuery, providers],
  );
  const categories: ConciergeProviderCategory[] = ["all", "restaurants", "drivers", "hotels", "other"];

  function selectRouteDate(value: string) {
    knownRouteStopIdsRef.current = new Set();
    setRouteOrder([]);
    setSelectedRouteStopIds(new Set());
    setRouteDate(value);
  }

  function toggleRouteStop(stop: ConciergeRouteStop) {
    if (!stop.address) return;
    setSelectedRouteStopIds((current) => {
      const next = new Set(current);
      if (next.has(stop.id)) next.delete(stop.id);
      else next.add(stop.id);
      return next;
    });
  }

  function moveRouteStop(stopId: string, direction: -1 | 1) {
    setRouteOrder((current) => {
      const index = current.indexOf(stopId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm" aria-label={labels.routePlanner}>
        <div className="flex flex-col gap-3 border-b border-border/70 px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Route className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">{labels.routePlanner}</h2>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{labels.routePlannerSubtitle}</p>
          </div>
          <label className="grid shrink-0 gap-1 text-xs font-medium text-muted-foreground">
            {labels.routeDate}
            <Input
              type="date"
              className="h-8 min-w-40 bg-field text-xs"
              value={routeDate}
              onChange={(event) => selectRouteDate(event.target.value)}
            />
          </label>
        </div>

        {routeStops.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">{labels.noRouteStops}</p>
        ) : (
          <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0 border-b border-border/70 lg:border-b-0 lg:border-r">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  {labels.routeSelected
                    .replace("{selected}", String(selectedRouteStops.length))
                    .replace("{total}", String(routableStops.length))}
                </p>
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setSelectedRouteStopIds(new Set(routableStops.map((stop) => stop.id)))}
                  >
                    {labels.selectAll}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setSelectedRouteStopIds(new Set())}
                  >
                    {labels.clearSelection}
                  </Button>
                </div>
              </div>
              <ol className="divide-y divide-border/60">
                {orderedRouteStops.map((stop, index) => (
                  <li key={stop.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={selectedRouteStopIds.has(stop.id)}
                      disabled={!stop.address}
                      aria-label={`${stop.title}: ${stop.address || labels.missingAddress}`}
                      onChange={() => toggleRouteStop(stop)}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <time className="font-mono text-[11px] text-muted-foreground" dateTime={stop.scheduledAt}>
                          {new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(stop.scheduledAt))}
                        </time>
                        <Badge variant="outline" className="rounded-full text-[10px]">{labels[stop.kind]}</Badge>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium">{stop.title}</p>
                      <p className={cn("mt-0.5 truncate text-xs", stop.address ? "text-muted-foreground" : "text-amber-700")}>
                        {stop.address || labels.missingAddress}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      <Button type="button" size="icon-sm" variant="ghost" disabled={index === 0} aria-label={labels.moveEarlier} onClick={() => moveRouteStop(stop.id, -1)}>
                        <ArrowUp />
                      </Button>
                      <Button type="button" size="icon-sm" variant="ghost" disabled={index === orderedRouteStops.length - 1} aria-label={labels.moveLater} onClick={() => moveRouteStop(stop.id, 1)}>
                        <ArrowDown />
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <aside className="space-y-3 p-3">
              {routePlan.segments.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">{labels.clearSelection}</p>
              ) : (
                <div className="grid gap-2">
                  {routePlan.segments.map((segment, index) => (
                    <Button
                      key={`${segment.stopIds[0]}:${index}`}
                      nativeButton={false}
                      render={<a href={segment.url} target="_blank" rel="noreferrer" />}
                      className="w-full justify-start"
                    >
                      <Navigation />
                      {routePlan.segments.length === 1
                        ? labels.routeOpen
                        : labels.routeSegment
                            .replace("{current}", String(index + 1))
                            .replace("{total}", String(routePlan.segments.length))}
                    </Button>
                  ))}
                </div>
              )}
              {routePlan.segments.length > 1 ? (
                <p className="rounded-lg border border-sky-200 bg-sky-50 p-2.5 text-xs leading-5 text-sky-800">{labels.splitRoute.replace("{count}", String(routePlan.segments.length))}</p>
              ) : null}
              {missingAddressCount + routePlan.tooLongStopIds.length > 0 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-5 text-amber-800">{labels.omittedStops.replace("{count}", String(missingAddressCount + routePlan.tooLongStopIds.length))}</p>
              ) : null}
              {routePlan.duplicateAddressStopIds.length > 0 ? (
                <p className="rounded-lg border border-border bg-muted/30 p-2.5 text-xs leading-5 text-muted-foreground">{labels.duplicateStops.replace("{count}", String(routePlan.duplicateAddressStopIds.length))}</p>
              ) : null}
            </aside>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border/70 bg-card shadow-sm" aria-label={labels.destinations}>
        <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
          <MapPin className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">{labels.destinations}</h2>
        </div>
        {destinations.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">{labels.noDestinations}</p>
        ) : (
          <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
            {destinations.map(({ service, provider, address }) => (
              <article key={service.id} className="rounded-lg border border-border/70 p-3">
                <h3 className="truncate text-sm font-semibold">{provider.name}</h3>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {conciergeServiceDisplayTitle(service, lang)}
                </p>
                <p className="mt-2 flex items-start gap-1.5 text-xs leading-5"><MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{address}</p>
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  <MapAction href={googleMapsSearchUrl(address)} label={labels.openMap} icon={MapPin} />
                  <MapAction href={googleMapsDirectionsUrl(address)} label={labels.directions} icon={Navigation} />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border/70 bg-card shadow-sm" aria-label={labels.partners}>
        <div className="border-b border-border/70 px-4 py-3">
          <h2 className="text-sm font-semibold">{labels.partners}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{labels.partnerSubtitle}</p>
        </div>
        <div className="space-y-2 border-b border-border/60 p-3">
          <Input className="h-8 rounded-md bg-field text-xs" value={providerQuery} onChange={(event) => setProviderQuery(event.target.value)} placeholder={labels.providerSearch} aria-label={labels.providerSearch} />
          <div className="flex gap-1 overflow-x-auto pb-1">
            {categories.map((item) => (
              <Button key={item} type="button" size="sm" className="h-8 rounded-md px-2.5 text-xs" variant={category === item ? "default" : "ghost"} aria-pressed={category === item} onClick={() => setCategory(item)}>
                {labels[item]}
              </Button>
            ))}
          </div>
        </div>
        {recommendations.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">{labels.noPartners}</p>
        ) : (
          <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
            {recommendations.slice(0, 24).map((provider) => {
              const address = conciergeProviderAddress(provider);
              const rating = provider.internal_rating ?? provider.avg_rating;
              const canBook = eligibleConciergeServicesForProvider(services, provider.id).length > 0;
              return (
                <article key={provider.id} className="flex min-w-0 flex-col rounded-lg border border-border/70 p-3">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold">{provider.name}</h3>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{conciergeProviderTaxonomyLabel(provider, lang)}</p>
                    </div>
                    {rating !== null ? <Badge variant="outline" className="rounded-full text-[10px]"><Star className="fill-amber-400 text-amber-500" />{rating.toFixed(1)}</Badge> : null}
                  </div>
                  <p className="mt-2 flex min-h-10 items-start gap-1.5 text-xs leading-5 text-muted-foreground"><MapPin className="mt-0.5 size-3.5 shrink-0" />{address || labels.routeUnavailable}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{provider.open_concierge_service_count} {labels.openServices}</p>
                  <div className="mt-auto grid grid-cols-2 gap-1.5 pt-3">
                    <StaffLink to={`/providers/${provider.id}`} className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-border bg-background px-2 text-xs font-medium hover:bg-muted">
                      <ExternalLink className="size-3" />{labels.details}
                    </StaffLink>
                    {provider.phone ? (
                      <Button nativeButton={false} render={<a href={`tel:${provider.phone}`} />} variant="outline" size="sm" className="h-8 rounded-md text-xs"><Phone />{labels.phone}</Button>
                    ) : (
                      <MapAction href={googleMapsSearchUrl(address)} label={labels.openMap} icon={MapPin} />
                    )}
                    {canBook ? (
                      <Button type="button" variant="default" size="sm" className="col-span-2 h-8 rounded-md text-xs" onClick={() => onBookProvider(provider)}>
                        <CalendarCheck2 />{labels.book}
                      </Button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function MapAction({ href, label, icon: Icon }: { href: string | null; label: string; icon: typeof MapPin }) {
  if (!href) return <Button type="button" variant="outline" size="sm" disabled><Icon />{label}</Button>;
  return (
    <Button nativeButton={false} render={<a href={href} target="_blank" rel="noreferrer" />} variant="outline" size="sm">
      <Icon />{label}
    </Button>
  );
}

function EmptySurface({ icon: Icon, text }: { icon: typeof CalendarDays; text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
      <Icon className="mx-auto mb-3 size-6" />{text}
    </div>
  );
}
