import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Building2,
  Cake,
  Check,
  Circle,
  ExternalLink,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { apiFetch, clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Lang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";

import type {
  ConciergeTaskChecklistItem,
  ConciergeTaskComment,
  ConciergeTaskDetail,
} from "./model";
import {
  availableConciergeTaskStatuses,
  canChangeConciergeTaskStatus,
  canDeleteConciergeTask,
  canModifyConciergeTask,
  conciergeTaskCode,
  conciergeTaskErrorMessage,
} from "./model";
import {
  conciergeDialogContentClassName,
  ConciergeDialogBody,
  ConciergeDialogHeader,
} from "./dialog-layout";
import { ConciergeTaskAttachments } from "./task-attachments";

const copy = {
  de: {
    loading: "Aufgabe wird geladen",
    checklist: "Checkliste",
    addChecklist: "Checklistenpunkt hinzufügen",
    checklistPlaceholder: "Nächster Arbeitsschritt",
    comments: "Kommentare",
    addComment: "Kommentar hinzufügen",
    commentPlaceholder: "Operative Übergabe oder Rückmeldung",
    history: "Aktivitätsverlauf",
    emptyChecklist: "Noch keine Checklistenpunkte",
    emptyComments: "Noch keine Kommentare",
    emptyHistory: "Noch keine Aktivität",
    reminder: "Erinnerung",
    due: "Termin",
    assignee: "Zuständig",
    note: "Operative Notiz",
    location: "Ort oder Adresse",
    status: "Status",
    priority: "Priorität",
    category: "Kategorie",
    internal: "Intern",
    external: "Extern",
    patient: "Patient / Kunde",
    provider: "Provider",
    birthDate: "Geburtsdatum",
    externalAssignee: "Externer Ausführender",
    open: "Offen",
    in_progress: "In Arbeit",
    review: "Zur Prüfung",
    completed: "Erledigt",
    cancelled: "Storniert",
    low: "Niedrig",
    normal: "Normal",
    high: "Hoch",
    urgent: "Dringend",
    created: "Aufgabe angelegt",
    updated: "Aufgabe aktualisiert",
    status_changed: "Status geändert",
    reassigned: "Neu zugewiesen",
    reminder_changed: "Erinnerung geändert",
    reminder_sent: "Erinnerung gesendet",
    comment_added: "Kommentar hinzugefügt",
    checklist_item_added: "Checklistenpunkt hinzugefügt",
    checklist_item_toggled: "Checklistenpunkt aktualisiert",
    attachment_added: "Anhang hinzugefügt",
    attachment_deleted: "Anhang entfernt",
    archived: "Aufgabe archiviert",
    restored: "Aufgabe wiederhergestellt",
    delete: "Löschen",
    deleteTitle: "Aufgabe löschen?",
    deleteMessage: "Die Aufgabe verschwindet aus dem Aufgabenmanager. Der Audit-Verlauf bleibt erhalten.",
    cancel: "Abbrechen",
    overview: "Aufgabendaten",
    links: "Verknüpfungen",
  },
  ru: {
    loading: "Загрузка задачи",
    checklist: "Чек-лист",
    addChecklist: "Добавить пункт",
    checklistPlaceholder: "Следующий операционный шаг",
    comments: "Комментарии",
    addComment: "Добавить комментарий",
    commentPlaceholder: "Результат, договорённость или передача смены",
    history: "История действий",
    emptyChecklist: "Пунктов чек-листа пока нет",
    emptyComments: "Комментариев пока нет",
    emptyHistory: "История пока пуста",
    reminder: "Напоминание",
    due: "Срок",
    assignee: "Исполнитель",
    note: "Операционная заметка",
    location: "Место или адрес",
    status: "Статус",
    priority: "Приоритет",
    category: "Категория",
    internal: "Внутренняя",
    external: "Внешняя",
    patient: "Пациент / клиент",
    provider: "Провайдер",
    birthDate: "Дата рождения",
    externalAssignee: "Внешний исполнитель",
    open: "Открыта",
    in_progress: "В работе",
    review: "На проверке",
    completed: "Выполнена",
    cancelled: "Отменена",
    low: "Низкий",
    normal: "Обычный",
    high: "Высокий",
    urgent: "Срочный",
    created: "Задача создана",
    updated: "Задача изменена",
    status_changed: "Статус изменён",
    reassigned: "Исполнитель изменён",
    reminder_changed: "Напоминание изменено",
    reminder_sent: "Напоминание отправлено",
    comment_added: "Добавлен комментарий",
    checklist_item_added: "Добавлен пункт чек-листа",
    checklist_item_toggled: "Пункт чек-листа изменён",
    attachment_added: "Файл прикреплён",
    attachment_deleted: "Файл удалён",
    archived: "Задача перемещена в архив",
    restored: "Задача восстановлена из архива",
    delete: "Удалить",
    deleteTitle: "Удалить задачу?",
    deleteMessage: "Задача исчезнет из менеджера задач. Аудит действий будет сохранён.",
    cancel: "Отмена",
    overview: "Данные задачи",
    links: "Связи",
  },
} as const;

const CHILD_REALTIME_EVENTS = [
  "concierge_operational_item.comment_added",
  "concierge_operational_item.checklist_item_added",
  "concierge_operational_item.checklist_item_toggled",
  "concierge_operational_item.attachment_added",
  "concierge_operational_item.attachment_deleted",
] as const;

function dateTime(value: string | null, lang: Lang) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function dateOnly(value: string | null, lang: Lang) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", { dateStyle: "medium" }).format(date);
}

