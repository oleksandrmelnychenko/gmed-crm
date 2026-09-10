import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  FolderKanban,
  List,
  ListChecks,
  MessageSquareText,
  Pencil,
  Pause,
  Play,
  ChartNoAxesGantt,
  ReceiptText,
  Search,
  Trash2,
  UserRound,
  UsersRound,
  Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { SelectField } from "@/components/ui/select-field";
import { Section } from "@/components/ui-shell";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { localizeTaskTitle } from "@/lib/task-labels";

import {
  COMPLETED_TASK_VISIBLE_DAYS,
  conciergeTaskCode,
  conciergeTaskInterval,
  conciergeTaskWorkload,
  filterConciergeTasks,
  isConciergeTaskPastCompletedVisibility,
  isConciergeTaskOverdue,
  sortConciergeTasks,
  type ConciergeAssignee,
  type ConciergeTask,
  type ConciergeTaskFilters,
  type ConciergeTaskStatus,
} from "./model";
import {
  isoWeekNumber,
  taskCalendarDays,
  taskCalendarWeeks,
  taskOccursOnDay,
  type TaskCalendarScale,
} from "./task-calendar";
import { TaskTimeline } from "./task-timeline";
import { TaskWorkflowDialog } from "./task-workflow-dialog";
import { taskWorkflowCounts } from "./task-workflow";

type TaskView = "board" | "list" | "calendar" | "timeline";
type CalendarScale = TaskCalendarScale;

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
    on_hold: "Pausiert",
    pause: "Pausieren",
    resume: "Fortsetzen",
    start: "Starten",
    begins: "Beginn",
    ends: "Ende",
    timeline: "Zeitplan",
    child: "Unteraufgabe",
    review: "Zur Prüfung",
    completed: "Erledigt",
    cancelled: "Storniert",
    low: "Niedrig",
    normal: "Normal",
    high: "Hoch",
    urgent: "Dringend",
    task: "Aufgabe",
    event: "Termin",
    noTasks: "Keine Aufgaben für die gewählten Filter",
    noActiveTasks: "Derzeit sind keine aktiven Aufgaben vorhanden",
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
    noStatusPermission: "Nur der Zuständige, der Ersteller oder eine übergeordnete Rolle darf den Status ändern",
    moveTo: "Status ändern",
    unplanned: "Ohne Termin",
    more: "weitere",
    showLess: "Weniger anzeigen",
    patient: "Patient",
    provider: "Anbieter",
    project: "Projekt",
    expenses: "Ausgaben",
    addExpense: "Ausgabe / Beleg",
    linkServiceForExpense: "Service verknüpfen und Ausgabe erfassen",
    activeTasks: "Aktiv",
    archivedTasks: "Archiv",
    allTasks: "Alle",
    archive: "Archivieren",
    restore: "Wiederherstellen",
    archived: "Archiviert",
    completedVisibilityHint: "Seit mindestens {days} Tagen erledigte Aufgaben sind ausgeblendet: {count}.",
    showCompleted: "Erledigte anzeigen",
    calendarWeekShort: "KW",
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
    on_hold: "На паузе",
    pause: "На паузу",
    resume: "Продолжить",
    start: "Начать",
    begins: "Начало",
    ends: "Окончание",
    timeline: "Таймлайн",
    child: "Подзадача",
    review: "На проверке",
    completed: "Выполнено",
    cancelled: "Отменено",
    low: "Низкий",
    normal: "Обычный",
    high: "Высокий",
    urgent: "Срочный",
    task: "Задача",
    event: "Событие",
    noTasks: "Для выбранных фильтров задач нет",
    noActiveTasks: "Активных задач пока нет",
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
    noStatusPermission: "Статус может менять исполнитель, автор или вышестоящий сотрудник",
    moveTo: "Изменить статус",
    unplanned: "Без даты",
    more: "ещё",
    showLess: "Свернуть",
    patient: "Пациент",
    provider: "Провайдер",
    project: "Проект",
    expenses: "Расходы",
    addExpense: "Расход / документ",
    linkServiceForExpense: "Привязать сервис и добавить расход",
    activeTasks: "Активные",
    archivedTasks: "Архив",
    allTasks: "Все",
    archive: "В архив",
    restore: "Восстановить",
    archived: "В архиве",
    completedVisibilityHint: "Выполненные {days} и более дней назад задачи скрыты: {count}.",
    showCompleted: "Показать выполненные",
    calendarWeekShort: "Нед.",
  },
} as const;

