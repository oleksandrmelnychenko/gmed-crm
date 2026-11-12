import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  type FormEvent,
  type SetStateAction,
} from "react";
import {
  BellPlus,
  Radio,
  BellRing,
  CheckCheck,
  Info,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Search,
  Send,
  SlidersHorizontal,
  Webhook,
  X,
} from "lucide-react";

import { AdminGuideButton } from "@/components/admin-guide";
import {
  AdminSectionTitle,
  SheetActionsFooter,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import {
  DataTablePager,
  useDataTablePagination,
} from "@/components/data-table/data-table-pager";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Dialog } from "@/components/ui/dialog";
import { AdminDialogScaffold, AdminFormSection } from "@/components/admin-dialog-scaffold";
import { StatusChip } from "@/components/ui/status-chip";
import { formatEnumLabelFromKeys, formatUiText, useLang, type TranslationKey } from "@/lib/i18n";
import {
  codedAdminErrorText,
  compactNotificationConfig,
  matchesNotificationSearch,
  prettyNotificationConfig,
} from "@/pages/admin-pages.helpers";
import {
  Banner,
  EmptyCell,
  Field,
  PageHeader,
  SuccessBanner,
  TabLoader,
  textareaClass,
} from "@/components/ui-shell";
import { Input } from "@/components/ui/input";
import { clearApiCache } from "@/lib/api";
import { useRealtimeSubscription } from "@/lib/realtime";
import {
  createAdminNotificationChannel,
  deleteAdminNotificationChannel,
  fetchAdminNotificationChannels,
  testAdminNotificationChannel,
  updateAdminNotificationChannel,
} from "@/pages/admin/data/admin-api";

interface Channel {
  id: string;
  channel_type: string;
  name: string;
  config: Record<string, unknown>;
  is_active: boolean;
}

type FlashState =
  | { tone: "success"; text: string }
  | { tone: "warning"; text: string }
  | { tone: "error"; text: string }
  | null;

const ADMIN_NOTIFICATION_CHANNEL_REALTIME_EVENTS = [
  "notification_channel.created",
  "notification_channel.updated",
  "notification_channel.deleted",
] as const;

const NOTIFICATION_CHANNEL_TYPE_LABEL_KEYS = {
  smtp: "notif_smtp",
  webhook: "notif_webhook",
} as const satisfies Partial<Record<string, TranslationKey>>;

function channelTypeTone(channelType: string) {
  if (channelType === "smtp") return "info" as const;
  if (channelType === "webhook") return "neutral" as const;
  return "neutral" as const;
}

type AdminNotificationsState = {
  channels: Channel[];
  loading: boolean;
  error: string;
  flash: FlashState;
  actionBusyId: string;
  search: string;
  typeFilter: string;
  statusFilter: string;
  detailOpen: boolean;
  selectedChannelId: string;
  createOpen: boolean;
  /** The channel the form edits; empty for a new channel. */
  editingId: string;
  submitting: boolean;
  formError: string;
  formName: string;
  formType: string;
  formConfig: string;
};

type AdminNotificationsPatch =
  | Partial<AdminNotificationsState>
  | ((current: AdminNotificationsState) => Partial<AdminNotificationsState>);

function adminNotificationsReducer(
  current: AdminNotificationsState,
  patch: AdminNotificationsPatch,
): AdminNotificationsState {
  return {
    ...current,
    ...(typeof patch === "function" ? patch(current) : patch),
  };
}

function resolveAdminNotificationsStateAction<T>(
  action: SetStateAction<T>,
  current: T,
): T {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action;
}

function createAdminNotificationsFieldPatch<
  K extends keyof AdminNotificationsState,
>(
  field: K,
  nextValue: SetStateAction<AdminNotificationsState[K]>,
): AdminNotificationsPatch {
  return (current) => ({
    [field]: resolveAdminNotificationsStateAction(nextValue, current[field]),
  } as Partial<AdminNotificationsState>);
}

