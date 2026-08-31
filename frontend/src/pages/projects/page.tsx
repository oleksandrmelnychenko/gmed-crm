import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarDays, CheckCircle2, FolderKanban, LayoutGrid, LoaderCircle, Pencil, Plus, Search, UsersRound, Workflow, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { PageHeader } from "@/components/ui-shell";
import { apiFetch, clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang, type Lang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import type { PatientSummary } from "@/pages/patients/model/list-model";
import { assignableConciergeTaskUsers, conciergeTaskErrorMessage, type ConciergeAssignee, type ConciergeTask } from "@/pages/concierge/model";
import {
  ConciergeTaskEventDialog,
  type ConciergeTaskPatientOption,
  type SaveConciergeOperationalItemInput,
} from "@/pages/concierge/task-event-dialog";

import type { Project, ProjectFormValue, ProjectPriority, ProjectStatus, ProjectWorkflowDependency } from "./model";
import { ProjectWorkflowView } from "./workflow-view";

const copy = {
  ru: {
    title: "Проекты",
    create: "Новый проект",
    overviewView: "Проекты",
    workflowView: "Workflow",
    empty: "Проектов пока нет",
    emptyHint: "Создайте проект, чтобы объединить команду, сроки и задачи в одном месте.",
    noMatches: "Проекты не найдены",
    noMatchesHint: "Измените поиск или фильтр статуса.",
    clearFilters: "Сбросить фильтры",
    selectHint: "Выберите проект, чтобы увидеть команду, сроки и связанные задачи.",
    search: "Найти проект",
    all: "Все",
    planned: "Запланирован",
    active: "В работе",
    on_hold: "Приостановлен",
    completed: "Завершён",
    cancelled: "Отменён",
    edit: "Изменить проект",
    createTitle: "Создать проект",
    name: "Название",
    namePlaceholder: "Например, запуск нового направления",
    description: "Описание и результат",
    descriptionPlaceholder: "Цель проекта, ожидаемый результат и важные договорённости",
    owner: "Владелец проекта",
    patient: "Пациент / клиент",
    noPatient: "Без привязки к пациенту",
    members: "Команда проекта",
    status: "Статус",
    priority: "Приоритет",
    starts: "Начало",
    due: "Срок",
    low: "Низкий",
    normal: "Обычный",
    high: "Высокий",
    urgent: "Срочный",
    save: "Сохранить",
    cancel: "Отмена",
    loading: "Загрузка проектов",
    loadFailed: "Не удалось загрузить проекты.",
    saveFailed: "Не удалось сохранить проект.",
    taskSaveFailed: "Не удалось создать задачу.",
    apiUnavailable: "Раздел проектов ещё не доступен на этом сервере.",
    tasks: "Задачи проекта",
    newTask: "Создать задачу",
    noTasks: "В проекте пока нет задач.",
    progress: "Выполнено",
    team: "Команда",
    deadline: "Срок",
    noDeadline: "Без срока",
    period: "Период",
    createdBy: "Создал",
    open: "Открыта",
    in_progress: "В работе",
    review: "На проверке",
  },
  de: {
    title: "Projekte",
    create: "Neues Projekt",
    overviewView: "Projekte",
    workflowView: "Workflow",
    empty: "Noch keine Projekte",
    emptyHint: "Erstellen Sie ein Projekt, um Team, Termine und Aufgaben zusammenzuführen.",
    noMatches: "Keine Projekte gefunden",
    noMatchesHint: "Passen Sie die Suche oder den Statusfilter an.",
    clearFilters: "Filter zurücksetzen",
    selectHint: "Wählen Sie ein Projekt aus, um Team, Termine und Aufgaben zu sehen.",
    search: "Projekt suchen",
    all: "Alle",
    planned: "Geplant",
    active: "In Arbeit",
    on_hold: "Pausiert",
    completed: "Abgeschlossen",
    cancelled: "Storniert",
    edit: "Projekt bearbeiten",
    createTitle: "Projekt erstellen",
    name: "Name",
    namePlaceholder: "z. B. Start eines neuen Bereichs",
    description: "Beschreibung und Ergebnis",
    descriptionPlaceholder: "Ziel, erwartetes Ergebnis und wichtige Vereinbarungen",
    owner: "Projektleitung",
    patient: "Patient / Kunde",
    noPatient: "Ohne Patientenzuordnung",
    members: "Projektteam",
    status: "Status",
    priority: "Priorität",
    starts: "Beginn",
    due: "Fällig",
    low: "Niedrig",
    normal: "Normal",
    high: "Hoch",
    urgent: "Dringend",
    save: "Speichern",
    cancel: "Abbrechen",
    loading: "Projekte werden geladen",
    loadFailed: "Projekte konnten nicht geladen werden.",
    saveFailed: "Projekt konnte nicht gespeichert werden.",
    taskSaveFailed: "Aufgabe konnte nicht erstellt werden.",
    apiUnavailable: "Der Projektbereich ist auf diesem Server noch nicht verfügbar.",
    tasks: "Projektaufgaben",
    newTask: "Aufgabe erstellen",
    noTasks: "Dieses Projekt hat noch keine Aufgaben.",
    progress: "Erledigt",
    team: "Team",
    deadline: "Fällig",
    noDeadline: "Ohne Termin",
    period: "Zeitraum",
    createdBy: "Erstellt von",
    open: "Offen",
    in_progress: "In Arbeit",
    review: "In Prüfung",
  },
} as const satisfies Record<Lang, Record<string, string>>;

const statusOrder: ProjectStatus[] = ["planned", "active", "on_hold", "completed", "cancelled"];

function statusClass(status: ProjectStatus) {
  if (status === "active") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "on_hold") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "cancelled") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-orange-200 bg-orange-50 text-orange-700";
}

