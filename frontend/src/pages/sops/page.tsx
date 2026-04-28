import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  BookOpen,
  CheckCheck,
  FileCheck2,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import {
  AdminInlineMetric,
  AdminSheetScaffold,
  AdminTableCard,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Banner as ShellBanner,
  PageHeader,
  SuccessBanner,
  checkboxClass,
  inputClass as shellInputClassName,
  selectClass as shellSelectClassName,
  textareaClass as shellTextareaClass,
  tokens,
} from "@/components/ui-shell";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { statusTone } from "./appearance/status-appearance";
import {
  acknowledgeSop,
  fetchSopsWorkspace,
  requestSopAcknowledgement,
  reviewSop,
  saveSopContent,
} from "./data/sops-api";
import {
  emptyForm,
  formDescription,
  formatDate,
  reviewQueueCopy,
  roleCanCreate,
  roleCanOpenLearning,
  roleCanReview,
} from "./model/sops-model";
import type { EligibleUser, SopFormState, SopItem } from "./model/types";

const selectClassName = shellSelectClassName;
const textareaClassName = shellTextareaClass;

function titleWithDot(title: ReactNode) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
      <span>{title}</span>
    </span>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn("rounded-xl px-6 py-10 text-center", tokens.surface.dashed)}>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div
      className={cn(
        "rounded-xl px-6 py-12 text-center text-sm text-muted-foreground",
        tokens.surface.card,
      )}
    >
      <LoaderCircle className="mx-auto mb-3 size-5 animate-spin" />
      {label}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={cn("rounded-xl p-3", tokens.surface.mutedCard)}>
      <div className={tokens.text.eyebrow}>{label}</div>
      <div className="mt-2 text-sm text-foreground">{value}</div>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className={tokens.text.label}>{label}</span>
      {children}
    </label>
  );
}

