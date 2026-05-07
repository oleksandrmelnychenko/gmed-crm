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
import { formatEnumLabelFromKeys, useLang, type TranslationKey } from "@/lib/i18n";
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

const SOP_ROLE_LABEL_KEYS = {
  ceo: "role_ceo",
  ceo_assistant: "role_ceo_assistant",
  patient_manager: "role_patient_manager",
  teamlead_interpreter: "role_teamlead_interpreter",
  interpreter: "role_interpreter",
  concierge: "role_concierge",
  billing: "role_billing",
  sales: "role_sales",
  it_admin: "role_it_admin",
  patient: "role_patient",
} as const satisfies Partial<Record<string, TranslationKey>>;

const SOP_STATUS_LABEL_KEYS = {
  approved: "sops_status_approved",
  pending_approval: "sops_status_pending_approval",
  rejected: "sops_status_rejected",
  archived: "sops_status_archived",
  draft: "sops_status_draft",
} as const satisfies Partial<Record<string, TranslationKey>>;

const SOP_CATEGORY_LABEL_KEYS = {
  sop: "sops_category_sop",
  handbook: "sops_category_handbook",
  training: "sops_category_training",
} as const satisfies Partial<Record<string, TranslationKey>>;

const SOP_ACK_LABEL_KEYS = {
  pending: "sops_ack_pending",
  acknowledged: "sops_ack_acknowledged",
  requested: "sops_ack_requested",
} as const satisfies Partial<Record<string, TranslationKey>>;

const SOP_APPROVAL_ROLE_LABEL_KEYS = {
  ceo: "sops_approval_role_ceo",
  patient_manager: "sops_approval_role_patient_manager",
} as const satisfies Partial<Record<string, TranslationKey>>;

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
  const text = useMemo(
    () => ({
      accessDenied: t.sops_access_denied,
      loadingWorkspace: t.sops_loading_workspace,
      title: t.sops_title,
      subtitle: t.sops_subtitle,
      refresh: t.common_refresh,
      newContent: t.sops_new_content,
      noticesSavedCreate: t.sops_notice_created,
      noticesSavedUpdate: t.sops_notice_updated,
      noticesAckRequested: t.sops_notice_ack_requested,
      noticesAckDone: t.sops_notice_ack_done,
      noticesReviewSaved: t.sops_notice_review_saved,
      failLoad: t.sops_error_load,
      failSave: t.sops_error_save,
      failAckRequest: t.sops_error_ack_request,
      failAck: t.sops_error_ack,
      failReview: t.sops_error_review,
      metricsVisible: t.sops_metric_visible,
      metricsApproved: t.sops_metric_approved,
      metricsPendingAck: t.sops_metric_pending_ack,
      queueTitle: t.sops_queue_title,
      queueDescription: t.sops_queue_description,
      queueEmptyTitle: t.sops_queue_empty_title,
      queueEmptyDescription: t.sops_queue_empty_description,
      libraryTitle: t.sops_library_title,
      libraryDescription: t.sops_library_description,
      librarySearchPlaceholder: t.sops_library_search_placeholder,
      libraryEmptyTitle: t.sops_library_empty_title,
      libraryEmptyDescription: t.sops_library_empty_description,
      detailTitle: t.sops_detail_title,
      detailDescription: t.sops_detail_description,
      detailOverview: t.sops_detail_overview,
      detailTargeting: t.sops_detail_targeting,
      detailBody: t.sops_detail_body,
      detailActions: t.sops_detail_actions,
      noSelectionTitle: t.sops_no_selection_title,
      noSelectionDescription: t.sops_no_selection_description,
      targetingModelTitle: t.sops_targeting_model_title,
      targetingModelDescription: t.sops_targeting_model_description,
      scopeTitle: t.sops_scope_title,
      scopeDescription: t.sops_scope_description,
      formCreateTitle: t.sops_form_create_title,
      formEditTitle: t.sops_form_edit_title,
      formTitle: t.sops_form_title,
      formCategory: t.sops_form_category,
      formSummary: t.sops_form_summary,
      formBody: t.sops_form_body,
      formTargetRoles: t.sops_form_target_roles,
      formDirectUsers: t.sops_form_direct_users,
      formRequiresAck: t.sops_form_requires_ack,
      formCancel: t.common_cancel,
      formCreate: t.common_create,
      formSave: t.common_save,
      reviewTitle: t.sops_review_title,
      reviewDescription: t.sops_review_description,
      reviewDecision: t.sops_review_decision,
      reviewNote: t.sops_review_note,
      reviewApprove: t.sops_review_approve,
      reviewReject: t.sops_review_reject,
      reviewSave: t.sops_review_save,
      actionOpenReview: t.sops_action_open_review,
      actionEdit: t.common_edit,
      actionRequestAck: t.sops_action_request_ack,
      actionAcknowledge: t.sops_action_acknowledge,
      statusNotSet: t.common_not_set,
      columns: {
        title: t.sops_column_title,
        summary: t.sops_column_summary,
        status: t.sops_column_status,
        category: t.sops_column_category,
        revision: t.sops_column_revision,
        updated: t.sops_column_updated,
        author: t.sops_column_author,
        ack: t.sops_column_ack,
        approval: t.sops_column_approval,
      },
      directUsers: t.sops_direct_users,
      pendingAck: t.sops_pending_ack,
      acknowledged: t.sops_acknowledged,
      myStatus: t.sops_my_status,
    }),
    [t],
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
  const queueCopy = useMemo(() => reviewQueueCopy(user?.role, t), [t, user?.role]);

  const roleLabel = useCallback(
    (role: string) => formatEnumLabelFromKeys(role, SOP_ROLE_LABEL_KEYS, t),
    [t],
  );
  const statusLabel = useCallback(
    (status: string) =>
      formatEnumLabelFromKeys(status, SOP_STATUS_LABEL_KEYS, t),
    [t],
  );
  const categoryLabel = useCallback(
    (category: string) =>
      formatEnumLabelFromKeys(category, SOP_CATEGORY_LABEL_KEYS, t),
    [t],
  );
  const ackLabel = useCallback(
    (ackStatus?: string | null) =>
      formatEnumLabelFromKeys(ackStatus, SOP_ACK_LABEL_KEYS, t),
    [t],
  );
  const approvalRoleLabel = useCallback(
    (value?: string | null) =>
      formatEnumLabelFromKeys(value, SOP_APPROVAL_ROLE_LABEL_KEYS, t),
    [t],
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
        render: (row) => formatDate(row.updated_at, lang, t),
      },
      {
        id: "author",
        label: text.columns.author,
        accessor: (row) => row.created_by_name ?? row.created_by_role,
        width: 190,
        render: (row) => row.created_by_name || roleLabel(row.created_by_role),
      },
    ],
    [approvalRoleLabel, categoryLabel, lang, roleLabel, statusLabel, t, text],
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
        render: (row) => formatDate(row.updated_at, lang, t),
      },
      {
        id: "author",
        label: text.columns.author,
        accessor: (row) => row.created_by_name ?? row.created_by_role,
        width: 190,
        render: (row) => row.created_by_name || roleLabel(row.created_by_role),
      },
    ],
    [ackLabel, categoryLabel, lang, roleLabel, statusLabel, t, text],
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

        <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
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
                      value={formatDate(selectedItem.updated_at, lang, t)}
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
              description={formDescription(user?.role, t)}
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
                    <DetailField
                      label={text.columns.updated}
                      value={formatDate(reviewItem.updated_at, lang, t)}
                    />
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