function priorityClass(priority: ProjectPriority) {
  if (priority === "urgent") return "border-rose-200 bg-rose-50 text-rose-700";
  if (priority === "high") return "border-orange-200 bg-orange-50 text-orange-700";
  if (priority === "low") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function taskStatusClass(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "review") return "border-violet-200 bg-violet-50 text-violet-700";
  if (status === "in_progress") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "cancelled") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function displayApiError(error: unknown, fallback: string, apiUnavailable: string) {
  if (!(error instanceof Error)) return fallback;
  if (/api route not found/i.test(error.message)) return apiUnavailable;
  return error.message || fallback;
}

function dateLabel(value: string | null, lang: Lang) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", { dateStyle: "medium" }).format(date);
}

export function ProjectsPage() {
  const { lang } = useLang();
  const labels = copy[lang];
  const { user } = useAuth();
  const { staffGo } = useStaffNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignees, setAssignees] = useState<ConciergeAssignee[]>([]);
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [tasks, setTasks] = useState<ConciergeTask[]>([]);
  const [dependencies, setDependencies] = useState<ProjectWorkflowDependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [dependencyError, setDependencyError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "all">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [taskDialogError, setTaskDialogError] = useState("");
  const createTaskRequestIdRef = useRef<string | null>(null);
  const selectedId = searchParams.get("project");
  const selected = projects.find((project) => project.id === selectedId) ?? null;
  const activeView = searchParams.get("view") === "workflow" ? "workflow" : "overview";
  const taskPatients = useMemo<ConciergeTaskPatientOption[]>(() => patients.map((patient) => ({
    id: patient.id,
    name: [patient.first_name, patient.last_name].filter(Boolean).join(" ") || patient.patient_id,
  })).sort((left, right) => left.name.localeCompare(right.name)), [patients]);
  const taskAssignees = useMemo(
    () => assignableConciergeTaskUsers(assignees, user?.id, user?.role),
    [assignees, user?.id, user?.role],
  );

  useDebouncedRealtimeSubscription([
    "crm_project.created",
    "crm_project.updated",
    "crm_project.workflow_updated",
    "concierge_operational_item.created",
    "concierge_operational_item.updated",
    "concierge_operational_item.deleted",
  ], () => {
    clearApiCache("/projects");
    void loadProjects(true);
    if (selectedId) void loadProjectWorkflow(selectedId);
  }, 250);

  async function loadProjects(forceFresh = false) {
    setError("");
    try {
      const [projectResult, userRows, patientRows] = await Promise.all([
        apiFetch<Project[]>("/projects", { cacheTtlMs: 10_000, forceFresh })
          .then((value) => ({ value, error: null as unknown }))
          .catch((projectError: unknown) => ({ value: null, error: projectError })),
        apiFetch<ConciergeAssignee[]>("/concierge-operational-items/assignees", { cacheTtlMs: 30_000, forceFresh }).catch(() => user ? [{
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          is_active: true,
        }] : []),
        apiFetch<PatientSummary[]>("/patients?active_only=true", { cacheTtlMs: 30_000, forceFresh }).catch(() => []),
      ]);
      setAssignees(userRows);
      setPatients(patientRows);
      if (projectResult.error || !projectResult.value) throw projectResult.error;
      const projectRows = projectResult.value;
      setProjects((current) => projectRows.map((project) => ({
        ...project,
        members: current.find((entry) => entry.id === project.id)?.members,
      })));
    } catch (loadError) {
      setError(displayApiError(loadError, labels.loadFailed, labels.apiUnavailable));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadProjects(); }, []);

  useEffect(() => {
    if (!selectedId) { setTasks([]); setDependencies([]); setDependencyError(""); return; }
    let cancelled = false;
    setDetailLoading(true);
    setDependencyError("");
    void Promise.all([
      apiFetch<Project>(`/projects/${selectedId}`, { forceFresh: true }),
      apiFetch<ConciergeTask[]>(`/concierge-operational-items?project_id=${encodeURIComponent(selectedId)}&archive=all`, { forceFresh: true }),
      apiFetch<ProjectWorkflowDependency[]>(`/projects/${selectedId}/workflow/dependencies`, { forceFresh: true })
        .catch((dependencyLoadError: unknown) => {
          if (!cancelled) setDependencyError(displayApiError(dependencyLoadError, labels.loadFailed, labels.apiUnavailable));
          return [];
        }),
    ]).then(([detail, taskRows, dependencyRows]) => {
      if (cancelled) return;
      setProjects((current) => current.map((project) => project.id === detail.id ? detail : project));
      setTasks(taskRows);
      setDependencies(dependencyRows);
    }).catch(() => { if (!cancelled) setError(labels.loadFailed); }).finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [labels.loadFailed, selectedId]);

  async function loadProjectWorkflow(projectId: string) {
    try {
      const [taskRows, dependencyRows] = await Promise.all([
        apiFetch<ConciergeTask[]>(`/concierge-operational-items?project_id=${encodeURIComponent(projectId)}&archive=all`, { forceFresh: true }),
        apiFetch<ProjectWorkflowDependency[]>(`/projects/${projectId}/workflow/dependencies`, { forceFresh: true }),
      ]);
      if (projectId !== selectedId) return;
      setTasks(taskRows);
      setDependencies(dependencyRows);
      setDependencyError("");
    } catch (workflowError) {
      if (projectId === selectedId) setDependencyError(displayApiError(workflowError, labels.loadFailed, labels.apiUnavailable));
    }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return projects.filter((project) => (status === "all" || project.status === status)
      && (!needle || `${project.name} ${project.description ?? ""} ${project.owner_name}`.toLocaleLowerCase().includes(needle)));
  }, [projects, query, status]);

  function selectProject(project: Project) {
    const next = new URLSearchParams(searchParams);
    next.set("project", project.id);
    setSearchParams(next);
  }

  function selectWorkflowProject(projectId: string) {
    const next = new URLSearchParams(searchParams);
    if (projectId) next.set("project", projectId);
    else next.delete("project");
    next.set("view", "workflow");
    setSearchParams(next);
  }

  function setActiveView(view: "overview" | "workflow") {
    const next = new URLSearchParams(searchParams);
    if (view === "workflow") next.set("view", "workflow");
    else next.delete("view");
    setSearchParams(next, { replace: true });
  }

  function clearSelection() {
    const next = new URLSearchParams(searchParams);
    next.delete("project");
    setSearchParams(next, { replace: true });
  }

  function openCreate() { setDialogError(""); setEditing(null); setDialogOpen(true); }
  function openEdit(project: Project) { setDialogError(""); setEditing(project); setDialogOpen(true); }

  function openCreateTask() {
    if (!selected) return;
    setTaskDialogError("");
    createTaskRequestIdRef.current = crypto.randomUUID();
    setTaskDialogOpen(true);
  }

  async function saveProject(input: ProjectFormValue) {
    if (saving) return;
    setSaving(true);
    setDialogError("");
    try {
      const saved = await apiFetch<Project>(editing ? `/projects/${editing.id}/update` : "/projects", {
        method: "POST",
        body: JSON.stringify({ ...input, ...(editing ? { expected_updated_at: editing.updated_at } : {}) }),
      });
      clearApiCache("/projects");
      setProjects((current) => current.some((project) => project.id === saved.id)
        ? current.map((project) => project.id === saved.id ? saved : project)
        : [saved, ...current]);
      setDialogOpen(false);
      setEditing(null);
      selectProject(saved);
    } catch (saveError) {
      setDialogError(displayApiError(saveError, labels.saveFailed, labels.apiUnavailable));
    } finally {
      setSaving(false);
    }
  }

  async function saveProjectTask(input: SaveConciergeOperationalItemInput): Promise<ConciergeTask> {
    if (taskSubmitting) throw new Error(labels.taskSaveFailed);
    setTaskSubmitting(true);
    setTaskDialogError("");
    try {
      const { status, ...fields } = input;
      void status;
      const requestId = createTaskRequestIdRef.current ?? crypto.randomUUID();
      createTaskRequestIdRef.current = requestId;
      const saved = await apiFetch<ConciergeTask>("/concierge-operational-items", {
        method: "POST",
        body: JSON.stringify({ ...fields, request_id: requestId }),
      });
      clearApiCache("/concierge-operational-items");
      clearApiCache("/projects");
      setTasks((current) => current.some((task) => task.id === saved.id)
        ? current.map((task) => task.id === saved.id ? saved : task)
        : [...current, saved]);
      void loadProjects(true);
      return saved;
    } catch (saveError) {
      setTaskDialogError(conciergeTaskErrorMessage(saveError, lang, labels.taskSaveFailed));
      throw saveError;
    } finally {
      setTaskSubmitting(false);
    }
  }

  async function addWorkflowDependency(taskId: string, dependsOnTaskId: string) {
    if (!selected) return;
    const created = await apiFetch<ProjectWorkflowDependency>(`/projects/${selected.id}/workflow/dependencies`, {
      method: "POST",
      body: JSON.stringify({ task_id: taskId, depends_on_task_id: dependsOnTaskId }),
    });
    setDependencies((current) => current.some((dependency) => dependency.id === created.id)
      ? current.map((dependency) => dependency.id === created.id ? created : dependency)
      : [...current, created]);
    setDependencyError("");
  }

  async function removeWorkflowDependency(dependencyId: string) {
    if (!selected) return;
    await apiFetch<void>(`/projects/${selected.id}/workflow/dependencies/${dependencyId}/delete`, {
      method: "POST",
    });
    setDependencies((current) => current.filter((dependency) => dependency.id !== dependencyId));
    setDependencyError("");
  }

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />{labels.loading}</div>;

  const filtersActive = Boolean(query.trim()) || status !== "all";
  const canEditSelected = Boolean(selected && user && (
    user.role === "ceo"
    || selected.owner_id === user.id
    || selected.members?.some((member) => member.id === user.id && member.member_role === "manager")
  ));

  return (
    <div className="space-y-4">
      <PageHeader title={labels.title} actions={<Button onClick={openCreate}><Plus />{labels.create}</Button>} />
      {error && activeView === "overview" ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
      <div className="flex justify-center">
        <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border bg-card p-1 shadow-sm" role="tablist" aria-label={labels.title}>
          <Button type="button" size="sm" variant={activeView === "overview" ? "default" : "ghost"} role="tab" aria-selected={activeView === "overview"} className="shrink-0" onClick={() => setActiveView("overview")}><LayoutGrid />{labels.overviewView}</Button>
          <Button type="button" size="sm" variant={activeView === "workflow" ? "default" : "ghost"} role="tab" aria-selected={activeView === "workflow"} className="shrink-0" onClick={() => setActiveView("workflow")}><Workflow />{labels.workflowView}</Button>
        </div>
      </div>

      {activeView === "workflow" ? (
        <ProjectWorkflowView
          projects={projects}
          selected={selected}
          tasks={tasks}
          dependencies={dependencies}
          loading={detailLoading}
          projectError={error}
          dependencyError={dependencyError}
          canManage={canEditSelected}
          onSelectProject={selectWorkflowProject}
          onCreateProject={openCreate}
          onCreateTask={openCreateTask}
          onOpenTask={(taskId) => staffGo(`/task-manager?task=${taskId}`)}
          onAddDependency={addWorkflowDependency}
          onRemoveDependency={removeWorkflowDependency}
        />
      ) : (
        <>
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} className="pl-9" placeholder={labels.search} onChange={(event) => setQuery(event.target.value)} /></div>
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted/50 p-1">
          {(["all", ...statusOrder] as const).map((value) => <Button key={value} type="button" size="sm" variant={status === value ? "default" : "ghost"} className="h-8 shrink-0 text-xs" onClick={() => setStatus(value)}>{labels[value]}</Button>)}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.44fr)]">
        <section className="min-w-0">
          {filtered.length ? (
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {filtered.map((project) => {
                const progress = project.task_total ? Math.round((project.task_completed / project.task_total) * 100) : 0;
                return (
                  <button key={project.id} type="button" className={`min-w-0 rounded-xl border bg-card p-4 text-left transition hover:border-orange-300 hover:shadow-sm ${selectedId === project.id ? "border-orange-400 ring-2 ring-orange-100" : ""}`} onClick={() => selectProject(project)}>
                    <div className="flex items-start justify-between gap-2"><Badge variant="outline" className={statusClass(project.status)}>{labels[project.status]}</Badge><Badge variant="outline" className={priorityClass(project.priority)}>{labels[project.priority]}</Badge></div>
                    <h2 className="mt-3 line-clamp-2 text-base font-semibold text-foreground">{project.name}</h2>
                    <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">{project.description || "—"}</p>
                    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-orange-500" style={{ width: `${progress}%` }} /></div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground"><span>{labels.progress}: {project.task_completed}/{project.task_total}</span><span>{progress}%</span></div>
                    <div className="mt-3 grid gap-2 border-t pt-3 text-sm text-muted-foreground"><span className="flex min-w-0 items-center gap-2"><UsersRound className="size-4 shrink-0" /><span className="truncate text-foreground">{project.owner_name}</span><span>+{Math.max(project.member_count - 1, 0)}</span></span><span className="flex items-center gap-2"><CalendarDays className="size-4" />{dateLabel(project.due_on, lang) ?? labels.noDeadline}</span></div>
                  </button>
                );
              })}
            </div>
          ) : <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed bg-card p-8 text-center"><FolderKanban className="size-10 text-orange-500" /><h2 className="mt-3 font-semibold">{filtersActive ? labels.noMatches : labels.empty}</h2><p className="mt-1 max-w-md text-sm text-muted-foreground">{filtersActive ? labels.noMatchesHint : labels.emptyHint}</p>{filtersActive ? <Button className="mt-4" variant="outline" onClick={() => { setQuery(""); setStatus("all"); }}>{labels.clearFilters}</Button> : <Button className="mt-4" onClick={openCreate}><Plus />{labels.create}</Button>}</div>}
        </section>

        <aside className="min-w-0 rounded-xl border bg-card p-4 xl:sticky xl:top-3 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto">
          {selected ? <>
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap gap-1.5"><Badge variant="outline" className={statusClass(selected.status)}>{labels[selected.status]}</Badge><Badge variant="outline" className={priorityClass(selected.priority)}>{labels[selected.priority]}</Badge></div><h2 className="mt-2 text-lg font-semibold">{selected.name}</h2><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{selected.description || "—"}</p></div><div className="flex shrink-0 gap-1">{canEditSelected ? <Button size="icon" variant="outline" disabled={detailLoading || !selected.members} aria-label={labels.edit} onClick={() => openEdit(selected)}><Pencil /></Button> : null}<Button size="icon" variant="ghost" aria-label={labels.cancel} onClick={clearSelection}><X /></Button></div></div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm"><div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{labels.owner}</p><p className="mt-1 font-medium">{selected.owner_name}</p></div><div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{labels.deadline}</p><p className="mt-1 font-medium">{dateLabel(selected.due_on, lang) ?? labels.noDeadline}</p></div></div>
            <div className="mt-2 rounded-lg bg-muted/40 p-3 text-sm"><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{labels.progress}</span><span>{selected.task_completed}/{selected.task_total}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background" role="progressbar" aria-label={labels.progress} aria-valuemin={0} aria-valuemax={selected.task_total || 1} aria-valuenow={selected.task_completed}><div className="h-full rounded-full bg-orange-500" style={{ width: `${selected.task_total ? Math.round((selected.task_completed / selected.task_total) * 100) : 0}%` }} /></div></div>
            {selected.starts_on || selected.due_on ? <div className="mt-2 rounded-lg border px-3 py-2 text-sm"><span className="text-muted-foreground">{labels.period}: </span><span className="font-medium">{dateLabel(selected.starts_on, lang) ?? "—"} – {dateLabel(selected.due_on, lang) ?? labels.noDeadline}</span></div> : null}
            {selected.patient_name ? <button type="button" className="mt-2 w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:border-orange-300 hover:bg-orange-50/40" onClick={() => staffGo(`/patients/${selected.patient_id}`)}><span className="text-muted-foreground">{labels.patient}: </span><span className="font-medium">{selected.patient_name}</span></button> : null}
            <div className="mt-4"><h3 className="text-sm font-semibold">{labels.team} <Badge variant="secondary">{selected.member_count}</Badge></h3><div className="mt-2 flex flex-wrap gap-1.5">{selected.members?.length ? selected.members.map((member) => <Badge key={member.id} variant="outline" className={member.id === selected.owner_id ? "border-orange-200 bg-orange-50 text-orange-700" : "bg-background"}><UsersRound className="mr-1 size-3" />{member.name}</Badge>) : <span className="text-sm text-muted-foreground">—</span>}</div></div>
            <div className="mt-5 flex items-center justify-between"><h3 className="font-semibold">{labels.tasks} <Badge variant="secondary">{selected.task_total}</Badge></h3><Button size="sm" onClick={openCreateTask}><Plus />{labels.newTask}</Button></div>
            <div className="mt-3 space-y-2">{detailLoading ? <div className="py-8 text-center"><LoaderCircle className="mx-auto size-5 animate-spin text-muted-foreground" /></div> : tasks.length ? tasks.map((task) => <button key={task.id} type="button" className="flex w-full items-start gap-3 rounded-lg border p-3 text-left hover:border-orange-300" onClick={() => staffGo(`/task-manager?task=${task.id}`)}><CheckCircle2 className={`mt-0.5 size-4 shrink-0 ${task.status === "completed" ? "text-emerald-600" : "text-muted-foreground"}`} /><span className="min-w-0 flex-1"><span className="block font-medium text-foreground">{task.title}</span><span className="mt-1 block text-xs text-muted-foreground">{task.assigned_to_name}{task.due_at ? ` · ${new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", { dateStyle: "medium" }).format(new Date(task.due_at))}` : ""}</span></span><Badge variant="outline" className={`shrink-0 text-[10px] ${taskStatusClass(task.status)}`}>{labels[task.status as keyof typeof labels] ?? task.status}</Badge></button>) : <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{labels.noTasks}</p>}</div>
            <p className="mt-4 text-xs text-muted-foreground">{labels.createdBy}: {selected.created_by_name}</p>
          </> : <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground"><FolderKanban className="mb-3 size-9 text-orange-400" />{labels.selectHint}</div>}
        </aside>
      </div>
        </>
      )}

      <ProjectDialog open={dialogOpen} editing={editing} assignees={assignees} patients={patients} lang={lang} saving={saving} error={dialogError} onOpenChange={(open) => { setDialogOpen(open); if (!open) setDialogError(""); }} onSave={saveProject} currentUserId={user?.id ?? ""} />
      <ConciergeTaskEventDialog
        item={null}
        services={[]}
        assignees={taskAssignees}
        currentUserId={user?.id ?? null}
        canAssign={taskAssignees.length > 0}
        canModifyAttachments={false}
        showServiceLink={false}
        patients={taskPatients}
        providers={[]}
        projects={projects}
        initialPatientId={selected?.patient_id ?? null}
        initialProjectId={selected?.id ?? null}
        lang={lang}
        open={taskDialogOpen}
        submitting={taskSubmitting}
        error={taskDialogError}
        onOpenChange={(open) => {
          setTaskDialogOpen(open);
          if (!open) {
            setTaskDialogError("");
            createTaskRequestIdRef.current = null;
          }
        }}
        onSave={saveProjectTask}
      />
    </div>
  );
}

