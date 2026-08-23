import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LoaderCircle, Plus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-shell";
import { apiFetch, clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang, type Lang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";

import {
  filterConciergeTaskAssignees,
  type ConciergeAssignee,
  type ConciergeTask,
} from "./model";
import { ConciergeTaskDetailDialog } from "./task-detail-dialog";
import {
  ConciergeTaskEventDialog,
  type SaveConciergeOperationalItemInput,
} from "./task-event-dialog";
import { ConciergeTaskManager } from "./task-manager";
import type { PatientSummary } from "@/pages/patients/model/list-model";
import type { ConciergeTaskPatientOption } from "./task-event-dialog";

const REALTIME_EVENTS = [
  "concierge_operational_item.created",
  "concierge_operational_item.updated",
  "concierge_operational_item.reminder_sent",
  "concierge_operational_item.comment_added",
  "concierge_operational_item.checklist_item_added",
  "concierge_operational_item.checklist_item_toggled",
] as const;

const copy = {
  de: {
    title: "Aufgabenmanager",
    subtitle: "Aufgaben verteilen, Termine planen und Fristen im Blick behalten",
    newTask: "Aufgabe / Termin",
    refresh: "Aktualisieren",
    loading: "Aufgabenmanager wird geladen",
    loadFailed: "Der Aufgabenmanager konnte nicht geladen werden.",
    updateFailed: "Die Aufgabe konnte nicht aktualisiert werden.",
    retry: "Erneut laden",
  },
  ru: {
    title: "Менеджер задач",
    subtitle: "Распределение задач, календарь событий и контроль сроков",
    newTask: "Задача / событие",
    refresh: "Обновить",
    loading: "Загрузка менеджера задач",
    loadFailed: "Не удалось загрузить менеджер задач.",
    updateFailed: "Не удалось обновить задачу.",
    retry: "Повторить",
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
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ConciergeTask | null>(null);
  const [submittingTask, setSubmittingTask] = useState(false);
  const [taskError, setTaskError] = useState("");
  const [patients, setPatients] = useState<ConciergeTaskPatientOption[]>([]);
  const [initialTaskDate, setInitialTaskDate] = useState<Date | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(() => searchParams.get("task"));
  const hasLoadedRef = useRef(false);
  const createTaskRequestIdRef = useRef<string | null>(null);
  const taskParam = searchParams.get("task");
  const now = useMemo(() => new Date(), [tasks, version]);

  const requestRefresh = useCallback(() => {
    clearApiCache("/concierge-operational-items");
    clearApiCache("/users");
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
        const [taskRows, assigneeRows, patientRows] = await Promise.all([
          apiFetch<ConciergeTask[]>("/concierge-operational-items", {
            cacheTtlMs: 10_000,
            forceFresh: version > 0,
          }),
          user?.role === "ceo"
            ? apiFetch<ConciergeAssignee[]>("/users?active_only=true", {
                cacheTtlMs: 30_000,
                forceFresh: version > 0,
              }).then(filterConciergeTaskAssignees)
            : Promise.resolve(
                user
                  ? [{
                      id: user.id,
                      name: user.name,
                      email: user.email,
                      role: user.role,
                      is_active: true,
                    }]
                  : [],
              ),
          apiFetch<PatientSummary[]>("/patients?active_only=true", {
            cacheTtlMs: 30_000,
            forceFresh: version > 0,
          }),
        ]);
        if (!cancelled) {
          setTasks(taskRows);
          setAssignees(assigneeRows);
          setPatients(patientRows.map((patient) => ({
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
          hasLoadedRef.current = true;
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [labels.loadFailed, user, version]);

  async function changeTaskStatus(task: ConciergeTask, status: string) {
    if (updatingTaskId) return;
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
          external_assignee_type: task.external_assignee_type,
          external_assignee_name: task.external_assignee_name,
          external_assignee_phone: task.external_assignee_phone,
          external_assignee_email: task.external_assignee_email,
        }),
      });
      clearApiCache("/concierge-operational-items");
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : labels.updateFailed);
    } finally {
      setUpdatingTaskId(null);
    }
  }

  function openCreateTask(date: Date | null = null) {
    setTaskError("");
    setEditingTask(null);
    createTaskRequestIdRef.current = crypto.randomUUID();
    setInitialTaskDate(date);
    setTaskDialogOpen(true);
  }

  function openEditTask(task: ConciergeTask) {
    setTaskError("");
    setEditingTask(task);
    setInitialTaskDate(null);
    setTaskDialogOpen(true);
  }

  useEffect(() => {
    if (loading || searchParams.get("create") !== "1" || taskDialogOpen) return;
    openCreateTask();
  }, [loading, searchParams, taskDialogOpen]);

  function openTaskDetail(task: ConciergeTask) {
    setDetailTaskId(task.id);
    const next = new URLSearchParams(searchParams);
    next.set("task", task.id);
    setSearchParams(next, { replace: true });
  }

  async function saveTask(input: SaveConciergeOperationalItemInput) {
    if (submittingTask) return;
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
      setTaskDialogOpen(false);
      setEditingTask(null);
      createTaskRequestIdRef.current = null;
    } catch (saveError) {
      setTaskError(saveError instanceof Error ? saveError.message : labels.updateFailed);
      throw saveError;
    } finally {
      setSubmittingTask(false);
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
        title={labels.title}
        description={labels.subtitle}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" className="h-9 rounded-lg px-3.5" onClick={() => openCreateTask()}>
              <Plus />{labels.newTask}
            </Button>
            <Button type="button" variant="outline" className="h-9 rounded-lg px-3.5" onClick={requestRefresh}>
              <RefreshCw />{labels.refresh}
            </Button>
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
        canManageTeam={user?.role === "ceo"}
        updatingTaskId={updatingTaskId}
        onEdit={openEditTask}
        onOpen={openTaskDetail}
        onStatusChange={(task, status) => void changeTaskStatus(task, status)}
        onCreateAt={(date) => openCreateTask(date)}
      />

      <ConciergeTaskEventDialog
        item={editingTask}
        services={[]}
        assignees={assignees}
        currentUserId={user?.id ?? null}
        canAssign={user?.role === "ceo"}
        showServiceLink={false}
        patients={patients}
        initialPatientId={searchParams.get("patient")}
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
            createTaskRequestIdRef.current = null;
            const next = new URLSearchParams(searchParams);
            next.delete("create");
            next.delete("patient");
            setSearchParams(next, { replace: true });
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
    </div>
  );
}
