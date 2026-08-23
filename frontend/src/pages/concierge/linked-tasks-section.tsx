import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  CalendarClock,
  LoaderCircle,
  Plus,
  RefreshCw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch, clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang, type Lang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
import type { PatientSummary } from "@/pages/patients/model/list-model";

import {
  assignableConciergeTaskUsers,
  conciergeTaskCode,
  filterConciergeTaskAssignees,
  isConciergeTaskActive,
  type ConciergeAssignee,
  type ConciergeProvider,
  type ConciergeTask,
} from "./model";
import {
  ConciergeTaskEventDialog,
  type ConciergeTaskPatientOption,
  type SaveConciergeOperationalItemInput,
} from "./task-event-dialog";

export const OPEN_PATIENT_TASK_CREATOR_EVENT = "gmed:open-patient-task-creator";

const REALTIME_EVENTS = [
  "concierge_operational_item.created",
  "concierge_operational_item.updated",
  "concierge_operational_item.deleted",
] as const;

const copy = {
  de: {
    title: "Verknüpfte Aufgaben",
    open: "Offene Aufgaben",
    create: "Aufgabe erstellen",
    task: "Aufgabe",
    status: "Status",
    assignee: "Zuständig",
    due: "Termin",
    noDate: "Ohne Termin",
    empty: "Mit diesem Profil sind noch keine Aufgaben verknüpft.",
    loadFailed: "Die verknüpften Aufgaben konnten nicht geladen werden.",
    retry: "Erneut laden",
    openTask: "Aufgabe öffnen",
    open_status: "Offen",
    in_progress: "In Arbeit",
    completed: "Erledigt",
    cancelled: "Storniert",
    task_kind: "Aufgabe",
    event_kind: "Termin",
  },
  ru: {
    title: "Связанные задачи",
    open: "Открытых задач",
    create: "Создать задачу",
    task: "Задача",
    status: "Статус",
    assignee: "Исполнитель",
    due: "Срок",
    noDate: "Без срока",
    empty: "К этому профилю пока не привязано ни одной задачи.",
    loadFailed: "Не удалось загрузить связанные задачи.",
    retry: "Повторить",
    openTask: "Открыть задачу",
    open_status: "Открыта",
    in_progress: "В работе",
    completed: "Выполнена",
    cancelled: "Отменена",
    task_kind: "Задача",
    event_kind: "Событие",
  },
} as const satisfies Record<Lang, Record<string, string>>;

export function linkedTaskOpenCount(tasks: ConciergeTask[]) {
  return tasks.filter(isConciergeTaskActive).length;
}

export function linkedTasksRequestPath({
  patientId,
  providerId,
}: {
  patientId?: string;
  providerId?: string;
}) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient_id", patientId);
  if (providerId) params.set("provider_id", providerId);
  return `/concierge-operational-items?${params.toString()}`;
}

function scheduledAt(task: ConciergeTask) {
  return task.kind === "event" ? task.starts_at : task.due_at;
}

function sortedLinkedTasks(tasks: ConciergeTask[]) {
  return [...tasks].sort((left, right) => {
    const activeDelta = Number(isConciergeTaskActive(right)) - Number(isConciergeTaskActive(left));
    if (activeDelta !== 0) return activeDelta;
    const leftAt = scheduledAt(left) ?? left.created_at;
    const rightAt = scheduledAt(right) ?? right.created_at;
    return leftAt.localeCompare(rightAt);
  });
}

function statusTone(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "cancelled") return "border-slate-200 bg-slate-50 text-slate-600";
  if (status === "in_progress") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function taskStatusLabel(status: string, lang: Lang) {
  const labels = copy[lang];
  if (status === "open") return labels.open_status;
  if (status === "in_progress") return labels.in_progress;
  if (status === "completed") return labels.completed;
  if (status === "cancelled") return labels.cancelled;
  return status;
}

