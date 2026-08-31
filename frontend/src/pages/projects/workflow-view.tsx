import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  FolderKanban,
  GitBranch,
  Link2,
  LoaderCircle,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { useLang, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ConciergeTask, ConciergeTaskStatus } from "@/pages/concierge/model";

import type { Project, ProjectWorkflowDependency } from "./model";
import {
  availablePrerequisites,
  buildProjectWorkflowGraph,
  projectWorkflowStats,
  WORKFLOW_NODE_HEIGHT,
  WORKFLOW_NODE_WIDTH,
  WORKFLOW_STAGE_START_X,
  WORKFLOW_STAGE_WIDTH,
} from "./workflow-model";

const workflowCopy = {
  ru: {
    project: "Проект",
    selectProject: "Выберите проект",
    searchProject: "Поиск проекта",
    noProjects: "Сначала создайте проект, чтобы собрать его workflow.",
    noProjectsTitle: "Проектов пока нет",
    createProject: "Создать проект",
    workflow: "Workflow проекта",
    workflowHint: "Задачи, зависимости, блокеры и прогресс в одной схеме.",
    tasks: "Задачи",
    completed: "Готово",
    blocked: "Заблокировано",
    overdue: "Просрочено",
    progress: "Прогресс",
    owner: "Владелец",
    deadline: "Срок",
    noDeadline: "Без срока",
    start: "Старт проекта",
    startHint: "Задачи без зависимостей",
    open: "Открыто",
    in_progress: "В работе",
    review: "На проверке",
    cancelled: "Отменено",
    dependency: "Зависимость",
    dependencyResolved: "Зависимость выполнена",
    dependencyBlocking: "Ожидает предыдущую задачу",
    details: "Детали задачи",
    selectTask: "Выберите плитку на канвасе, чтобы увидеть связи задачи.",
    dependsOn: "Зависит от",
    unlocks: "Открывает следующие",
    noDependencies: "Нет предыдущих зависимостей",
    noFollowing: "Нет следующих зависимых задач",
    addDependency: "Добавить зависимость",
    dependencyTask: "Зависимая задача",
    prerequisite: "Сначала должна быть выполнена",
    selectTaskPlaceholder: "Выберите задачу",
    selectPrerequisite: "Выберите предыдущую задачу",
    dependencyHelp: "После сохранения связь появится на канвасе. Циклические связи запрещены.",
    saveDependency: "Связать задачи",
    removeDependency: "Удалить связь",
    removeTitle: "Удалить зависимость?",
    removeHint: "Задача больше не будет ждать выбранную предыдущую задачу.",
    remove: "Удалить",
    cancel: "Отмена",
    openTask: "Открыть задачу",
    createTask: "Создать задачу",
    emptyTitle: "В проекте пока нет задач",
    emptyHint: "Создайте первую задачу — она станет стартовой плиткой workflow.",
    allLinked: "Для этой задачи уже указаны все допустимые зависимости.",
    loadFailed: "Не удалось загрузить зависимости workflow.",
    saveFailed: "Не удалось сохранить зависимость.",
    removeFailed: "Не удалось удалить зависимость.",
    cycleError: "Эта связь создаст цикл. Выберите другую предыдущую задачу.",
    taskMismatchError: "Обе задачи должны относиться к выбранному проекту.",
    workflowForbidden: "Изменять связи может владелец или менеджер проекта.",
    checklist: "Чек-лист",
    comments: "Комментарии",
    attachments: "Файлы",
    linkedPatient: "Пациент",
    linkedProvider: "Провайдер",
    taskCode: "Задача",
    searchTask: "Найти задачу, исполнителя или ID",
    allTasks: "Все задачи",
    activeTasks: "Активные",
    blockedTasks: "С блокерами",
    overdueTasks: "Просроченные",
    shown: "Показано",
    noFilteredTasks: "По этим условиям задач нет",
    noFilteredTasksHint: "Измените поиск или фильтр, чтобы вернуть задачи на канвас.",
    clearFilters: "Сбросить фильтры",
    zoomIn: "Увеличить канвас",
    zoomOut: "Уменьшить канвас",
    resetZoom: "Сбросить масштаб",
  },
  de: {
    project: "Projekt",
    selectProject: "Projekt auswählen",
    searchProject: "Projekt suchen",
    noProjects: "Erstellen Sie zuerst ein Projekt, um den Workflow aufzubauen.",
    noProjectsTitle: "Noch keine Projekte",
    createProject: "Projekt erstellen",
    workflow: "Projekt-Workflow",
    workflowHint: "Aufgaben, Abhängigkeiten, Blocker und Fortschritt in einer Ansicht.",
    tasks: "Aufgaben",
    completed: "Erledigt",
    blocked: "Blockiert",
    overdue: "Überfällig",
    progress: "Fortschritt",
    owner: "Leitung",
    deadline: "Fällig",
    noDeadline: "Ohne Termin",
    start: "Projektstart",
    startHint: "Aufgaben ohne Abhängigkeiten",
    open: "Offen",
    in_progress: "In Arbeit",
    review: "In Prüfung",
    cancelled: "Storniert",
    dependency: "Abhängigkeit",
    dependencyResolved: "Abhängigkeit erfüllt",
    dependencyBlocking: "Wartet auf vorherige Aufgabe",
    details: "Aufgabendetails",
    selectTask: "Wählen Sie eine Kachel aus, um ihre Verknüpfungen zu sehen.",
    dependsOn: "Abhängig von",
    unlocks: "Ermöglicht danach",
    noDependencies: "Keine vorherigen Abhängigkeiten",
    noFollowing: "Keine nachfolgenden abhängigen Aufgaben",
    addDependency: "Abhängigkeit hinzufügen",
    dependencyTask: "Abhängige Aufgabe",
    prerequisite: "Muss zuerst erledigt sein",
    selectTaskPlaceholder: "Aufgabe auswählen",
    selectPrerequisite: "Vorherige Aufgabe auswählen",
    dependencyHelp: "Nach dem Speichern erscheint die Verbindung im Canvas. Zyklen sind nicht zulässig.",
    saveDependency: "Aufgaben verbinden",
    removeDependency: "Verknüpfung entfernen",
    removeTitle: "Abhängigkeit entfernen?",
    removeHint: "Die Aufgabe wartet danach nicht mehr auf die ausgewählte vorherige Aufgabe.",
    remove: "Entfernen",
    cancel: "Abbrechen",
    openTask: "Aufgabe öffnen",
    createTask: "Aufgabe erstellen",
    emptyTitle: "Noch keine Aufgaben im Projekt",
    emptyHint: "Erstellen Sie die erste Aufgabe – sie wird zur Startkachel des Workflows.",
    allLinked: "Für diese Aufgabe sind bereits alle zulässigen Abhängigkeiten angegeben.",
    loadFailed: "Workflow-Abhängigkeiten konnten nicht geladen werden.",
    saveFailed: "Abhängigkeit konnte nicht gespeichert werden.",
    removeFailed: "Abhängigkeit konnte nicht entfernt werden.",
    cycleError: "Diese Verbindung würde einen Zyklus erzeugen. Wählen Sie eine andere vorherige Aufgabe.",
    taskMismatchError: "Beide Aufgaben müssen zum ausgewählten Projekt gehören.",
    workflowForbidden: "Nur Projektleitung oder Projektmanager können Verknüpfungen ändern.",
    checklist: "Checkliste",
    comments: "Kommentare",
    attachments: "Dateien",
    linkedPatient: "Patient",
    linkedProvider: "Leistungserbringer",
    taskCode: "Aufgabe",
    searchTask: "Aufgabe, Bearbeiter oder ID suchen",
    allTasks: "Alle Aufgaben",
    activeTasks: "Aktive",
    blockedTasks: "Mit Blockern",
    overdueTasks: "Überfällige",
    shown: "Angezeigt",
    noFilteredTasks: "Keine Aufgaben für diese Auswahl",
    noFilteredTasksHint: "Passen Sie Suche oder Filter an, um Aufgaben im Canvas anzuzeigen.",
    clearFilters: "Filter zurücksetzen",
    zoomIn: "Canvas vergrößern",
    zoomOut: "Canvas verkleinern",
    resetZoom: "Zoom zurücksetzen",
  },
} as const satisfies Record<Lang, Record<string, string>>;