export function SopsPage() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = useCallback(
    (de: string, ru: string, en: string) =>
      lang === "de" ? de : lang === "ru" ? ru : en,
    [lang],
  );

  const text = useMemo(
    () => ({
      accessDenied: l(
        "Dieser Bereich steht nur internen Rollen zur Verfügung.",
        "Этот раздел доступен только внутренним ролям.",
        "This section is available only for internal roles.",
      ),
      loadingWorkspace: l(
        "SOP-Arbeitsbereich wird geladen...",
        "Загрузка раздела SOP...",
        "Loading SOP workspace...",
      ),
      title: l("SOP и обучение", "SOP и обучение", "SOP and learning"),
      subtitle: l(
        "Библиотека SOP, handbook и training с маршрутами согласования и подтверждением ознакомления.",
        "Библиотека SOP, handbook и training с маршрутами согласования и подтверждением ознакомления.",
        "SOP, handbook and training library with approval routing and acknowledgement tracking.",
      ),
      refresh: l("Aktualisieren", "Обновить", "Refresh"),
      newContent: l("Neuer контент", "Новый контент", "New content"),
      noticesSavedCreate: l(
        "Контент создан.",
        "Контент создан.",
        "Content created.",
      ),
      noticesSavedUpdate: l(
        "Контент обновлен.",
        "Контент обновлен.",
        "Content updated.",
      ),
      noticesAckRequested: l(
        "Запрос на подтверждение отправлен.",
        "Запрос на подтверждение отправлен.",
        "Acknowledgement request sent.",
      ),
      noticesAckDone: l(
        "Подтверждение зафиксировано.",
        "Подтверждение зафиксировано.",
        "Acknowledgement recorded.",
      ),
      noticesReviewSaved: l(
        "Решение ревью сохранено.",
        "Решение ревью сохранено.",
        "Review decision saved.",
      ),
      failLoad: l(
        "Не удалось загрузить раздел SOP.",
        "Не удалось загрузить раздел SOP.",
        "Failed to load SOP workspace.",
      ),
      failSave: l(
        "Не удалось сохранить контент.",
        "Не удалось сохранить контент.",
        "Failed to save content.",
      ),
      failAckRequest: l(
        "Не удалось отправить запрос подтверждения.",
        "Не удалось отправить запрос подтверждения.",
        "Failed to request acknowledgement.",
      ),
      failAck: l(
        "Не удалось зафиксировать подтверждение.",
        "Не удалось зафиксировать подтверждение.",
        "Failed to acknowledge content.",
      ),
      failReview: l(
        "Не удалось сохранить ревью.",
        "Не удалось сохранить ревью.",
        "Failed to review content.",
      ),
      metricsVisible: l(
        "Visible content",
        "Видимый контент",
        "Visible content",
      ),
      metricsApproved: l("Approved", "Подтверждено", "Approved"),
      metricsPendingAck: l(
        "Pending acknowledgement",
        "Ожидает подтверждения",
        "Pending acknowledgement",
      ),
      queueTitle: l(
        "Очередь согласования",
        "Очередь согласования",
        "Approval queue",
      ),
      queueDescription: l(
        "Элементы, ожидающие решения текущей роли.",
        "Элементы, ожидающие решения текущей роли.",
        "Items waiting for decision by current role.",
      ),
      queueEmptyTitle: l(
        "Очередь пустая",
        "Очередь пустая",
        "Queue is empty",
      ),
      queueEmptyDescription: l(
        "Сейчас нет SOP в статусе ожидания согласования.",
        "Сейчас нет SOP в статусе ожидания согласования.",
        "There are no SOP items waiting for approval.",
      ),
      libraryTitle: l("Бухгалтерский реестр SOP", "Реестр SOP", "SOP registry"),
      libraryDescription: l(
        "Единый список видимого контента с фильтрацией, статусами и действиями.",
        "Единый список видимого контента с фильтрацией, статусами и действиями.",
        "Unified content list with filters, statuses and actions.",
      ),
      librarySearchPlaceholder: l(
        "Поиск по title, summary или роли",
        "Поиск по title, summary или роли",
        "Search by title, summary or role",
      ),
      libraryEmptyTitle: l(
        "Контент отсутствует",
        "Контент отсутствует",
        "No learning content",
      ),
      libraryEmptyDescription: l(
        "После публикации или назначения контент появится в реестре.",
        "После публикации или назначения контент появится в реестре.",
        "Content will appear once approved or assigned.",
      ),
      detailTitle: l("Карточка SOP", "Карточка SOP", "SOP detail"),
      detailDescription: l(
        "Статус, таргетинг, текст контента и операционные действия.",
        "Статус, таргетинг, текст контента и операционные действия.",
        "Status, targeting, content body and operational actions.",
      ),
      detailOverview: l("Обзор", "Обзор", "Overview"),
      detailTargeting: l("Таргетинг", "Таргетинг", "Targeting"),
      detailBody: l("Контент", "Контент", "Content"),
      detailActions: l("Действия", "Действия", "Actions"),
      noSelectionTitle: l(
        "Запись не выбрана",
        "Запись не выбрана",
        "No item selected",
      ),
      noSelectionDescription: l(
        "Выберите запись в таблице, чтобы открыть right view.",
        "Выберите запись в таблице, чтобы открыть right view.",
        "Select an item in the table to open right view.",
      ),
      targetingModelTitle: l(
        "Модель таргетинга",
        "Модель таргетинга",
        "Targeting model",
      ),
      targetingModelDescription: l(
        "Доступ определяется ролями и прямыми назначениями пользователей.",
        "Доступ определяется ролями и прямыми назначениями пользователей.",
        "Visibility is defined by target roles and direct user assignments.",
      ),
      scopeTitle: l("Scope", "Scope", "Scope"),
      scopeDescription: l(
        "Срез покрывает библиотеку SOP, маршруты approval и подтверждение ознакомления.",
        "Срез покрывает библиотеку SOP, маршруты approval и подтверждение ознакомления.",
        "Current slice covers SOP library, approval routing and acknowledgements.",
      ),
      formCreateTitle: l(
        "Новый контент",
        "Новый контент",
        "New content",
      ),
      formEditTitle: l(
        "Редактирование контента",
        "Редактирование контента",
        "Edit content",
      ),
      formTitle: l("Заголовок", "Заголовок", "Title"),
      formCategory: l("Категория", "Категория", "Category"),
      formSummary: l("Краткое описание", "Краткое описание", "Summary"),
      formBody: l("Текст", "Текст", "Body"),
      formTargetRoles: l("Целевые роли", "Целевые роли", "Target roles"),
      formDirectUsers: l(
        "Прямые назначения",
        "Прямые назначения",
        "Direct users",
      ),
      formRequiresAck: l(
        "Требуется подтверждение ознакомления",
        "Требуется подтверждение ознакомления",
        "Acknowledgement required",
      ),
      formCancel: l("Отмена", "Отмена", "Cancel"),
      formCreate: l("Создать", "Создать", "Create"),
      formSave: l("Сохранить", "Сохранить", "Save"),
      reviewTitle: l("Ревью контента", "Ревью контента", "Review content"),
      reviewDescription: l(
        "Подтвердите SOP или верните на доработку с заметкой.",
        "Подтвердите SOP или верните на доработку с заметкой.",
        "Approve SOP or return it with a review note.",
      ),
      reviewDecision: l("Решение", "Решение", "Decision"),
      reviewNote: l("Заметка ревью", "Заметка ревью", "Review note"),
      reviewApprove: l("Подтвердить", "Подтвердить", "Approve"),
      reviewReject: l(
        "Отклонить / доработка",
        "Отклонить / доработка",
        "Reject / changes requested",
      ),
      reviewSave: l("Сохранить ревью", "Сохранить ревью", "Save review"),
      actionOpenReview: l(
        "Открыть ревью",
        "Открыть ревью",
        "Open review",
      ),
      actionEdit: l("Редактировать", "Редактировать", "Edit"),
      actionRequestAck: l(
        "Запросить ack",
        "Запросить ack",
        "Request ack",
      ),
      actionAcknowledge: l(
        "Подтвердить",
        "Подтвердить",
        "Acknowledge",
      ),
      statusNotSet: l("Не задано", "Не задано", "Not set"),
      columns: {
        title: l("Название", "Название", "Title"),
        summary: l("Описание", "Описание", "Summary"),
        status: l("Статус", "Статус", "Status"),
        category: l("Категория", "Категория", "Category"),
        revision: l("Ревизия", "Ревизия", "Revision"),
        updated: l("Обновлено", "Обновлено", "Updated"),
        author: l("Автор", "Автор", "Author"),
        ack: l("Ack", "Ack", "Ack"),
        approval: l("Маршрут approval", "Маршрут approval", "Approval route"),
      },
      categoryLabels: {
        sop: "SOP",
        handbook: l("Справочник", "Справочник", "Handbook"),
        training: l("Обучение", "Обучение", "Training"),
      },
      statusLabels: {
        approved: l("Подтверждено", "Подтверждено", "Approved"),
        pending_approval: l("Ожидает approval", "Ожидает approval", "Pending approval"),
        rejected: l("Отклонено", "Отклонено", "Rejected"),
        archived: l("Архив", "Архив", "Archived"),
        draft: l("Черновик", "Черновик", "Draft"),
      },
      ackLabels: {
        pending: l("Ожидает", "Ожидает", "Pending"),
        acknowledged: l("Подтверждено", "Подтверждено", "Acknowledged"),
        requested: l("Запрошено", "Запрошено", "Requested"),
      },
      directUsers: l("Прямые пользователи", "Прямые пользователи", "Direct users"),
      pendingAck: l("Ожидает ack", "Ожидает ack", "Pending ack"),
      acknowledged: l("Подтвердили", "Подтвердили", "Acknowledged"),
      myStatus: l("Мой статус", "Мой статус", "My status"),
      approvalRoleCeo: l("CEO approval", "CEO approval", "CEO approval"),
      approvalRolePm: l(
        "Patient-manager approval",
        "Patient-manager approval",
        "Patient-manager approval",
      ),
    }),
    [l],
  );

  const [items, setItems] = useState<SopItem[]>([]);
  const [reviewQueue, setReviewQueue] = useState<SopItem[]>([]);
  const [eligibleUsers, setEligibleUsers] = useState<EligibleUser[]>([]);
  const [allowedTargetRoles, setAllowedTargetRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [editing, setEditing] = useState<SopItem | null>(null);
  const [reviewItem, setReviewItem] = useState<SopItem | null>(null);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [reviewDecision, setReviewDecision] = useState("approve");
  const [reviewNote, setReviewNote] = useState("");
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [form, setForm] = useState<SopFormState>(emptyForm());
  const [librarySearch, setLibrarySearch] = useState("");
  const [queueSearch, setQueueSearch] = useState("");

  const canCreate = roleCanCreate(user?.role);
  const canReviewQueue = roleCanReview(user?.role);
  const canOpenPage = roleCanOpenLearning(user?.role);
  const queueCopy = useMemo(() => reviewQueueCopy(user?.role), [user?.role]);

  const roleLabel = useCallback((role: string) => tr[`role_${role}`] ?? role, [tr]);
  const statusLabel = useCallback(
    (status: string) =>
      text.statusLabels[status as keyof typeof text.statusLabels] ?? status,
    [text],
  );
  const categoryLabel = useCallback(
    (category: string) =>
      text.categoryLabels[category as keyof typeof text.categoryLabels] ?? category,
    [text],
  );
  const ackLabel = useCallback(
    (ackStatus?: string | null) =>
      text.ackLabels[ackStatus as keyof typeof text.ackLabels] ??
      ackStatus ??
      text.statusNotSet,
    [text],
  );
  const approvalRoleLabel = useCallback(
    (value?: string | null) => {
      if (value === "ceo") return text.approvalRoleCeo;
      if (value === "patient_manager") return text.approvalRolePm;
      return text.statusNotSet;
    },
    [text],
  );

  useEffect(() => {
    if (!canOpenPage) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setRefreshing(!loading);

    async function load() {
      try {
        const { library, eligible, queue } = await fetchSopsWorkspace(
          canCreate,
          canReviewQueue,
        );

        if (cancelled) return;

        setItems(library);
        setReviewQueue(queue);
        setEligibleUsers(eligible?.eligible_users ?? []);
        setAllowedTargetRoles(eligible?.allowed_target_roles ?? []);
        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : text.failLoad);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [canCreate, canOpenPage, canReviewQueue, loading, text.failLoad, version]);

  const visibleMetrics = useMemo(() => {
    const approved = items.filter((item) => item.status === "approved").length;
    const pendingAck = items.filter((item) => item.my_ack_status === "pending").length;
    return { approved, pendingAck };
  }, [items]);

  const filteredUsers = useMemo(() => {
    if (form.targetRoles.length === 0) return eligibleUsers;
    return eligibleUsers.filter(
      (item) =>
        form.targetRoles.includes(item.role) || form.targetUserIds.includes(item.id),
    );
  }, [eligibleUsers, form.targetRoles, form.targetUserIds]);

  const visibleItems = useMemo(() => {
    const term = librarySearch.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) =>
      [
        item.title,
        item.summary ?? "",
        item.created_by_name ?? "",
        item.created_by_role,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [items, librarySearch]);

  const visibleQueue = useMemo(() => {
    const term = queueSearch.trim().toLowerCase();
    if (!term) return reviewQueue;
    return reviewQueue.filter((item) =>
      [item.title, item.summary ?? "", item.created_by_name ?? "", item.created_by_role]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [queueSearch, reviewQueue]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  const queueColumns = useMemo<ColumnDef<SopItem>[]>(
    () => [
      {
        id: "title",
        label: text.columns.title,
        accessor: (row) => row.title,
        sortable: true,
        required: true,
        width: 260,
        render: (row) => <span className="text-sm font-medium text-foreground">{row.title}</span>,
      },
      {
        id: "summary",
        label: text.columns.summary,
        accessor: (row) => row.summary ?? "",
        width: 300,
        render: (row) => <span className="text-xs text-foreground">{row.summary || text.statusNotSet}</span>,
      },
      {
        id: "status",
        label: text.columns.status,
        accessor: (row) => row.status,
        sortable: true,
        width: 180,
        render: (row) => (
          <Badge variant="outline" className={cn("rounded-full", statusTone(row.status))}>
            {statusLabel(row.status)}
          </Badge>
        ),
      },
      {
        id: "category",
        label: text.columns.category,
        accessor: (row) => row.category,
        sortable: true,
        width: 150,
        render: (row) => categoryLabel(row.category),
      },
      {
        id: "approval",
        label: text.columns.approval,
        accessor: (row) => row.approval_required_role ?? "",
        width: 220,
        render: (row) => approvalRoleLabel(row.approval_required_role),
      },
      {
        id: "updated",
        label: text.columns.updated,
        accessor: (row) => row.updated_at,
        sortable: true,
        width: 170,
        render: (row) => formatDate(row.updated_at),
      },
      {
        id: "author",
        label: text.columns.author,
        accessor: (row) => row.created_by_name ?? row.created_by_role,
        width: 190,
        render: (row) => row.created_by_name || roleLabel(row.created_by_role),
      },
    ],
    [approvalRoleLabel, categoryLabel, roleLabel, statusLabel, text],
  );

  const libraryColumns = useMemo<ColumnDef<SopItem>[]>(
    () => [
      {
        id: "title",
        label: text.columns.title,
        accessor: (row) => row.title,
        sortable: true,
        required: true,
        width: 260,
        pinned: "left",
        render: (row) => <span className="text-sm font-medium text-foreground">{row.title}</span>,
      },
      {
        id: "summary",
        label: text.columns.summary,
        accessor: (row) => row.summary ?? "",
        width: 300,
        render: (row) => <span className="text-xs text-foreground">{row.summary || text.statusNotSet}</span>,
      },
      {
        id: "status",
        label: text.columns.status,
        accessor: (row) => row.status,
        sortable: true,
        width: 170,
        render: (row) => (
          <Badge variant="outline" className={cn("rounded-full", statusTone(row.status))}>
            {statusLabel(row.status)}
          </Badge>
        ),
      },
      {
        id: "category",
        label: text.columns.category,
        accessor: (row) => row.category,
        sortable: true,
        width: 140,
        render: (row) => categoryLabel(row.category),
      },
      {
        id: "revision",
        label: text.columns.revision,
        accessor: (row) => row.revision_no,
        sortable: true,
        width: 120,
      },
      {
        id: "ack",
        label: text.columns.ack,
        accessor: (row) => row.my_ack_status ?? "",
        width: 180,
        render: (row) => ackLabel(row.my_ack_status),
      },
      {
        id: "updated",
        label: text.columns.updated,
        accessor: (row) => row.updated_at,
        sortable: true,
        width: 170,
        render: (row) => formatDate(row.updated_at),
      },
      {
        id: "author",
        label: text.columns.author,
        accessor: (row) => row.created_by_name ?? row.created_by_role,
        width: 190,
        render: (row) => row.created_by_name || roleLabel(row.created_by_role),
      },
    ],
    [ackLabel, categoryLabel, roleLabel, statusLabel, text],
  );

  function resetForm() {
    setEditing(null);
    setForm(emptyForm());
    setFormError("");
  }

  function openCreate() {
    resetForm();
    setFormOpen(true);
  }

  function openEdit(item: SopItem) {
    setEditing(item);
    setForm({
      title: item.title,
      category: item.category,
      summary: item.summary ?? "",
      bodyMarkdown: item.body_markdown,
      requiresAck: item.requires_ack,
      targetRoles: item.target_roles,
      targetUserIds: item.target_user_ids,
    });
    setFormError("");
    setFormOpen(true);
  }

  function openReview(item: SopItem) {
    setReviewItem(item);
    setReviewDecision("approve");
    setReviewNote(item.review_note ?? "");
    setReviewError("");
    setReviewOpen(true);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    setError("");
    setNotice("");

    try {
      await saveSopContent(editing?.id ?? null, {
        title: form.title,
        category: form.category,
        summary: form.summary || null,
        body_markdown: form.bodyMarkdown,
        target_roles: form.targetRoles,
        target_user_ids: form.targetUserIds,
        requires_ack: form.requiresAck,
      });
      setFormOpen(false);
      resetForm();
      setNotice(editing ? text.noticesSavedUpdate : text.noticesSavedCreate);
      setVersion((value) => value + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : text.failSave);
    } finally {
      setSaving(false);
    }
  }

  async function requestAck(item: SopItem) {
    setActionBusyId(`request-ack:${item.id}`);
    setError("");
    setNotice("");
    try {
      await requestSopAcknowledgement(item.id);
      setNotice(text.noticesAckRequested);
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : text.failAckRequest);
    } finally {
      setActionBusyId(null);
    }
  }

  async function acknowledge(item: SopItem) {
    setActionBusyId(`ack:${item.id}`);
    setError("");
    setNotice("");
    try {
      await acknowledgeSop(item.id);
      setNotice(text.noticesAckDone);
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : text.failAck);
    } finally {
      setActionBusyId(null);
    }
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewItem) return;

    setReviewBusy(true);
    setReviewError("");
    setError("");
    setNotice("");

    try {
      await reviewSop(reviewItem.id, {
        decision: reviewDecision,
        note: reviewNote || null,
      });
      setReviewOpen(false);
      setReviewItem(null);
      setReviewNote("");
      setNotice(text.noticesReviewSaved);
      setVersion((value) => value + 1);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : text.failReview);
    } finally {
      setReviewBusy(false);
    }
  }

  if (!canOpenPage) {
    return (
      <ShellBanner tone="warning" withIcon>
        {text.accessDenied}
      </ShellBanner>
    );
  }

  if (loading) {
    return <LoadingState label={text.loadingWorkspace} />;
  }

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          title={text.title}
          description={text.subtitle}
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg px-3.5"
                onClick={() => setVersion((value) => value + 1)}
              >
                {refreshing ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {text.refresh}
              </Button>
              {canCreate ? (
                <Button
                  type="button"
                  className="h-9 rounded-lg px-3.5"
                  onClick={openCreate}
                >
                  <Plus className="size-4" />
                  {text.newContent}
                </Button>
              ) : null}
            </>
          }
        />

        {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
        {error ? <ShellBanner tone="error">{error}</ShellBanner> : null}

        <div className="flex flex-wrap gap-6 rounded-xl border border-border bg-card px-4 py-3">
          <AdminInlineMetric
            icon={BookOpen}
            label={text.metricsVisible}
            value={String(items.length)}
            tone="sky"
          />
          <AdminInlineMetric
            icon={FileCheck2}
            label={text.metricsApproved}
            value={String(visibleMetrics.approved)}
            tone="emerald"
          />
          <AdminInlineMetric
            icon={CheckCheck}
            label={text.metricsPendingAck}
            value={String(visibleMetrics.pendingAck)}
            tone="amber"
          />
          <AdminInlineMetric
            icon={ShieldCheck}
            label={queueCopy.metric}
            value={String(reviewQueue.length)}
            tone="slate"
          />
        </div>

        {canReviewQueue ? (
          <AdminTableCard
            title={titleWithDot(text.queueTitle)}
            description={text.queueDescription}
            count={visibleQueue.length}
            accessory={
              <div className="flex min-w-[220px] items-center gap-2">
                <Input
                  value={queueSearch}
                  onChange={(event) => setQueueSearch(event.target.value)}
                  className={shellInputClassName}
                  placeholder={text.librarySearchPlaceholder}
                />
              </div>
            }
          >
            <DataTable
              rows={visibleQueue}
              columns={queueColumns}
              rowId={(row) => row.id}
              density="compact"
              onRowClick={(row) => openReview(row)}
              rowActions={(row) => (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg px-2.5"
                  onClick={() => openReview(row)}
                >
                  {text.actionOpenReview}
                </Button>
              )}
              emptyState={
                <EmptyState
                  title={text.queueEmptyTitle}
                  description={text.queueEmptyDescription}
                />
              }
            />
          </AdminTableCard>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
          <AdminTableCard
            title={titleWithDot(text.libraryTitle)}
            description={text.libraryDescription}
            count={visibleItems.length}
            accessory={
              <div className="flex min-w-[240px] items-center gap-2">
                <Input
                  value={librarySearch}
                  onChange={(event) => setLibrarySearch(event.target.value)}
                  className={shellInputClassName}
                  placeholder={text.librarySearchPlaceholder}
                />
              </div>
            }
          >
            <DataTable
              rows={visibleItems}
              columns={libraryColumns}
              rowId={(row) => row.id}
              density="compact"
              activeRowId={selectedItemId || null}
              onRowClick={(row) => setSelectedItemId(row.id)}
              rowActions={(row) => (
                <div className="flex items-center gap-1">
                  {row.can_edit ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg px-2.5"
                      onClick={() => openEdit(row)}
                    >
                      {text.actionEdit}
                    </Button>
                  ) : null}
                  {row.can_request_ack ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg px-2.5"
                      disabled={actionBusyId === `request-ack:${row.id}`}
                      onClick={() => void requestAck(row)}
                    >
                      {actionBusyId === `request-ack:${row.id}` ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : null}
                      {text.actionRequestAck}
                    </Button>
                  ) : null}
                  {row.can_acknowledge ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 rounded-lg px-2.5"
                      disabled={actionBusyId === `ack:${row.id}`}
                      onClick={() => void acknowledge(row)}
                    >
                      {actionBusyId === `ack:${row.id}` ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : null}
                      {text.actionAcknowledge}
                    </Button>
                  ) : null}
                  {row.can_review ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg px-2.5"
                      onClick={() => openReview(row)}
                    >
                      {text.actionOpenReview}
                    </Button>
                  ) : null}
                </div>
              )}
              emptyState={
                <EmptyState
                  title={text.libraryEmptyTitle}
                  description={text.libraryEmptyDescription}
                />
              }
            />
          </AdminTableCard>

          <div className="space-y-6">
            <AdminTableCard
              title={titleWithDot(text.targetingModelTitle)}
              description={text.targetingModelDescription}
            >
              <div className="flex flex-wrap gap-2 p-4">
                {allowedTargetRoles.length > 0 ? (
                  allowedTargetRoles.map((role) => (
                    <Badge key={role} variant="outline" className="rounded-full">
                      {roleLabel(role)}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">{text.statusNotSet}</span>
                )}
              </div>
            </AdminTableCard>

            <AdminTableCard
              title={titleWithDot(text.scopeTitle)}
              description={text.scopeDescription}
            >
              <div className="p-4 text-sm text-muted-foreground">
                {text.scopeDescription}
              </div>
            </AdminTableCard>
          </div>
        </section>
      </div>

      <Sheet
        open={Boolean(selectedItemId)}
        onOpenChange={(open) => {
          if (!open) setSelectedItemId("");
        }}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-3xl">
          <AdminSheetScaffold
            title={selectedItem ? selectedItem.title : text.detailTitle}
            description={text.detailDescription}
          >
            {!selectedItem ? (
              <EmptyState
                title={text.noSelectionTitle}
                description={text.noSelectionDescription}
              />
            ) : (
              <>
                <AdminTableCard
                  title={titleWithDot(text.detailOverview)}
                  accessory={
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn("rounded-full", statusTone(selectedItem.status))}>
                        {statusLabel(selectedItem.status)}
                      </Badge>
                      <Badge variant="outline" className="rounded-full">
                        {categoryLabel(selectedItem.category)}
                      </Badge>
                    </div>
                  }
                >
                  <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
                    <DetailField label={text.columns.revision} value={selectedItem.revision_no} />
                    <DetailField
                      label={text.columns.updated}
                      value={formatDate(selectedItem.updated_at)}
                    />
                    <DetailField
                      label={text.columns.author}
                      value={selectedItem.created_by_name || roleLabel(selectedItem.created_by_role)}
                    />
                    <DetailField
                      label={text.columns.ack}
                      value={ackLabel(selectedItem.my_ack_status)}
                    />
                    <DetailField label={text.pendingAck} value={selectedItem.pending_ack_count} />
                    <DetailField
                      label={text.acknowledged}
                      value={selectedItem.acknowledged_count}
                    />
                    <DetailField
                      label={text.columns.approval}
                      value={approvalRoleLabel(selectedItem.approval_required_role)}
                    />
                    <DetailField
                      label={text.myStatus}
                      value={ackLabel(selectedItem.my_ack_status)}
                    />
                  </div>
                </AdminTableCard>

                <AdminTableCard title={titleWithDot(text.detailTargeting)}>
                  <div className="space-y-3 p-4">
                    <div className="flex flex-wrap gap-2">
                      {selectedItem.target_roles.length > 0 ? (
                        selectedItem.target_roles.map((role) => (
                          <Badge key={`${selectedItem.id}-${role}`} variant="outline" className="rounded-full">
                            {roleLabel(role)}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">{text.statusNotSet}</span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {text.directUsers}: {selectedItem.assigned_user_count}
                    </div>
                  </div>
                </AdminTableCard>

                <AdminTableCard title={titleWithDot(text.detailBody)}>
                  <div className="p-4">
                    {selectedItem.summary ? (
                      <p className="mb-4 text-sm text-muted-foreground">{selectedItem.summary}</p>
                    ) : null}
                    <pre
                      className={cn(
                        "whitespace-pre-wrap break-words rounded-xl p-4 text-sm text-foreground",
                        tokens.surface.mutedCard,
                      )}
                    >
                      {selectedItem.body_markdown}
                    </pre>
                  </div>
                </AdminTableCard>

                <AdminTableCard title={titleWithDot(text.detailActions)}>
                  <div className="flex flex-wrap gap-2 p-4">
                    {selectedItem.can_edit ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-lg px-3.5"
                        onClick={() => openEdit(selectedItem)}
                      >
                        {text.actionEdit}
                      </Button>
                    ) : null}
                    {selectedItem.can_request_ack ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-lg px-3.5"
                        disabled={actionBusyId === `request-ack:${selectedItem.id}`}
                        onClick={() => void requestAck(selectedItem)}
                      >
                        {actionBusyId === `request-ack:${selectedItem.id}` ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : null}
                        {text.actionRequestAck}
                      </Button>
                    ) : null}
                    {selectedItem.can_acknowledge ? (
                      <Button
                        type="button"
                        className="h-9 rounded-lg px-3.5"
                        disabled={actionBusyId === `ack:${selectedItem.id}`}
                        onClick={() => void acknowledge(selectedItem)}
                      >
                        {actionBusyId === `ack:${selectedItem.id}` ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : null}
                        {text.actionAcknowledge}
                      </Button>
                    ) : null}
                    {selectedItem.can_review ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-lg px-3.5"
                        onClick={() => openReview(selectedItem)}
                      >
                        {text.actionOpenReview}
                      </Button>
                    ) : null}
                  </div>
                </AdminTableCard>
              </>
            )}
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-3xl">
          <form className="flex h-full min-h-0 flex-col" onSubmit={(event) => void submitForm(event)}>
            <AdminSheetScaffold
              title={editing ? text.formEditTitle : text.formCreateTitle}
              description={formDescription(user?.role)}
              footer={
                <SheetFormFooter
                  cancelLabel={text.formCancel}
                  submitLabel={editing ? text.formSave : text.formCreate}
                  submittingLabel={editing ? text.formSave : text.formCreate}
                  submitting={saving}
                  onCancel={() => setFormOpen(false)}
                />
              }
            >
              {formError ? <ShellBanner tone="error">{formError}</ShellBanner> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={text.formTitle}>
                  <Input
                    value={form.title}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, title: event.target.value }))
                    }
                    className={shellInputClassName}
                    required
                  />
                </Field>
                <Field label={text.formCategory}>
                  <NativeComboboxSelect
                    value={form.category}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        category: event.target.value as SopFormState["category"],
                      }))
                    }
                    className={selectClassName}
                  >
                    <option value="sop">{categoryLabel("sop")}</option>
                    <option value="handbook">{categoryLabel("handbook")}</option>
                    <option value="training">{categoryLabel("training")}</option>
                  </NativeComboboxSelect>
                </Field>
                <Field label={text.formSummary} className="sm:col-span-2">
                  <Input
                    value={form.summary}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, summary: event.target.value }))
                    }
                    className={shellInputClassName}
                  />
                </Field>
                <Field label={text.formBody} className="sm:col-span-2">
                  <textarea
                    value={form.bodyMarkdown}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, bodyMarkdown: event.target.value }))
                    }
                    className={cn(textareaClassName, "min-h-[220px]")}
                    required
                  />
                </Field>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <Field label={text.formTargetRoles}>
                  <div
                    className={cn(
                      "max-h-72 space-y-2 overflow-y-auto rounded-xl p-3",
                      tokens.surface.mutedCard,
                    )}
                  >
                    {allowedTargetRoles.length > 0 ? (
                      allowedTargetRoles.map((role) => (
                        <label
                          key={role}
                          className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                        >
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={form.targetRoles.includes(role)}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                targetRoles: event.target.checked
                                  ? [...current.targetRoles, role]
                                  : current.targetRoles.filter((value) => value !== role),
                              }))
                            }
                          />
                          <span>{roleLabel(role)}</span>
                        </label>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">{text.statusNotSet}</span>
                    )}
                  </div>
                </Field>

                <Field label={text.formDirectUsers}>
                  <div
                    className={cn(
                      "max-h-72 space-y-2 overflow-y-auto rounded-xl p-3",
                      tokens.surface.mutedCard,
                    )}
                  >
                    {(filteredUsers.length > 0 ? filteredUsers : eligibleUsers).map((item) => (
                      <label
                        key={item.id}
                        className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                      >
                        <input
                          type="checkbox"
                          className={checkboxClass}
                          checked={form.targetUserIds.includes(item.id)}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              targetUserIds: event.target.checked
                                ? [...current.targetUserIds, item.id]
                                : current.targetUserIds.filter((value) => value !== item.id),
                            }))
                          }
                        />
                        <div>
                          <p className="font-medium text-foreground">{item.name}</p>
                          <p className="text-xs text-muted-foreground">{roleLabel(item.role)}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </Field>
              </div>

              <label
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-foreground",
                  tokens.surface.mutedCard,
                )}
              >
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={form.requiresAck}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      requiresAck: event.target.checked,
                    }))
                  }
                />
                <span>{text.formRequiresAck}</span>
              </label>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={reviewOpen} onOpenChange={setReviewOpen}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
          <form className="flex h-full min-h-0 flex-col" onSubmit={(event) => void submitReview(event)}>
            <AdminSheetScaffold
              title={text.reviewTitle}
              description={text.reviewDescription}
              footer={
                <SheetFormFooter
                  cancelLabel={text.formCancel}
                  submitLabel={text.reviewSave}
                  submittingLabel={text.reviewSave}
                  submitting={reviewBusy}
                  onCancel={() => setReviewOpen(false)}
                />
              }
            >
              {reviewError ? <ShellBanner tone="error">{reviewError}</ShellBanner> : null}
              {reviewItem ? (
                <AdminTableCard title={titleWithDot(text.detailOverview)}>
                  <div className="grid gap-3 p-4">
                    <DetailField label={text.columns.title} value={reviewItem.title} />
                    <DetailField label={text.columns.author} value={reviewItem.created_by_name || roleLabel(reviewItem.created_by_role)} />
                    <DetailField label={text.columns.updated} value={formatDate(reviewItem.updated_at)} />
                  </div>
                </AdminTableCard>
              ) : null}
              <Field label={text.reviewDecision}>
                <NativeComboboxSelect
                  value={reviewDecision}
                  onChange={(event) => setReviewDecision(event.target.value)}
                  className={selectClassName}
                >
                  <option value="approve">{text.reviewApprove}</option>
                  <option value="reject">{text.reviewReject}</option>
                </NativeComboboxSelect>
              </Field>
              <Field label={text.reviewNote}>
                <textarea
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  className={cn(textareaClassName, "min-h-[160px]")}
                />
              </Field>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