function taskDateLabel(task: ConciergeTask, lang: Lang, fallback: string) {
  const value = scheduledAt(task);
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function LinkedTasksSection({
  patientId,
  patientName,
  providerId,
  className,
}: {
  patientId?: string;
  patientName?: string;
  providerId?: string;
  className?: string;
}) {
  const { lang } = useLang();
  const { user } = useAuth();
  const labels = copy[lang];
  const { staffGo } = useStaffNavigate();
  const [tasks, setTasks] = useState<ConciergeTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");
  const [assignees, setAssignees] = useState<ConciergeAssignee[]>([]);
  const [patients, setPatients] = useState<ConciergeTaskPatientOption[]>([]);
  const [providers, setProviders] = useState<ConciergeProvider[]>([]);
  const createRequestIdRef = useRef<string | null>(null);
  const requestPath = useMemo(
    () => linkedTasksRequestPath({ patientId, providerId }),
    [patientId, providerId],
  );

  const refresh = useCallback(() => setVersion((current) => current + 1), []);
  useDebouncedRealtimeSubscription(REALTIME_EVENTS, refresh, 250);

  const openContextTaskCreator = useCallback(() => {
    if (!patientId && !providerId) return;
    createRequestIdRef.current = crypto.randomUUID();
    setCreateError("");
    setCreateOpen(true);
  }, [patientId, providerId]);

  useEffect(() => {
    if (!patientId) return;
    const handleOpen = (event: Event) => {
      const requestedPatientId = (event as CustomEvent<{ patientId?: string }>).detail?.patientId;
      if (requestedPatientId === patientId) openContextTaskCreator();
    };
    window.addEventListener(OPEN_PATIENT_TASK_CREATOR_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_PATIENT_TASK_CREATOR_EVENT, handleOpen);
  }, [openContextTaskCreator, patientId]);

  useEffect(() => {
    if (!createOpen || (!patientId && !providerId)) return;
    let cancelled = false;
    void Promise.all([
      apiFetch<ConciergeAssignee[]>("/concierge-operational-items/assignees", { cacheTtlMs: 30_000 })
        .then(filterConciergeTaskAssignees)
        .catch(() => user ? [{ id: user.id, name: user.name, email: user.email, role: user.role, is_active: true }] : []),
      apiFetch<ConciergeProvider[]>("/providers?active_only=true", { cacheTtlMs: 30_000 }).catch(() => []),
      apiFetch<PatientSummary[]>("/patients?active_only=true", { cacheTtlMs: 30_000 }).catch(() => []),
    ]).then(([userRows, providerRows, patientRows]) => {
      if (cancelled) return;
      setAssignees(assignableConciergeTaskUsers(userRows, user?.id, user?.role));
      setProviders([...providerRows].sort((left, right) => left.name.localeCompare(right.name)));
      setPatients(patientRows.map((patient) => ({
        id: patient.id,
        name: [patient.first_name, patient.last_name].filter(Boolean).join(" ") || patient.patient_id,
      })).sort((left, right) => left.name.localeCompare(right.name)));
    });
    return () => { cancelled = true; };
  }, [createOpen, patientId, providerId, user]);

  async function createContextTask(input: SaveConciergeOperationalItemInput): Promise<ConciergeTask> {
    if ((!patientId && !providerId) || submitting) throw new Error(labels.loadFailed);
    setSubmitting(true);
    setCreateError("");
    try {
      const { status: _status, ...fields } = input;
      void _status;
      const requestId = createRequestIdRef.current ?? crypto.randomUUID();
      createRequestIdRef.current = requestId;
      const saved = await apiFetch<ConciergeTask>("/concierge-operational-items", {
        method: "POST",
        body: JSON.stringify({
          ...fields,
          patient_id: patientId ?? fields.patient_id,
          provider_id: providerId ?? fields.provider_id,
          request_id: requestId,
        }),
      });
      clearApiCache("/concierge-operational-items");
      refresh();
      return saved;
    } catch (saveError) {
      setCreateError(saveError instanceof Error ? saveError.message : labels.loadFailed);
      throw saveError;
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void apiFetch<ConciergeTask[]>(requestPath, {
      cacheTtlMs: 10_000,
      forceFresh: version > 0,
    })
      .then((rows) => {
        if (!cancelled) setTasks(rows);
      })
      .catch(() => {
        if (!cancelled) setError(labels.loadFailed);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [labels.loadFailed, requestPath, version]);

  const rows = useMemo(() => sortedLinkedTasks(tasks), [tasks]);
  const openCount = linkedTaskOpenCount(tasks);
  return (
    <section
      className={cn("overflow-hidden rounded-lg border border-border/70 bg-card", className)}
      data-testid="linked-tasks-section"
    >
      <div className="flex flex-col gap-3 border-b border-border/70 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">{labels.title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {loading ? (
                <span className="inline-flex items-center gap-1.5">
                  <LoaderCircle className="size-3 animate-spin" />
                  {labels.open}: …
                </span>
              ) : (
                <span className={cn("font-semibold", openCount > 0 ? "text-orange-700" : "text-emerald-700")}>
                  {labels.open}: {openCount}
                </span>
              )}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-8 self-start rounded-lg sm:self-auto"
          onClick={openContextTaskCreator}
        >
          <Plus className="size-3.5" />
          {labels.create}
        </Button>
      </div>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 text-sm text-destructive">
          <span>{error}</span>
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={refresh}>
            <RefreshCw className="size-3.5" />
            {labels.retry}
          </Button>
        </div>
      ) : loading ? (
        <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" />
          {labels.title}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <div role="list" aria-label={labels.title}>
          <div className="hidden grid-cols-[minmax(0,1fr)_8rem_minmax(8rem,0.42fr)_10rem_2rem] gap-3 border-b border-border/60 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid">
            <span>{labels.task}</span>
            <span>{labels.status}</span>
            <span>{labels.assignee}</span>
            <span>{labels.due}</span>
            <span />
          </div>
          {rows.map((task) => (
            <button
              key={task.id}
              type="button"
              role="listitem"
              aria-label={`${labels.openTask}: ${task.title}`}
              className="group grid w-full min-w-0 gap-2 border-b border-border/60 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-orange-50/30 md:grid-cols-[minmax(0,1fr)_8rem_minmax(8rem,0.42fr)_10rem_2rem] md:items-center md:gap-3"
              onClick={() => staffGo(`/task-manager?task=${encodeURIComponent(task.id)}`)}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono text-[10px] font-medium text-muted-foreground">{conciergeTaskCode(task)}</span>
                  <p className="truncate text-sm font-semibold text-foreground">{task.title}</p>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {task.kind === "event" ? labels.event_kind : labels.task_kind}
                </p>
              </div>
              <div>
                <Badge variant="outline" className={cn("rounded-full text-[10px]", statusTone(task.status))}>
                  {taskStatusLabel(task.status, lang)}
                </Badge>
              </div>
              <span className="truncate text-xs text-muted-foreground">{task.assigned_to_name || "—"}</span>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarClock className="size-3.5 shrink-0" />
                {taskDateLabel(task, lang, labels.noDate)}
              </span>
              <ArrowUpRight className="hidden size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-orange-700 md:block" />
            </button>
          ))}
        </div>
      )}
      {patientId || providerId ? (
        <ConciergeTaskEventDialog
          item={null}
          services={[]}
          assignees={assignees}
          currentUserId={user?.id ?? null}
          canAssign={assignees.length > 1}
          showServiceLink={false}
          patients={patientId && !patients.some((patient) => patient.id === patientId)
            ? [{ id: patientId, name: patientName || patientId }, ...patients]
            : patients}
          providers={providers}
          initialPatientId={patientId}
          initialProviderId={providerId}
          lang={lang}
          open={createOpen}
          submitting={submitting}
          error={createError}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) createRequestIdRef.current = null;
          }}
          onSave={createContextTask}
        />
      ) : null}
    </section>
  );
}