type WorkflowLabels = (typeof workflowCopy)[Lang];
type WorkflowTaskFilter = "all" | "active" | "blocked" | "overdue";

type ProjectWorkflowViewProps = {
  projects: Project[];
  selected: Project | null;
  tasks: ConciergeTask[];
  dependencies: ProjectWorkflowDependency[];
  loading: boolean;
  projectError: string;
  dependencyError: string;
  canManage: boolean;
  onSelectProject: (projectId: string) => void;
  onCreateProject: () => void;
  onCreateTask: () => void;
  onOpenTask: (taskId: string) => void;
  onAddDependency: (taskId: string, dependsOnTaskId: string) => Promise<void>;
  onRemoveDependency: (dependencyId: string) => Promise<void>;
};

function formatDate(value: string | null, lang: Lang) {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
    day: "2-digit",
    month: "short",
    year: value.length === 10 ? "numeric" : undefined,
  }).format(date);
}

function statusLabel(status: ConciergeTaskStatus, labels: WorkflowLabels) {
  return labels[status];
}

function statusTone(status: ConciergeTaskStatus) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "review") return "border-violet-200 bg-violet-50 text-violet-700";
  if (status === "in_progress") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "cancelled") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function statusAccent(status: ConciergeTaskStatus) {
  if (status === "completed") return "bg-emerald-500";
  if (status === "review") return "bg-violet-500";
  if (status === "in_progress") return "bg-sky-500";
  if (status === "cancelled") return "bg-rose-500";
  return "bg-orange-500";
}

