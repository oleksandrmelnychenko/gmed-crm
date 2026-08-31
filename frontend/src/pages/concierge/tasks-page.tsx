import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ClipboardPlus, LoaderCircle, Plus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { PageHeader } from "@/components/ui-shell";
import { apiFetch, clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang, type Lang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";

import {
  assignableConciergeTaskUsers,
  availableConciergeTaskStatuses,
  canChangeConciergeTaskStatus,
  canDeleteConciergeTask,
  canModifyConciergeTask,
  conciergeOperationalItemsListPath,
  conciergeTaskErrorMessage,
  conciergeTasksVisibleToActor,
  filterConciergeTaskAssignees,
  type ConciergeAssignee,
  type ConciergeProvider,
  type ConciergeService,
  type ConciergeTask,
  type ConciergeTaskStatus,
} from "./model";
import { ConciergeTaskDetailDialog } from "./task-detail-dialog";
import {
  ConciergeTaskEventDialog,
  type SaveConciergeOperationalItemInput,
} from "./task-event-dialog";
import { ConciergeTaskManager } from "./task-manager";
import type { PatientSummary } from "@/pages/patients/model/list-model";
import type { ConciergeTaskPatientOption } from "./task-event-dialog";

type TaskProjectOption = { id: string; name: string; status: string };

const REALTIME_EVENTS = [
  "concierge_operational_item.created",
  "concierge_operational_item.updated",
  "concierge_operational_item.deleted",
  "concierge_operational_item.archived",
  "concierge_operational_item.restored",
  "concierge_operational_item.reminder_sent",
  "concierge_operational_item.comment_added",
  "concierge_operational_item.comment_edited",
  "concierge_operational_item.comment_deleted",
  "concierge_operational_item.checklist_item_added",
  "concierge_operational_item.checklist_item_toggled",
  "concierge_operational_item.checklist_item_edited",
  "concierge_operational_item.checklist_item_deleted",
] as const;

const copy = {
  de: {
    title: "Aufgabenmanager",
    subtitle: "Aufgaben verteilen, Termine planen und Fristen im Blick behalten",
    newTask: "Aufgabe / Termin",
    newServiceTask: "Concierge-Aufgabe",
    serviceRequired: "Wählen Sie einen Service für die Concierge-Aufgabe aus.",
    refresh: "Aktualisieren",
    loading: "Aufgabenmanager wird geladen",
    loadFailed: "Der Aufgabenmanager konnte nicht geladen werden.",
    updateFailed: "Die Aufgabe konnte nicht aktualisiert werden.",
    deleteTitle: "Aufgabe löschen?",
    deleteMessage: "Die Aufgabe wird aus dem Aufgabenmanager entfernt. Der Audit-Verlauf bleibt erhalten.",
    delete: "Löschen",
    cancel: "Abbrechen",
    deleteFailed: "Die Aufgabe konnte nicht gelöscht werden.",
    retry: "Erneut laden",
    archiveFailed: "Die Aufgabe konnte nicht archiviert werden.",
    restoreFailed: "Die Aufgabe konnte nicht wiederhergestellt werden.",
    myTitle: "Meine Aufgaben",
    mySubtitle: "Persönliche Aufgaben, Termine und Fristen",
  },
  ru: {
    title: "Менеджер задач",
    subtitle: "Распределение задач, календарь событий и контроль сроков",
    newTask: "Задача / событие",
    newServiceTask: "Консьерж-задача",
    serviceRequired: "Для консьерж-задачи выберите связанный сервис.",
    refresh: "Обновить",
    loading: "Загрузка менеджера задач",
    loadFailed: "Не удалось загрузить менеджер задач.",
    updateFailed: "Не удалось обновить задачу.",
    deleteTitle: "Удалить задачу?",
    deleteMessage: "Задача исчезнет из менеджера задач. Аудит действий будет сохранён.",
    delete: "Удалить",
    cancel: "Отмена",
    deleteFailed: "Не удалось удалить задачу.",
    retry: "Повторить",
    archiveFailed: "Не удалось переместить задачу в архив.",
    restoreFailed: "Не удалось восстановить задачу из архива.",
    myTitle: "Мои задачи",
    mySubtitle: "Личные задачи, события и сроки",
  },
} as const satisfies Record<Lang, Record<string, string>>;

export function ConciergeTaskManagerPage() {
  const { lang } = useLang();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const labels = copy[lang];
  const [tasks, setTasks] = useState<ConciergeTask[]>([]);
  const [assignees, setAssignees] = useState<ConciergeAssignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [archivingTaskId, setArchivingTaskId] = useState<string | null>(null);
  const [pendingDeleteTask, setPendingDeleteTask] = useState<ConciergeTask | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ConciergeTask | null>(null);
  const [submittingTask, setSubmittingTask] = useState(false);
  const [taskError, setTaskError] = useState("");
  const [patients, setPatients] = useState<ConciergeTaskPatientOption[]>([]);
  const [providers, setProviders] = useState<ConciergeProvider[]>([]);
  const [services, setServices] = useState<ConciergeService[]>([]);
  const [projects, setProjects] = useState<TaskProjectOption[]>([]);
  const [initialTaskDate, setInitialTaskDate] = useState<Date | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(() => searchParams.get("task"));
  const [serviceTaskMode, setServiceTaskMode] = useState(false);
  const [detailExpenseRequested, setDetailExpenseRequested] = useState(false);
  const hasLoadedRef = useRef(false);
  const createTaskRequestIdRef = useRef<string | null>(null);
  const taskParam = searchParams.get("task");
  const now = useMemo(() => new Date(), [tasks, version]);
  const isPersonalConcierge = user?.role === "concierge" || user?.role === "interpreter";
  const taskListPath = useMemo(
    () => conciergeOperationalItemsListPath(user?.id, user?.role, "all"),
    [user?.id, user?.role],
  );

  const requestRefresh = useCallback(() => {
    clearApiCache("/concierge-operational-items");
    clearApiCache("/concierge-operational-items/assignees");
    clearApiCache("/patients");
    clearApiCache("/providers");
    clearApiCache("/concierge-services");
    clearApiCache("/projects");
    setVersion((current) => current + 1);
  }, []);

  useDebouncedRealtimeSubscription(REALTIME_EVENTS, requestRefresh, 250);

  useEffect(() => {
    setDetailTaskId(taskParam);
  }, [taskParam]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!hasLoadedRef.current) setLoading(true);
      setError("");
      try {
        const [taskRows, assigneeRows, patientRows, providerRows, serviceRows, projectRows] = await Promise.all([
          apiFetch<ConciergeTask[]>(taskListPath, {
            cacheTtlMs: 10_000,
            forceFresh: version > 0,
          }),
          apiFetch<ConciergeAssignee[]>("/concierge-operational-items/assignees", {
            cacheTtlMs: 30_000,
            forceFresh: version > 0,
          })
            .then(filterConciergeTaskAssignees)
            .catch(() => user ? [{
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
              is_active: true,
            }] : []),
          apiFetch<PatientSummary[]>("/patients?active_only=true", {
            cacheTtlMs: 30_000,
            forceFresh: version > 0,
          }).catch(() => []),
          apiFetch<ConciergeProvider[]>("/providers?active_only=true", {
            cacheTtlMs: 30_000,
            forceFresh: version > 0,
          }).catch(() => []),
          apiFetch<ConciergeService[]>(user?.role === "ceo" ? "/concierge-services" : "/concierge-services?mine_only=true", {
            cacheTtlMs: 30_000,
            forceFresh: version > 0,
          }).catch(() => []),
          apiFetch<TaskProjectOption[]>("/projects", {
            cacheTtlMs: 30_000,
            forceFresh: version > 0,
          }).catch(() => []),
        ]);
        if (!cancelled) {
          setTasks(conciergeTasksVisibleToActor(taskRows, user?.id, user?.role));
          setAssignees(assignableConciergeTaskUsers(assigneeRows, user?.id, user?.role));
          setPatients(patientRows.map((patient) => ({
            id: patient.id,
            name: [patient.first_name, patient.last_name].filter(Boolean).join(" ") || patient.patient_id,
          })).sort((left, right) => left.name.localeCompare(right.name)));
          setProviders(providerRows.sort((left, right) => left.name.localeCompare(right.name)));
          setServices(serviceRows);
          setProjects(projectRows.filter((project) => !["completed", "cancelled"].includes(project.status)));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : labels.loadFailed);
        }
      } finally {
        if (!cancelled) {
          hasLoadedRef.current = true;
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [labels.loadFailed, taskListPath, user, version]);

  useEffect(() => {
    if (loading || !detailTaskId || tasks.some((task) => task.id === detailTaskId)) return;
    setDetailTaskId(null);
    const next = new URLSearchParams(searchParams);
    next.delete("task");
    setSearchParams(next, { replace: true });
  }, [detailTaskId, loading, searchParams, setSearchParams, tasks]);

  async function changeTaskStatus(task: ConciergeTask, status: string) {
    if (updatingTaskId || !canChangeConciergeTaskStatus(task, user?.id, user?.role)) return;
    if (!availableConciergeTaskStatuses(task, user?.id, user?.role).includes(status as ConciergeTaskStatus)) return;
    setUpdatingTaskId(task.id);
    setError("");
    try {
      const updated = await apiFetch<ConciergeTask>(`/concierge-operational-items/${task.id}/status`, {
        method: "POST",
        body: JSON.stringify({
          expected_updated_at: task.updated_at,
          status,
        }),
      });
      clearApiCache("/concierge-operational-items");
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (updateError) {
      setError(conciergeTaskErrorMessage(updateError, lang, labels.updateFailed));
    } finally {
      setUpdatingTaskId(null);
    }
  }

  function openCreateTask(date: Date | null = null, requireService = false) {
    setTaskError("");
    setEditingTask(null);
    createTaskRequestIdRef.current = crypto.randomUUID();
    setInitialTaskDate(date);
    setServiceTaskMode(requireService);
    setTaskDialogOpen(true);
  }

  function openEditTask(task: ConciergeTask, requireService = false) {
    if (!canModifyConciergeTask(task, user?.id, user?.role)) return;
    setTaskError("");
    setEditingTask(task);
    setInitialTaskDate(null);
    setServiceTaskMode(requireService);
    setTaskDialogOpen(true);
  }

  useEffect(() => {
    if (loading || searchParams.get("create") !== "1" || taskDialogOpen) return;
    openCreateTask();
  }, [loading, searchParams, taskDialogOpen]);

  function openTaskDetail(task: ConciergeTask) {
    setDetailExpenseRequested(false);
    setDetailTaskId(task.id);
    const next = new URLSearchParams(searchParams);
    next.set("task", task.id);
    setSearchParams(next, { replace: true });
  }

  function openTaskExpense(task: ConciergeTask) {
    if (!task.concierge_service_id) return;
    if (user?.role !== "ceo" && !(user?.role === "concierge" && task.assigned_to === user.id)) return;
    setDetailExpenseRequested(true);
    setDetailTaskId(task.id);
    const next = new URLSearchParams(searchParams);
    next.set("task", task.id);
    setSearchParams(next, { replace: true });
  }

  async function saveTask(input: SaveConciergeOperationalItemInput): Promise<ConciergeTask> {
    if (submittingTask) throw new Error(labels.updateFailed);
    if (editingTask && !canModifyConciergeTask(editingTask, user?.id, user?.role)) throw new Error(labels.updateFailed);
    setSubmittingTask(true);
    setTaskError("");
    setError("");
    try {
      if (serviceTaskMode && !input.concierge_service_id) {
        const validationError = new Error(labels.serviceRequired);
        setTaskError(labels.serviceRequired);
        throw validationError;
      }
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
      if (serviceTaskMode && editingTask) {
        setDetailExpenseRequested(true);
        setDetailTaskId(saved.id);
        const next = new URLSearchParams(searchParams);
        next.set("task", saved.id);
        setSearchParams(next, { replace: true });
      }
      return saved;
    } catch (saveError) {
      setTaskError(conciergeTaskErrorMessage(saveError, lang, labels.updateFailed));
      throw saveError;
    } finally {
      setSubmittingTask(false);
    }
  }

  async function deleteTask(task: ConciergeTask) {
    if (deletingTaskId || !canDeleteConciergeTask(task, user?.id, user?.role)) return;
    setDeletingTaskId(task.id);
    setError("");
    try {
      await apiFetch<void>(`/concierge-operational-items/${task.id}`, { method: "DELETE" });
      clearApiCache("/concierge-operational-items");
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setPendingDeleteTask(null);
      if (detailTaskId === task.id) {
        setDetailTaskId(null);
        const next = new URLSearchParams(searchParams);
        next.delete("task");
        setSearchParams(next, { replace: true });
      }
    } catch (deleteError) {
      setError(conciergeTaskErrorMessage(deleteError, lang, labels.deleteFailed));
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
          archive ? labels.archiveFailed : labels.restoreFailed,
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
        {labels.loading}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="concierge-task-manager-page">
      <PageHeader
        title={isPersonalConcierge ? labels.myTitle : labels.title}
        description={isPersonalConcierge ? labels.mySubtitle : labels.subtitle}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" className="h-9 rounded-lg px-3.5" onClick={() => openCreateTask()}>
              <Plus />{labels.newTask}
            </Button>
            {services.length > 0 ? (
              <Button type="button" className="h-9 rounded-lg px-3.5" onClick={() => openCreateTask(null, true)}>
                <ClipboardPlus />{labels.newServiceTask}
              </Button>
            ) : null}
          </div>
        )}
      />

      {error ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={requestRefresh}>
            <RefreshCw />{labels.retry}
          </Button>
        </div>
      ) : null}

      <ConciergeTaskManager
        tasks={tasks}
        assignees={assignees}
        lang={lang}
        now={now}
        canManageTeam={!isPersonalConcierge && assignees.some((assignee) => assignee.id !== user?.id)}
        updatingTaskId={updatingTaskId}
        deletingTaskId={deletingTaskId}
        archivingTaskId={archivingTaskId}
        canModifyTask={(task) => canModifyConciergeTask(task, user?.id, user?.role)}
        canDeleteTask={(task) => canDeleteConciergeTask(task, user?.id, user?.role)}
        canChangeTaskStatus={(task) => canChangeConciergeTaskStatus(task, user?.id, user?.role)}
        canAddExpenseToTask={(task) => Boolean(
          task.concierge_service_id
          && (user?.role === "ceo" || (user?.role === "concierge" && task.assigned_to === user.id)),
        )}
        availableStatusesForTask={(task) => availableConciergeTaskStatuses(task, user?.id, user?.role)}
        onEdit={openEditTask}
        onDelete={setPendingDeleteTask}
        onArchive={(task) => void changeArchiveState(task, true)}
        onRestore={(task) => void changeArchiveState(task, false)}
        onOpen={openTaskDetail}
        onExpense={openTaskExpense}
        onStatusChange={(task, status) => void changeTaskStatus(task, status)}
        onCreateAt={(date) => openCreateTask(date)}
      />

      <ConciergeTaskEventDialog
        item={editingTask}
        services={services}
        assignees={assignees}
        currentUserId={user?.id ?? null}
        canAssign={assignees.length > 0}
        canModifyAttachments={Boolean(editingTask && canModifyConciergeTask(editingTask, user?.id, user?.role))}
        showServiceLink={services.length > 0 || Boolean(editingTask?.concierge_service_id)}
        serviceLinkRequired={serviceTaskMode}
        patients={patients}
        providers={providers}
        projects={projects}
        initialPatientId={searchParams.get("patient")}
        initialProviderId={searchParams.get("provider")}
        initialProjectId={searchParams.get("project")}
        initialDate={initialTaskDate}
        lang={lang}
        open={taskDialogOpen}
        submitting={submittingTask}
        error={taskError}
        onOpenChange={(open) => {
          setTaskDialogOpen(open);
          if (!open) {
            setEditingTask(null);
            setInitialTaskDate(null);
            setServiceTaskMode(false);
            createTaskRequestIdRef.current = null;
            const next = new URLSearchParams(searchParams);
            next.delete("create");
            next.delete("patient");
            next.delete("provider");
            next.delete("project");
            setSearchParams(next, { replace: true });
          }
        }}
        onSave={saveTask}
      />

      <ConciergeTaskDetailDialog
        taskId={detailTaskId}
        lang={lang}
        open={Boolean(detailTaskId)}
        openExpenseOnLoad={detailExpenseRequested}
        onOpenChange={(open) => {
          if (open) return;
          setDetailTaskId(null);
          setDetailExpenseRequested(false);
          const next = new URLSearchParams(searchParams);
          next.delete("task");
          setSearchParams(next, { replace: true });
        }}
        onChanged={requestRefresh}
      />

      <DirtyDismissConfirmDialog
        open={Boolean(pendingDeleteTask)}
        title={labels.deleteTitle}
        message={labels.deleteMessage}
        cancelLabel={labels.cancel}
        confirmLabel={labels.delete}
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
