import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  Building2,
  Cake,
  Check,
  Circle,
  Clock3,
  History,
  ExternalLink,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  Plus,
  UserRound,
} from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiFetch, clearApiCache } from "@/lib/api";
import type { Lang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";

import type {
  ConciergeTaskChecklistItem,
  ConciergeTaskComment,
  ConciergeTaskDetail,
} from "./model";
import {
  conciergeDialogContentClassName,
  ConciergeDialogBody,
  ConciergeDialogHeader,
} from "./dialog-layout";

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
  },
} as const;

const CHILD_REALTIME_EVENTS = [
  "concierge_operational_item.comment_added",
  "concierge_operational_item.checklist_item_added",
  "concierge_operational_item.checklist_item_toggled",
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
  const [detail, setDetail] = useState<ConciergeTaskDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [checklistLabel, setChecklistLabel] = useState("");
  const [busy, setBusy] = useState(false);
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
      setError(loadError instanceof Error ? loadError.message : labels.loading);
    } finally {
      setLoading(false);
    }
  }, [labels.loading, taskId]);

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
      setError(mutationError instanceof Error ? mutationError.message : labels.addComment);
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
      setError(mutationError instanceof Error ? mutationError.message : labels.addChecklist);
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
      setError(mutationError instanceof Error ? mutationError.message : labels.checklist);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={conciergeDialogContentClassName}>
        <ConciergeDialogHeader
          icon={ListChecks}
          tone="indigo"
          title={detail?.item.title ?? labels.loading}
          meta={detail ? <Badge variant="secondary" className="rounded-full">{detail.item.checklist_completed}/{detail.item.checklist_total}</Badge> : undefined}
        />
        <ConciergeDialogBody>
          {error ? <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
          {loading && !detail ? <div className="flex items-center justify-center py-20 text-sm text-muted-foreground"><LoaderCircle className="mr-2 animate-spin" />{labels.loading}</div> : null}
          {detail ? (
            <div className="space-y-4">
              <section className="grid gap-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs sm:grid-cols-3">
                <p className="rounded-md bg-background/70 p-2.5"><UserRound className="mr-1.5 inline size-3.5 text-muted-foreground" /><span className="text-muted-foreground">{labels.assignee}: </span><strong>{detail.item.assigned_to_name}</strong></p>
                <p className="rounded-md bg-background/70 p-2.5"><Clock3 className="mr-1.5 inline size-3.5 text-muted-foreground" /><span className="text-muted-foreground">{labels.due}: </span><strong>{dateTime(detail.item.kind === "event" ? detail.item.starts_at : detail.item.due_at, lang)}</strong></p>
                <p className="rounded-md bg-background/70 p-2.5"><CalendarClock className="mr-1.5 inline size-3.5 text-muted-foreground" /><span className="text-muted-foreground">{labels.reminder}: </span><strong>{dateTime(detail.item.reminder_at, lang)}</strong></p>
              </section>

              <section className="grid gap-3 rounded-lg border border-border/70 bg-card p-3 text-sm sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium text-muted-foreground">{labels.note}</p>
                  <p className="mt-1 whitespace-pre-wrap">{detail.item.note || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{labels.location}</p>
                  <p className="mt-1">{detail.item.location || "—"}</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <Badge variant="outline">{labels.status}: {labels[detail.item.status as keyof typeof labels] ?? detail.item.status}</Badge>
                  <Badge variant="outline">{labels.priority}: {labels[detail.item.priority as keyof typeof labels] ?? detail.item.priority}</Badge>
                  <Badge variant="outline">{labels.category}: {detail.item.task_audience === "external" ? labels.external : labels.internal}</Badge>
                </div>
                {detail.item.patient_id && detail.item.patient_name ? (
                  <StaffLink to={`/patients/${detail.item.patient_id}`} className="group flex items-center gap-3 rounded-lg border border-border/70 bg-muted/25 p-3 transition-colors hover:border-primary/30 hover:bg-primary/5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><UserRound className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-muted-foreground">{labels.patient}</span>
                      <strong className="block truncate text-sm">{detail.item.patient_name}</strong>
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><Cake className="size-3" />{labels.birthDate}: {dateOnly(detail.item.patient_birth_date, lang)}</span>
                    </span>
                    <ExternalLink className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                  </StaffLink>
                ) : null}
                {detail.item.provider_id && detail.item.provider_name ? (
                  <StaffLink to={`/providers/${detail.item.provider_id}`} className="group flex items-center gap-3 rounded-lg border border-border/70 bg-muted/25 p-3 transition-colors hover:border-primary/30 hover:bg-primary/5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building2 className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-muted-foreground">{labels.provider}</span>
                      <strong className="block truncate text-sm">{detail.item.provider_name}</strong>
                      <span className="block truncate text-xs text-muted-foreground">{[detail.item.provider_phone, detail.item.provider_email].filter(Boolean).join(" · ") || "—"}</span>
                    </span>
                    <ExternalLink className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                  </StaffLink>
                ) : null}
                {detail.item.task_audience === "external" ? <div><p className="text-xs font-medium text-muted-foreground">{labels.externalAssignee}</p><p className="mt-1 font-medium">{detail.item.external_assignee_name || "—"}</p><p className="text-xs text-muted-foreground">{[detail.item.external_assignee_phone, detail.item.external_assignee_email].filter(Boolean).join(" · ")}</p></div> : null}
              </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-lg border border-border/70 bg-card">
                <div className="flex items-center gap-2 border-b px-3 py-2.5"><ListChecks className="size-4 text-primary" /><h3 className="text-sm font-semibold">{labels.checklist}</h3><Badge variant="secondary" className="ml-auto rounded-full">{detail.item.checklist_completed}/{detail.item.checklist_total}</Badge></div>
                <div className="space-y-2 p-3">
                  {detail.checklist.length === 0 ? <p className="py-5 text-center text-xs text-muted-foreground">{labels.emptyChecklist}</p> : detail.checklist.map((item) => (
                    <button key={item.id} type="button" className="flex w-full items-start gap-2 rounded-lg border p-2 text-left text-sm hover:bg-muted/40" disabled={busy} onClick={() => void toggleChecklist(item)}>
                      {item.is_completed ? <Check className="mt-0.5 size-4 text-emerald-600" /> : <Circle className="mt-0.5 size-4 text-muted-foreground" />}
                      <span className={cn("min-w-0 flex-1", item.is_completed && "text-muted-foreground line-through")}>{item.label}</span>
                    </button>
                  ))}
                  <div className="flex gap-2"><Input value={checklistLabel} maxLength={500} placeholder={labels.checklistPlaceholder} onChange={(event) => setChecklistLabel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addChecklistItem(); } }} /><Button type="button" size="icon" disabled={busy || !checklistLabel.trim()} aria-label={labels.addChecklist} onClick={() => void addChecklistItem()}><Plus /></Button></div>
                </div>
              </section>

              <section className="rounded-lg border border-border/70 bg-card">
                <div className="flex items-center gap-2 border-b px-3 py-2.5"><MessageSquareText className="size-4 text-primary" /><h3 className="text-sm font-semibold">{labels.comments}</h3><Badge variant="secondary" className="ml-auto rounded-full">{detail.comments.length}</Badge></div>
                <div className="space-y-2 p-3">
                  {detail.comments.length === 0 ? <p className="py-5 text-center text-xs text-muted-foreground">{labels.emptyComments}</p> : detail.comments.map((item) => <article key={item.id} className="rounded-lg border bg-muted/20 p-2.5"><div className="flex justify-between gap-2 text-[10px] text-muted-foreground"><strong className="text-foreground">{item.created_by_name}</strong><time>{dateTime(item.created_at, lang)}</time></div><p className="mt-1.5 whitespace-pre-wrap text-sm">{item.body}</p></article>)}
                  <textarea className="min-h-24 w-full rounded-md border border-input bg-field px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30" value={comment} maxLength={4000} placeholder={labels.commentPlaceholder} onChange={(event) => setComment(event.target.value)} />
                  <Button type="button" size="sm" className="w-full" disabled={busy || !comment.trim()} onClick={() => void addComment()}>{busy ? <LoaderCircle className="animate-spin" /> : <MessageSquareText />}{labels.addComment}</Button>
                </div>
              </section>
            </div>

            <section className="rounded-lg border border-border/70 bg-card">
              <div className="flex items-center gap-2 border-b px-3 py-2.5"><History className="size-4 text-primary" /><h3 className="text-sm font-semibold">{labels.history}</h3></div>
              <div className="divide-y">
                {detail.history.length === 0 ? <p className="p-6 text-center text-xs text-muted-foreground">{labels.emptyHistory}</p> : detail.history.map((event) => <div key={event.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-xs"><div><p className="font-medium">{labels[event.event_type as keyof typeof labels] ?? event.event_type}</p><p className="mt-0.5 text-muted-foreground">{event.actor_name ?? "System"}</p></div><time className="shrink-0 text-muted-foreground">{dateTime(event.created_at, lang)}</time></div>)}
              </div>
            </section>
            </div>
          ) : null}
        </ConciergeDialogBody>
      </DialogContent>
    </Dialog>
  );
}