function ProjectDialog({ open, editing, assignees, patients, lang, saving, error, onOpenChange, onSave, currentUserId }: {
  open: boolean; editing: Project | null; assignees: ConciergeAssignee[]; patients: PatientSummary[]; lang: Lang; saving: boolean; error: string;
  onOpenChange: (open: boolean) => void; onSave: (input: ProjectFormValue) => Promise<void>; currentUserId: string;
}) {
  const labels = copy[lang];
  const [name, setName] = useState(""); const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("planned"); const [priority, setPriority] = useState<ProjectPriority>("normal");
  const [ownerId, setOwnerId] = useState(""); const [patientId, setPatientId] = useState("");
  const [startsOn, setStartsOn] = useState(""); const [dueOn, setDueOn] = useState(""); const [memberIds, setMemberIds] = useState<string[]>([]);
  useEffect(() => { if (!open) return; setName(editing?.name ?? ""); setDescription(editing?.description ?? ""); setStatus(editing?.status ?? "planned"); setPriority(editing?.priority ?? "normal"); setOwnerId(editing?.owner_id ?? currentUserId); setPatientId(editing?.patient_id ?? ""); setStartsOn(editing?.starts_on ?? ""); setDueOn(editing?.due_on ?? ""); setMemberIds(editing?.members?.map((member) => member.id) ?? [editing?.owner_id ?? currentUserId].filter(Boolean)); }, [currentUserId, editing, open]);
  async function submit(event: FormEvent) { event.preventDefault(); await onSave({ name: name.trim(), description: description.trim() || null, status, priority, owner_id: ownerId, patient_id: patientId || null, starts_on: startsOn || null, due_on: dueOn || null, member_ids: Array.from(new Set([...memberIds, ownerId])) }); }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><span className="size-2 rounded-full bg-orange-500" />{editing ? labels.edit : labels.createTitle}</DialogTitle></DialogHeader><form onSubmit={(event) => void submit(event)} className="space-y-4">
    {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
    <label className="grid gap-1.5 text-sm font-medium">{labels.name}<Input required maxLength={255} value={name} placeholder={labels.namePlaceholder} onChange={(event) => setName(event.target.value)} /></label>
    <label className="grid gap-1.5 text-sm font-medium">{labels.description}<textarea className="min-h-24 rounded-md border bg-field px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/45 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30" maxLength={8000} value={description} placeholder={labels.descriptionPlaceholder} onChange={(event) => setDescription(event.target.value)} /></label>
    <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">{labels.owner}<NativeComboboxSelect value={ownerId} required onChange={(event) => setOwnerId(event.target.value)}>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}</NativeComboboxSelect></label><label className="grid gap-1.5 text-sm font-medium">{labels.patient}<NativeComboboxSelect value={patientId} onChange={(event) => setPatientId(event.target.value)}><option value="">{labels.noPatient}</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{[patient.first_name, patient.last_name].filter(Boolean).join(" ") || patient.patient_id}</option>)}</NativeComboboxSelect></label></div>
    <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">{labels.status}<select className="h-9 rounded-md border bg-field px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}>{statusOrder.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></label><label className="grid gap-1.5 text-sm font-medium">{labels.priority}<select className="h-9 rounded-md border bg-field px-3 text-sm" value={priority} onChange={(event) => setPriority(event.target.value as ProjectPriority)}>{(["low", "normal", "high", "urgent"] as const).map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></label></div>
    <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">{labels.starts}<Input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label><label className="grid gap-1.5 text-sm font-medium">{labels.due}<Input type="date" min={startsOn || undefined} value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></label></div>
    <fieldset className="rounded-lg border p-3"><legend className="px-1 text-sm font-medium">{labels.members}</legend><div className="grid max-h-40 gap-2 overflow-y-auto sm:grid-cols-2">{assignees.map((assignee) => <label key={assignee.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"><input type="checkbox" className="size-4 accent-orange-500" checked={memberIds.includes(assignee.id) || ownerId === assignee.id} disabled={ownerId === assignee.id} onChange={(event) => setMemberIds((current) => event.target.checked ? [...current, assignee.id] : current.filter((id) => id !== assignee.id))} /><span className="truncate">{assignee.name}</span></label>)}</div></fieldset>
    <DialogFooter className="sticky -bottom-4 z-10 border-t bg-background/95 pb-1 pt-4 backdrop-blur"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{labels.cancel}</Button><Button type="submit" disabled={saving || !name.trim() || !ownerId}>{saving ? <LoaderCircle className="animate-spin" /> : null}{labels.save}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}
