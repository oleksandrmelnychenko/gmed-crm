import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Building2,
  Cake,
  Check,
  ChevronDown,
  Circle,
  ExternalLink,
  FolderKanban,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  Plus,
  ReceiptText,
  Save,
  Trash2,
  UserRound,
  X,
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
  ConciergeDialogFooter,
  ConciergeDialogHeader,
} from "./dialog-layout";
import { ConciergeExpenseReceiptDialog } from "./concierge-expense-receipt-dialog";
import {
  downloadConciergeExpenseReceipt,
  getConciergeExpenseContext,
  getConciergeExpenses,
  uploadConciergeExpense,
} from "./expense-receipt-api";
import type {
  ConciergeExpenseContext,
  ConciergeExpenseItem,
  ConciergeExpenseMutationResponse,
  ConciergeExpenseSubmitInput,
} from "./expense-receipt-model";
import type { ConciergeService } from "./model";
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
    project: "Projekt",
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
    checklist_item_edited: "Checklistenpunkt bearbeitet",
    checklist_item_deleted: "Checklistenpunkt gelöscht",
    comment_edited: "Kommentar bearbeitet",
    comment_deleted: "Kommentar gelöscht",
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
    expenses: "Ausgaben",
    addExpense: "Ausgabe erfassen",
    emptyExpenses: "Für diesen Service wurden noch keine Ausgaben erfasst.",
    expenseLoadFailed: "Die Ausgaben des verknüpften Services konnten nicht geladen werden.",
    pending_review: "Zur Prüfung",
    posted: "Bestätigt",
    rejected: "Abgelehnt",
    reversed: "Storniert",
    noReceipt: "Kein Beleg",
    downloadReceipt: "Beleg herunterladen",
    edit: "Bearbeiten",
    save: "Speichern",
    edited: "Bearbeitet",
    confirmStatus: "OK",
    cancelStatus: "Änderung verwerfen",
    cancelEdit: "Bearbeitung abbrechen",
    deleteChecklistTitle: "Checklistenpunkt löschen?",
    deleteChecklistMessage: "Der Checklistenpunkt wird entfernt. Die Änderung bleibt im Aktivitätsverlauf erhalten.",
    deleteCommentTitle: "Kommentar löschen?",
    deleteCommentMessage: "Der Kommentar wird entfernt. Die Änderung bleibt im Aktivitätsverlauf erhalten.",
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
    project: "Проект",
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
    checklist_item_edited: "Пункт чек-листа отредактирован",
    checklist_item_deleted: "Пункт чек-листа удалён",
    comment_edited: "Комментарий отредактирован",
    comment_deleted: "Комментарий удалён",
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
    expenses: "Расходы",
    addExpense: "Добавить расход",
    emptyExpenses: "По связанному сервису расходы ещё не добавлены.",
    expenseLoadFailed: "Не удалось загрузить расходы связанного сервиса.",
    pending_review: "На проверке",
    posted: "Подтверждено",
    rejected: "Отклонено",
    reversed: "Отменено",
    noReceipt: "Документа нет",
    downloadReceipt: "Скачать подтверждение",
    edit: "Изменить",
    save: "Сохранить",
    edited: "Изменено",
    confirmStatus: "ОК",
    cancelStatus: "Отменить изменение",
    cancelEdit: "Отменить редактирование",
    deleteChecklistTitle: "Удалить пункт чек-листа?",
    deleteChecklistMessage: "Пункт будет удалён. Изменение сохранится в истории действий.",
    deleteCommentTitle: "Удалить комментарий?",
    deleteCommentMessage: "Комментарий будет удалён. Изменение сохранится в истории действий.",
  },
} as const;