const statuses = ["open", "in_progress", "on_hold", "review", "completed", "cancelled"] as const;

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function CalendarTaskButton({ task, lang, onOpen }: { task: ConciergeTask; lang: Lang; onOpen: (task: ConciergeTask) => void }) {
  const labels = copy[lang];
  const { start, end } = conciergeTaskInterval(task);
  const period = `${labels.begins}: ${formatDateTime(start, lang)} · ${labels.ends}: ${formatDateTime(end, lang)}`;
  return <button type="button" className={cn("block w-full rounded border px-1.5 py-1 text-left text-[10px]", task.status === "on_hold" ? "border-dashed border-amber-400 bg-amber-50 text-amber-800" : task.kind === "event" ? "border-transparent bg-violet-100 text-violet-800" : "border-transparent bg-muted text-foreground")} title={`${localizeTaskTitle(task.title, lang)} · ${period} · ${labels[task.status]}`} onClick={() => onOpen(task)}>
    <span className="block truncate font-medium">{task.status === "on_hold" ? <Pause className="mr-1 inline size-3" /> : null}{localizeTaskTitle(task.title, lang)}</span>
    <span className="block truncate">{formatDateTime(start, lang)} — {formatDateTime(end, lang)}</span>
  </button>;
}

function taskAccent(priority: string) {
  if (priority === "urgent") return "border-l-rose-400";
  if (priority === "high") return "border-l-orange-400";
  if (priority === "low") return "border-l-slate-300";
  return "border-l-sky-400";
}

