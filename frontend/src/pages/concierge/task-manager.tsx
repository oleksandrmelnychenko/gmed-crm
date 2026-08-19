import { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  List,
  ListChecks,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  UsersRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  conciergeTaskScheduledAt,
  conciergeTaskWorkload,
  filterConciergeTasks,
  isConciergeTaskOverdue,
  sortConciergeTasks,
  type ConciergeAssignee,
  type ConciergeTask,
  type ConciergeTaskFilters,
} from "./model";

type TaskView = "board" | "list" | "calendar";
type CalendarScale = "day" | "week" | "month";

const copy = {
  de: {
    title: "Aufgabenmanager",
    subtitle: "Aufgaben verteilen, Termine planen und Fristen im Blick behalten",
    newTask: "Aufgabe oder Termin",
    search: "Aufgabe, Ort oder Concierge suchen",
    allAssignees: "Alle Concierge",
    allStatuses: "Alle Status",
    allPriorities: "Alle Prioritäten",
    allKinds: "Aufgaben und Termine",
    allTiming: "Alle Zeiträume",
    today: "Heute",
    overdue: "Überfällig",
    upcoming: "Bevorstehend",
    board: "Kanban",
    list: "Liste",
    calendar: "Kalender",
    day: "Tag",
    week: "Woche",
    month: "Monat",
    open: "Offen",
    in_progress: "In Arbeit",
    completed: "Erledigt",
    cancelled: "Storniert",
    low: "Niedrig",
    normal: "Normal",
    high: "Hoch",
    urgent: "Dringend",
    task: "Aufgabe",
    event: "Termin",
    noTasks: "Keine Aufgaben für die gewählten Filter",
    active: "Aktiv",
    dueToday: "Heute fällig",
    teamWorkload: "Team-Auslastung",
    checklist: "Checkliste",
    comments: "Kommentare",
    reminder: "Erinnerung",
    details: "Details",
    edit: "Bearbeiten",
    moveTo: "Status ändern",
    unplanned: "Ohne Termin",
  },
  ru: {
    title: "Менеджер задач",
    subtitle: "Распределение задач, календарь событий и контроль сроков",
    newTask: "Задача или событие",
    search: "Поиск по задаче, адресу или консьержу",
    allAssignees: "Все консьержи",
    allStatuses: "Все статусы",
    allPriorities: "Все приоритеты",
    allKinds: "Задачи и события",
    allTiming: "Все сроки",
    today: "Сегодня",
    overdue: "Просрочено",
    upcoming: "Предстоящие",
    board: "Канбан",
    list: "Список",
    calendar: "Календарь",
    day: "День",
    week: "Неделя",
    month: "Месяц",
    open: "Открыто",
    in_progress: "В работе",
    completed: "Выполнено",
    cancelled: "Отменено",
    low: "Низкий",
    normal: "Обычный",
    high: "Высокий",
    urgent: "Срочный",
    task: "Задача",
    event: "Событие",
    noTasks: "Для выбранных фильтров задач нет",
    active: "Активные",
    dueToday: "На сегодня",
    teamWorkload: "Загрузка команды",
    checklist: "Чек-лист",
    comments: "Комментарии",
    reminder: "Напоминание",
    details: "Подробнее",
    edit: "Изменить",
    moveTo: "Изменить статус",
    unplanned: "Без даты",
  },
} as const;

const statuses = ["open", "in_progress", "completed", "cancelled"] as const;

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(date: Date) {
  const day = (date.getDay() + 6) % 7;
  return addDays(startOfDay(date), -day);
}