const CHILD_REALTIME_EVENTS = [
  "concierge_operational_item.updated",
  "concierge_operational_item.comment_added",
  "concierge_operational_item.comment_edited",
  "concierge_operational_item.comment_deleted",
  "concierge_operational_item.checklist_item_added",
  "concierge_operational_item.checklist_item_toggled",
  "concierge_operational_item.checklist_item_edited",
  "concierge_operational_item.checklist_item_deleted",
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

function expenseMoney(value: string, currency: string, lang: Lang) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${value} ${currency}`;
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
    style: "currency",
    currency: currency || "EUR",
  }).format(amount);
}

function expenseStatusClassName(status: ConciergeExpenseItem["status"]) {
  if (status === "posted") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected" || status === "reversed") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function taskPriorityClassName(priority: string) {
  if (priority === "urgent") return "border-rose-200 bg-rose-50 text-rose-700";
  if (priority === "high") return "border-orange-200 bg-orange-50 text-orange-700";
  if (priority === "low") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function taskAudienceClassName(audience: string) {
  return audience === "external"
    ? "border-violet-200 bg-violet-50 text-violet-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
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
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-3 py-2">
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
  openExpenseOnLoad = false,
  onOpenChange,
  onChanged,
}: {
  taskId: string | null;
  lang: Lang;
  open: boolean;
  openExpenseOnLoad?: boolean;
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
  const [editingChecklistId, setEditingChecklistId] = useState<string | null>(null);
  const [checklistDraft, setChecklistDraft] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [pendingStatus, setPendingStatus] = useState("");
  const [pendingChildDelete, setPendingChildDelete] = useState<{
    kind: "checklist" | "comment";
    id: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [expenseService, setExpenseService] = useState<ConciergeService | null>(null);
  const [expenseContext, setExpenseContext] = useState<ConciergeExpenseContext | null>(null);
  const [expenseItems, setExpenseItems] = useState<ConciergeExpenseItem[]>([]);
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [expenseError, setExpenseError] = useState("");
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [submittingExpense, setSubmittingExpense] = useState(false);
  const [expenseProgress, setExpenseProgress] = useState(0);
  const canModify = detail ? canModifyConciergeTask(detail.item, user?.id, user?.role) : false;
  const canDelete = detail ? canDeleteConciergeTask(detail.item, user?.id, user?.role) : false;
  const canChangeStatus = detail
    ? canChangeConciergeTaskStatus(detail.item, user?.id, user?.role)
    : false;
  const canCollaborate = canModify || canChangeStatus;
  const commentRequestRef = useRef<{ body: string; requestId: string } | null>(null);
  const checklistRequestRef = useRef<{ label: string; requestId: string } | null>(null);
  const toggleRequestRef = useRef<{ payloadKey: string; requestId: string } | null>(null);
  const expenseLoadSequenceRef = useRef(0);
  const autoExpenseOpenedRef = useRef(false);
  const canReadLinkedExpenses = Boolean(
    detail?.item.concierge_service_id
    && (user?.role === "ceo" || user?.role === "billing" || user?.role === "concierge"),
  );
  const canSubmitLinkedExpense = Boolean(
    expenseService
    && (user?.role === "ceo"
      || (user?.role === "concierge" && expenseService.assigned_concierge_id === user.id)),
  );
  const statusDirty = Boolean(detail && pendingStatus && pendingStatus !== detail.item.status);

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError("");
    try {
      const payload = await apiFetch<ConciergeTaskDetail>(`/concierge-operational-items/${taskId}`, { forceFresh: true });
      setDetail(payload);
      setPendingStatus(payload.item.status);
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
    setEditingChecklistId(null);
    setChecklistDraft("");
    setEditingCommentId(null);
    setCommentDraft("");
    setPendingStatus("");
    setPendingChildDelete(null);
    autoExpenseOpenedRef.current = false;
    commentRequestRef.current = null;
    checklistRequestRef.current = null;
    toggleRequestRef.current = null;
    void load();
  }, [load, open]);

  useEffect(() => {
    const serviceId = detail?.item.concierge_service_id;
    const loadSequence = expenseLoadSequenceRef.current + 1;
    expenseLoadSequenceRef.current = loadSequence;
    setExpenseDialogOpen(false);
    setExpenseService(null);
    setExpenseContext(null);
    setExpenseItems([]);
    setExpenseError("");
    setExpenseProgress(0);

    if (!open || !serviceId || !canReadLinkedExpenses) {
      setExpenseLoading(false);
      return;
    }

    setExpenseLoading(true);
    void Promise.all([
      apiFetch<ConciergeService>(`/concierge-services/${serviceId}`, { forceFresh: true }),
      getConciergeExpenseContext(serviceId),
      getConciergeExpenses(serviceId),
    ])
      .then(([service, context, history]) => {
        if (expenseLoadSequenceRef.current !== loadSequence) return;
        setExpenseService(service);
        setExpenseContext(context);
        setExpenseItems(history.items);
      })
      .catch(() => {
        if (expenseLoadSequenceRef.current !== loadSequence) return;
        setExpenseError(labels.expenseLoadFailed);
      })
      .finally(() => {
        if (expenseLoadSequenceRef.current === loadSequence) setExpenseLoading(false);
      });
  }, [canReadLinkedExpenses, detail?.item.concierge_service_id, labels.expenseLoadFailed, open]);

  useEffect(() => {
    if (!open || !openExpenseOnLoad || expenseLoading || !canSubmitLinkedExpense || !expenseService) return;
    if (autoExpenseOpenedRef.current) return;
    autoExpenseOpenedRef.current = true;
    setExpenseDialogOpen(true);
  }, [canSubmitLinkedExpense, expenseLoading, expenseService, open, openExpenseOnLoad]);

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

  async function updateChecklistItem(item: ConciergeTaskChecklistItem) {
    if (!taskId || !canCollaborate || busy || !checklistDraft.trim()) return;
    setBusy(true);
    setError("");
    try {
      const row = await apiFetch<ConciergeTaskChecklistItem>(`/concierge-operational-items/${taskId}/checklist/${item.id}/update`, {
        method: "POST",
        body: JSON.stringify({ request_id: crypto.randomUUID(), label: checklistDraft.trim() }),
      });
      setDetail((current) => current ? {
        ...current,
        checklist: current.checklist.map((entry) => entry.id === row.id ? row : entry),
      } : current);
      setEditingChecklistId(null);
      setChecklistDraft("");
      clearApiCache("/concierge-operational-items");
      onChanged();
    } catch (mutationError) {
      setError(conciergeTaskErrorMessage(mutationError, lang, labels.edit));
    } finally {
      setBusy(false);
    }
  }

  async function updateCommentItem(item: ConciergeTaskComment) {
    if (!taskId || item.created_by !== user?.id || busy || !commentDraft.trim()) return;
    setBusy(true);
    setError("");
    try {
      const row = await apiFetch<ConciergeTaskComment>(`/concierge-operational-items/${taskId}/comments/${item.id}/update`, {
        method: "POST",
        body: JSON.stringify({ request_id: crypto.randomUUID(), body: commentDraft.trim() }),
      });
      setDetail((current) => current ? {
        ...current,
        comments: current.comments.map((entry) => entry.id === row.id ? row : entry),
      } : current);
      setEditingCommentId(null);
      setCommentDraft("");
      clearApiCache("/concierge-operational-items");
      onChanged();
    } catch (mutationError) {
      setError(conciergeTaskErrorMessage(mutationError, lang, labels.edit));
    } finally {
      setBusy(false);
    }
  }

  async function deleteChildItem() {
    if (!taskId || !pendingChildDelete || busy) return;
    const target = pendingChildDelete;
    setBusy(true);
    setError("");
    try {
      const path = target.kind === "comment"
        ? `/concierge-operational-items/${taskId}/comments/${target.id}/delete`
        : `/concierge-operational-items/${taskId}/checklist/${target.id}/delete`;
      await apiFetch<void>(path, {
        method: "POST",
        body: JSON.stringify({ request_id: crypto.randomUUID() }),
      });
      setDetail((current) => {
        if (!current) return current;
        if (target.kind === "comment") {
          return {
            ...current,
            comments: current.comments.filter((entry) => entry.id !== target.id),
            item: { ...current.item, comment_count: Math.max(0, current.item.comment_count - 1) },
          };
        }
        const removed = current.checklist.find((entry) => entry.id === target.id);
        return {
          ...current,
          checklist: current.checklist.filter((entry) => entry.id !== target.id),
          item: {
            ...current.item,
            checklist_total: Math.max(0, current.item.checklist_total - 1),
            checklist_completed: Math.max(0, current.item.checklist_completed - (removed?.is_completed ? 1 : 0)),
          },
        };
      });
      setPendingChildDelete(null);
      clearApiCache("/concierge-operational-items");
      onChanged();
    } catch (mutationError) {
      setError(conciergeTaskErrorMessage(mutationError, lang, labels.delete));
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

  async function changeStatus() {
    if (!taskId || !detail || !canChangeStatus || busy || !pendingStatus || pendingStatus === detail.item.status) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/concierge-operational-items/${taskId}/status`, {
        method: "POST",
        body: JSON.stringify({
          expected_updated_at: detail.item.updated_at,
          status: pendingStatus,
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

  async function submitLinkedExpense(
    input: ConciergeExpenseSubmitInput,
  ): Promise<ConciergeExpenseMutationResponse> {
    if (!expenseService || submittingExpense || !canSubmitLinkedExpense) {
      throw new Error(labels.expenseLoadFailed);
    }
    setSubmittingExpense(true);
    setExpenseError("");
    setExpenseProgress(0);
    try {
      const response = await uploadConciergeExpense(
        expenseService.id,
        input,
        setExpenseProgress,
      );
      setExpenseItems((current) => [
        response.item,
        ...current.filter((item) => item.id !== response.item.id),
      ]);
      clearApiCache(`/concierge-services/${expenseService.id}/expenses`);
      onChanged();
      return response;
    } catch (submitError) {
      setExpenseError(
        submitError instanceof Error ? submitError.message : labels.expenseLoadFailed,
      );
      throw submitError;
    } finally {
      setSubmittingExpense(false);
    }
  }

  async function downloadLinkedExpenseReceipt(item: ConciergeExpenseItem) {
    if (!expenseService || !item.receipt) return;
    setExpenseError("");
    try {
      await downloadConciergeExpenseReceipt(
        expenseService.id,
        item.id,
        item.receipt.original_filename,
      );
    } catch (downloadError) {
      setExpenseError(
        downloadError instanceof Error ? downloadError.message : labels.expenseLoadFailed,
      );
      throw downloadError;
    }
  }

  return (
    <>
      <Dialog
        open={open && !openExpenseOnLoad && !expenseDialogOpen}
        dirty={statusDirty || Boolean(editingChecklistId) || Boolean(editingCommentId)}
        onOpenChange={onOpenChange}
      >
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
                        value={pendingStatus || detail.item.status}
                        disabled={busy || Boolean(detail.item.archived_at)}
                        aria-label={labels.status}
                        options={availableConciergeTaskStatuses(detail.item, user?.id, user?.role).map((status) => ({
                          value: status,
                          label: labels[status],
                        }))}
                        onValueChange={setPendingStatus}
                      />
                    ) : (
                      <Badge variant="outline" className="rounded-full">{labels[detail.item.status as keyof typeof labels] ?? detail.item.status}</Badge>
                    )}
                  />
                  <TaskDetailRow label={labels.priority} value={<Badge variant="outline" className={cn("rounded-full", taskPriorityClassName(detail.item.priority))}>{labels[detail.item.priority as keyof typeof labels] ?? detail.item.priority}</Badge>} />
                  <TaskDetailRow label={labels.category} value={<Badge variant="outline" className={cn("rounded-full", taskAudienceClassName(detail.item.task_audience))}>{detail.item.task_audience === "external" ? labels.external : labels.internal}</Badge>} />
                </div>
              </TaskDetailSection>

              {(detail.item.patient_id && detail.item.patient_name) || (detail.item.provider_id && detail.item.provider_name) || (detail.item.project_id && detail.item.project_name) || detail.item.task_audience === "external" ? (
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
                    {detail.item.project_id && detail.item.project_name ? (
                      <StaffLink to={`/projects?project=${detail.item.project_id}`} className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-muted/20">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-orange-50 text-orange-700"><FolderKanban className="size-4" /></span>
                        <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-muted-foreground">{labels.project}</span><strong className="block truncate text-sm">{detail.item.project_name}</strong></span>
                        <ExternalLink className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[var(--brand)]" />
                      </StaffLink>
                    ) : null}
                    {detail.item.task_audience === "external" ? <TaskDetailRow label={labels.externalAssignee} value={<><p>{detail.item.external_assignee_name || "—"}</p><p className="mt-0.5 text-xs font-normal text-muted-foreground">{[detail.item.external_assignee_phone, detail.item.external_assignee_email].filter(Boolean).join(" · ")}</p></>} /> : null}
                  </div>
                </TaskDetailSection>
              ) : null}

              {canReadLinkedExpenses ? (
                <TaskDetailSection
                  title={labels.expenses}
                  action={canSubmitLinkedExpense ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8"
                      disabled={expenseLoading || submittingExpense || Boolean(detail.item.archived_at)}
                      onClick={() => setExpenseDialogOpen(true)}
                    >
                      {expenseLoading ? <LoaderCircle className="animate-spin" /> : <ReceiptText />}
                      {labels.addExpense}
                    </Button>
                  ) : undefined}
                >
                  {expenseError ? (
                    <p role="alert" className="border-b border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
                      {expenseError}
                    </p>
                  ) : null}
                  {expenseLoading ? (
                    <div className="flex items-center justify-center gap-2 px-3.5 py-6 text-xs text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" />
                      {labels.loading}
                    </div>
                  ) : expenseItems.length === 0 ? (
                    <p className="px-3.5 py-5 text-center text-xs text-muted-foreground">{labels.emptyExpenses}</p>
                  ) : (
                    <div className="divide-y divide-border/60">
                      {expenseItems.map((item) => (
                        <article key={item.id} className="flex flex-col gap-2 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <strong className="truncate text-sm text-foreground">{item.vendor}</strong>
                              <Badge variant="outline" className={cn("rounded-full text-[10px]", expenseStatusClassName(item.status))}>
                                {labels[item.status]}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {dateOnly(item.expense_date, lang)} · {expenseMoney(item.amount_gross, item.currency, lang)}
                            </p>
                          </div>
                          {item.receipt ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 shrink-0"
                              onClick={() => void downloadLinkedExpenseReceipt(item)}
                            >
                              <ReceiptText />
                              {labels.downloadReceipt}
                            </Button>
                          ) : (
                            <Badge variant="secondary" className="w-fit rounded-full text-[10px]">{labels.noReceipt}</Badge>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </TaskDetailSection>
              ) : null}

              <ConciergeTaskAttachments taskId={detail.item.id} lang={lang} canModify={canModify && !detail.item.archived_at} />

            <div className="grid items-start gap-3 lg:grid-cols-2">
              <TaskDetailSection title={labels.checklist} action={<Badge variant="secondary" className="rounded-full">{detail.item.checklist_completed}/{detail.item.checklist_total}</Badge>}>
                <div className="divide-y divide-border/60">
                  {detail.checklist.length === 0 ? <p className="px-3.5 py-5 text-center text-xs text-muted-foreground">{labels.emptyChecklist}</p> : detail.checklist.map((item) => (
                    <div key={item.id} className="flex items-start gap-1.5 px-3 py-2 text-sm">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="-ml-1.5 size-7 shrink-0 rounded-full"
                        disabled={busy || Boolean(detail.item.archived_at)}
                        aria-label={item.label}
                        onClick={() => void toggleChecklist(item)}
                      >
                        {item.is_completed ? <Check className="size-4 text-emerald-600" /> : <Circle className="size-4 text-muted-foreground" />}
                      </Button>
                      {editingChecklistId === item.id ? (
                        <div className="flex min-w-0 flex-1 gap-1.5">
                          <Input
                            autoFocus
                            className="h-8 min-w-0"
                            value={checklistDraft}
                            maxLength={500}
                            onChange={(event) => setChecklistDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void updateChecklistItem(item);
                              }
                              if (event.key === "Escape") {
                                setEditingChecklistId(null);
                                setChecklistDraft("");
                              }
                            }}
                          />
                          <Button type="button" size="icon-sm" className="size-8" disabled={busy || !checklistDraft.trim()} aria-label={labels.save} onClick={() => void updateChecklistItem(item)}><Save /></Button>
                          <Button type="button" size="icon-sm" variant="ghost" className="size-8" aria-label={labels.cancelEdit} onClick={() => { setEditingChecklistId(null); setChecklistDraft(""); }}><X /></Button>
                        </div>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 pt-0.5">
                            <span className={cn("block break-words", item.is_completed && "text-muted-foreground line-through")}>{item.label}</span>
                            <time className="mt-0.5 block text-[10px] font-normal text-muted-foreground">{dateTime(item.created_at, lang)}</time>
                          </span>
                          {canCollaborate && !detail.item.archived_at ? (
                            <div className="flex shrink-0 items-center gap-0.5">
                              <Button type="button" size="icon-sm" variant="ghost" className="size-7" aria-label={labels.edit} onClick={() => { setEditingChecklistId(item.id); setChecklistDraft(item.label); }}><Pencil /></Button>
                              <Button type="button" size="icon-sm" variant="ghost" className="size-7 text-destructive hover:text-destructive" aria-label={labels.delete} onClick={() => setPendingChildDelete({ kind: "checklist", id: item.id })}><Trash2 /></Button>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  ))}
                  {!detail.item.archived_at ? <div className="flex gap-1.5 p-2.5"><Input className="h-8" value={checklistLabel} maxLength={500} placeholder={labels.checklistPlaceholder} onChange={(event) => setChecklistLabel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addChecklistItem(); } }} /><Button type="button" size="icon-sm" className="size-8" disabled={busy || !checklistLabel.trim()} aria-label={labels.addChecklist} onClick={() => void addChecklistItem()}><Plus /></Button></div> : null}
                </div>
              </TaskDetailSection>

              <TaskDetailSection title={labels.comments} action={<Badge variant="secondary" className="rounded-full">{detail.comments.length}</Badge>}>
                <div className="divide-y divide-border/60">
                  {detail.comments.length === 0 ? <p className="px-3.5 py-5 text-center text-xs text-muted-foreground">{labels.emptyComments}</p> : detail.comments.map((item) => (
                    <article key={item.id} className="px-3 py-2">
                      <div className="flex items-start justify-between gap-2 text-[10px] text-muted-foreground">
                        <div className="min-w-0"><strong className="text-foreground">{item.created_by_name}</strong>{item.edited_at ? <span className="ml-1.5">· {labels.edited}</span> : null}</div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <time className="mr-1 pt-1.5">{dateTime(item.created_at, lang)}</time>
                          {item.created_by === user?.id && !detail.item.archived_at ? (
                            <>
                              <Button type="button" size="icon-sm" variant="ghost" className="size-7" aria-label={labels.edit} onClick={() => { setEditingCommentId(item.id); setCommentDraft(item.body); }}><Pencil /></Button>
                              <Button type="button" size="icon-sm" variant="ghost" className="size-7 text-destructive hover:text-destructive" aria-label={labels.delete} onClick={() => setPendingChildDelete({ kind: "comment", id: item.id })}><Trash2 /></Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                      {editingCommentId === item.id ? (
                        <div className="mt-2 space-y-2">
                          <textarea autoFocus className="min-h-24 w-full rounded-md border border-input bg-field px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30" value={commentDraft} maxLength={4000} onChange={(event) => setCommentDraft(event.target.value)} />
                          <div className="flex justify-end gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={() => { setEditingCommentId(null); setCommentDraft(""); }}><X />{labels.cancelEdit}</Button>
                            <Button type="button" size="sm" disabled={busy || !commentDraft.trim()} onClick={() => void updateCommentItem(item)}>{busy ? <LoaderCircle className="animate-spin" /> : <Save />}{labels.save}</Button>
                          </div>
                        </div>
                      ) : <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-snug">{item.body}</p>}
                    </article>
                  ))}
                  {!detail.item.archived_at ? <div className="space-y-1.5 p-2.5"><textarea className="min-h-16 w-full rounded-md border border-input bg-field px-3 py-2 text-sm outline-none placeholder:font-normal focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30" value={comment} maxLength={4000} placeholder={labels.commentPlaceholder} onChange={(event) => setComment(event.target.value)} /><div className="flex justify-end"><Button type="button" size="sm" className="h-8 px-3" disabled={busy || !comment.trim()} onClick={() => void addComment()}>{busy ? <LoaderCircle className="animate-spin" /> : <MessageSquareText />}{labels.addComment}</Button></div></div> : null}
                </div>
              </TaskDetailSection>
            </div>

            <details className="group overflow-hidden rounded-lg border border-border/70 bg-card">
              <summary className="flex min-w-0 cursor-pointer list-none items-center justify-between gap-3 bg-muted/20 px-3.5 py-2.5 transition-colors hover:bg-muted/35 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span className="min-w-0 break-words text-[13px] font-semibold tracking-tight text-foreground">{labels.history}</span>
                  <Badge variant="secondary" className="rounded-full">{detail.history.length}</Badge>
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="divide-y divide-border/60 border-t border-border/70">
                {detail.history.length === 0 ? <p className="p-6 text-center text-xs text-muted-foreground">{labels.emptyHistory}</p> : detail.history.map((event) => <div key={event.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-xs"><div><p className="font-medium">{labels[event.event_type as keyof typeof labels] ?? event.event_type}</p><p className="mt-0.5 text-muted-foreground">{event.actor_name ?? "System"}</p></div><time className="shrink-0 text-muted-foreground">{dateTime(event.created_at, lang)}</time></div>)}
              </div>
            </details>
            </div>
          ) : null}
        </ConciergeDialogBody>
        {statusDirty ? (
          <ConciergeDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setPendingStatus(detail?.item.status ?? "")}
            >
              <X />
              {labels.cancelStatus}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void changeStatus()}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Check />}
              {labels.confirmStatus}
            </Button>
          </ConciergeDialogFooter>
        ) : null}
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
      <DirtyDismissConfirmDialog
        open={Boolean(pendingChildDelete)}
        title={pendingChildDelete?.kind === "comment" ? labels.deleteCommentTitle : labels.deleteChecklistTitle}
        message={pendingChildDelete?.kind === "comment" ? labels.deleteCommentMessage : labels.deleteChecklistMessage}
        cancelLabel={labels.cancel}
        confirmLabel={labels.delete}
        destructive
        confirmDisabled={busy}
        onCancel={() => {
          if (!busy) setPendingChildDelete(null);
        }}
        onConfirm={() => void deleteChildItem()}
      />
      </Dialog>
      <ConciergeExpenseReceiptDialog
        service={expenseService}
        lang={lang}
        open={expenseDialogOpen}
        context={expenseContext}
        expenses={expenseItems}
        loading={expenseLoading}
        error={expenseError}
        submitting={submittingExpense}
        progress={expenseProgress}
        vendorSuggestions={[
          ...(detail?.item.provider_name ? [{
            id: `provider:${detail.item.provider_id ?? detail.item.provider_name}`,
            value: detail.item.provider_name,
            description: labels.provider,
          }] : []),
          ...(detail?.item.external_assignee_name ? [{
            id: `external:${detail.item.external_assignee_name}`,
            value: detail.item.external_assignee_name,
            description: labels.externalAssignee,
          }] : []),
          ...(detail?.item.assigned_to_name ? [{
            id: `user:${detail.item.assigned_to}`,
            value: detail.item.assigned_to_name,
            description: labels.assignee,
          }] : []),
        ]}
        onOpenChange={(nextOpen) => {
          setExpenseDialogOpen(nextOpen);
          if (!nextOpen) {
            setExpenseProgress(0);
            if (openExpenseOnLoad) onOpenChange(false);
          }
        }}
        onSubmit={submitLinkedExpense}
        onDownload={downloadLinkedExpenseReceipt}
      />
    </>
  );
}
