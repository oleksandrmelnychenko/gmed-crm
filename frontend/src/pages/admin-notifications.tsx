import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  BellRing,
  CheckCheck,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Webhook,
  X,
} from "lucide-react";

import { AdminGuideButton } from "@/components/admin-guide";
import {
  AdminInlineMetric,
  AdminSheetScaffold,
  SheetActionsFooter,
  SheetFormFooter,
  AdminToolbar,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { useLang } from "@/lib/i18n";
import {
  compactNotificationConfig,
  matchesNotificationSearch,
  prettyNotificationConfig,
} from "@/pages/admin-pages.helpers";
import {
  Banner,
  EmptyCell,
  Field,
  PageHeader,
  StatusBadge,
  SuccessBanner,
  TabLoader,
  textareaClass,
  tokens,
} from "@/components/ui-shell";
import { Input } from "@/components/ui/input";
import { clearApiCache } from "@/lib/api";
import { useRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import {
  createAdminNotificationChannel,
  deleteAdminNotificationChannel,
  fetchAdminNotificationChannels,
  testAdminNotificationChannel,
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
  | { tone: "error"; text: string }
  | null;

const ADMIN_NOTIFICATION_CHANNEL_REALTIME_EVENTS = [
  "notification_channel.created",
  "notification_channel.updated",
  "notification_channel.deleted",
] as const;

export function AdminNotificationsPage() {
  const { t } = useLang();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<FlashState>(null);
  const [actionBusyId, setActionBusyId] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("smtp");
  const [formConfig, setFormConfig] = useState("");

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
    setSubmitting(false);
  }

  function handleCreateOpenChange(open: boolean) {
    setCreateOpen(open);
    if (!open) resetCreateForm();
  }

  function handleDetailOpenChange(open: boolean) {
    setDetailOpen(open);
    if (!open) setSelectedChannelId("");
  }

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
      await createAdminNotificationChannel({
        channel_type: formType,
        name: formName.trim(),
        config,
        is_active: true,
      });
      handleCreateOpenChange(false);
      setFlash({ tone: "success", text: t.settings_updated });
      await load();
    } catch (submitError) {
      setFormError(
        submitError instanceof Error ? submitError.message : t.common_error,
      );
    } finally {
      setSubmitting(false);
    }
  }

  const handleDelete = useCallback(async (id: string) => {
    setFlash(null);
    setActionBusyId(id);
    try {
      await deleteAdminNotificationChannel(id);
      if (selectedChannelId === id) {
        setDetailOpen(false);
        setSelectedChannelId("");
      }
      await load();
    } catch (deleteError) {
      setFlash({
        tone: "error",
        text: deleteError instanceof Error ? deleteError.message : t.common_error,
      });
    } finally {
      setActionBusyId("");
    }
  }, [load, selectedChannelId, t.common_error]);

  const handleTest = useCallback(async (id: string) => {
    setFlash(null);
    setActionBusyId(id);
    try {
      await testAdminNotificationChannel(id);
      setFlash({ tone: "success", text: t.notif_test_ok });
    } catch (testError) {
      setFlash({
        tone: "error",
        text: testError instanceof Error ? testError.message : t.common_error,
      });
    } finally {
      setActionBusyId("");
    }
  }, [t.common_error, t.notif_test_ok]);

  const columns = useMemo<ColumnDef<Channel>[]>(() => [
    {
      id: "name",
      label: t.notif_name,
      accessor: (channel) => channel.name,
      sortable: true,
      width: 260,
      render: (channel) => (
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">
            {channel.name}
          </div>
          <div className="mt-1 truncate text-[11px] text-muted-foreground">
            {channel.id}
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
        <StatusBadge tone={channel.channel_type === "smtp" ? "info" : "brand"}>
          {channel.channel_type === "smtp" ? t.notif_smtp : t.notif_webhook}
        </StatusBadge>
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
          <span className="truncate font-mono text-xs text-muted-foreground" title={full}>
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
        <StatusBadge tone={channel.is_active ? "success" : "neutral"}>
          {channel.is_active ? t.common_active : t.common_inactive}
        </StatusBadge>
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
    t.notif_smtp,
    t.notif_test,
    t.notif_type,
    t.notif_webhook,
    t.users_actions,
    t.users_status,
  ]);

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={t.notif_title}
          description={t.notif_subtitle}
          actions={(
            <>
              <AdminGuideButton title={t.notif_title} description={t.notif_subtitle} />
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
                onClick={() => void load()}
              >
                <RefreshCcw className="size-3.5" />
                {t.common_refresh}
              </Button>
              <Button
                type="button"
                className="h-9 rounded-lg gap-1.5 px-3.5"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-3.5" />
                {t.notif_new}
              </Button>
            </>
          )}
        />

        <AdminToolbar>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t.common_search}
              className="h-8 w-[240px] rounded-lg bg-card pl-8 text-[13px]"
            />
          </div>

          <NativeComboboxSelect value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value ?? "")} className="h-8 w-[240px] rounded-lg bg-card text-[13px]">
              <option value="">{t.providers_all}</option>
              <option value="smtp">{t.notif_smtp}</option>
              <option value="webhook">{t.notif_webhook}</option>
            </NativeComboboxSelect>

          <NativeComboboxSelect
            value={statusFilter}


            onChange={(event) => setStatusFilter(event.target.value ?? "")} className="h-8 w-[240px] rounded-lg bg-card text-[13px]">
              <option value="">{t.providers_all}</option>
              <option value="active">{t.common_active}</option>
              <option value="inactive">{t.common_inactive}</option>
            </NativeComboboxSelect>

          {anyFilterActive ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg gap-1 text-[12.5px] text-muted-foreground"
              onClick={() => {
                setSearch("");
                setTypeFilter("");
                setStatusFilter("");
              }}
            >
              <X className="size-3.5" />
              {t.common_reset}
            </Button>
          ) : null}
        </AdminToolbar>

        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <AdminInlineMetric
            icon={BellRing}
            tone="sky"
            label={t.notif_title}
            value={metrics.total}
            description={t.common_registry}
          />
          <AdminInlineMetric
            icon={CheckCheck}
            tone="emerald"
            label={t.common_active}
            value={metrics.active}
            description={t.users_status}
          />
          <AdminInlineMetric
            icon={Send}
            tone="amber"
            label={t.notif_smtp}
            value={metrics.smtp}
            description={t.notif_type}
          />
          <AdminInlineMetric
            icon={Webhook}
            tone="slate"
            label={t.notif_webhook}
            value={metrics.webhook}
            description={t.notif_type}
          />
        </div>

        {flash ? (
          flash.tone === "error" ? (
            <Banner tone="error">{flash.text}</Banner>
          ) : (
            <SuccessBanner>{flash.text}</SuccessBanner>
          )
        ) : null}

        {error ? <Banner tone="error">{error}</Banner> : null}

        <AdminTableCard
          title={t.common_registry}
          description={t.notif_subtitle}
          count={filteredChannels.length}
        >
          {loading ? (
            <TabLoader />
          ) : (
            <DataTableSurface
              rows={filteredChannels}
              columns={columns}
              defaultDensity="comfortable"
              dictionary={t as unknown as Record<string, string>}
              rowId={(channel) => channel.id}
              activeRowId={selectedChannelId}
              onRowClick={(channel) => {
                setSelectedChannelId(channel.id);
                setDetailOpen(true);
              }}
              emptyState={<EmptyCell>{t.notif_no_channels}</EmptyCell>}
              tableClassName="min-h-[360px]"
            />
          )}
        </AdminTableCard>
      </div>

      <Sheet open={createOpen} onOpenChange={handleCreateOpenChange}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
          <form onSubmit={handleCreate} className="flex flex-1 min-h-0 flex-col">
            <AdminSheetScaffold
              title={t.notif_new}
              description={t.notif_subtitle}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.common_create}
                  submitting={submitting}
                  onCancel={() => handleCreateOpenChange(false)}
                />
              )}
            >
              {formError ? <Banner tone="error">{formError}</Banner> : null}

              <section className={cn("space-y-4 rounded-xl p-3.5", tokens.surface.softCard)}>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={`${t.notif_name} *`} htmlFor="channel-name">
                    <Input
                      id="channel-name"
                      required
                      value={formName}
                      onChange={(event) => setFormName(event.target.value)}
                      className="h-9 rounded-lg bg-card"
                    />
                  </Field>
                  <Field label={t.notif_type} htmlFor="channel-type">
                    <NativeComboboxSelect value={formType}
                      onChange={(event) => setFormType(event.target.value ?? "smtp")}
                        id="channel-type"
                        className="!h-9 w-full rounded-lg bg-card"
                      >
                        <option value="smtp">{t.notif_smtp}</option>
                        <option value="webhook">{t.notif_webhook}</option>
                      </NativeComboboxSelect>
                  </Field>
                </div>

                <Field label={t.notif_config} htmlFor="channel-config">
                  <textarea
                    id="channel-config"
                    value={formConfig}
                    onChange={(event) => setFormConfig(event.target.value)}
                    placeholder='{"host":"smtp.example.com","port":587,"user":"ops"}'
                    rows={10}
                    className={textareaClass}
                  />
                </Field>
              </section>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={detailOpen} onOpenChange={handleDetailOpenChange}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
          <AdminSheetScaffold
            title={selectedChannel?.name ?? t.notif_title}
            description={selectedChannel ? selectedChannel.id : t.notif_subtitle}
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
                <section className={cn("space-y-3 rounded-xl p-3.5", tokens.surface.softCard)}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge
                      tone={selectedChannel.channel_type === "smtp" ? "info" : "brand"}
                    >
                      {selectedChannel.channel_type === "smtp"
                        ? t.notif_smtp
                        : t.notif_webhook}
                    </StatusBadge>
                    <StatusBadge tone={selectedChannel.is_active ? "success" : "neutral"}>
                      {selectedChannel.is_active ? t.common_active : t.common_inactive}
                    </StatusBadge>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
                      <p className="text-[11.5px] text-muted-foreground">{t.notif_name}</p>
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {selectedChannel.name}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
                      <p className="text-[11.5px] text-muted-foreground">{t.notif_type}</p>
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {selectedChannel.channel_type === "smtp"
                          ? t.notif_smtp
                          : t.notif_webhook}
                      </p>
                    </div>
                  </div>
                </section>

                <section className={cn("space-y-3 rounded-xl p-3.5", tokens.surface.softCard)}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
                      {t.notif_config}
                    </h3>
                  </div>
                  <pre className="overflow-x-auto rounded-lg border border-border/50 bg-card/60 p-3 text-xs leading-6 text-muted-foreground">
                    {prettyNotificationConfig(selectedChannel.config)}
                  </pre>
                </section>
              </>
            ) : (
              <EmptyCell>{t.notif_no_channels}</EmptyCell>
            )}
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>
    </>
  );
}
