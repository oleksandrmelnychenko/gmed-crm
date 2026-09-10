import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArchiveRestore,
  ArrowLeft,
  Building2,
  CalendarClock,
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
import { localizeTaskNote, localizeTaskTitle } from "@/lib/task-labels";

import type {
  ConciergeTask,
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
import {
  ConciergeExpenseReceiptDialog,
  type ConciergeExpenseSubject,
} from "./concierge-expense-receipt-dialog";
import {
  downloadTaskExpenseReceipt,
  getTaskExpenseContext,
  getTaskExpenses,
  uploadTaskExpense,
} from "./expense-receipt-api";
import type {
  ConciergeExpenseContext,
  ConciergeExpenseItem,
  ConciergeExpenseMutationResponse,
  ConciergeExpenseSubmitInput,
} from "./expense-receipt-model";
import { ConciergeTaskAttachments } from "./task-attachments";

const copy = {
  de: {
    loading: "Aufgabe wird geladen",
    children: "Unteraufgaben und Termine",
    emptyChildren: "Noch keine Unteraufgaben oder Termine",
    subtask: "Unteraufgabe",
    event: "Termin",
    parentTask: "Zur übergeordneten Aufgabe",
    title: "Titel",
    period: "Zeitraum",
    start: "Beginn",
    end: "Ende / Frist",
    noDate: "Ohne Termin",
    noAssignee: "Nicht zugewiesen",
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
    on_hold: "Pausiert",
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
    archiveAction: "Archivieren",
    archivedStatus: "Archiviert",
    restoreAction: "Wiederherstellen",
    restored: "Aufgabe wiederhergestellt",
    delete: "Löschen",
    deleteTitle: "Aufgabe löschen?",
    deleteMessage: "Die Aufgabe verschwindet aus dem Aufgabenmanager. Der Audit-Verlauf bleibt erhalten.",
    cancel: "Abbrechen",
    overview: "Aufgabendaten",
    links: "Verknüpfungen",
    expenses: "Ausgaben",
    addExpense: "Ausgabe erfassen",
    emptyExpenses: "Für diese Aufgabe wurden noch keine Ausgaben erfasst.",
    expenseLoadFailed: "Die Ausgaben dieser Aufgabe konnten nicht geladen werden.",
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
    children: "Подзадачи и события",
    emptyChildren: "Подзадач и событий пока нет",
    subtask: "Подзадача",
    event: "Событие",
    parentTask: "К основной задаче",
    title: "Название",
    period: "Период",
    start: "Начало",
    end: "Окончание / срок",
    noDate: "Без срока",
    noAssignee: "Не назначен",
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
    on_hold: "На паузе",
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
    archiveAction: "В архив",
    archivedStatus: "В архиве",
    restoreAction: "Восстановить",
    restored: "Задача восстановлена из архива",
    delete: "Удалить",
    deleteTitle: "Удалить задачу?",
    deleteMessage: "Задача исчезнет из менеджера задач. Аудит действий будет сохранён.",
    cancel: "Отмена",
    overview: "Данные задачи",
    links: "Связи",
    expenses: "Расходы",
    addExpense: "Добавить расход",
    emptyExpenses: "Для этой задачи ещё не добавляли расходы.",
    expenseLoadFailed: "Не удалось загрузить расходы этой задачи.",
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
  "concierge_operational_item.archived",
  "concierge_operational_item.restored",
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

function taskStatusClassName(status: ConciergeTask["status"]) {
  switch (status) {
    case "open": return "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300";
    case "in_progress": return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300";
    case "on_hold": return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300";
    case "review": return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300";
    case "completed": return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300";
    case "cancelled": return "border-border bg-muted text-muted-foreground";
  }
}

function TaskDetailSection({
  title,
  count,
  action,
  className,
  children,
}: {
  title: ReactNode;
  count?: number;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg border border-border/70 bg-card", className)}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/70 bg-muted/20 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="min-w-0 break-words text-[13px] font-semibold tracking-tight text-foreground">{title}</h3>
          {count !== undefined ? <Badge variant="secondary" className="tabular-nums">{count}</Badge> : null}
        </div>
        {action ? <div className="flex max-w-full flex-wrap items-center gap-2">{action}</div> : null}
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
  relatedTasks = [],
  onCreateChild,
  onOpenRelated,
  onOpenChange,
  onChanged,
}: {
  taskId: string | null;
  lang: Lang;
  open: boolean;
  openExpenseOnLoad?: boolean;
  relatedTasks?: ConciergeTask[];
  onCreateChild?: (parent: ConciergeTask, kind: "task" | "event") => void;
  onOpenRelated?: (task: ConciergeTask) => void;
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
  const [expenseSubject, setExpenseSubject] = useState<ConciergeExpenseSubject | null>(null);
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
  const detailLoadSequenceRef = useRef(0);
  const autoExpenseOpenedRef = useRef(false);
  const canReadTaskExpenses = Boolean(
    detail
    && user
    && (user.role === "ceo"
      || user.role === "billing"
      || detail.item.assigned_to === user.id
      || detail.item.assigned_by === user.id),
  );
  const canSubmitTaskExpense = canReadTaskExpenses;
  const checklistDirty = Boolean(editingChecklistId && checklistDraft.trim() !== detail?.checklist.find((item) => item.id === editingChecklistId)?.label);
  const commentDirty = Boolean(editingCommentId && commentDraft.trim() !== detail?.comments.find((item) => item.id === editingCommentId)?.body);
  const statusDirty = Boolean(detail && pendingStatus && pendingStatus !== detail.item.status);
  const hasUnsavedChanges = statusDirty || checklistDirty || commentDirty || Boolean(comment.trim() || checklistLabel.trim());
  const childTasks = detail ? relatedTasks.filter((task) => task.parent_task_id === detail.item.id) : [];
  const parentTask = detail ? relatedTasks.find((task) => task.id === detail.item.parent_task_id) : undefined;

  const load = useCallback(async () => {
    if (!open || !taskId) return;
    const sequence = ++detailLoadSequenceRef.current;
    setLoading(true);
    setError("");
    try {
      const payload = await apiFetch<ConciergeTaskDetail>(`/concierge-operational-items/${taskId}`, { forceFresh: true });
      if (sequence !== detailLoadSequenceRef.current) return;
      setDetail(payload);
      setPendingStatus(payload.item.status);
    } catch (loadError) {
      if (sequence === detailLoadSequenceRef.current) {
        setError(conciergeTaskErrorMessage(loadError, lang, labels.loading));
      }
    } finally {
      if (sequence === detailLoadSequenceRef.current) setLoading(false);
    }
  }, [labels.loading, lang, open, taskId]);

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
    setDeleteConfirmOpen(false);
    setPendingChildDelete(null);
    autoExpenseOpenedRef.current = false;
    commentRequestRef.current = null;
    checklistRequestRef.current = null;
    toggleRequestRef.current = null;
    void load();
    return () => {
      detailLoadSequenceRef.current += 1;
    };
  }, [load, open]);

  useEffect(() => {
    const task = detail?.item;
    const loadSequence = expenseLoadSequenceRef.current + 1;
    expenseLoadSequenceRef.current = loadSequence;
    setExpenseDialogOpen(false);
    setExpenseSubject(null);
    setExpenseContext(null);
    setExpenseItems([]);
    setExpenseError("");
    setExpenseProgress(0);

    if (!open || !task || !canReadTaskExpenses) {
      setExpenseLoading(false);
      return;
    }

    // Keep the expense action responsive even while its server context is
    // loading (or temporarily unavailable). Otherwise the detail dialog is
    // hidden by openExpenseOnLoad and the click appears to do nothing.
    setExpenseSubject({
      id: task.id,
      patient_name: task.patient_name || "",
      patient_pid: "",
      provider_name: task.provider_name,
      vendor_name: task.external_assignee_name,
      currency: "EUR",
      status: task.status,
    });
    setExpenseLoading(true);
    void Promise.allSettled([
      getTaskExpenseContext(task.id),
      getTaskExpenses(task.id),
    ])
      .then(([contextResult, historyResult]) => {
        if (expenseLoadSequenceRef.current !== loadSequence) return;
        if (contextResult.status === "fulfilled") {
          const context = contextResult.value;
          setExpenseSubject({
            id: task.id,
            patient_name: context.patient?.display_name || task.patient_name || "",
            patient_pid: context.patient?.pid || "",
            provider_name: task.provider_name,
            vendor_name: task.external_assignee_name,
            currency: context.task?.currency || context.service?.currency || "EUR",
            status: task.status,
          });
          setExpenseContext(context);
        }
        if (historyResult.status === "fulfilled") {
          setExpenseItems(historyResult.value.items);
        }
        if (contextResult.status === "rejected" || historyResult.status === "rejected") {
          setExpenseError(labels.expenseLoadFailed);
        }
      })
      .finally(() => {
        if (expenseLoadSequenceRef.current === loadSequence) setExpenseLoading(false);
      });
  }, [canReadTaskExpenses, detail?.item, labels.expenseLoadFailed, open]);

  useEffect(() => {
    if (!open || !openExpenseOnLoad || expenseLoading || !canSubmitTaskExpense || !expenseSubject) return;
    if (autoExpenseOpenedRef.current) return;
    autoExpenseOpenedRef.current = true;
    setExpenseDialogOpen(true);
  }, [canSubmitTaskExpense, expenseLoading, expenseSubject, open, openExpenseOnLoad]);

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
    if (!taskId || !canCollaborate || busy || !checklistDirty || !checklistDraft.trim()) return;
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
    if (!taskId || item.created_by !== user?.id || busy || !commentDirty || !commentDraft.trim()) return;
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
      setPendingChildDelete(null);
      setError(conciergeTaskErrorMessage(mutationError, lang, labels.delete));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTask() {
    if (!taskId || !canDelete || busy) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch<void>(`/concierge-operational-items/${taskId}`, { method: "DELETE" });
      clearApiCache("/concierge-operational-items");
      setDeleteConfirmOpen(false);
      onOpenChange(false);
      onChanged();
    } catch (deleteError) {
      setDeleteConfirmOpen(false);
      setError(conciergeTaskErrorMessage(deleteError, lang, labels.delete));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus() {
    if (!taskId || !detail || !canChangeStatus || busy || !pendingStatus || pendingStatus === detail.item.status) return;
    if (pendingStatus === "archive") {
      await changeArchiveState(true);
      return;
    }
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

  async function changeArchiveState(archive: boolean) {
    if (!taskId || !detail || !canModify || busy) return;
    if (archive ? detail.item.status !== "completed" || Boolean(detail.item.archived_at) : !detail.item.archived_at) return;
    setBusy(true);
    setError("");
    try {
      const updated = await apiFetch<ConciergeTask>(`/concierge-operational-items/${taskId}/${archive ? "archive" : "restore"}`, { method: "POST" });
      setDetail((current) => current?.item.id === updated.id ? { ...current, item: updated } : current);
      setPendingStatus(updated.status);
      clearApiCache("/concierge-operational-items");
      onChanged();
      await load();
    } catch (archiveError) {
      setError(conciergeTaskErrorMessage(archiveError, lang, archive ? labels.archiveAction : labels.restoreAction));
    } finally {
      setBusy(false);
    }
  }

  async function submitLinkedExpense(
    input: ConciergeExpenseSubmitInput,
  ): Promise<ConciergeExpenseMutationResponse> {
    if (!taskId || !expenseSubject || submittingExpense || !canSubmitTaskExpense) {
      throw new Error(labels.expenseLoadFailed);
    }
    setSubmittingExpense(true);
    setExpenseError("");
    setExpenseProgress(0);
    try {
      const response = await uploadTaskExpense(
        taskId,
        input,
        setExpenseProgress,
      );
      setExpenseItems((current) => [
        response.item,
        ...current.filter((item) => item.id !== response.item.id),
      ]);
      clearApiCache(`/tasks/${taskId}/expenses`);
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
    if (!taskId || !item.receipt) return;
    setExpenseError("");
    try {
      await downloadTaskExpenseReceipt(
        taskId,
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
        dirty={hasUnsavedChanges}
        onOpenChange={onOpenChange}
      >
      <DialogContent className={cn(conciergeDialogContentClassName, (canDelete || statusDirty) && "grid-rows-[auto_minmax(0,1fr)_auto]")} style={{ maxWidth: "64rem" }}>
        <ConciergeDialogHeader
          icon={ListChecks}
          tone="dot"
          title={detail ? localizeTaskTitle(detail.item.title, lang) : labels.loading}
          meta={detail ? <><Badge variant="outline" className="rounded-full font-mono text-muted-foreground">{conciergeTaskCode(detail.item)}</Badge><Badge variant="outline" className={detail.item.archived_at ? "bg-muted text-muted-foreground" : taskStatusClassName(detail.item.status)}>{detail.item.archived_at ? labels.archivedStatus : labels[detail.item.status]}</Badge><Badge variant="secondary" className="rounded-full">{detail.item.checklist_completed}/{detail.item.checklist_total}</Badge></> : undefined}
        />
        <ConciergeDialogBody>
          {error ? <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
          {loading && !detail ? <div className="flex items-center justify-center py-20 text-sm text-muted-foreground"><LoaderCircle className="mr-2 animate-spin" />{labels.loading}</div> : null}
          {detail ? (
            <div className="space-y-3">
              {onOpenRelated && parentTask ? (
                <Button type="button" variant="outline" size="sm" className="max-w-full" disabled={busy || hasUnsavedChanges} onClick={() => onOpenRelated(parentTask)}>
                  <ArrowLeft />{labels.parentTask}
                </Button>
              ) : null}
              {detail.item.kind === "task" && (onCreateChild || childTasks.length > 0) ? (
                <TaskDetailSection
                  title={labels.children}
                  count={childTasks.length}
                  action={onCreateChild && canCollaborate && !detail.item.archived_at && !["completed", "cancelled"].includes(detail.item.status) ? (
                    <>
                      <Button type="button" size="sm" className="h-8" disabled={busy || hasUnsavedChanges} onClick={() => onCreateChild(detail.item, "task")}><Plus />{labels.subtask}</Button>
                      <Button type="button" size="sm" className="h-8" disabled={busy || hasUnsavedChanges} onClick={() => onCreateChild(detail.item, "event")}><Plus />{labels.event}</Button>
                    </>
                  ) : undefined}
                >
                  {childTasks.length === 0 ? (
                    <p className="px-3.5 py-5 text-center text-xs text-muted-foreground">{labels.emptyChildren}</p>
                  ) : (
                    <div>
                      <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,0.85fr)_minmax(0,1.1fr)_7rem] gap-3 border-b border-border/60 bg-muted/10 px-3.5 py-2 text-xs text-muted-foreground sm:grid">
                        <span>{labels.title}</span><span>{labels.assignee}</span><span>{labels.period}</span><span>{labels.status}</span>
                      </div>
                      <div className="divide-y divide-border/60">
                        {childTasks.map((task) => {
                          const end = task.kind === "event" ? task.ends_at : task.due_at;
                          const KindIcon = task.kind === "event" ? CalendarClock : ListChecks;
                          return (
                            <button key={task.id} type="button" className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3.5 py-3 text-left text-sm enabled:cursor-pointer enabled:hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.85fr)_minmax(0,1.1fr)_7rem]" disabled={!onOpenRelated || busy || hasUnsavedChanges} onClick={() => onOpenRelated?.(task)}>
                              <span className="col-span-2 flex min-w-0 items-start gap-2.5 sm:col-span-1">
                                <KindIcon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", task.kind === "event" ? "text-sky-600 dark:text-sky-400" : "text-[var(--brand)]")} />
                                <span className="min-w-0">
                                  <span className="block break-words font-medium leading-snug">{localizeTaskTitle(task.title, lang)}</span>
                                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground"><span className="font-mono">{conciergeTaskCode(task)}</span><span>{task.kind === "event" ? labels.event : labels.subtask}</span></span>
                                </span>
                              </span>
                              <span className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground"><UserRound aria-hidden="true" className="size-3.5 shrink-0 sm:hidden" /><span className="break-words">{task.assigned_to_name || labels.noAssignee}</span></span>
                              <span className="col-span-2 row-start-3 grid min-w-0 gap-1 text-xs tabular-nums text-muted-foreground sm:col-span-1 sm:row-auto">
                                {task.starts_at ? <span className="break-words"><span>{labels.start}: </span>{dateTime(task.starts_at, lang)}</span> : null}
                                {end ? <span className="break-words"><span>{labels.due}: </span>{dateTime(end, lang)}</span> : null}
                                {!task.starts_at && !end ? labels.noDate : null}
                              </span>
                              <Badge variant="outline" className={cn("col-start-2 row-start-2 max-sm:justify-self-end sm:col-auto sm:row-auto", task.archived_at ? "bg-muted text-muted-foreground" : taskStatusClassName(task.status))}>{task.archived_at ? labels.archivedStatus : labels[task.status]}</Badge>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </TaskDetailSection>
              ) : null}
              <TaskDetailSection title={labels.overview}>
                <div className="divide-y divide-border/60">
                  <TaskDetailRow label={labels.assignee} value={detail.item.assigned_to_name} />
                  <TaskDetailRow label={labels.start} value={dateTime(detail.item.starts_at, lang)} />
                  <TaskDetailRow label={labels.end} value={dateTime(detail.item.kind === "event" ? detail.item.ends_at : detail.item.due_at, lang)} />
                  <TaskDetailRow label={labels.reminder} value={dateTime(detail.item.reminder_at, lang)} />
                  <TaskDetailRow label={labels.note} value={<p className="whitespace-pre-wrap">{localizeTaskNote(detail.item.note, lang) || "—"}</p>} />
                  <TaskDetailRow label={labels.location} value={detail.item.location || "—"} />
                  <TaskDetailRow
                    label={labels.status}
                    value={detail.item.archived_at ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="rounded-full">{labels.archivedStatus}</Badge>
                        {canModify ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void changeArchiveState(false)}><ArchiveRestore />{labels.restoreAction}</Button> : null}
                      </div>
                    ) : canChangeStatus ? (
                      <SelectField
                        className="h-9 min-w-40"
                        value={pendingStatus || detail.item.status}
                        disabled={busy || Boolean(detail.item.archived_at)}
                        aria-label={labels.status}
                        options={[
                          ...availableConciergeTaskStatuses(detail.item, user?.id, user?.role).map((status) => ({
                            value: status,
                            label: labels[status],
                          })),
                          ...(detail.item.status === "completed" && canModify ? [{ value: "archive", label: labels.archiveAction }] : []),
                        ]}
                        onValueChange={setPendingStatus}
                      />
                    ) : (
                      <Badge variant="outline" className={taskStatusClassName(detail.item.status)}>{labels[detail.item.status]}</Badge>
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

              {canReadTaskExpenses ? (
                <TaskDetailSection
                  title={labels.expenses}
                  action={canSubmitTaskExpense ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8"
                      disabled={expenseLoading || submittingExpense || !expenseSubject || Boolean(detail.item.archived_at)}
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
                          <Button type="button" size="icon-sm" className="size-8" disabled={busy || !checklistDirty || !checklistDraft.trim()} aria-label={labels.save} onClick={() => void updateChecklistItem(item)}><Save /></Button>
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
                            <Button type="button" size="sm" disabled={busy || !commentDirty || !commentDraft.trim()} onClick={() => void updateCommentItem(item)}>{busy ? <LoaderCircle className="animate-spin" /> : <Save />}{labels.save}</Button>
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
        {canDelete || statusDirty ? (
          <ConciergeDialogFooter>
            {canDelete ? (
              <Button type="button" size="sm" variant="ghost" className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto" disabled={busy} onClick={() => setDeleteConfirmOpen(true)}>
                <Trash2 />{labels.delete}
              </Button>
            ) : null}
            {statusDirty ? (
              <>
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
              </>
            ) : null}
          </ConciergeDialogFooter>
        ) : null}
      </DialogContent>
      <DirtyDismissConfirmDialog
        open={open && deleteConfirmOpen}
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
        open={open && Boolean(pendingChildDelete)}
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
        service={expenseSubject}
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