function calendarDays(scale: CalendarScale, focus: Date) {
  if (scale === "day") return [startOfDay(focus)];
  if (scale === "week") {
    const start = startOfWeek(focus);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }
  const first = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function formatDateTime(value: Date | null, lang: Lang) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
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

function TaskCard({
  task,
  lang,
  now,
  compact = false,
  updating,
  onOpen,
  onEdit,
  onStatusChange,
}: {
  task: ConciergeTask;
  lang: Lang;
  now: Date;
  compact?: boolean;
  updating: boolean;
  onOpen: (task: ConciergeTask) => void;
  onEdit: (task: ConciergeTask) => void;
  onStatusChange: (task: ConciergeTask, status: string) => void;
}) {
  const labels = copy[lang];
  const scheduled = conciergeTaskScheduledAt(task);
  const overdue = isConciergeTaskOverdue(task, now);
  return (
    <article className={cn("rounded-lg border border-l-[3px] bg-card p-3 shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:shadow-md", taskAccent(task.priority, overdue), overdue ? "border-rose-200" : "border-border/70", compact && "grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center")}>
      <button type="button" className="min-w-0 text-left" onClick={() => onOpen(task)}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn("rounded-full text-[10px]", priorityTone(task.priority))}>{labels[task.priority as keyof typeof labels] ?? task.priority}</Badge>
          <Badge variant="secondary" className="rounded-full text-[10px]">{task.kind === "event" ? labels.event : labels.task}</Badge>
          {overdue ? <Badge variant="outline" className="rounded-full border-rose-200 bg-rose-50 text-[10px] text-rose-700">{labels.overdue}</Badge> : null}
        </div>
        <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-foreground">{task.title}</h3>
        <div className="mt-2 space-y-1.5 rounded-md bg-muted/35 p-2.5 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{scheduled ? formatDateTime(scheduled, lang) : labels.unplanned}</p>
          <p className="truncate"><UsersRound className="mr-1.5 inline size-3.5" />{task.assigned_to_name}</p>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
          <span><ListChecks className="mr-1 inline size-3" />{labels.checklist}: {task.checklist_completed ?? 0}/{task.checklist_total ?? 0}</span>
          <span><MessageSquareText className="mr-1 inline size-3" />{labels.comments}: {task.comment_count ?? 0}</span>
          {task.reminder_at ? <span><CircleAlert className="mr-1 inline size-3" />{labels.reminder}</span> : null}
        </div>
      </button>
      <Button type="button" size="sm" variant="ghost" className="h-8 rounded-md text-xs" onClick={() => onEdit(task)}><Pencil />{labels.edit}</Button>
      <select
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        value={task.status}
        disabled={updating}
        aria-label={labels.moveTo}
        onChange={(event) => onStatusChange(task, event.target.value)}
      >
        {statuses.map((status) => <option key={status} value={status}>{labels[status]}</option>)}
      </select>
    </article>
  );
}