function assigneeRoleTone(role?: string) {
  if (role === "ceo") return "border-rose-200 bg-rose-50 text-rose-700";
  if (role === "ceo_assistant") return "border-amber-200 bg-amber-50 text-amber-700";
  if (role === "billing") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (role === "patient_manager") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (role === "sales") return "border-blue-200 bg-blue-50 text-blue-700";
  if (role === "teamlead_interpreter") return "border-violet-200 bg-violet-50 text-violet-700";
  if (role === "interpreter") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (role === "concierge") return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function TaskCard({
  task,
  parentTask,
  subCount,
  assignedToRole,
  lang,
  now,
  compact = false,
  updating,
  deleting,
  archiving,
  canModify,
  canDelete,
  canChangeStatus,
  canAddExpense,
  availableStatuses,
  onOpen,
  onEdit,
  onDelete,
  onArchive,
  onRestore,
  onExpense,
  onStatusChange,
  onWorkflow,
}: {
  task: ConciergeTask;
  parentTask?: ConciergeTask;
  subCount?: { total: number; paused: number };
  assignedToRole?: string;
  lang: Lang;
  now: Date;
  compact?: boolean;
  updating: boolean;
  deleting: boolean;
  archiving: boolean;
  canModify: boolean;
  canDelete: boolean;
  canChangeStatus: boolean;
  canAddExpense: boolean;
  availableStatuses: ConciergeTaskStatus[];
  onOpen: (task: ConciergeTask) => void;
  onEdit: (task: ConciergeTask) => void;
  onDelete: (task: ConciergeTask) => void;
  onArchive: (task: ConciergeTask) => void;
  onRestore: (task: ConciergeTask) => void;
  onExpense: (task: ConciergeTask) => void;
  onStatusChange: (task: ConciergeTask, status: string) => void;
  onWorkflow: (task: ConciergeTask) => void;
}) {
  const labels = copy[lang];
  const interval = conciergeTaskInterval(task);
  const overdue = isConciergeTaskOverdue(task, now);
  const archived = Boolean(task.archived_at);
  const terminal = task.status === "completed" || task.status === "cancelled";
  const workflowLabel = lang === "ru" ? "Процесс задачи" : "Aufgabenablauf";
  const countLabel = lang === "ru" ? "Подзадачи и события" : "Unteraufgaben und Termine";
  const parentLabel = lang === "ru" ? "В составе" : "Gehört zu";
  return (
    <article tabIndex={-1} data-task-card-id={task.id} data-testid={`task-card-${task.id}`} className={cn("relative min-w-0 max-w-full overflow-hidden rounded-lg border border-l-[3px] border-border/70 bg-card p-3 shadow-sm transition-[border-color,box-shadow] hover:shadow-md focus:outline-2 focus:outline-primary focus:outline-offset-2", taskAccent(task.priority), compact && "grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center")}>
      <div className={cn("min-w-0", compact && "col-span-2 sm:col-span-1")}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
        <button type="button" title={conciergeTaskCode(task)} onClick={() => onOpen(task)}><Badge variant="outline" className="rounded-full font-mono text-[10px] text-muted-foreground">{conciergeTaskCode(task)}</Badge></button>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {archived ? (
          <Button type="button" size="sm" variant="outline" className="h-8 rounded-md px-2 text-xs" disabled={!canModify || archiving} title={canModify ? labels.restore : labels.noPermission} onClick={() => onRestore(task)}><ArchiveRestore /><span className={cn(!compact && "sr-only")}>{labels.restore}</span></Button>
        ) : terminal ? (
          <Button type="button" size="sm" variant="outline" className="h-8 rounded-md px-2 text-xs" disabled={!canModify || archiving} title={canModify ? labels.archive : labels.noPermission} onClick={() => onArchive(task)}><Archive /><span className={cn(!compact && "sr-only")}>{labels.archive}</span></Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 rounded-md px-1.5 text-primary hover:text-primary" data-workflow-task-id={task.id} title={`${countLabel}: ${subCount?.total ?? 0}${subCount?.paused ? ` · ${labels.on_hold}: ${subCount.paused}` : ""}`} aria-label={`${workflowLabel} · ${countLabel}: ${subCount?.total ?? 0}`} onClick={() => onWorkflow(task)}><Workflow /><span data-testid={`task-sub-count-${task.id}`} className="min-w-4 rounded-full bg-primary/10 px-1 font-mono text-[10px] leading-4">{subCount?.total ?? 0}</span></Button>
        {!archived ? <Button type="button" size="icon-sm" variant="ghost" className="h-8 rounded-md" disabled={!canModify || updating || deleting || archiving} title={canModify ? labels.edit : labels.noPermission} aria-label={labels.edit} onClick={() => onEdit(task)}><Pencil /></Button> : null}
        {!archived && canDelete ? <Button type="button" size="icon-sm" variant="ghost" className="h-8 rounded-md text-destructive hover:text-destructive" disabled={updating || deleting || archiving} title={labels.delete} aria-label={labels.delete} onClick={() => onDelete(task)}><Trash2 /></Button> : null}
      </div>
      </div>
      <button type="button" className="min-w-0 w-full max-w-full overflow-hidden text-left" onClick={() => onOpen(task)}>
        <div className="flex flex-wrap items-center gap-1.5">
          {task.parent_task_id ? <Badge variant="outline" className={cn("rounded-full text-[10px]", task.kind === "event" ? "border-violet-200 bg-violet-50 text-violet-700" : "border-orange-200 bg-orange-50 text-orange-700")}>↳ {task.kind === "event" ? labels.event : labels.child}</Badge> : null}
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
          {task.project_name ? (
            <Badge
              variant="outline"
              className="max-w-full rounded-full border-orange-200 bg-orange-50 text-[10px] text-orange-800"
              title={`${labels.project}: ${task.project_name}`}
            >
              <FolderKanban className="size-3 shrink-0" />
              <span className="truncate">{task.project_name}</span>
            </Badge>
          ) : null}
          {task.concierge_service_id ? (
            <Badge
              variant="outline"
              className="rounded-full border-cyan-200 bg-cyan-50 text-[10px] text-cyan-800"
              title={labels.expenses}
            >
              <ReceiptText className="size-3 shrink-0" />
              {labels.expenses}
            </Badge>
          ) : null}
          {overdue ? <Badge variant="outline" className="rounded-full border-rose-200 bg-rose-50 text-[10px] text-rose-700">{labels.overdue}</Badge> : null}
          {archived ? <Badge variant="outline" className="rounded-full border-slate-300 bg-slate-100 text-[10px] text-slate-700">{labels.archived}</Badge> : null}
        </div>
        <h3 className="mt-2 min-w-0 max-w-full whitespace-normal break-words text-sm font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">{localizeTaskTitle(task.title, lang)}</h3>
        <div className="mt-2 space-y-1.5 rounded-md bg-muted/35 p-2.5 text-xs text-muted-foreground">
          <div className="flex items-start gap-1.5">
            <Clock3 className="mt-1 size-3.5 shrink-0" />
            <div className="@container/task-times min-w-0 flex-1 space-y-1.5">
              {([[labels.begins, interval.start], [labels.ends, interval.end]] as const).map(([label, date], index) => (
                <div key={label} className="grid grid-cols-1 items-center gap-x-2 gap-y-1 @[12rem]/task-times:grid-cols-[minmax(0,1fr)_auto]">
                  <span className="min-w-0">{label}:{date ? null : " —"}</span>
                  {date ? <Badge variant="outline" className={cn("shrink-0 justify-self-start rounded-full font-mono text-[10px] tabular-nums @[12rem]/task-times:justify-self-end", index === 1 && overdue ? "border-rose-200 bg-rose-50 text-rose-700" : "border-border/70 bg-background text-foreground")}><time dateTime={date.toISOString()}>{formatDateTime(date, lang).replace(/[.,]/g, "")}</time></Badge> : null}
                </div>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <UsersRound className="size-3.5 shrink-0" />
            <Badge
              variant="outline"
              className={cn("min-w-0 max-w-full rounded-full text-[10px] font-medium", assigneeRoleTone(assignedToRole))}
              title={task.assigned_to_name}
            >
              <span className="truncate">{task.assigned_to_name}</span>
            </Badge>
          </div>
          {task.task_audience === "external" && task.external_assignee_name ? <p className="truncate font-medium text-foreground">{task.external_assignee_name}</p> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
          <span><ListChecks className="mr-1 inline size-3" />{labels.checklist}: {task.checklist_completed ?? 0}/{task.checklist_total ?? 0}</span>
          <span><MessageSquareText className="mr-1 inline size-3" />{labels.comments}: {task.comment_count ?? 0}</span>
          {task.reminder_at ? <span><CircleAlert className="mr-1 inline size-3" />{labels.reminder}</span> : null}
        </div>
      </button>
      {parentTask ? <button type="button" className="mt-2 flex w-full min-w-0 items-center gap-1.5 rounded-md border border-primary/15 bg-primary/5 px-2 py-1.5 text-left text-[10px] text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary" title={`${parentLabel}: ${localizeTaskTitle(parentTask.title, lang)}`} onClick={() => onWorkflow(parentTask)}><Workflow className="size-3 shrink-0" /><span className="truncate">{parentLabel}: {localizeTaskTitle(parentTask.title, lang)}</span><ArrowUpRight className="ml-auto size-3 shrink-0" /></button> : null}
      </div>
      <div className={cn("space-y-1.5", compact && "col-span-2 sm:col-span-1")}>
        {!archived && ["open", "in_progress", "on_hold"].includes(task.status) ? (
          <Button type="button" size="sm" variant={task.status === "in_progress" ? "outline" : "default"} className="h-8 w-full text-xs" disabled={!canChangeStatus || updating || deleting || archiving || !availableStatuses.includes(task.status === "in_progress" ? "on_hold" : "in_progress")} onClick={() => onStatusChange(task, task.status === "in_progress" ? "on_hold" : "in_progress")}>
            {task.status === "in_progress" ? <Pause /> : <Play />}{task.status === "in_progress" ? labels.pause : task.status === "on_hold" ? labels.resume : labels.start}
          </Button>
        ) : null}
        <SelectField
          className="h-8 min-w-[130px] rounded-md bg-background text-xs"
          value={archived ? "archived" : task.status}
          disabled={archived || !canChangeStatus || updating || deleting || archiving}
          title={canChangeStatus ? labels.moveTo : labels.noStatusPermission}
          aria-label={labels.moveTo}
          options={archived
            ? [{ value: "archived", label: labels.archived }]
            : [
                ...availableStatuses.map((status) => ({ value: status, label: labels[status] })),
                ...(task.status === "completed" && canModify ? [{ value: "archive", label: labels.archive }] : []),
              ]}
          onValueChange={(status) => {
            if (status === "archive") {
              if (task.status === "completed" && canModify) onArchive(task);
            } else onStatusChange(task, status);
          }}
        />
        {!archived && canAddExpense ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-full justify-center rounded-md px-2 text-xs text-cyan-800 hover:bg-cyan-50 hover:text-cyan-900"
            disabled={updating || deleting || archiving}
            title={labels.addExpense}
            onClick={() => onExpense(task)}
          >
            <ReceiptText />
            {labels.addExpense}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export function ConciergeTaskManager({
  tasks,
  refreshing,
  assignees,
  lang,
  now,
  canManageTeam,
  updatingTaskId,
  deletingTaskId,
  archivingTaskId,
  canModifyTask,
  canDeleteTask,
  canChangeTaskStatus,
  canAddExpenseToTask,
  availableStatusesForTask,
  onEdit,
  onDelete,
  onArchive,
  onRestore,
  onOpen,
  onExpense,
  onStatusChange,
  onCreateAt,
}: {
  tasks: ConciergeTask[];
  refreshing: boolean;
  assignees: ConciergeAssignee[];
  lang: Lang;
  now: Date;
  canManageTeam: boolean;
  updatingTaskId: string | null;
  deletingTaskId: string | null;
  archivingTaskId: string | null;
  canModifyTask: (task: ConciergeTask) => boolean;
  canDeleteTask: (task: ConciergeTask) => boolean;
  canChangeTaskStatus: (task: ConciergeTask) => boolean;
  canAddExpenseToTask: (task: ConciergeTask) => boolean;
  availableStatusesForTask: (task: ConciergeTask) => ConciergeTaskStatus[];
  onEdit: (task: ConciergeTask) => void;
  onDelete: (task: ConciergeTask) => void;
  onArchive: (task: ConciergeTask) => void;
  onRestore: (task: ConciergeTask) => void;
  onOpen: (task: ConciergeTask) => void;
  onExpense: (task: ConciergeTask) => void;
  onStatusChange: (task: ConciergeTask, status: string) => Promise<string | null>;
  onCreateAt?: (date: Date) => void;
}) {
  const labels = copy[lang];
  const [view, setView] = useState<TaskView>("board");
  const [workflowTaskId, setWorkflowTaskId] = useState<string | null>(null);
  const [focusBoardTaskId, setFocusBoardTaskId] = useState<string | null>(null);
  const [calendarScale, setCalendarScale] = useState<CalendarScale>("month");
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [expandedCalendarDays, setExpandedCalendarDays] = useState<Set<string>>(
    () => new Set(),
  );
  const [clock, setClock] = useState(() => Date.now());
  const [filters, setFilters] = useState<ConciergeTaskFilters>({ query: "", assignee: "all", status: "all", priority: "all", kind: "all", audience: "all", timing: "all", archive: "active" });
  const effectiveNow = useMemo(() => new Date(Math.max(now.getTime(), clock)), [clock, now]);
  const filtered = useMemo(() => sortConciergeTasks(filterConciergeTasks(tasks, filters, effectiveNow)), [effectiveNow, filters, tasks]);
  const tasksById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks]);
  const subCounts = useMemo(() => taskWorkflowCounts(tasks), [tasks]);
  useEffect(() => {
    if (!focusBoardTaskId || view !== "board") return;
    const frame = requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(`[data-task-card-id="${CSS.escape(focusBoardTaskId)}"]`);
      if (!card) return;
      card.scrollIntoView({ block: "center", inline: "center" });
      card.focus({ preventScroll: true });
      setFocusBoardTaskId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusBoardTaskId, view]);
  function showOnBoard(task: ConciergeTask) {
    setWorkflowTaskId(null);
    setView("board");
    if (!filtered.some(row => row.id === task.id)) {
      setFilters({ query: "", assignee: "all", status: task.status, priority: "all", kind: "all", audience: "all", timing: "all", archive: task.archived_at ? "archived" : "active" });
    }
    setFocusBoardTaskId(task.id);
  }
  const hiddenCompletedCount = useMemo(() => {
    if (filters.archive !== "active" || filters.status !== "all" || filters.query.trim()) return 0;
    return filterConciergeTasks(tasks, { ...filters, status: "completed" }, effectiveNow)
      .filter((task) => isConciergeTaskPastCompletedVisibility(task, effectiveNow)).length;
  }, [effectiveNow, filters, tasks]);
  const workload = useMemo(() => conciergeTaskWorkload(tasks, assignees, effectiveNow), [assignees, effectiveNow, tasks]);
  const assigneeRoles = useMemo(() => new Map(assignees.map((assignee) => [assignee.id, assignee.role])), [assignees]);
  const days = useMemo(() => taskCalendarDays(calendarScale, focusDate), [calendarScale, focusDate]);
  const calendarWeeks = useMemo(() => taskCalendarWeeks(days), [days]);
  const calendarLocale = lang === "de" ? "de-DE" : "ru-RU";
  const weekdayLabels = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(calendarLocale, { weekday: "short" }).format(new Date(2026, 0, 5 + index)));
  }, [calendarLocale]);
  const visibleStatuses = filters.archive === "archived"
    ? statuses.filter((status) => status === "completed" || status === "cancelled")
    : statuses;
  const hasCustomFilters = Boolean(
    filters.query.trim()
      || filters.archive !== "active"
      || filters.assignee !== "all"
      || filters.status !== "all"
      || filters.priority !== "all"
      || filters.kind !== "all"
      || filters.audience !== "all"
      || filters.timing !== "all",
  );
  const tasksByDay = useMemo(() => {
    const result = new Map<string, ConciergeTask[]>();
    days.forEach((day) => result.set(dateKey(day), filtered.filter((task) => taskOccursOnDay(task, day))));
    return result;
  }, [days, filtered]);

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

  function toggleCalendarDay(key: string) {
    setExpandedCalendarDays((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className="space-y-3" aria-label={labels.title}>
      {canManageTeam ? (
        <Section title={labels.teamWorkload} className="rounded-lg border border-border/70 bg-card p-3">
          <div className="px-1">
            <div role="tablist" aria-label={labels.teamWorkload} className="flex w-full flex-wrap justify-center gap-1">
              <Button
                type="button"
                role="tab"
                size="sm"
                variant={filters.assignee === "all" ? "default" : "ghost"}
                aria-selected={filters.assignee === "all"}
                className="h-9 shrink-0 rounded-md px-3 text-xs"
                onClick={() => setFilters((current) => ({ ...current, assignee: "all" }))}
              >
                {labels.allAssignees}
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-full px-1.5 text-[10px] tabular-nums",
                    filters.assignee === "all"
                      ? "border-white/25 bg-white/15 text-primary-foreground"
                      : "border-border/70 bg-background text-muted-foreground",
                  )}
                >
                  {workload.reduce((total, item) => total + item.active, 0)}
                </Badge>
              </Button>
            {workload.map(({ assignee, active: assigneeActive, overdue: assigneeOverdue, today }) => (
              <Button
                key={assignee.id}
                type="button"
                role="tab"
                size="sm"
                variant={filters.assignee === assignee.id ? "default" : "ghost"}
                aria-selected={filters.assignee === assignee.id}
                aria-label={`${assignee.name}. ${labels.active}: ${assigneeActive}. ${labels.today}: ${today}. ${labels.overdue}: ${assigneeOverdue}.`}
                className="h-9 shrink-0 rounded-md px-3 text-xs"
                onClick={() => setFilters((current) => ({ ...current, assignee: assignee.id }))}
              >
                <span className="max-w-44 truncate">{assignee.name}</span>
                <Badge
                  variant="outline"
                  title={`${labels.active}: ${assigneeActive}`}
                  className={cn(
                    "rounded-full px-1.5 text-[10px] tabular-nums",
                    filters.assignee === assignee.id
                      ? "border-white/25 bg-white/15 text-primary-foreground"
                      : "border-border/70 bg-background text-muted-foreground",
                  )}
                >
                  {assigneeActive}
                </Badge>
                {today > 0 ? (
                  <Badge variant="outline" title={`${labels.today}: ${today}`} className="rounded-full border-amber-200 bg-amber-50 px-1.5 text-[10px] text-amber-700 tabular-nums">
                    {today}
                  </Badge>
                ) : null}
                {assigneeOverdue > 0 ? (
                  <Badge variant="outline" title={`${labels.overdue}: ${assigneeOverdue}`} className="rounded-full border-rose-200 bg-rose-50 px-1.5 text-[10px] text-rose-700 tabular-nums">
                    {assigneeOverdue}
                  </Badge>
                ) : null}
              </Button>
            ))}
            </div>
          </div>
        </Section>
      ) : null}

      <div className="relative z-20 grid grid-cols-2 gap-2 rounded-lg border border-border/70 bg-card p-2.5 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-8 2xl:px-3 2xl:py-2">
        <div className="relative col-span-2 min-w-0"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input aria-label={labels.search} className="h-10 rounded-md bg-field pl-8 text-xs 2xl:h-8" value={filters.query} placeholder={labels.search} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} /></div>
        <SelectField aria-label={labels.activeTasks} className="h-10 min-w-0 text-xs 2xl:h-8" value={filters.archive} options={[{ value: "active", label: labels.activeTasks }, { value: "archived", label: labels.archivedTasks }, { value: "all", label: labels.allTasks }]} onValueChange={(archive) => setFilters((current) => ({ ...current, archive: archive as ConciergeTaskFilters["archive"] }))} />
        {canManageTeam ? <NativeComboboxSelect aria-label={labels.allAssignees} className="h-10 min-w-0 text-xs 2xl:h-8" value={filters.assignee} onChange={(event) => setFilters((current) => ({ ...current, assignee: event.target.value }))}><option value="all">{labels.allAssignees}</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}</NativeComboboxSelect> : null}
        <SelectField aria-label={labels.allStatuses} className="h-10 min-w-0 text-xs 2xl:h-8" value={filters.status} options={[{ value: "all", label: labels.allStatuses }, ...statuses.map((status) => ({ value: status, label: labels[status] }))]} onValueChange={(status) => setFilters((current) => ({ ...current, status }))} />
        <SelectField aria-label={labels.allPriorities} className="h-10 min-w-0 text-xs 2xl:h-8" value={filters.priority} options={[{ value: "all", label: labels.allPriorities }, ...["low", "normal", "high", "urgent"].map((priority) => ({ value: priority, label: labels[priority as keyof typeof labels] }))]} onValueChange={(priority) => setFilters((current) => ({ ...current, priority }))} />
        <SelectField aria-label={labels.allKinds} className="h-10 min-w-0 text-xs 2xl:h-8" value={filters.kind} options={[{ value: "all", label: labels.allKinds }, { value: "task", label: labels.task }, { value: "event", label: labels.event }]} onValueChange={(kind) => setFilters((current) => ({ ...current, kind }))} />
        <SelectField aria-label={labels.allAudiences} className="h-10 min-w-0 text-xs 2xl:h-8" value={filters.audience} options={[{ value: "all", label: labels.allAudiences }, { value: "internal", label: labels.internal }, { value: "external", label: labels.external }]} onValueChange={(audience) => setFilters((current) => ({ ...current, audience }))} />
        <SelectField aria-label={labels.allTiming} className="h-10 min-w-0 text-xs 2xl:h-8" value={filters.timing} options={[{ value: "all", label: labels.allTiming }, { value: "today", label: labels.today }, { value: "overdue", label: labels.overdue }, { value: "upcoming", label: labels.upcoming }]} onValueChange={(timing) => setFilters((current) => ({ ...current, timing: timing as ConciergeTaskFilters["timing"] }))} />
      </div>

      {hiddenCompletedCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
          <p>{labels.completedVisibilityHint.replace("{days}", String(COMPLETED_TASK_VISIBLE_DAYS)).replace("{count}", String(hiddenCompletedCount))}</p>
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setFilters((current) => ({ ...current, status: "completed" }))}>
            {labels.showCompleted}
          </Button>
        </div>
      ) : null}

      <div className="mx-auto grid w-full grid-cols-2 gap-1 sm:flex sm:w-fit">
        {([ ["board", ListChecks, labels.board], ["list", List, labels.list], ["calendar", CalendarDays, labels.calendar], ["timeline", ChartNoAxesGantt, labels.timeline] ] as const).map(([value, Icon, label]) => <Button key={value} type="button" size="sm" variant={view === value ? "default" : "ghost"} aria-pressed={view === value} className="h-9 min-w-0 rounded-md px-2 text-xs sm:h-8 sm:px-3" onClick={() => setView(value)}><Icon />{label}</Button>)}
      </div>

      {filtered.length === 0 && view !== "calendar" ? <div className="rounded-lg border border-dashed bg-card px-6 py-16 text-center text-sm text-muted-foreground">{hasCustomFilters ? labels.noTasks : labels.noActiveTasks}</div> : null}

      {filtered.length > 0 && view === "board" ? (
        <div className={cn("grid items-start gap-3 md:grid-cols-2", visibleStatuses.length > 2 && "xl:grid-cols-3 2xl:grid-cols-6")}>
          {visibleStatuses.map((status) => {
            const rows = filtered.filter((task) => task.status === status);
            return <section key={status} data-testid={`task-column-${status}`} className="min-w-0 rounded-lg border border-border/70 bg-muted/30 p-2"><div className="mb-2 flex items-center justify-between px-1"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{labels[status]}</h3><Badge variant="secondary" className="rounded-full">{rows.length}</Badge></div><div className="space-y-2">{rows.map((task) => <TaskCard key={task.id} task={task} parentTask={tasksById.get(task.parent_task_id ?? "")} subCount={subCounts.get(task.id)} assignedToRole={assigneeRoles.get(task.assigned_to)} lang={lang} now={effectiveNow} updating={updatingTaskId === task.id} deleting={deletingTaskId === task.id} archiving={archivingTaskId === task.id} canModify={canModifyTask(task)} canDelete={canDeleteTask(task)} canChangeStatus={canChangeTaskStatus(task)} canAddExpense={canAddExpenseToTask(task)} availableStatuses={availableStatusesForTask(task)} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} onArchive={onArchive} onRestore={onRestore} onExpense={onExpense} onStatusChange={onStatusChange} onWorkflow={(item) => setWorkflowTaskId(item.id)} />)}</div></section>;
          })}
        </div>
      ) : null}

      {filtered.length > 0 && view === "list" ? <div className="space-y-2">{filtered.map((task) => <TaskCard key={task.id} task={task} parentTask={tasksById.get(task.parent_task_id ?? "")} subCount={subCounts.get(task.id)} assignedToRole={assigneeRoles.get(task.assigned_to)} lang={lang} now={effectiveNow} compact updating={updatingTaskId === task.id} deleting={deletingTaskId === task.id} archiving={archivingTaskId === task.id} canModify={canModifyTask(task)} canDelete={canDeleteTask(task)} canChangeStatus={canChangeTaskStatus(task)} canAddExpense={canAddExpenseToTask(task)} availableStatuses={availableStatusesForTask(task)} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} onArchive={onArchive} onRestore={onRestore} onExpense={onExpense} onStatusChange={onStatusChange} onWorkflow={(item) => setWorkflowTaskId(item.id)} />)}</div> : null}

      {view === "timeline" ? <TaskTimeline tasks={filtered} lang={lang} now={effectiveNow} onOpen={onOpen} onStatusChange={onStatusChange} availableStatusesForTask={availableStatusesForTask} updatingTaskId={updatingTaskId} /> : null}

      {view === "calendar" ? (
        <div className="rounded-lg border border-border/70 bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
            <div className="flex items-center gap-1"><Button type="button" size="icon-sm" variant="ghost" onClick={() => shiftCalendar(-1)}><ChevronLeft /></Button><Button type="button" size="sm" variant="ghost" onClick={() => setFocusDate(new Date())}>{labels.today}</Button><Button type="button" size="icon-sm" variant="ghost" onClick={() => shiftCalendar(1)}><ChevronRight /></Button></div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="rounded-md tabular-nums">{labels.calendarWeekShort} {isoWeekNumber(focusDate)}</Badge>
              <h3 className="text-sm font-semibold">{new Intl.DateTimeFormat(calendarLocale, { month: "long", year: "numeric" }).format(focusDate)}</h3>
            </div>
            <div className="flex gap-1">{(["day", "week", "month"] as const).map((scale) => <Button key={scale} type="button" size="sm" variant={calendarScale === scale ? "secondary" : "ghost"} className="h-8 text-xs" onClick={() => setCalendarScale(scale)}>{labels[scale]}</Button>)}</div>
          </div>
          <div className="overflow-x-auto">
            {calendarScale === "day" ? (
              <div className="grid grid-cols-1">
                {days.map((day) => {
                  const key = dateKey(day);
                  const rows = tasksByDay.get(key) ?? [];
                  const visibleLimit = 12;
                  const hiddenCount = Math.max(0, rows.length - visibleLimit);
                  const expanded = expandedCalendarDays.has(key);
                  const visibleRows = expanded ? rows : rows.slice(0, visibleLimit);
                  return (
                    <div key={day.toISOString()} className="min-h-28 border-b p-1.5">
                      <button type="button" className={cn("mb-1 rounded px-1 text-xs font-medium hover:bg-primary/10", dateKey(day) === dateKey(effectiveNow) && "text-primary")} onClick={() => onCreateAt?.(day)}>
                        {new Intl.DateTimeFormat(calendarLocale, { weekday: "short", day: "2-digit", month: "long" }).format(day)}
                      </button>
                      <div className="space-y-1">
                        {visibleRows.map((task) => (
                          <CalendarTaskButton key={task.id} task={task} lang={lang} onOpen={onOpen} />
                        ))}
                        {hiddenCount > 0 ? (
                          <button type="button" className="block w-full rounded px-1.5 py-1 text-left text-[10px] font-semibold text-primary hover:bg-primary/5" aria-expanded={expanded} onClick={() => toggleCalendarDay(key)}>
                            {expanded ? labels.showLess : `+${hiddenCount} ${labels.more}`}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b bg-muted/25 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <div className="flex items-center justify-center border-r px-1 py-2">{labels.calendarWeekShort}</div>
                  {weekdayLabels.map((label) => <div key={label} className="border-r px-2 py-2 text-center last:border-r-0">{label}</div>)}
                </div>
                {calendarWeeks.map((week) => (
                  <div key={week[0]?.toISOString()} className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
                    <div className="flex min-h-28 items-start justify-center border-b border-r bg-muted/20 px-1 py-2 text-xs font-semibold tabular-nums text-muted-foreground">
                      {labels.calendarWeekShort} {isoWeekNumber(week[0] ?? focusDate)}
                    </div>
                    {week.map((day) => {
                      const key = dateKey(day);
                      const rows = tasksByDay.get(key) ?? [];
                      const visibleLimit = calendarScale === "month" ? 3 : 12;
                      const hiddenCount = Math.max(0, rows.length - visibleLimit);
                      const expanded = expandedCalendarDays.has(key);
                      const visibleRows = expanded ? rows : rows.slice(0, visibleLimit);
                      const outsideMonth = calendarScale === "month" && day.getMonth() !== focusDate.getMonth();
                      return (
                        <div key={day.toISOString()} className={cn("min-h-28 border-b border-r p-1.5 last:border-r-0", outsideMonth && "bg-muted/30 text-muted-foreground")}>
                          <button type="button" className={cn("mb-1 rounded px-1 text-xs font-medium hover:bg-primary/10", dateKey(day) === dateKey(effectiveNow) && "text-primary")} onClick={() => onCreateAt?.(day)}>
                            {new Intl.DateTimeFormat(calendarLocale, { day: "2-digit" }).format(day)}
                          </button>
                          <div className="space-y-1">
                            {visibleRows.map((task) => (
                              <CalendarTaskButton key={task.id} task={task} lang={lang} onOpen={onOpen} />
                            ))}
                            {hiddenCount > 0 ? (
                              <button type="button" className="block w-full rounded px-1.5 py-1 text-left text-[10px] font-semibold text-primary hover:bg-primary/5" aria-expanded={expanded} onClick={() => toggleCalendarDay(key)}>
                                {expanded ? labels.showLess : `+${hiddenCount} ${labels.more}`}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
      {workflowTaskId ? <TaskWorkflowDialog key={workflowTaskId} rootId={workflowTaskId} tasks={tasks} lang={lang} busy={refreshing || Boolean(updatingTaskId || deletingTaskId || archivingTaskId)} availableStatusesForTask={availableStatusesForTask} onStatusChange={onStatusChange} onOpen={onOpen} onShowOnBoard={showOnBoard} onClose={() => setWorkflowTaskId(null)} /> : null}
    </section>
  );
}