function taskCode(task: ConciergeTask) {
  return `TASK-${task.id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function localizeWorkflowError(error: unknown, labels: WorkflowLabels, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (/create a cycle|zyklus|цикл/i.test(error.message)) return labels.cycleError;
  if (/both workflow tasks|selected project/i.test(error.message)) return labels.taskMismatchError;
  if (/owner or a project manager|forbidden/i.test(error.message)) return labels.workflowForbidden;
  return error.message || fallback;
}

function WorkflowTaskCard({
  task,
  unresolvedCount,
  selected,
  labels,
  lang,
  onClick,
  className,
  style,
}: {
  task: ConciergeTask;
  unresolvedCount: number;
  selected: boolean;
  labels: WorkflowLabels;
  lang: Lang;
  onClick: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      aria-label={`${taskCode(task)}: ${task.title}. ${statusLabel(task.status, labels)}${unresolvedCount ? `. ${labels.blocked}: ${unresolvedCount}` : ""}`}
      className={cn(
        "group overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-[border-color,box-shadow] hover:border-orange-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400",
        selected && "border-orange-400 ring-2 ring-orange-100",
        className,
      )}
      style={style}
      onClick={onClick}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", statusAccent(task.status))} />
      <span className="flex h-full flex-col px-4 py-3 pl-5">
        <span className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] font-medium tracking-wide text-muted-foreground">{taskCode(task)}</span>
          <Badge variant="outline" className={cn("h-6 text-[10px]", statusTone(task.status))}>
            {statusLabel(task.status, labels)}
          </Badge>
        </span>
        <span className="mt-2 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-foreground">{task.title}</span>
        <span className="mt-auto grid gap-1.5 border-t pt-2 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5"><UserRound className="size-3.5 shrink-0" /><span className="truncate">{task.assigned_to_name}</span></span>
          <span className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5"><CalendarDays className="size-3.5 shrink-0" /><span className="truncate">{formatDate(task.due_at, lang) ?? labels.noDeadline}</span></span>
            {unresolvedCount ? <span className="flex shrink-0 items-center gap-1 font-medium text-orange-700"><span className="size-1.5 rounded-full bg-orange-500" />{unresolvedCount}</span> : null}
          </span>
        </span>
      </span>
    </button>
  );
}

function WorkflowCanvas({
  project,
  tasks,
  dependencies,
  selectedTaskId,
  labels,
  lang,
  onSelectTask,
}: {
  project: Project;
  tasks: ConciergeTask[];
  dependencies: ProjectWorkflowDependency[];
  selectedTaskId: string | null;
  labels: WorkflowLabels;
  lang: Lang;
  onSelectTask: (taskId: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const graph = useMemo(
    () => buildProjectWorkflowGraph(tasks, dependencies),
    [dependencies, tasks],
  );

  useEffect(() => setZoom(1), [project.id]);

  function changeZoom(next: number) {
    setZoom(Math.min(1.25, Math.max(0.75, Number(next.toFixed(2)))));
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-muted/10" role="region" aria-label={labels.workflow}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><GitBranch className="size-4 text-orange-500" />{labels.workflow}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{labels.workflowHint}</p>
        </div>
        <div className="hidden items-center rounded-lg border bg-background p-0.5 md:flex" role="group" aria-label={labels.resetZoom}>
          <Button type="button" size="icon" variant="ghost" className="size-8" disabled={zoom <= 0.75} aria-label={labels.zoomOut} onClick={() => changeZoom(zoom - 0.25)}><Minus className="size-3.5" /></Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 min-w-16 px-2 font-mono text-[11px]" aria-label={labels.resetZoom} onClick={() => setZoom(1)}><RotateCcw className="size-3.5" />{Math.round(zoom * 100)}%</Button>
          <Button type="button" size="icon" variant="ghost" className="size-8" disabled={zoom >= 1.25} aria-label={labels.zoomIn} onClick={() => changeZoom(zoom + 0.25)}><Plus className="size-3.5" /></Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 border-b bg-card px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-slate-300" />{labels.start}</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" />{labels.dependencyResolved}</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-orange-500" />{labels.dependencyBlocking}</span>
      </div>

      <div className="hidden overflow-auto md:block" data-testid="project-workflow-canvas">
        <div className="relative" style={{ width: graph.width * zoom, height: graph.height * zoom }}>
          <div className="absolute left-0 top-0" style={{ width: graph.width, height: graph.height, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
          <div className="absolute left-7 top-[88px] z-20 h-[150px] w-[232px] rounded-xl border border-orange-200 bg-orange-50/80 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-orange-700"><span className="size-2 rounded-full bg-orange-500" />{labels.start}</div>
            <p className="mt-3 line-clamp-2 text-sm font-semibold text-foreground">{project.name}</p>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{project.description || labels.startHint}</p>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><FolderKanban className="size-3.5" />{tasks.length} {labels.tasks.toLocaleLowerCase()}</div>
          </div>

          {graph.stages.map((stage, index) => {
            const count = tasks.filter((task) => task.status === stage).length;
            return (
              <div key={stage}>
                <div
                  className="absolute bottom-4 top-16 rounded-2xl border border-dashed border-border/70 bg-card/35"
                  style={{ left: WORKFLOW_STAGE_START_X + index * WORKFLOW_STAGE_WIDTH - 12, width: WORKFLOW_STAGE_WIDTH - 16 }}
                />
                <div
                  className="absolute top-5 z-20 flex items-center gap-2"
                  style={{ left: WORKFLOW_STAGE_START_X + index * WORKFLOW_STAGE_WIDTH }}
                >
                  <span className={cn("size-2 rounded-full", statusAccent(stage))} />
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{statusLabel(stage, labels)}</span>
                  <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-[10px]">{count}</Badge>
                </div>
              </div>
            );
          })}

          <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-10" width={graph.width} height={graph.height}>
            {graph.edges.map((edge) => (
              <g key={edge.id}>
                <path
                  d={edge.path}
                  fill="none"
                  stroke={edge.dependency ? edge.resolved ? "#10b981" : "#f97316" : "#cbd5e1"}
                  strokeWidth={edge.dependency ? 2 : 1.5}
                  strokeDasharray={edge.dependency ? undefined : "5 5"}
                  opacity={selectedTaskId && edge.sourceTaskId !== selectedTaskId && edge.targetTaskId !== selectedTaskId ? 0.16 : edge.dependency ? 0.78 : 0.8}
                />
                <circle cx={edge.targetX} cy={edge.targetY} r={edge.dependency ? 4 : 3} fill={edge.dependency ? edge.resolved ? "#10b981" : "#f97316" : "#cbd5e1"} opacity={selectedTaskId && edge.sourceTaskId !== selectedTaskId && edge.targetTaskId !== selectedTaskId ? 0.16 : 1} />
              </g>
            ))}
          </svg>

          {graph.nodes.map((node) => (
            <WorkflowTaskCard
              key={node.task.id}
              task={node.task}
              unresolvedCount={node.unresolvedIncoming.length}
              selected={selectedTaskId === node.task.id}
              labels={labels}
              lang={lang}
              className="absolute z-20"
              style={{ left: node.x, top: node.y, width: WORKFLOW_NODE_WIDTH, height: WORKFLOW_NODE_HEIGHT }}
              onClick={() => onSelectTask(node.task.id)}
            />
          ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-3 md:hidden">
        {graph.stages.flatMap((stage) => graph.nodes.filter((node) => node.task.status === stage)).map((node) => (
          <div key={node.task.id} className="grid gap-2">
            <WorkflowTaskCard
              task={node.task}
              unresolvedCount={node.unresolvedIncoming.length}
              selected={selectedTaskId === node.task.id}
              labels={labels}
              lang={lang}
              className="relative h-[158px] w-full"
              onClick={() => onSelectTask(node.task.id)}
            />
            {node.incoming.length ? (
              <div className="ml-4 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <GitBranch className="size-3.5 text-orange-500" />
                {node.incoming.map((dependency) => {
                  const prerequisite = tasks.find((task) => task.id === dependency.depends_on_task_id);
                  return prerequisite ? <Badge key={dependency.id} variant="outline" className="max-w-full truncate bg-card">{prerequisite.title}</Badge> : null;
                })}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function DependencyDialog({
  open,
  taskId,
  tasks,
  dependencies,
  labels,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  taskId: string | null;
  tasks: ConciergeTask[];
  dependencies: ProjectWorkflowDependency[];
  labels: WorkflowLabels;
  onOpenChange: (open: boolean) => void;
  onSave: (taskId: string, dependsOnTaskId: string) => Promise<void>;
}) {
  const [selectedTaskId, setSelectedTaskId] = useState(taskId ?? "");
  const [prerequisiteId, setPrerequisiteId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const available = useMemo(
    () => availablePrerequisites(tasks, dependencies, selectedTaskId),
    [dependencies, selectedTaskId, tasks],
  );

  useEffect(() => {
    if (!open) return;
    setSelectedTaskId(taskId ?? tasks[0]?.id ?? "");
    setPrerequisiteId("");
    setError("");
  }, [open, taskId, tasks]);

  function changeOpen(nextOpen: boolean) {
    onOpenChange(nextOpen);
  }

  async function save() {
    if (!selectedTaskId || !prerequisiteId || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(selectedTaskId, prerequisiteId);
      changeOpen(false);
    } catch (saveError) {
      setError(localizeWorkflowError(saveError, labels, labels.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><span className="size-2 rounded-full bg-orange-500" />{labels.addDependency}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
          <label className="grid gap-1.5 text-sm font-medium">
            {labels.dependencyTask}
            <NativeComboboxSelect value={selectedTaskId} onChange={(event) => { setSelectedTaskId(event.target.value); setPrerequisiteId(""); }}>
              <option value="">{labels.selectTaskPlaceholder}</option>
              {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
            </NativeComboboxSelect>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {labels.prerequisite}
            <NativeComboboxSelect value={prerequisiteId} disabled={!selectedTaskId || !available.length} onChange={(event) => setPrerequisiteId(event.target.value)}>
              <option value="">{labels.selectPrerequisite}</option>
              {available.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
            </NativeComboboxSelect>
          </label>
          {selectedTaskId && !available.length ? <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">{labels.allLinked}</p> : null}
          <p className="text-xs text-muted-foreground">{labels.dependencyHelp}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => changeOpen(false)}>{labels.cancel}</Button>
          <Button type="button" disabled={!selectedTaskId || !prerequisiteId || saving} onClick={() => void save()}>{saving ? <LoaderCircle className="animate-spin" /> : <Link2 />}{labels.saveDependency}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectWorkflowView({
  projects,
  selected,
  tasks,
  dependencies,
  loading,
  projectError,
  dependencyError,
  canManage,
  onSelectProject,
  onCreateProject,
  onCreateTask,
  onOpenTask,
  onAddDependency,
  onRemoveDependency,
}: ProjectWorkflowViewProps) {
  const { lang } = useLang();
  const labels = workflowCopy[lang];
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [dependencyDialogOpen, setDependencyDialogOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<ProjectWorkflowDependency | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [taskQuery, setTaskQuery] = useState("");
  const [taskFilter, setTaskFilter] = useState<WorkflowTaskFilter>("all");
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const incoming = selectedTask ? dependencies.filter((dependency) => dependency.task_id === selectedTask.id) : [];
  const outgoing = selectedTask ? dependencies.filter((dependency) => dependency.depends_on_task_id === selectedTask.id) : [];
  const stats = useMemo(() => projectWorkflowStats(tasks, dependencies), [dependencies, tasks]);
  const blockedTaskIds = useMemo(() => new Set(
    dependencies
      .filter((dependency) => tasksById.get(dependency.depends_on_task_id)?.status !== "completed")
      .map((dependency) => dependency.task_id),
  ), [dependencies, tasksById]);
  const visibleTasks = useMemo(() => {
    const normalizedQuery = taskQuery.trim().toLocaleLowerCase();
    const now = Date.now();
    return tasks.filter((task) => {
      const matchesQuery = !normalizedQuery || [task.title, task.assigned_to_name, taskCode(task)]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
      if (!matchesQuery) return false;
      if (taskFilter === "active") return task.status !== "completed" && task.status !== "cancelled";
      if (taskFilter === "blocked") return blockedTaskIds.has(task.id);
      if (taskFilter === "overdue") {
        return Boolean(task.due_at)
          && task.status !== "completed"
          && task.status !== "cancelled"
          && new Date(task.due_at as string).getTime() < now;
      }
      return true;
    });
  }, [blockedTaskIds, taskFilter, taskQuery, tasks]);
  const visibleTaskIds = useMemo(() => new Set(visibleTasks.map((task) => task.id)), [visibleTasks]);
  const visibleDependencies = useMemo(
    () => dependencies.filter((dependency) => visibleTaskIds.has(dependency.task_id) && visibleTaskIds.has(dependency.depends_on_task_id)),
    [dependencies, visibleTaskIds],
  );

  useEffect(() => {
    setSelectedTaskId(null);
    setTaskQuery("");
    setTaskFilter("all");
  }, [selected?.id]);

  useEffect(() => {
    if (selectedTaskId && !visibleTaskIds.has(selectedTaskId)) setSelectedTaskId(null);
  }, [selectedTaskId, visibleTaskIds]);

  async function removeDependency() {
    if (!deleteCandidate || deleteBusy) return;
    setDeleteBusy(true);
    setLocalError("");
    try {
      await onRemoveDependency(deleteCandidate.id);
      setDeleteCandidate(null);
    } catch (removeError) {
      setLocalError(localizeWorkflowError(removeError, labels, labels.removeFailed));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        {projectError ? <div role="alert" className="mb-3 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">{projectError}</div> : null}
        <div className="grid gap-3 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)] lg:items-end">
          <label className="grid gap-1.5 text-sm font-medium">
            {labels.project}
            <NativeComboboxSelect
              value={selected?.id ?? ""}
              searchPlaceholder={labels.searchProject}
              emptyLabel={labels.noProjects}
              onChange={(event) => { setSelectedTaskId(null); onSelectProject(event.target.value); }}
            >
              <option value="">{labels.selectProject}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </NativeComboboxSelect>
          </label>
          {selected ? (
            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant="outline" className="max-w-full truncate border-orange-200 bg-orange-50 text-orange-700">{selected.name}</Badge>
                  {selected.patient_name ? <span className="truncate text-xs text-muted-foreground">{selected.patient_name}</span> : null}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span><span className="text-foreground">{labels.owner}:</span> {selected.owner_name}</span>
                  <span><span className="text-foreground">{labels.deadline}:</span> {formatDate(selected.due_on, lang) ?? labels.noDeadline}</span>
                </div>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={labels.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={stats.progress}><div className="h-full rounded-full bg-orange-500 transition-[width]" style={{ width: `${stats.progress}%` }} /></div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button type="button" size="sm" variant="outline" onClick={onCreateTask}><Plus />{labels.createTask}</Button>
                {canManage && tasks.length > 1 ? <Button type="button" size="sm" onClick={() => setDependencyDialogOpen(true)}><Link2 />{labels.addDependency}</Button> : null}
              </div>
            </div>
          ) : projects.length ? <p className="text-sm text-muted-foreground">{labels.workflowHint}</p> : null}
        </div>
      </section>

      {dependencyError || localError ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{localError || dependencyError}</div> : null}

      {!selected ? (
        <div className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed bg-card px-6 text-center">
          <GitBranch className="size-10 text-orange-500" />
          <h2 className="mt-3 font-semibold">{projects.length ? labels.selectProject : labels.noProjectsTitle}</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{projects.length ? labels.workflowHint : labels.noProjects}</p>
          {!projects.length ? <Button className="mt-4" onClick={onCreateProject}><Plus />{labels.createProject}</Button> : null}
        </div>
      ) : loading ? (
        <div className="flex min-h-80 items-center justify-center rounded-2xl border bg-card text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />{labels.workflow}</div>
      ) : tasks.length === 0 ? (
        <div className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed bg-card px-6 text-center">
          <CircleDashed className="size-10 text-orange-500" />
          <h2 className="mt-3 font-semibold">{labels.emptyTitle}</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{labels.emptyHint}</p>
          <Button className="mt-4" onClick={onCreateTask}><Plus />{labels.createTask}</Button>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={taskQuery} className="pl-9" aria-label={labels.searchTask} placeholder={labels.searchTask} onChange={(event) => setTaskQuery(event.target.value)} />
            </div>
            <NativeComboboxSelect className="w-full sm:w-48" aria-label={labels.allTasks} value={taskFilter} onChange={(event) => setTaskFilter(event.target.value as WorkflowTaskFilter)}>
              <option value="all">{labels.allTasks}</option>
              <option value="active">{labels.activeTasks}</option>
              <option value="blocked">{labels.blockedTasks}</option>
              <option value="overdue">{labels.overdueTasks}</option>
            </NativeComboboxSelect>
            <Badge variant="secondary" className="h-9 shrink-0 justify-center px-3 font-normal tabular-nums">{labels.shown}: {visibleTasks.length}/{tasks.length}</Badge>
          </section>

          {visibleTasks.length ? (
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_20rem]">
            <WorkflowCanvas
              project={selected}
              tasks={visibleTasks}
              dependencies={visibleDependencies}
              selectedTaskId={selectedTaskId}
              labels={labels}
              lang={lang}
              onSelectTask={setSelectedTaskId}
            />

            <aside className="rounded-2xl border bg-card p-4 2xl:sticky 2xl:top-3 2xl:self-start">
              {selectedTask ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] text-muted-foreground">{taskCode(selectedTask)}</p>
                      <h3 className="mt-1 text-sm font-semibold leading-5">{selectedTask.title}</h3>
                    </div>
                    <Badge variant="outline" className={cn("shrink-0 text-[10px]", statusTone(selectedTask.status))}>{statusLabel(selectedTask.status, labels)}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 rounded-xl bg-muted/35 p-3 text-xs">
                    <span className="flex min-w-0 items-center gap-2"><UserRound className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{selectedTask.assigned_to_name}</span></span>
                    <span className="flex items-center gap-2"><CalendarDays className="size-3.5 text-muted-foreground" />{formatDate(selectedTask.due_at, lang) ?? labels.noDeadline}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-[10px] text-muted-foreground">
                    <div className="rounded-lg border px-1.5 py-2"><strong className="block text-xs text-foreground">{selectedTask.checklist_completed}/{selectedTask.checklist_total}</strong>{labels.checklist}</div>
                    <div className="rounded-lg border px-1.5 py-2"><strong className="block text-xs text-foreground">{selectedTask.comment_count}</strong>{labels.comments}</div>
                    <div className="rounded-lg border px-1.5 py-2"><strong className="block text-xs text-foreground">{selectedTask.attachment_count ?? 0}</strong>{labels.attachments}</div>
                  </div>
                  {selectedTask.patient_name || selectedTask.provider_name ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selectedTask.patient_name ? <Badge variant="outline" className="max-w-full truncate bg-background"><span className="mr-1 text-muted-foreground">{labels.linkedPatient}:</span>{selectedTask.patient_name}</Badge> : null}
                      {selectedTask.provider_name ? <Badge variant="outline" className="max-w-full truncate bg-background"><span className="mr-1 text-muted-foreground">{labels.linkedProvider}:</span>{selectedTask.provider_name}</Badge> : null}
                    </div>
                  ) : null}

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{labels.dependsOn}</h4>
                    {canManage && tasks.length > 1 ? <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setDependencyDialogOpen(true)}><Plus />{labels.addDependency}</Button> : null}
                  </div>
                  <div className="mt-2 grid gap-2">
                    {incoming.length ? incoming.map((dependency) => {
                      const task = tasksById.get(dependency.depends_on_task_id);
                      if (!task) return null;
                      const resolved = task.status === "completed";
                      return (
                        <div key={dependency.id} className="flex items-start gap-2 rounded-lg border p-2.5">
                          {resolved ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-orange-600" />}
                          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedTaskId(task.id)}><span className="line-clamp-2 text-xs font-medium">{task.title}</span><span className={cn("mt-1 block text-[10px]", resolved ? "text-emerald-700" : "text-orange-700")}>{resolved ? labels.dependencyResolved : labels.dependencyBlocking}</span></button>
                          {canManage ? <Button size="icon" variant="ghost" className="size-7 shrink-0 text-muted-foreground hover:text-destructive" aria-label={labels.removeDependency} onClick={() => setDeleteCandidate(dependency)}><Trash2 className="size-3.5" /></Button> : null}
                        </div>
                      );
                    }) : <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">{labels.noDependencies}</p>}
                  </div>

                  <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{labels.unlocks}</h4>
                  <div className="mt-2 grid gap-1.5">
                    {outgoing.length ? outgoing.map((dependency) => {
                      const task = tasksById.get(dependency.task_id);
                      return task ? <button key={dependency.id} type="button" className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs hover:border-orange-300" onClick={() => setSelectedTaskId(task.id)}><span className="size-1.5 shrink-0 rounded-full bg-orange-500" /><span className="min-w-0 flex-1 truncate">{task.title}</span><ArrowRight className="size-3.5 shrink-0 text-muted-foreground" /></button> : null;
                    }) : <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">{labels.noFollowing}</p>}
                  </div>
                  <Button className="mt-4 w-full" variant="outline" onClick={() => onOpenTask(selectedTask.id)}><ExternalLink />{labels.openTask}</Button>
                </>
              ) : (
                <div className="flex min-h-64 flex-col items-center justify-center text-center">
                  <GitBranch className="size-8 text-orange-400" />
                  <h3 className="mt-3 text-sm font-semibold">{labels.details}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{labels.selectTask}</p>
                  {canManage && tasks.length > 1 ? <Button className="mt-4" size="sm" variant="outline" onClick={() => setDependencyDialogOpen(true)}><Plus />{labels.addDependency}</Button> : null}
                </div>
              )}
            </aside>
          </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed bg-card px-6 text-center">
              <Search className="size-9 text-orange-500" />
              <h2 className="mt-3 font-semibold">{labels.noFilteredTasks}</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">{labels.noFilteredTasksHint}</p>
              <Button className="mt-4" variant="outline" onClick={() => { setTaskQuery(""); setTaskFilter("all"); }}>{labels.clearFilters}</Button>
            </div>
          )}
        </>
      )}

      <DependencyDialog
        open={dependencyDialogOpen}
        taskId={selectedTaskId}
        tasks={tasks}
        dependencies={dependencies}
        labels={labels}
        onOpenChange={setDependencyDialogOpen}
        onSave={onAddDependency}
      />

      <Dialog open={Boolean(deleteCandidate)} onOpenChange={(open) => { if (!open && !deleteBusy) setDeleteCandidate(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><span className="size-2 rounded-full bg-rose-500" />{labels.removeTitle}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{labels.removeHint}</p>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={deleteBusy} onClick={() => setDeleteCandidate(null)}>{labels.cancel}</Button>
            <Button type="button" variant="destructive" disabled={deleteBusy} onClick={() => void removeDependency()}>{deleteBusy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}{labels.remove}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