export function ConciergeTaskManager({
  tasks,
  assignees,
  lang,
  now,
  canManageTeam,
  updatingTaskId,
  onCreate,
  onEdit,
  onOpen,
  onStatusChange,
}: {
  tasks: ConciergeTask[];
  assignees: ConciergeAssignee[];
  lang: Lang;
  now: Date;
  canManageTeam: boolean;
  updatingTaskId: string | null;
  onCreate: () => void;
  onEdit: (task: ConciergeTask) => void;
  onOpen: (task: ConciergeTask) => void;
  onStatusChange: (task: ConciergeTask, status: string) => void;
}) {
  const labels = copy[lang];
  const [view, setView] = useState<TaskView>("board");
  const [calendarScale, setCalendarScale] = useState<CalendarScale>("month");
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [filters, setFilters] = useState<ConciergeTaskFilters>({ query: "", assignee: "all", status: "all", priority: "all", kind: "all", timing: "all" });
  const filtered = useMemo(() => sortConciergeTasks(filterConciergeTasks(tasks, filters, now)), [filters, now, tasks]);
  const workload = useMemo(() => conciergeTaskWorkload(tasks, assignees, now), [assignees, now, tasks]);
  const active = tasks.filter((task) => !["completed", "cancelled"].includes(task.status)).length;
  const overdue = tasks.filter((task) => isConciergeTaskOverdue(task, now)).length;
  const scheduledToday = tasks.filter((task) => conciergeTaskScheduledAt(task) && dateKey(conciergeTaskScheduledAt(task) as Date) === dateKey(now)).length;
  const days = useMemo(() => calendarDays(calendarScale, focusDate), [calendarScale, focusDate]);
  const tasksByDay = useMemo(() => {
    const result = new Map<string, ConciergeTask[]>();
    filtered.forEach((task) => {
      const date = conciergeTaskScheduledAt(task);
      if (!date) return;
      const key = dateKey(date);
      result.set(key, [...(result.get(key) ?? []), task]);
    });
    return result;
  }, [filtered]);

  function shiftCalendar(direction: number) {
    const next = new Date(focusDate);
    if (calendarScale === "month") next.setMonth(next.getMonth() + direction);
    else next.setDate(next.getDate() + direction * (calendarScale === "week" ? 7 : 1));
    setFocusDate(next);
  }

  return (
    <section className="space-y-3" aria-label={labels.title}>
      <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold">{labels.title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{labels.subtitle}</p>
        </div>
        <Button type="button" className="h-9 rounded-lg" onClick={onCreate}><Plus />{labels.newTask}</Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border bg-card p-3"><p className="text-[11px] text-muted-foreground">{labels.active}</p><p className="mt-1 font-mono text-xl font-semibold">{active}</p></div>
        <div className="rounded-lg border bg-card p-3"><p className="text-[11px] text-muted-foreground">{labels.dueToday}</p><p className="mt-1 font-mono text-xl font-semibold">{scheduledToday}</p></div>
        <div className="rounded-lg border bg-card p-3"><p className="text-[11px] text-muted-foreground">{labels.overdue}</p><p className={cn("mt-1 font-mono text-xl font-semibold", overdue > 0 && "text-rose-600")}>{overdue}</p></div>
      </div>

      {canManageTeam ? (
        <div className="rounded-lg border border-border/70 bg-card p-3 shadow-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{labels.teamWorkload}</h3>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {workload.map(({ assignee, active: assigneeActive, overdue: assigneeOverdue, today }) => (
              <button key={assignee.id} type="button" className={cn("rounded-lg border p-3 text-left", filters.assignee === assignee.id ? "border-primary bg-primary/5" : "border-border/70")} onClick={() => setFilters((current) => ({ ...current, assignee: current.assignee === assignee.id ? "all" : assignee.id }))}>
                <p className="truncate text-sm font-semibold">{assignee.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{labels.active}: {assigneeActive} · {labels.today}: {today} · {labels.overdue}: {assigneeOverdue}</p>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-2 rounded-lg border border-border/70 bg-card p-2 shadow-sm">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
          <div className="relative xl:col-span-2"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="h-8 pl-8 text-xs" value={filters.query} placeholder={labels.search} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} /></div>
          {canManageTeam ? <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={filters.assignee} onChange={(event) => setFilters((current) => ({ ...current, assignee: event.target.value }))}><option value="all">{labels.allAssignees}</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}</select> : null}
          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="all">{labels.allStatuses}</option>{statuses.map((status) => <option key={status} value={status}>{labels[status]}</option>)}</select>
          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={filters.priority} onChange={(event) => setFilters((current) => ({ ...current, priority: event.target.value }))}><option value="all">{labels.allPriorities}</option>{["low", "normal", "high", "urgent"].map((priority) => <option key={priority} value={priority}>{labels[priority as keyof typeof labels]}</option>)}</select>
          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={filters.kind} onChange={(event) => setFilters((current) => ({ ...current, kind: event.target.value }))}><option value="all">{labels.allKinds}</option><option value="task">{labels.task}</option><option value="event">{labels.event}</option></select>
          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={filters.timing} onChange={(event) => setFilters((current) => ({ ...current, timing: event.target.value as ConciergeTaskFilters["timing"] }))}><option value="all">{labels.allTiming}</option><option value="today">{labels.today}</option><option value="overdue">{labels.overdue}</option><option value="upcoming">{labels.upcoming}</option></select>
        </div>
        <div className="flex justify-center gap-1 rounded-md bg-muted p-1">
          {([ ["board", ListChecks, labels.board], ["list", List, labels.list], ["calendar", CalendarDays, labels.calendar] ] as const).map(([value, Icon, label]) => <Button key={value} type="button" size="sm" variant={view === value ? "secondary" : "ghost"} className="h-8 text-xs" onClick={() => setView(value)}><Icon />{label}</Button>)}
        </div>
      </div>

      {filtered.length === 0 ? <div className="rounded-lg border border-dashed bg-card px-6 py-16 text-center text-sm text-muted-foreground">{labels.noTasks}</div> : null}

      {filtered.length > 0 && view === "board" ? (
        <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
          {statuses.map((status) => {
            const rows = filtered.filter((task) => task.status === status);
            return <section key={status} className="min-w-0 rounded-lg border border-border/70 bg-muted/30 p-2"><div className="mb-2 flex items-center justify-between px-1"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{labels[status]}</h3><Badge variant="secondary" className="rounded-full">{rows.length}</Badge></div><div className="space-y-2">{rows.map((task) => <TaskCard key={task.id} task={task} lang={lang} now={now} updating={updatingTaskId === task.id} onOpen={onOpen} onEdit={onEdit} onStatusChange={onStatusChange} />)}</div></section>;
          })}
        </div>
      ) : null}

      {filtered.length > 0 && view === "list" ? <div className="space-y-2">{filtered.map((task) => <TaskCard key={task.id} task={task} lang={lang} now={now} compact updating={updatingTaskId === task.id} onOpen={onOpen} onEdit={onEdit} onStatusChange={onStatusChange} />)}</div> : null}

      {filtered.length > 0 && view === "calendar" ? (
        <div className="rounded-lg border border-border/70 bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
            <div className="flex items-center gap-1"><Button type="button" size="icon-sm" variant="ghost" onClick={() => shiftCalendar(-1)}><ChevronLeft /></Button><Button type="button" size="sm" variant="ghost" onClick={() => setFocusDate(new Date())}>{labels.today}</Button><Button type="button" size="icon-sm" variant="ghost" onClick={() => shiftCalendar(1)}><ChevronRight /></Button></div>
            <h3 className="text-sm font-semibold">{new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", { month: "long", year: "numeric" }).format(focusDate)}</h3>
            <div className="flex gap-1">{(["day", "week", "month"] as const).map((scale) => <Button key={scale} type="button" size="sm" variant={calendarScale === scale ? "secondary" : "ghost"} className="h-8 text-xs" onClick={() => setCalendarScale(scale)}>{labels[scale]}</Button>)}</div>
          </div>
          <div className="overflow-x-auto">
          <div className={cn("grid", calendarScale === "day" ? "grid-cols-1" : "min-w-[700px] grid-cols-7")}>
            {days.map((day) => {
              const rows = tasksByDay.get(dateKey(day)) ?? [];
              const outsideMonth = calendarScale === "month" && day.getMonth() !== focusDate.getMonth();
              return <div key={day.toISOString()} className={cn("min-h-28 border-b border-r p-1.5", outsideMonth && "bg-muted/30 text-muted-foreground")}><div className={cn("mb-1 text-xs font-medium", dateKey(day) === dateKey(now) && "text-primary")}>{new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", { weekday: calendarScale === "month" ? undefined : "short", day: "2-digit", month: calendarScale === "day" ? "long" : undefined }).format(day)}</div><div className="space-y-1">{rows.slice(0, calendarScale === "month" ? 3 : 12).map((task) => <button key={task.id} type="button" className={cn("block w-full truncate rounded px-1.5 py-1 text-left text-[10px]", task.kind === "event" ? "bg-violet-100 text-violet-800" : "bg-sky-100 text-sky-800")} title={task.title} onClick={() => onOpen(task)}>{task.title}</button>)}</div></div>;
            })}
          </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
