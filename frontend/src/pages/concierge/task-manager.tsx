import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  List,
  ListChecks,
  MessageSquareText,
  Pencil,
  Search,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { SelectField } from "@/components/ui/select-field";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  conciergeTaskCode,
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
    search: "Aufgabe, Ort oder zuständige Person suchen",
    allAssignees: "Alle Zuständigen",
    allStatuses: "Alle Status",
    allPriorities: "Alle Prioritäten",
    allKinds: "Aufgaben und Termine",
    allAudiences: "Intern und extern",
    internal: "Intern",
    external: "Extern",
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
    delete: "Löschen",
    noPermission: "Nur der Ersteller oder eine übergeordnete Rolle darf diese Aufgabe ändern",
    moveTo: "Status ändern",
    unplanned: "Ohne Termin",
    more: "weitere",
    patient: "Patient",
    provider: "Anbieter",
    activeTasks: "Aktiv",
    archivedTasks: "Archiv",
    allTasks: "Alle",
    archive: "Archivieren",
    restore: "Wiederherstellen",
    archived: "Archiviert",
  },
  ru: {
    title: "Менеджер задач",
    subtitle: "Распределение задач, календарь событий и контроль сроков",
    newTask: "Задача или событие",
    search: "Поиск по задаче, адресу или исполнителю",
    allAssignees: "Все исполнители",
    allStatuses: "Все статусы",
    allPriorities: "Все приоритеты",
    allKinds: "Задачи и события",
    allAudiences: "Внутренние и внешние",
    internal: "Внутренняя",
    external: "Внешняя",
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
    delete: "Удалить",
    noPermission: "Изменять задачу может только её автор или вышестоящий сотрудник",
    moveTo: "Изменить статус",
    unplanned: "Без даты",
    more: "ещё",
    patient: "Пациент",
    provider: "Провайдер",
    activeTasks: "Активные",
    archivedTasks: "Архив",
    allTasks: "Все",
    archive: "В архив",
    restore: "Восстановить",
    archived: "В архиве",
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

function taskAccent(priority: string) {
  if (priority === "urgent") return "border-l-rose-400";
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
  deleting,
  archiving,
  canModify,
  onOpen,
  onEdit,
  onDelete,
  onArchive,
  onRestore,
  onStatusChange,
}: {
  task: ConciergeTask;
  lang: Lang;
  now: Date;
  compact?: boolean;
  updating: boolean;
  deleting: boolean;
  archiving: boolean;
  canModify: boolean;
  onOpen: (task: ConciergeTask) => void;
  onEdit: (task: ConciergeTask) => void;
  onDelete: (task: ConciergeTask) => void;
  onArchive: (task: ConciergeTask) => void;
  onRestore: (task: ConciergeTask) => void;
  onStatusChange: (task: ConciergeTask, status: string) => void;
}) {
  const labels = copy[lang];
  const scheduled = conciergeTaskScheduledAt(task);
  const overdue = isConciergeTaskOverdue(task, now);
  const archived = Boolean(task.archived_at);
  const terminal = task.status === "completed" || task.status === "cancelled";
  return (
    <article className={cn("relative min-w-0 max-w-full overflow-hidden rounded-lg border border-l-[3px] border-border/70 bg-card p-3 shadow-sm transition-[border-color,box-shadow] hover:shadow-md", taskAccent(task.priority), compact && "grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center")}>
      <button type="button" className={cn("min-w-0 w-full max-w-full overflow-hidden text-left", compact && "col-span-2 sm:col-span-1")} onClick={() => onOpen(task)}>
        <div className={cn("flex flex-wrap items-center gap-1.5", !compact && "pr-52")}>
          <Badge variant="outline" className="rounded-full font-mono text-[10px] text-muted-foreground">{conciergeTaskCode(task)}</Badge>
          <Badge variant="outline" className={cn("rounded-full text-[10px]", priorityTone(task.priority))}>{labels[task.priority as keyof typeof labels] ?? task.priority}</Badge>
          <Badge variant="secondary" className="rounded-full text-[10px]">{task.kind === "event" ? labels.event : labels.task}</Badge>
          <Badge variant="outline" className={cn("rounded-full text-[10px]", task.task_audience === "external" ? "border-violet-200 bg-violet-50 text-violet-700" : "border-slate-200 bg-slate-50 text-slate-700")}>{task.task_audience === "external" ? labels.external : labels.internal}</Badge>
          {task.patient_name ? (
            <Badge
              variant="outline"
              className="max-w-full rounded-full border-emerald-200 bg-emerald-50 text-[10px] text-emerald-800"
              title={`${labels.patient}: ${task.patient_name}`}
            >
              <UserRound className="size-3 shrink-0" />
              <span className="truncate">{labels.patient}: {task.patient_name}</span>
            </Badge>
          ) : null}
          {task.provider_name ? (
            <Badge
              variant="outline"
              className="max-w-full rounded-full border-amber-200 bg-amber-50 text-[10px] text-amber-800"
              title={`${labels.provider}: ${task.provider_name}`}
            >
              <Building2 className="size-3 shrink-0" />
              <span className="truncate">{labels.provider}: {task.provider_name}</span>
            </Badge>
          ) : null}
          {overdue ? <Badge variant="outline" className="rounded-full border-rose-200 bg-rose-50 text-[10px] text-rose-700">{labels.overdue}</Badge> : null}
          {archived ? <Badge variant="outline" className="rounded-full border-slate-300 bg-slate-100 text-[10px] text-slate-700">{labels.archived}</Badge> : null}
        </div>
        <h3 className="mt-2 min-w-0 max-w-full whitespace-normal break-words text-sm font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">{task.title}</h3>
        <div className="mt-2 space-y-1.5 rounded-md bg-muted/35 p-2.5 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{scheduled ? formatDateTime(scheduled, lang) : labels.unplanned}</p>
          <p className="truncate"><UsersRound className="mr-1.5 inline size-3.5" />{task.assigned_to_name}</p>
          {task.task_audience === "external" && task.external_assignee_name ? <p className="truncate font-medium text-foreground">{task.external_assignee_name}</p> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
          <span><ListChecks className="mr-1 inline size-3" />{labels.checklist}: {task.checklist_completed ?? 0}/{task.checklist_total ?? 0}</span>
          <span><MessageSquareText className="mr-1 inline size-3" />{labels.comments}: {task.comment_count ?? 0}</span>
          {task.reminder_at ? <span><CircleAlert className="mr-1 inline size-3" />{labels.reminder}</span> : null}
        </div>
      </button>
      <div className={cn("flex items-center gap-1", !compact && "absolute right-2 top-2 z-10")}>
        {archived ? (
          <Button type="button" size="sm" variant="outline" className="h-8 rounded-md px-2 text-xs" disabled={!canModify || archiving} title={canModify ? labels.restore : labels.noPermission} onClick={() => onRestore(task)}><ArchiveRestore />{labels.restore}</Button>
        ) : terminal ? (
          <Button type="button" size="sm" variant="outline" className="h-8 rounded-md px-2 text-xs" disabled={!canModify || archiving} title={canModify ? labels.archive : labels.noPermission} onClick={() => onArchive(task)}><Archive />{labels.archive}</Button>
        ) : null}
        {!archived ? <Button type="button" size="icon-sm" variant="ghost" className="h-8 rounded-md" disabled={!canModify || updating || deleting || archiving} title={canModify ? labels.edit : labels.noPermission} aria-label={labels.edit} onClick={() => onEdit(task)}><Pencil /></Button> : null}
        {!archived ? <Button type="button" size="icon-sm" variant="ghost" className="h-8 rounded-md text-destructive hover:text-destructive" disabled={!canModify || updating || deleting || archiving} title={canModify ? labels.delete : labels.noPermission} aria-label={labels.delete} onClick={() => onDelete(task)}><Trash2 /></Button> : null}
      </div>
      <SelectField
        className="h-8 min-w-[130px] rounded-md bg-background text-xs"
        value={task.status}
        disabled={archived || !canModify || updating || deleting || archiving}
        title={canModify ? labels.moveTo : labels.noPermission}
        aria-label={labels.moveTo}
        options={statuses.map((status) => ({ value: status, label: labels[status] }))}
        onValueChange={(status) => onStatusChange(task, status)}
      />
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
  deletingTaskId,
  archivingTaskId,
  canModifyTask,
  onEdit,
  onDelete,
  onArchive,
  onRestore,
  onOpen,
  onStatusChange,
  onCreateAt,
}: {
  tasks: ConciergeTask[];
  assignees: ConciergeAssignee[];
  lang: Lang;
  now: Date;
  canManageTeam: boolean;
  updatingTaskId: string | null;
  deletingTaskId: string | null;
  archivingTaskId: string | null;
  canModifyTask: (task: ConciergeTask) => boolean;
  onEdit: (task: ConciergeTask) => void;
  onDelete: (task: ConciergeTask) => void;
  onArchive: (task: ConciergeTask) => void;
  onRestore: (task: ConciergeTask) => void;
  onOpen: (task: ConciergeTask) => void;
  onStatusChange: (task: ConciergeTask, status: string) => void;
  onCreateAt?: (date: Date) => void;
}) {
  const labels = copy[lang];
  const [view, setView] = useState<TaskView>("board");
  const [calendarScale, setCalendarScale] = useState<CalendarScale>("month");
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [clock, setClock] = useState(() => Date.now());
  const [filters, setFilters] = useState<ConciergeTaskFilters>({ query: "", assignee: "all", status: "all", priority: "all", kind: "all", audience: "all", timing: "all", archive: "active" });
  const effectiveNow = useMemo(() => new Date(Math.max(now.getTime(), clock)), [clock, now]);
  const filtered = useMemo(() => sortConciergeTasks(filterConciergeTasks(tasks, filters, effectiveNow)), [effectiveNow, filters, tasks]);
  const workload = useMemo(() => conciergeTaskWorkload(tasks, assignees, effectiveNow), [assignees, effectiveNow, tasks]);
  const days = useMemo(() => calendarDays(calendarScale, focusDate), [calendarScale, focusDate]);
  const visibleStatuses = filters.archive === "archived"
    ? statuses.filter((status) => status === "completed" || status === "cancelled")
    : statuses;
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

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  function shiftCalendar(direction: number) {
    const next = new Date(focusDate);
    if (calendarScale === "month") next.setMonth(next.getMonth() + direction);
    else next.setDate(next.getDate() + direction * (calendarScale === "week" ? 7 : 1));
    setFocusDate(next);
  }

  return (
    <section className="space-y-3" aria-label={labels.title}>
      {canManageTeam ? (
        <div className="rounded-lg border border-border/70 bg-card p-3">
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

      <div className="relative z-20 grid grid-cols-2 gap-2 rounded-lg border border-border/70 bg-card p-2.5 sm:flex sm:flex-nowrap sm:items-center sm:gap-1.5 sm:overflow-x-auto sm:px-3 sm:py-2">
        <div className="relative col-span-2 min-w-0 sm:col-auto sm:min-w-[240px] sm:flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="h-10 rounded-md bg-field pl-8 text-xs sm:h-8" value={filters.query} placeholder={labels.search} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} /></div>
        <SelectField className="h-10 min-w-0 text-xs sm:h-8 sm:w-[120px] sm:shrink-0" value={filters.archive} options={[{ value: "active", label: labels.activeTasks }, { value: "archived", label: labels.archivedTasks }, { value: "all", label: labels.allTasks }]} onValueChange={(archive) => setFilters((current) => ({ ...current, archive: archive as ConciergeTaskFilters["archive"] }))} />
        {canManageTeam ? <NativeComboboxSelect className="h-10 min-w-0 text-xs sm:h-8 sm:w-[145px] sm:shrink-0" value={filters.assignee} onChange={(event) => setFilters((current) => ({ ...current, assignee: event.target.value }))}><option value="all">{labels.allAssignees}</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}</NativeComboboxSelect> : null}
        <SelectField className="h-10 min-w-0 text-xs sm:h-8 sm:w-[130px] sm:shrink-0" value={filters.status} options={[{ value: "all", label: labels.allStatuses }, ...statuses.map((status) => ({ value: status, label: labels[status] }))]} onValueChange={(status) => setFilters((current) => ({ ...current, status }))} />
        <SelectField className="h-10 min-w-0 text-xs sm:h-8 sm:w-[140px] sm:shrink-0" value={filters.priority} options={[{ value: "all", label: labels.allPriorities }, ...["low", "normal", "high", "urgent"].map((priority) => ({ value: priority, label: labels[priority as keyof typeof labels] }))]} onValueChange={(priority) => setFilters((current) => ({ ...current, priority }))} />
        <SelectField className="h-10 min-w-0 text-xs sm:h-8 sm:w-[145px] sm:shrink-0" value={filters.kind} options={[{ value: "all", label: labels.allKinds }, { value: "task", label: labels.task }, { value: "event", label: labels.event }]} onValueChange={(kind) => setFilters((current) => ({ ...current, kind }))} />
        <SelectField className="h-10 min-w-0 text-xs sm:h-8 sm:w-[145px] sm:shrink-0" value={filters.audience} options={[{ value: "all", label: labels.allAudiences }, { value: "internal", label: labels.internal }, { value: "external", label: labels.external }]} onValueChange={(audience) => setFilters((current) => ({ ...current, audience }))} />
        <SelectField className="h-10 min-w-0 text-xs sm:h-8 sm:w-[125px] sm:shrink-0" value={filters.timing} options={[{ value: "all", label: labels.allTiming }, { value: "today", label: labels.today }, { value: "overdue", label: labels.overdue }, { value: "upcoming", label: labels.upcoming }]} onValueChange={(timing) => setFilters((current) => ({ ...current, timing: timing as ConciergeTaskFilters["timing"] }))} />
      </div>

      <div className="mx-auto grid w-full grid-cols-3 gap-1 sm:flex sm:w-fit">
        {([ ["board", ListChecks, labels.board], ["list", List, labels.list], ["calendar", CalendarDays, labels.calendar] ] as const).map(([value, Icon, label]) => <Button key={value} type="button" size="sm" variant={view === value ? "default" : "ghost"} className="h-9 min-w-0 rounded-md px-2 text-xs sm:h-8 sm:px-3" onClick={() => setView(value)}><Icon />{label}</Button>)}
      </div>

      {filtered.length === 0 && view !== "calendar" ? <div className="rounded-lg border border-dashed bg-card px-6 py-16 text-center text-sm text-muted-foreground">{labels.noTasks}</div> : null}

      {filtered.length > 0 && view === "board" ? (
        <div className={cn("grid items-start gap-3 md:grid-cols-2", visibleStatuses.length > 2 && "xl:grid-cols-4")}>
          {visibleStatuses.map((status) => {
            const rows = filtered.filter((task) => task.status === status);
            return <section key={status} className="min-w-0 rounded-lg border border-border/70 bg-muted/30 p-2"><div className="mb-2 flex items-center justify-between px-1"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{labels[status]}</h3><Badge variant="secondary" className="rounded-full">{rows.length}</Badge></div><div className="space-y-2">{rows.map((task) => <TaskCard key={task.id} task={task} lang={lang} now={effectiveNow} updating={updatingTaskId === task.id} deleting={deletingTaskId === task.id} archiving={archivingTaskId === task.id} canModify={canModifyTask(task)} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} onArchive={onArchive} onRestore={onRestore} onStatusChange={onStatusChange} />)}</div></section>;
          })}
        </div>
      ) : null}

      {filtered.length > 0 && view === "list" ? <div className="space-y-2">{filtered.map((task) => <TaskCard key={task.id} task={task} lang={lang} now={effectiveNow} compact updating={updatingTaskId === task.id} deleting={deletingTaskId === task.id} archiving={archivingTaskId === task.id} canModify={canModifyTask(task)} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} onArchive={onArchive} onRestore={onRestore} onStatusChange={onStatusChange} />)}</div> : null}

      {view === "calendar" ? (
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
                const visibleLimit = calendarScale === "month" ? 3 : 12;
                const hiddenCount = Math.max(0, rows.length - visibleLimit);
                const outsideMonth = calendarScale === "month" && day.getMonth() !== focusDate.getMonth();
                return (
                  <div key={day.toISOString()} className={cn("min-h-28 border-b border-r p-1.5", outsideMonth && "bg-muted/30 text-muted-foreground")}>
                    <button type="button" className={cn("mb-1 rounded px-1 text-xs font-medium hover:bg-primary/10", dateKey(day) === dateKey(effectiveNow) && "text-primary")} onClick={() => onCreateAt?.(day)}>
                      {new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", { weekday: calendarScale === "month" ? undefined : "short", day: "2-digit", month: calendarScale === "day" ? "long" : undefined }).format(day)}
                    </button>
                    <div className="space-y-1">
                      {rows.slice(0, visibleLimit).map((task) => (
                        <button key={task.id} type="button" className={cn("block w-full truncate rounded px-1.5 py-1 text-left text-[10px]", task.kind === "event" ? "bg-violet-100 text-violet-800" : "bg-sky-100 text-sky-800")} title={task.title} onClick={() => onOpen(task)}>{task.title}</button>
                      ))}
                      {hiddenCount > 0 ? (
                        <button type="button" className="block w-full rounded px-1.5 py-1 text-left text-[10px] font-semibold text-primary hover:bg-primary/5" onClick={() => setView("list")}>
                          +{hiddenCount} {labels.more}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