function TaskDetailSection({
  title,
  action,
  className,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg border border-border/70 bg-card", className)}>
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="min-w-0 break-words text-[13px] font-semibold tracking-tight text-foreground">{title}</h3>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function TaskDetailRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5 px-3.5 py-2.5 sm:grid-cols-[minmax(10rem,0.4fr)_minmax(0,1fr)] sm:items-center sm:gap-3">
      <span className="min-w-0 break-words text-xs font-medium text-muted-foreground sm:text-[13px]">{label}</span>
      <div className="min-w-0 break-words text-sm font-medium leading-snug text-foreground">{value}</div>
    </div>
  );
}

export function ConciergeTaskDetailDialog({
  taskId,
  lang,
  open,
  onOpenChange,
  onChanged,
}: {
  taskId: string | null;
  lang: Lang;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const labels = copy[lang];
  const { user } = useAuth();
  const [detail, setDetail] = useState<ConciergeTaskDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [checklistLabel, setChecklistLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const canModify = detail ? canModifyConciergeTask(detail.item, user?.id, user?.role) : false;
  const canDelete = detail ? canDeleteConciergeTask(detail.item, user?.id, user?.role) : false;
  const canChangeStatus = detail
    ? canChangeConciergeTaskStatus(detail.item, user?.id, user?.role)
    : false;
  const commentRequestRef = useRef<{ body: string; requestId: string } | null>(null);
  const checklistRequestRef = useRef<{ label: string; requestId: string } | null>(null);
  const toggleRequestRef = useRef<{ payloadKey: string; requestId: string } | null>(null);

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError("");
    try {
      const payload = await apiFetch<ConciergeTaskDetail>(`/concierge-operational-items/${taskId}`, { forceFresh: true });
      setDetail(payload);
    } catch (loadError) {
      setError(conciergeTaskErrorMessage(loadError, lang, labels.loading));
    } finally {
      setLoading(false);
    }
  }, [labels.loading, lang, taskId]);

  const refreshFromRealtime = useCallback((event: { entity_id: string }) => {
    if (open && taskId && event.entity_id === taskId) void load();
  }, [load, open, taskId]);

  useDebouncedRealtimeSubscription(CHILD_REALTIME_EVENTS, refreshFromRealtime, 250);

  useEffect(() => {
    if (!open) return;
    setDetail(null);
    setComment("");
    setChecklistLabel("");
    commentRequestRef.current = null;
    checklistRequestRef.current = null;
    toggleRequestRef.current = null;
    void load();
  }, [load, open]);

  async function addComment() {
    if (!taskId || !comment.trim() || busy) return;
    const body = comment.trim();
    const requestId = commentRequestRef.current?.body === body
      ? commentRequestRef.current.requestId
      : crypto.randomUUID();
    commentRequestRef.current = { body, requestId };
    setBusy(true);
    setError("");
    try {
      const row = await apiFetch<ConciergeTaskComment>(`/concierge-operational-items/${taskId}/comments`, {
        method: "POST",
        body: JSON.stringify({ request_id: requestId, body }),
      });
      setDetail((current) => {
        if (!current || current.comments.some((entry) => entry.id === row.id)) return current;
        return {
          ...current,
          comments: [...current.comments, row],
          item: { ...current.item, comment_count: current.item.comment_count + 1 },
        };
      });
      setComment("");
      commentRequestRef.current = null;
      clearApiCache("/concierge-operational-items");
      onChanged();
    } catch (mutationError) {
      setError(conciergeTaskErrorMessage(mutationError, lang, labels.addComment));
    } finally {
      setBusy(false);
    }
  }

  async function addChecklistItem() {
    if (!taskId || !checklistLabel.trim() || busy) return;
    const label = checklistLabel.trim();
    const requestId = checklistRequestRef.current?.label === label
      ? checklistRequestRef.current.requestId
      : crypto.randomUUID();
    checklistRequestRef.current = { label, requestId };
    setBusy(true);
    setError("");
    try {
      const row = await apiFetch<ConciergeTaskChecklistItem>(`/concierge-operational-items/${taskId}/checklist`, {
        method: "POST",
        body: JSON.stringify({ request_id: requestId, label }),
      });
      setDetail((current) => {
        if (!current || current.checklist.some((entry) => entry.id === row.id)) return current;
        return {
          ...current,
          checklist: [...current.checklist, row],
          item: { ...current.item, checklist_total: current.item.checklist_total + 1 },
        };
      });
      setChecklistLabel("");
      checklistRequestRef.current = null;
      clearApiCache("/concierge-operational-items");
      onChanged();
    } catch (mutationError) {
      setError(conciergeTaskErrorMessage(mutationError, lang, labels.addChecklist));
    } finally {
      setBusy(false);
    }
  }

  async function toggleChecklist(item: ConciergeTaskChecklistItem) {
    if (!taskId || busy) return;
    const completed = !item.is_completed;
    const payloadKey = `${item.id}:${completed}`;
    const requestId = toggleRequestRef.current?.payloadKey === payloadKey
      ? toggleRequestRef.current.requestId
      : crypto.randomUUID();
    toggleRequestRef.current = { payloadKey, requestId };
    setBusy(true);
    setError("");
    try {
      const row = await apiFetch<ConciergeTaskChecklistItem>(`/concierge-operational-items/${taskId}/checklist/${item.id}/toggle`, {
        method: "POST",
        body: JSON.stringify({ request_id: requestId, completed }),
      });
      setDetail((current) => {
        if (!current) return current;
        const checklist = current.checklist.map((entry) => entry.id === row.id ? row : entry);
        return {
          ...current,
          checklist,
          item: {
            ...current.item,
            checklist_completed: checklist.filter((entry) => entry.is_completed).length,
          },
        };
      });
      toggleRequestRef.current = null;
      clearApiCache("/concierge-operational-items");
      onChanged();
    } catch (mutationError) {
      setError(conciergeTaskErrorMessage(mutationError, lang, labels.checklist));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTask() {
    if (!taskId || busy) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch<void>(`/concierge-operational-items/${taskId}`, { method: "DELETE" });
      clearApiCache("/concierge-operational-items");
      setDeleteConfirmOpen(false);
      onOpenChange(false);
      onChanged();
    } catch (deleteError) {
      setError(conciergeTaskErrorMessage(deleteError, lang, labels.delete));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: string) {
    if (!taskId || !detail || !canChangeStatus || busy || status === detail.item.status) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/concierge-operational-items/${taskId}/status`, {
        method: "POST",
        body: JSON.stringify({
          expected_updated_at: detail.item.updated_at,
          status,
        }),
      });
      clearApiCache("/concierge-operational-items");
      await load();
      onChanged();
    } catch (statusError) {
      setError(conciergeTaskErrorMessage(statusError, lang, labels.status));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={conciergeDialogContentClassName} style={{ maxWidth: "64rem" }}>
        <ConciergeDialogHeader
          icon={ListChecks}
          tone="dot"
          title={detail?.item.title ?? labels.loading}
          meta={detail ? <><Badge variant="outline" className="rounded-full font-mono text-muted-foreground">{conciergeTaskCode(detail.item)}</Badge><Badge variant="outline" className="rounded-full">{labels[detail.item.status as keyof typeof labels] ?? detail.item.status}</Badge><Badge variant="secondary" className="rounded-full">{detail.item.checklist_completed}/{detail.item.checklist_total}</Badge>{canDelete ? <Button type="button" size="sm" variant="ghost" className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={() => setDeleteConfirmOpen(true)}><Trash2 />{labels.delete}</Button> : null}</> : undefined}
        />
        <ConciergeDialogBody>
          {error ? <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
          {loading && !detail ? <div className="flex items-center justify-center py-20 text-sm text-muted-foreground"><LoaderCircle className="mr-2 animate-spin" />{labels.loading}</div> : null}
          {detail ? (
            <div className="space-y-3">
              <TaskDetailSection title={labels.overview}>
                <div className="divide-y divide-border/60">
                  <TaskDetailRow label={labels.assignee} value={detail.item.assigned_to_name} />
                  <TaskDetailRow label={labels.due} value={dateTime(detail.item.kind === "event" ? detail.item.starts_at : detail.item.due_at, lang)} />
                  <TaskDetailRow label={labels.reminder} value={dateTime(detail.item.reminder_at, lang)} />
                  <TaskDetailRow label={labels.note} value={<p className="whitespace-pre-wrap">{detail.item.note || "—"}</p>} />
                  <TaskDetailRow label={labels.location} value={detail.item.location || "—"} />
                  <TaskDetailRow
                    label={labels.status}
                    value={canChangeStatus ? (
                      <SelectField
                        className="h-9 min-w-40"
                        value={detail.item.status}
                        disabled={busy || Boolean(detail.item.archived_at)}
                        aria-label={labels.status}
                        options={availableConciergeTaskStatuses(detail.item, user?.id, user?.role).map((status) => ({
                          value: status,
                          label: labels[status],
                        }))}
                        onValueChange={(status) => void changeStatus(status)}
                      />
                    ) : (
                      <Badge variant="outline" className="rounded-full">{labels[detail.item.status as keyof typeof labels] ?? detail.item.status}</Badge>
                    )}
                  />
                  <TaskDetailRow label={labels.priority} value={<Badge variant="outline" className="rounded-full">{labels[detail.item.priority as keyof typeof labels] ?? detail.item.priority}</Badge>} />
                  <TaskDetailRow label={labels.category} value={<Badge variant="outline" className="rounded-full">{detail.item.task_audience === "external" ? labels.external : labels.internal}</Badge>} />
                </div>
              </TaskDetailSection>

              {(detail.item.patient_id && detail.item.patient_name) || (detail.item.provider_id && detail.item.provider_name) || detail.item.task_audience === "external" ? (
                <TaskDetailSection title={labels.links}>
                  <div className="divide-y divide-border/60">
                    {detail.item.patient_id && detail.item.patient_name ? (
                      <StaffLink to={`/patients/${detail.item.patient_id}`} className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-muted/20">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-orange-50 text-orange-700"><UserRound className="size-4" /></span>
                        <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-muted-foreground">{labels.patient}</span><strong className="block truncate text-sm">{detail.item.patient_name}</strong><span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><Cake className="size-3" />{labels.birthDate}: {dateOnly(detail.item.patient_birth_date, lang)}</span></span>
                        <ExternalLink className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[var(--brand)]" />
                      </StaffLink>
                    ) : null}
                    {detail.item.provider_id && detail.item.provider_name ? (
                      <StaffLink to={`/providers/${detail.item.provider_id}`} className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-muted/20">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-orange-50 text-orange-700"><Building2 className="size-4" /></span>
                        <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-muted-foreground">{labels.provider}</span><strong className="block truncate text-sm">{detail.item.provider_name}</strong><span className="block truncate text-xs text-muted-foreground">{[detail.item.provider_phone, detail.item.provider_email].filter(Boolean).join(" · ") || "—"}</span></span>
                        <ExternalLink className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[var(--brand)]" />
                      </StaffLink>
                    ) : null}
                    {detail.item.task_audience === "external" ? <TaskDetailRow label={labels.externalAssignee} value={<><p>{detail.item.external_assignee_name || "—"}</p><p className="mt-0.5 text-xs font-normal text-muted-foreground">{[detail.item.external_assignee_phone, detail.item.external_assignee_email].filter(Boolean).join(" · ")}</p></>} /> : null}
                  </div>
                </TaskDetailSection>
              ) : null}

              <ConciergeTaskAttachments taskId={detail.item.id} lang={lang} canModify={canModify && !detail.item.archived_at} />

            <div className="grid items-start gap-3 lg:grid-cols-2">
              <TaskDetailSection title={labels.checklist} action={<Badge variant="secondary" className="rounded-full">{detail.item.checklist_completed}/{detail.item.checklist_total}</Badge>}>
                <div className="divide-y divide-border/60">
                  {detail.checklist.length === 0 ? <p className="px-3.5 py-5 text-center text-xs text-muted-foreground">{labels.emptyChecklist}</p> : detail.checklist.map((item) => (
                    <button key={item.id} type="button" className="flex w-full items-start gap-2 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-muted/20" disabled={busy || Boolean(detail.item.archived_at)} onClick={() => void toggleChecklist(item)}>
                      {item.is_completed ? <Check className="mt-0.5 size-4 text-emerald-600" /> : <Circle className="mt-0.5 size-4 text-muted-foreground" />}
                      <span className={cn("min-w-0 flex-1", item.is_completed && "text-muted-foreground line-through")}>{item.label}</span>
                    </button>
                  ))}
                  {!detail.item.archived_at ? <div className="flex gap-2 p-3"><Input className="h-9" value={checklistLabel} maxLength={500} placeholder={labels.checklistPlaceholder} onChange={(event) => setChecklistLabel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addChecklistItem(); } }} /><Button type="button" size="icon-sm" disabled={busy || !checklistLabel.trim()} aria-label={labels.addChecklist} onClick={() => void addChecklistItem()}><Plus /></Button></div> : null}
                </div>
              </TaskDetailSection>

              <TaskDetailSection title={labels.comments} action={<Badge variant="secondary" className="rounded-full">{detail.comments.length}</Badge>}>
                <div className="divide-y divide-border/60">
                  {detail.comments.length === 0 ? <p className="px-3.5 py-5 text-center text-xs text-muted-foreground">{labels.emptyComments}</p> : detail.comments.map((item) => <article key={item.id} className="px-3.5 py-2.5"><div className="flex justify-between gap-2 text-[10px] text-muted-foreground"><strong className="text-foreground">{item.created_by_name}</strong><time>{dateTime(item.created_at, lang)}</time></div><p className="mt-1.5 whitespace-pre-wrap text-sm">{item.body}</p></article>)}
                  {!detail.item.archived_at ? <div className="space-y-2 p-3"><textarea className="min-h-20 w-full rounded-md border border-input bg-field px-3 py-2 text-sm outline-none placeholder:font-normal focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30" value={comment} maxLength={4000} placeholder={labels.commentPlaceholder} onChange={(event) => setComment(event.target.value)} /><Button type="button" size="sm" className="w-full" disabled={busy || !comment.trim()} onClick={() => void addComment()}>{busy ? <LoaderCircle className="animate-spin" /> : <MessageSquareText />}{labels.addComment}</Button></div> : null}
                </div>
              </TaskDetailSection>
            </div>

            <TaskDetailSection title={labels.history}>
              <div className="divide-y divide-border/60">
                {detail.history.length === 0 ? <p className="p-6 text-center text-xs text-muted-foreground">{labels.emptyHistory}</p> : detail.history.map((event) => <div key={event.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-xs"><div><p className="font-medium">{labels[event.event_type as keyof typeof labels] ?? event.event_type}</p><p className="mt-0.5 text-muted-foreground">{event.actor_name ?? "System"}</p></div><time className="shrink-0 text-muted-foreground">{dateTime(event.created_at, lang)}</time></div>)}
              </div>
            </TaskDetailSection>
            </div>
          ) : null}
        </ConciergeDialogBody>
      </DialogContent>
      <DirtyDismissConfirmDialog
        open={deleteConfirmOpen}
        title={labels.deleteTitle}
        message={labels.deleteMessage}
        cancelLabel={labels.cancel}
        confirmLabel={labels.delete}
        destructive
        confirmDisabled={busy}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => void deleteTask()}
      />
    </Dialog>
  );
}