function useAdminNotificationsPageContent() {
  const { t } = useLang();
  const [notificationsState, dispatchNotificationsState] = useReducer(
    adminNotificationsReducer,
    undefined,
    (): AdminNotificationsState => ({
      channels: [],
      loading: true,
      error: "",
      flash: null,
      actionBusyId: "",
      search: "",
      typeFilter: "",
      statusFilter: "",
      detailOpen: false,
      selectedChannelId: "",
      createOpen: false,
      editingId: "",
      submitting: false,
      formError: "",
      formName: "",
      formType: "smtp",
      formConfig: "",
    }),
  );
  const {
    actionBusyId,
    channels,
    createOpen,
    detailOpen,
    editingId,
    error,
    flash,
    formConfig,
    formError,
    formName,
    formType,
    loading,
    search,
    selectedChannelId,
    statusFilter,
    submitting,
    typeFilter,
  } = notificationsState;
  const setNotificationsField = <K extends keyof AdminNotificationsState>(
    field: K,
    nextValue: SetStateAction<AdminNotificationsState[K]>,
  ) =>
    dispatchNotificationsState(
      createAdminNotificationsFieldPatch(field, nextValue),
    );
  const setChannels = (nextValue: SetStateAction<Channel[]>) =>
    setNotificationsField("channels", nextValue);
  const setLoading = (nextValue: SetStateAction<boolean>) =>
    setNotificationsField("loading", nextValue);
  const setError = (nextValue: SetStateAction<string>) =>
    setNotificationsField("error", nextValue);
  const setFlash = (nextValue: SetStateAction<FlashState>) =>
    setNotificationsField("flash", nextValue);
  const setActionBusyId = (nextValue: SetStateAction<string>) =>
    setNotificationsField("actionBusyId", nextValue);
  const setSearch = (nextValue: SetStateAction<string>) =>
    setNotificationsField("search", nextValue);
  const deferredSearch = useDeferredValue(search);
  const setTypeFilter = (nextValue: SetStateAction<string>) =>
    setNotificationsField("typeFilter", nextValue);
  const setStatusFilter = (nextValue: SetStateAction<string>) =>
    setNotificationsField("statusFilter", nextValue);
  const setDetailOpen = (nextValue: SetStateAction<boolean>) =>
    setNotificationsField("detailOpen", nextValue);
  const setSelectedChannelId = (nextValue: SetStateAction<string>) =>
    setNotificationsField("selectedChannelId", nextValue);
  const setCreateOpen = (nextValue: SetStateAction<boolean>) =>
    setNotificationsField("createOpen", nextValue);
  const setEditingId = (nextValue: SetStateAction<string>) =>
    setNotificationsField("editingId", nextValue);
  const setSubmitting = (nextValue: SetStateAction<boolean>) =>
    setNotificationsField("submitting", nextValue);
  const setFormError = (nextValue: SetStateAction<string>) =>
    setNotificationsField("formError", nextValue);
  const setFormName = (nextValue: SetStateAction<string>) =>
    setNotificationsField("formName", nextValue);
  const setFormType = (nextValue: SetStateAction<string>) =>
    setNotificationsField("formType", nextValue);
  const setFormConfig = (nextValue: SetStateAction<string>) =>
    setNotificationsField("formConfig", nextValue);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchAdminNotificationChannels<Channel>();
      startTransition(() => setChannels(data));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.common_error);
    } finally {
      setLoading(false);
    }
  }, [t.common_error]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeSubscription(ADMIN_NOTIFICATION_CHANNEL_REALTIME_EVENTS, () => {
    clearApiCache("/admin/notifications");
    void load();
  });

  const filteredChannels = useMemo(() => {
    return channels.filter((channel) => {
      if (typeFilter && channel.channel_type !== typeFilter) return false;
      if (statusFilter === "active" && !channel.is_active) return false;
      if (statusFilter === "inactive" && channel.is_active) return false;
      return matchesNotificationSearch(channel, deferredSearch);
    });
  }, [channels, deferredSearch, statusFilter, typeFilter]);
  const channelsPagination = useDataTablePagination(
    filteredChannels,
    `${deferredSearch}\u0000${typeFilter}\u0000${statusFilter}`,
  );

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId) ?? null,
    [channels, selectedChannelId],
  );

  const metrics = useMemo(() => {
    return channels.reduce(
      (acc, channel) => {
        acc.total += 1;
        if (channel.is_active) acc.active += 1;
        if (channel.channel_type === "smtp") acc.smtp += 1;
        if (channel.channel_type === "webhook") acc.webhook += 1;
        return acc;
      },
      { total: 0, active: 0, smtp: 0, webhook: 0 },
    );
  }, [channels]);

  const anyFilterActive =
    search.trim() !== "" || typeFilter !== "" || statusFilter !== "";

  function resetCreateForm() {
    setFormName("");
    setFormType("smtp");
    setFormConfig("");
    setFormError("");
    setEditingId("");
    setSubmitting(false);
  }

  const channelErrorMessages = useMemo(
    () => ({
      notification_channel_type_invalid: t.notif_error_type_invalid,
      notification_channel_name_invalid: t.notif_error_name_invalid,
      notification_channel_config_invalid: t.notif_error_config_invalid,
      notification_channel_not_found: t.notif_error_not_found,
    }),
    [t],
  );

  /** Opens the form with the channel; its secrets stay masked (E F3). */
  function openEdit(channel: Channel) {
    setFormName(channel.name);
    setFormType(channel.channel_type);
    setFormConfig(prettyNotificationConfig(channel.config));
    setFormError("");
    setEditingId(channel.id);
    setDetailOpen(false);
    setCreateOpen(true);
  }

  function handleCreateOpenChange(open: boolean) {
    setCreateOpen(open);
    if (!open) resetCreateForm();
  }

  function handleDetailOpenChange(open: boolean) {
    setDetailOpen(open);
    if (!open) setSelectedChannelId("");
  }

  const channelTypeLabel = useCallback(
    (value: string | null | undefined) =>
      formatEnumLabelFromKeys(value, NOTIFICATION_CHANNEL_TYPE_LABEL_KEYS, t),
    [t],
  );

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFlash(null);

    let config: Record<string, unknown> = {};
    const rawConfig = formConfig.trim();
    if (rawConfig) {
      try {
        const parsed = JSON.parse(rawConfig);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setFormError(t.notif_config_invalid);
          return;
        }
        config = parsed as Record<string, unknown>;
      } catch {
        setFormError(t.notif_config_invalid);
        return;
      }
    }

    setSubmitting(true);
    try {
      const editedChannel = editingId
        ? channels.find((channel) => channel.id === editingId)
        : undefined;
      const payload = {
        channel_type: formType,
        name: formName.trim(),
        config,
        is_active: editedChannel?.is_active ?? true,
      };
      if (editingId) {
        await updateAdminNotificationChannel(editingId, payload);
      } else {
        await createAdminNotificationChannel(payload);
      }
      handleCreateOpenChange(false);
      setFlash({ tone: "success", text: t.notif_saved });
      await load();
    } catch (submitError) {
      setFormError(codedAdminErrorText(submitError, channelErrorMessages, t.common_error));
    } finally {
      setSubmitting(false);
    }
  }

  const handleDelete = useCallback(async (id: string) => {
    const channel = channels.find((item) => item.id === id);
    // Deleting cannot be undone: ask first (screens QA E F3).
    if (!window.confirm(formatUiText(t.notif_delete_confirm, { name: channel?.name ?? "" }))) return;
    setFlash(null);
    setActionBusyId(id);
    try {
      await deleteAdminNotificationChannel(id);
      if (selectedChannelId === id) {
        setDetailOpen(false);
        setSelectedChannelId("");
      }
      setFlash({ tone: "success", text: t.notif_deleted });
      await load();
    } catch (deleteError) {
      setFlash({
        tone: "error",
        text: codedAdminErrorText(deleteError, channelErrorMessages, t.common_error),
      });
    } finally {
      setActionBusyId("");
    }
  }, [channelErrorMessages, channels, load, selectedChannelId, t.common_error, t.notif_delete_confirm, t.notif_deleted]);

  const handleTest = useCallback(async (id: string) => {
    setFlash(null);
    setActionBusyId(id);
    try {
      await testAdminNotificationChannel(id);
      // Nothing is sent: GMED does not deliver through these channels yet,
      // so the page says so instead of "OK" (screens QA E F3).
      const channel = channels.find((item) => item.id === id);
      setFlash({
        tone: "warning",
        text: formatUiText(t.notif_test_dry_run, { name: channel?.name ?? "" }),
      });
    } catch (testError) {
      setFlash({
        tone: "error",
        text: codedAdminErrorText(testError, channelErrorMessages, t.common_error),
      });
    } finally {
      setActionBusyId("");
    }
  }, [channelErrorMessages, channels, t.common_error, t.notif_test_dry_run]);

  const columns = useMemo<ColumnDef<Channel>[]>(() => [
    {
      id: "name",
      label: t.notif_name,
      accessor: (channel) => channel.name,
      sortable: true,
      width: 260,
      render: (channel) => (
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-foreground">
            {channel.name}
          </div>
        </div>
      ),
    },
    {
      id: "type",
      label: t.notif_type,
      accessor: (channel) => channel.channel_type,
      sortable: true,
      width: 140,
      render: (channel) => (
        <StatusChip tone={channelTypeTone(channel.channel_type)}>
          {channelTypeLabel(channel.channel_type)}
        </StatusChip>
      ),
    },
    {
      id: "config",
      label: t.notif_config,
      accessor: (channel) => compactNotificationConfig(channel.config),
      sortable: true,
      width: 360,
      render: (channel) => {
        const full = prettyNotificationConfig(channel.config);
        return (
          <span className="truncate font-mono text-xs text-foreground" title={full}>
            {compactNotificationConfig(channel.config) || "-"}
          </span>
        );
      },
    },
    {
      id: "status",
      label: t.users_status,
      accessor: (channel) => channel.is_active,
      sortable: true,
      width: 120,
      render: (channel) => (
        <StatusChip tone={channel.is_active ? "success" : "warning"}>
          {channel.is_active ? t.common_active : t.common_inactive}
        </StatusChip>
      ),
    },
    {
      id: "actions",
      label: t.users_actions,
      accessor: (channel) => channel.id,
      width: 180,
      render: (channel) => {
        const busy = actionBusyId === channel.id;
        return (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 rounded-lg"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                void handleTest(channel.id);
              }}
            >
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {t.notif_test}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-8 rounded-lg"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                void handleDelete(channel.id);
              }}
            >
              {t.common_delete}
            </Button>
          </div>
        );
      },
    },
  ], [
    actionBusyId,
    handleDelete,
    handleTest,
    t.common_active,
    t.common_delete,
    t.common_inactive,
    t.notif_config,
    t.notif_name,
    t.notif_test,
    t.notif_type,
    t.users_actions,
    t.users_status,
    channelTypeLabel,
  ]);

  return (
    <>
      <div className="min-w-0 space-y-3">
        <PageHeader
          title={t.notif_title}
          description={t.notif_subtitle}
          actions={(
            <>
              <AdminGuideButton title={t.notif_title} description={t.notif_subtitle} />
              <Button
                type="button"
                variant="outline"
                className="h-8 rounded-lg gap-1.5 bg-card px-3 text-xs"
                onClick={() => void load()}
              >
                <RefreshCcw className="size-3.5" />
                {t.common_refresh}
              </Button>
              <Button
                type="button"
                className="h-8 rounded-lg gap-1.5 px-3 text-xs"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-3.5" />
                {t.notif_new}
              </Button>
            </>
          )}
        />

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="notification-metrics">
          {[
            { icon: BellRing, label: t.notif_title, value: metrics.total },
            { icon: CheckCheck, label: t.common_active, value: metrics.active },
            { icon: Send, label: t.notif_smtp, value: metrics.smtp },
            { icon: Webhook, label: t.notif_webhook, value: metrics.webhook },
          ].map(({ icon: Icon, label, value }) => (
            <article key={label} className="min-w-0 rounded-xl border border-border/70 bg-card px-3 py-2.5 shadow-xs">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 break-words font-mono text-[11px] text-muted-foreground">{label}</p>
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              </div>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{value}</p>
            </article>
          ))}
        </div>

        <Banner tone="warning">{t.notif_not_used_notice}</Banner>

        {flash ? (
          flash.tone === "error" || flash.tone === "warning" ? (
            <Banner tone={flash.tone}>{flash.text}</Banner>
          ) : (
            <SuccessBanner>{flash.text}</SuccessBanner>
          )
        ) : null}

        {error ? <Banner tone="error">{error}</Banner> : null}

        <section className="min-w-0 space-y-3">
          <div className="space-y-3 rounded-xl border border-border/70 bg-card p-3 shadow-xs">
            <div className="flex items-center justify-between gap-3">
              <AdminSectionTitle icon={BellRing}>{t.common_registry}</AdminSectionTitle>
              <StatusChip>{filteredChannels.length}</StatusChip>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_minmax(180px,240px)_minmax(180px,240px)_auto] xl:items-end">
              <Field label={t.common_search} htmlFor="notification-search">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input id="notification-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.common_search} className="h-9 w-full rounded-lg bg-field pl-8 text-[13px]" />
                </div>
              </Field>
              <Field label={t.notif_type} htmlFor="notification-type-filter">
                <NativeComboboxSelect id="notification-type-filter" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value ?? "")} className="h-9 w-full rounded-lg bg-field text-[13px]">
                  <option value="">{t.providers_all}</option>
                  <option value="smtp">{t.notif_smtp}</option>
                  <option value="webhook">{t.notif_webhook}</option>
                </NativeComboboxSelect>
              </Field>
              <Field label={t.users_status} htmlFor="notification-status-filter">
                <NativeComboboxSelect id="notification-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value ?? "")} className="h-9 w-full rounded-lg bg-field text-[13px]">
                  <option value="">{t.providers_all}</option>
                  <option value="active">{t.common_active}</option>
                  <option value="inactive">{t.common_inactive}</option>
                </NativeComboboxSelect>
              </Field>
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 justify-self-start rounded-lg text-xs" disabled={!anyFilterActive} onClick={() => { setSearch(""); setTypeFilter(""); setStatusFilter(""); }}>
                <X className="size-3.5" />{t.common_reset}
              </Button>
            </div>
          </div>
          {loading ? (
            <TabLoader />
          ) : (
            <DataTableSurface
              rows={channelsPagination.pagedRows}
              columns={columns}
              defaultDensity="compact"
              dictionary={t as unknown as Record<string, string>}
              rowId={(channel) => channel.id}
              activeRowId={selectedChannelId}
              onRowClick={(channel) => {
                setSelectedChannelId(channel.id);
                setDetailOpen(true);
              }}
              emptyState={<EmptyCell>{t.notif_no_channels}</EmptyCell>}
              tableClassName="min-h-[360px]"
              toolbarAfter={(
                <DataTablePager
                  pageIndex={channelsPagination.pageIndex}
                  pageSize={channelsPagination.pageSize}
                  totalPages={channelsPagination.totalPages}
                  totalRows={channelsPagination.totalRows}
                  previousLabel={t.pagination_previous}
                  nextLabel={t.pagination_next}
                  onPageChange={channelsPagination.onPageChange}
                />
              )}
            />
          )}
        </section>
      </div>

      <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
            <AdminDialogScaffold
              icon={BellPlus}
              onSubmit={handleCreate}
              title={editingId ? t.notif_edit : t.notif_new}
              description={t.notif_subtitle}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={editingId ? t.common_save : t.common_create}
                  submitting={submitting}
                  onCancel={() => handleCreateOpenChange(false)}
                />
              )}
            >
              {formError ? <Banner tone="error">{formError}</Banner> : null}

              <AdminFormSection icon={Info} title={t.activity_details}>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={`${t.notif_name} *`} htmlFor="channel-name">
                    <Input
                      id="channel-name"
                      required
                      value={formName}
                      onChange={(event) => setFormName(event.target.value)}
                      className="h-9 rounded-lg bg-field"
                    />
                  </Field>
                  <Field label={t.notif_type} htmlFor="channel-type">
                    <NativeComboboxSelect value={formType}
                      onChange={(event) => setFormType(event.target.value ?? "smtp")}
                        id="channel-type"
                        className="!h-9 w-full rounded-lg bg-field"
                      >
                        <option value="smtp">{t.notif_smtp}</option>
                        <option value="webhook">{t.notif_webhook}</option>
                      </NativeComboboxSelect>
                  </Field>
                </div>

              </AdminFormSection>
              <AdminFormSection icon={SlidersHorizontal} title={t.notif_config}>
                <Field label={t.notif_config} htmlFor="channel-config">
                  <textarea
                    id="channel-config"
                    value={formConfig}
                    onChange={(event) => setFormConfig(event.target.value)}
                    placeholder={t.notif_config_placeholder}
                    rows={10}
                    className={`${textareaClass} font-mono text-xs`}
                  />
                </Field>
                <p className="text-[11.5px] text-muted-foreground">{t.notif_secret_hint}</p>
              </AdminFormSection>
            </AdminDialogScaffold>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={handleDetailOpenChange}>
          <AdminDialogScaffold
            icon={Radio}
            title={selectedChannel?.name ?? t.notif_title}
            description={t.notif_subtitle}
            footer={(
              <SheetActionsFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg"
                  onClick={() => handleDetailOpenChange(false)}
                >
                  {t.common_cancel}
                </Button>
                {selectedChannel ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-lg"
                      disabled={actionBusyId === selectedChannel.id}
                      onClick={() => void handleTest(selectedChannel.id)}
                    >
                      {actionBusyId === selectedChannel.id ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : null}
                      {t.notif_test}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-lg"
                      disabled={actionBusyId === selectedChannel.id}
                      onClick={() => openEdit(selectedChannel)}
                    >
                      {t.common_edit}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      className="h-9 rounded-lg"
                      disabled={actionBusyId === selectedChannel.id}
                      onClick={() => void handleDelete(selectedChannel.id)}
                    >
                      {t.common_delete}
                    </Button>
                  </>
                ) : null}
              </SheetActionsFooter>
            )}
          >
            {selectedChannel ? (
              <>
                <AdminFormSection icon={Info} title={t.activity_details}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusChip
                      tone={channelTypeTone(selectedChannel.channel_type)}
                    >
                      {channelTypeLabel(selectedChannel.channel_type)}
                    </StatusChip>
                    <StatusChip tone={selectedChannel.is_active ? "success" : "warning"}>
                      {selectedChannel.is_active ? t.common_active : t.common_inactive}
                    </StatusChip>
                  </div>

                  <div className="grid gap-2.5 md:grid-cols-2">
                    <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
                      <p className="text-[11.5px] text-muted-foreground">{t.notif_name}</p>
                      <p className="mt-1 break-words text-sm font-medium text-foreground">
                        {selectedChannel.name}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
                      <p className="text-[11.5px] text-muted-foreground">{t.notif_type}</p>
                      <p className="mt-1 break-words text-sm font-medium text-foreground">
                        {channelTypeLabel(selectedChannel.channel_type)}
                      </p>
                    </div>
                  </div>
                </AdminFormSection>

                <AdminFormSection icon={SlidersHorizontal} title={t.notif_config}>
                  <pre className="whitespace-pre-wrap break-all rounded-lg border border-border/50 bg-muted/50 p-3 font-mono text-xs leading-6 text-muted-foreground">
                    {prettyNotificationConfig(selectedChannel.config)}
                  </pre>
                </AdminFormSection>
              </>
            ) : (
              <EmptyCell>{t.notif_no_channels}</EmptyCell>
            )}
          </AdminDialogScaffold>
      </Dialog>
    </>
  );
}

export function AdminNotificationsPage(...args: Parameters<typeof useAdminNotificationsPageContent>) {
  return useAdminNotificationsPageContent(...args);
}
