import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Globe,
  LoaderCircle,
  Plus,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Waypoints,
} from "lucide-react";

import { AdminGuideButton } from "@/components/admin-guide";
import {
  AdminInlineMetric,
  AdminSheetScaffold,
  SheetActionsFooter,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { formatEnumLabelFromKeys, useLang, type TranslationKey } from "@/lib/i18n";
import {
  formatAdminDateTime,
  normalizeAdminSettingValue,
  shortAdminUserAgent,
} from "@/pages/admin-pages.helpers";
import {
  Banner,
  EmptyCell,
  Field,
  PageHeader,
  Section,
  StatCard,
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
  createIpWhitelistEntry,
  deleteIpWhitelistEntry,
  fetchAdminSecurityWorkspace,
  saveAdminMaintenance,
} from "@/pages/admin/data/admin-api";

interface IpEntry {
  id: string;
  cidr: string;
  description: string | null;
  is_active: boolean;
}

interface GeoLogin {
  user_name: string;
  user_email: string;
  ip_address: string | null;
  user_agent: string | null;
  geo_data: unknown;
  created_at: string;
  is_revoked: boolean;
}

interface AuditAnalyticsSummary {
  failed_logins_24h: number;
  blocked_logins_24h: number;
  token_theft_30d: number;
  executive_sensitive_access_7d: number;
  off_hours_sensitive_access_7d: number;
}

interface AuditAnalyticsEvent {
  id: number;
  user_name: string | null;
  user_role: string | null;
  action: string;
  entity_type: string;
  reason: string;
  route: string | null;
  status: number | null;
  ip_hash: string | null;
  created_at: string;
}

interface AuditAnalyticsReader {
  user_id: string;
  user_name: string;
  user_role: string;
  event_count: number;
  distinct_entities: number;
}

interface AuditAnalyticsPayload {
  summary: AuditAnalyticsSummary;
  recent_suspicious_events: AuditAnalyticsEvent[];
  top_sensitive_readers: AuditAnalyticsReader[];
}

type FlashState =
  | { tone: "success"; text: string }
  | { tone: "error"; text: string }
  | null;

const ADMIN_SECURITY_REALTIME_EVENTS = [
  "security.ip_whitelist_added",
  "security.ip_whitelist_deleted",
  "system_setting.updated",
  "system_setting.maintenance_toggled",
  "session.revoked",
  "session.revoked_all",
  "pending_login.approved",
  "pending_login.rejected",
  "user.unlocked",
  "user.force_password_reset",
  "user.mfa_toggled",
] as const;

const ROLE_LABEL_KEYS = {
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

const SECURITY_ACTION_LABEL_KEYS = {
  login: "activity_action_login",
  create_lead: "activity_action_create_lead",
  create_patient: "activity_action_create_patient",
  convert_lead: "activity_action_convert_lead",
  qualify_lead: "activity_action_qualify_lead",
  update_setting: "activity_action_update_setting",
  revoke_all_sessions: "activity_action_revoke_all_sessions",
  admin_force_logout_user: "activity_action_admin_force_logout_user",
  revoke_all_users_sessions: "activity_action_revoke_all_users_sessions",
  token_theft_detected: "activity_action_token_theft_detected",
} as const satisfies Partial<Record<string, TranslationKey>>;

const SECURITY_ENTITY_LABEL_KEYS = {
  access_policy: "activity_entity_access_policy",
  appointment: "activity_entity_appointment",
  case: "activity_entity_case",
  document: "activity_entity_document",
  invoice: "activity_entity_invoice",
  order: "activity_entity_order",
  patient: "activity_entity_patient",
  privacy_request: "activity_entity_privacy_request",
  security: "activity_entity_security",
  session: "activity_entity_session",
  system_setting: "activity_entity_system_setting",
  user: "activity_entity_user",
} as const satisfies Partial<Record<string, TranslationKey>>;

export function AdminSecurityPage() {
  const { t, lang } = useLang();
  const [ips, setIps] = useState<IpEntry[]>([]);
  const [geo, setGeo] = useState<GeoLogin[]>([]);
  const [auditAnalytics, setAuditAnalytics] =
    useState<AuditAnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<FlashState>(null);
  const [deleteBusyId, setDeleteBusyId] = useState("");

  const [maintEnabled, setMaintEnabled] = useState(false);
  const [maintMsg, setMaintMsg] = useState("");
  const [maintDraftMsg, setMaintDraftMsg] = useState("");
  const [maintOpen, setMaintOpen] = useState(false);
  const [maintBusy, setMaintBusy] = useState(false);
  const [maintError, setMaintError] = useState("");

  const [ipOpen, setIpOpen] = useState(false);
  const [ipBusy, setIpBusy] = useState(false);
  const [ipError, setIpError] = useState("");
  const [newCidr, setNewCidr] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { ipList, geoList, analyticsPayload, settings } =
        await fetchAdminSecurityWorkspace<
          IpEntry,
          GeoLogin,
          AuditAnalyticsPayload
        >();

      setIps(ipList);
      setGeo(geoList);
      setAuditAnalytics(analyticsPayload);

      const maintenanceMode = settings.find((row) => row.key === "maintenance_mode");
      const maintenanceMessage = settings.find(
        (row) => row.key === "maintenance_message",
      );
      setMaintEnabled(normalizeAdminSettingValue(maintenanceMode?.value) === "true");
      setMaintMsg(normalizeAdminSettingValue(maintenanceMessage?.value));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.common_error);
    } finally {
      setLoading(false);
    }
  }, [t.common_error]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeSubscription(ADMIN_SECURITY_REALTIME_EVENTS, () => {
    clearApiCache("/admin/ip-whitelist");
    clearApiCache("/admin/login-geo");
    clearApiCache("/admin/audit-analytics");
    clearApiCache("/admin/settings");
    clearApiCache("/admin/sessions");
    clearApiCache("/admin/mfa/pending");
    void load();
  });

  const metrics = useMemo(
    () => ({
      suspicious: auditAnalytics?.recent_suspicious_events.length ?? 0,
      blocked: auditAnalytics?.summary.blocked_logins_24h ?? 0,
      theft: auditAnalytics?.summary.token_theft_30d ?? 0,
    }),
    [auditAnalytics],
  );

  function openMaintenanceSheet() {
    setMaintDraftMsg(maintMsg);
    setMaintError("");
    setMaintOpen(true);
  }

  function closeMaintenanceSheet(open: boolean) {
    setMaintOpen(open);
    if (!open) {
      setMaintDraftMsg(maintMsg);
      setMaintError("");
      setMaintBusy(false);
    }
  }

  function closeIpSheet(open: boolean) {
    setIpOpen(open);
    if (!open) {
      setNewCidr("");
      setNewDesc("");
      setIpError("");
      setIpBusy(false);
    }
  }

  async function saveMaintenance(enabled: boolean) {
    if (enabled && !maintEnabled && !window.confirm(t.security_maintenance_hint)) {
      return;
    }

    setMaintBusy(true);
    setMaintError("");
    setFlash(null);

    try {
      await saveAdminMaintenance({
        enabled,
        message: maintDraftMsg.trim() || null,
      });
      closeMaintenanceSheet(false);
      setFlash({ tone: "success", text: t.settings_updated });
      await load();
    } catch (submitError) {
      setMaintError(
        submitError instanceof Error ? submitError.message : t.common_error,
      );
    } finally {
      setMaintBusy(false);
    }
  }

  async function addIp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newCidr.trim()) return;

    setIpBusy(true);
    setIpError("");
    setFlash(null);
    try {
      await createIpWhitelistEntry({
        cidr: newCidr.trim(),
        description: newDesc.trim() || null,
      });
      closeIpSheet(false);
      setFlash({ tone: "success", text: t.settings_updated });
      await load();
    } catch (submitError) {
      setIpError(
        submitError instanceof Error ? submitError.message : t.common_error,
      );
    } finally {
      setIpBusy(false);
    }
  }

  const deleteIp = useCallback(async (id: string) => {
    setDeleteBusyId(id);
    setFlash(null);
    try {
      await deleteIpWhitelistEntry(id);
      await load();
    } catch (deleteError) {
      setFlash({
        tone: "error",
        text: deleteError instanceof Error ? deleteError.message : t.common_error,
      });
    } finally {
      setDeleteBusyId("");
    }
  }, [load, t.common_error]);

  const roleLabel = useCallback(
    (value: string | null | undefined) =>
      formatEnumLabelFromKeys(value, ROLE_LABEL_KEYS, t),
    [t],
  );
  const securityActionLabel = useCallback(
    (value: string | null | undefined) =>
      formatEnumLabelFromKeys(value, SECURITY_ACTION_LABEL_KEYS, t),
    [t],
  );
  const securityEntityLabel = useCallback(
    (value: string | null | undefined) =>
      formatEnumLabelFromKeys(value, SECURITY_ENTITY_LABEL_KEYS, t),
    [t],
  );

  const suspiciousEventColumns = useMemo<ColumnDef<AuditAnalyticsEvent>[]>(() => [
    {
      id: "created_at",
      label: t.activity_time,
      accessor: (event) => event.created_at,
      sortable: true,
      width: 170,
      render: (event) => (
        <span className="font-mono text-xs text-muted-foreground">
          {formatAdminDateTime(event.created_at, lang)}
        </span>
      ),
    },
    {
      id: "user",
      label: t.activity_user,
      accessor: (event) => `${event.user_name ?? ""} ${event.user_role ?? ""}`,
      sortable: true,
      width: 220,
      render: (event) => (
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">
            {event.user_name ?? t.security_anonymous}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {event.user_role ? roleLabel(event.user_role) : securityActionLabel(event.action)}
          </div>
        </div>
      ),
    },
    {
      id: "reason",
      label: t.security_col_reason,
      accessor: (event) => event.reason,
      sortable: true,
      width: 260,
      render: (event) => (
        <div className="min-w-0">
          <div className="truncate text-xs text-foreground">{event.reason}</div>
          <div className="text-[11px] text-muted-foreground">
            {securityEntityLabel(event.entity_type)} - {securityActionLabel(event.action)}
          </div>
        </div>
      ),
    },
    {
      id: "route",
      label: t.security_col_route,
      accessor: (event) => event.route ?? "",
      sortable: true,
      width: 220,
      render: (event) => (
        <span className="truncate text-xs text-muted-foreground">
          {event.route ?? "-"}
        </span>
      ),
    },
    {
      id: "ip",
      label: t.common_ip,
      accessor: (event) => event.ip_hash ?? "",
      sortable: true,
      width: 140,
      render: (event) => (
        <span className="font-mono text-xs text-muted-foreground">
          {event.ip_hash ?? "-"}
        </span>
      ),
    },
  ], [
    lang,
    t.activity_time,
    t.activity_user,
    t.common_ip,
    t.security_anonymous,
    t.security_col_reason,
    t.security_col_route,
    roleLabel,
    securityActionLabel,
    securityEntityLabel,
  ]);

  const readerColumns = useMemo<ColumnDef<AuditAnalyticsReader>[]>(() => [
    {
      id: "user",
      label: t.activity_user,
      accessor: (reader) => reader.user_name,
      sortable: true,
      width: 220,
      render: (reader) => (
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">{reader.user_name}</div>
          <div className="text-[11px] text-muted-foreground">
            {roleLabel(reader.user_role)}
          </div>
        </div>
      ),
    },
    {
      id: "event_count",
      label: t.security_col_events,
      accessor: (reader) => reader.event_count,
      sortable: true,
      width: 120,
      render: (reader) => <span className="tabular-nums">{reader.event_count}</span>,
    },
    {
      id: "distinct_entities",
      label: t.security_col_distinct_entities,
      accessor: (reader) => reader.distinct_entities,
      sortable: true,
      width: 160,
      render: (reader) => <span className="tabular-nums">{reader.distinct_entities}</span>,
    },
  ], [roleLabel, t.activity_user, t.security_col_distinct_entities, t.security_col_events]);

  const ipColumns = useMemo<ColumnDef<IpEntry>[]>(() => [
    {
      id: "cidr",
      label: t.security_col_cidr,
      accessor: (ip) => ip.cidr,
      sortable: true,
      width: 220,
      render: (ip) => <span className="font-mono text-xs text-foreground">{ip.cidr}</span>,
    },
    {
      id: "description",
      label: t.security_ip_desc,
      accessor: (ip) => ip.description ?? "",
      sortable: true,
      width: 280,
      render: (ip) => (
        <span className="truncate text-xs text-muted-foreground">
          {ip.description || "-"}
        </span>
      ),
    },
    {
      id: "status",
      label: t.users_status,
      accessor: (ip) => ip.is_active,
      sortable: true,
      width: 140,
      render: (ip) => (
        <StatusBadge tone={ip.is_active ? "success" : "neutral"}>
          {ip.is_active ? t.common_active : t.common_inactive}
        </StatusBadge>
      ),
    },
    {
      id: "actions",
      label: t.users_actions,
      accessor: (ip) => ip.id,
      width: 160,
      render: (ip) => {
        const busy = deleteBusyId === ip.id;
        return (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-8 rounded-lg"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              void deleteIp(ip.id);
            }}
          >
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {t.common_delete}
          </Button>
        );
      },
    },
  ], [
    deleteBusyId,
    deleteIp,
    t.common_active,
    t.common_delete,
    t.common_inactive,
    t.security_col_cidr,
    t.security_ip_desc,
    t.users_actions,
    t.users_status,
  ]);

  const geoColumns = useMemo<ColumnDef<GeoLogin>[]>(() => [
    {
      id: "created_at",
      label: t.activity_time,
      accessor: (entry) => entry.created_at,
      sortable: true,
      width: 170,
      render: (entry) => (
        <span className="font-mono text-xs text-muted-foreground">
          {formatAdminDateTime(entry.created_at, lang)}
        </span>
      ),
    },
    {
      id: "user",
      label: t.activity_user,
      accessor: (entry) => `${entry.user_name} ${entry.user_email}`,
      sortable: true,
      width: 240,
      render: (entry) => (
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">{entry.user_name}</div>
          <div className="text-[11px] text-muted-foreground">{entry.user_email}</div>
        </div>
      ),
    },
    {
      id: "ip",
      label: t.common_ip,
      accessor: (entry) => entry.ip_address ?? "",
      sortable: true,
      width: 140,
      render: (entry) => (
        <span className="font-mono text-xs text-muted-foreground">
          {entry.ip_address ?? "-"}
        </span>
      ),
    },
    {
      id: "device",
      label: t.common_device,
      accessor: (entry) => shortAdminUserAgent(entry.user_agent),
      sortable: true,
      width: 260,
      render: (entry) => (
        <span className="truncate text-xs text-muted-foreground" title={entry.user_agent ?? ""}>
          {shortAdminUserAgent(entry.user_agent)}
        </span>
      ),
    },
    {
      id: "status",
      label: t.users_status,
      accessor: (entry) => entry.is_revoked,
      sortable: true,
      width: 140,
      render: (entry) => (
        <StatusBadge tone={entry.is_revoked ? "error" : "success"}>
          {entry.is_revoked ? t.compliance_revoked : t.common_active}
        </StatusBadge>
      ),
    },
  ], [
    lang,
    t.activity_time,
    t.activity_user,
    t.common_active,
    t.common_device,
    t.common_ip,
    t.compliance_revoked,
    t.users_status,
  ]);

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={t.security_title}
          description={t.security_subtitle}
          actions={(
            <>
              <AdminGuideButton title={t.security_title} description={t.security_subtitle} />
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
                disabled={loading}
                onClick={() => void load()}
              >
                <RefreshCcw className="size-3.5" />
                {t.common_refresh}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
                onClick={openMaintenanceSheet}
              >
                <ShieldAlert className="size-3.5" />
                {t.security_maintenance}
              </Button>
              <Button
                type="button"
                className="h-9 rounded-lg gap-1.5 px-3.5"
                onClick={() => setIpOpen(true)}
              >
                <Plus className="size-3.5" />
                {t.security_ip_add}
              </Button>
            </>
          )}
        />

        {loading ? <TabLoader /> : null}
        {!loading && error ? <Banner tone="error">{error}</Banner> : null}
        {flash ? (
          flash.tone === "error" ? (
            <Banner tone="error">{flash.text}</Banner>
          ) : (
            <SuccessBanner>{flash.text}</SuccessBanner>
          )
        ) : null}

        {!loading && !error ? (
          <>
            <div className="flex flex-wrap gap-x-8 gap-y-4">
              <AdminInlineMetric
                icon={ShieldCheck}
                tone={maintEnabled ? "rose" : "emerald"}
                label={t.security_maintenance}
                value={maintEnabled ? t.common_active : t.common_inactive}
                description={maintMsg || t.security_subtitle}
              />
              <AdminInlineMetric
                icon={Waypoints}
                tone="sky"
                label={t.security_ip_whitelist}
                value={ips.length}
                description={t.common_registry}
              />
              <AdminInlineMetric
                icon={ShieldX}
                tone="amber"
                label={t.security_audit_blocked_logins}
                value={metrics.blocked}
                description={t.security_audit_recent}
              />
              <AdminInlineMetric
                icon={Globe}
                tone="slate"
                label={t.security_login_history}
                value={geo.length}
                description={`${metrics.suspicious} ${t.security_audit_recent}`}
              />
            </div>

            {maintEnabled ? (
              <Banner tone="warning" withIcon>
                <div className="space-y-1">
                  <div className="font-medium">{t.security_maintenance}</div>
                  <div>{maintMsg || t.security_maintenance_hint}</div>
                </div>
              </Banner>
            ) : null}

            <Section
              title={t.security_maintenance}
              accessory={(
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg bg-card"
                  onClick={openMaintenanceSheet}
                >
                  {t.common_edit}
                </Button>
              )}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
                  <p className="text-[11.5px] text-muted-foreground">{t.users_status}</p>
                  <div className="mt-1">
                    <StatusBadge tone={maintEnabled ? "error" : "success"}>
                      {maintEnabled ? t.common_active : t.common_inactive}
                    </StatusBadge>
                  </div>
                </div>
                <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
                  <p className="text-[11.5px] text-muted-foreground">
                    {t.security_maintenance_msg}
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    {maintMsg || "-"}
                  </p>
                </div>
              </div>
            </Section>

            <Section title={t.security_audit_analytics}>
              <p className="text-sm text-muted-foreground">{t.security_audit_hint}</p>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <StatCard
                  label={t.security_audit_failed_logins}
                  value={auditAnalytics?.summary.failed_logins_24h ?? 0}
                />
                <StatCard
                  label={t.security_audit_blocked_logins}
                  value={auditAnalytics?.summary.blocked_logins_24h ?? 0}
                />
                <StatCard
                  label={t.security_audit_token_theft}
                  value={auditAnalytics?.summary.token_theft_30d ?? 0}
                />
                <StatCard
                  label={t.security_audit_executive_access}
                  value={auditAnalytics?.summary.executive_sensitive_access_7d ?? 0}
                />
                <StatCard
                  label={t.security_audit_off_hours}
                  value={auditAnalytics?.summary.off_hours_sensitive_access_7d ?? 0}
                />
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.85fr)]">
                <AdminTableCard
                  title={t.security_audit_recent}
                  description={t.security_audit_hint}
                  count={auditAnalytics?.recent_suspicious_events.length ?? 0}
                >
                  {auditAnalytics?.recent_suspicious_events.length ? (
                    <DataTableSurface
                      rows={auditAnalytics.recent_suspicious_events}
                      columns={suspiciousEventColumns}
                      defaultDensity="comfortable"
                      defaultSort={[{ field: "created_at", dir: "desc" }]}
                      dictionary={t as unknown as Record<string, string>}
                      rowId={(event) => String(event.id)}
                      tableClassName="min-h-[320px]"
                    />
                  ) : (
                    <div className="p-4">
                      <EmptyCell>{t.security_no_suspicious}</EmptyCell>
                    </div>
                  )}
                </AdminTableCard>

                <AdminTableCard
                  title={t.security_audit_top_readers}
                  count={auditAnalytics?.top_sensitive_readers.length ?? 0}
                >
                  {auditAnalytics?.top_sensitive_readers.length ? (
                    <DataTableSurface
                      rows={auditAnalytics.top_sensitive_readers}
                      columns={readerColumns}
                      defaultDensity="comfortable"
                      defaultSort={[{ field: "event_count", dir: "desc" }]}
                      dictionary={t as unknown as Record<string, string>}
                      rowId={(reader) => reader.user_id}
                      tableClassName="min-h-[320px]"
                    />
                  ) : (
                    <div className="p-4">
                      <EmptyCell>{t.security_no_outlier_readers}</EmptyCell>
                    </div>
                  )}
                </AdminTableCard>
              </div>
            </Section>

            <Section
              title={t.security_ip_whitelist}
              accessory={(
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-lg gap-1.5 px-3"
                  onClick={() => setIpOpen(true)}
                >
                  <Plus className="size-3.5" />
                  {t.security_ip_add}
                </Button>
              )}
            >
              <AdminTableCard
                title={t.common_registry}
                description={t.security_ip_add_hint}
                count={ips.length}
              >
                {ips.length === 0 ? (
                  <div className="p-4">
                    <EmptyCell>{t.security_ip_none}</EmptyCell>
                  </div>
                ) : (
                  <DataTableSurface
                    rows={ips}
                    columns={ipColumns}
                    defaultDensity="compact"
                    dictionary={t as unknown as Record<string, string>}
                    rowId={(ip) => ip.id}
                    tableClassName="min-h-[320px]"
                  />
                )}
              </AdminTableCard>
            </Section>

            <Section title={t.security_login_history}>
              <AdminTableCard
                title={t.common_monitoring}
                description={t.security_login_history}
                count={geo.length}
              >
                {geo.length === 0 ? (
                  <div className="p-4">
                    <EmptyCell>{t.security_login_history}</EmptyCell>
                  </div>
                ) : (
                  <DataTableSurface
                    rows={geo}
                    columns={geoColumns}
                    defaultDensity="comfortable"
                    defaultSort={[{ field: "created_at", dir: "desc" }]}
                    dictionary={t as unknown as Record<string, string>}
                    rowId={(entry) => `${entry.user_email}-${entry.created_at}-${entry.ip_address ?? ""}`}
                    tableClassName="min-h-[360px]"
                  />
                )}
              </AdminTableCard>
            </Section>
          </>
        ) : null}
      </div>

      <Sheet open={maintOpen} onOpenChange={closeMaintenanceSheet}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
          <AdminSheetScaffold
            title={t.security_maintenance}
            description={t.security_subtitle}
            footer={(
              <SheetActionsFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg"
                  onClick={() => closeMaintenanceSheet(false)}
                >
                  {t.common_cancel}
                </Button>
                {maintEnabled ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg"
                    disabled={maintBusy}
                    onClick={() => void saveMaintenance(false)}
                  >
                    {maintBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {t.security_maintenance_off}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant={maintEnabled ? "default" : "destructive"}
                  className="h-9 rounded-lg"
                  disabled={maintBusy}
                  onClick={() => void saveMaintenance(true)}
                >
                  {maintBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  {maintEnabled ? t.common_save : t.security_maintenance_on}
                </Button>
              </SheetActionsFooter>
            )}
          >
            {maintError ? <Banner tone="error">{maintError}</Banner> : null}
            <Banner tone="warning" withIcon>
              {t.security_maintenance_hint}
            </Banner>

            <section className={cn("space-y-4 rounded-xl p-3.5", tokens.surface.softCard)}>
              <Field label={t.users_status}>
                <div>
                  <StatusBadge tone={maintEnabled ? "error" : "success"}>
                    {maintEnabled ? t.common_active : t.common_inactive}
                  </StatusBadge>
                </div>
              </Field>
              <Field label={t.security_maintenance_msg} htmlFor="maintenance-message">
                <textarea
                  id="maintenance-message"
                  rows={6}
                  value={maintDraftMsg}
                  onChange={(event) => setMaintDraftMsg(event.target.value)}
                  className={textareaClass}
                />
              </Field>
            </section>
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>

      <Sheet open={ipOpen} onOpenChange={closeIpSheet}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
          <form onSubmit={addIp} className="flex flex-1 min-h-0 flex-col">
            <AdminSheetScaffold
              title={t.security_ip_add}
              description={t.security_ip_add_hint}
              footer={(
                <SheetActionsFooter>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg"
                    onClick={() => closeIpSheet(false)}
                  >
                    {t.common_cancel}
                  </Button>
                  <Button
                    type="submit"
                    className="h-9 rounded-lg gap-1.5 px-3.5"
                    disabled={ipBusy}
                  >
                    {ipBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    {t.security_ip_add}
                  </Button>
                </SheetActionsFooter>
              )}
            >
              {ipError ? <Banner tone="error">{ipError}</Banner> : null}

              <section className={cn("space-y-4 rounded-xl p-3.5", tokens.surface.softCard)}>
                <Field label={t.security_ip_cidr} htmlFor="whitelist-cidr">
                  <Input
                    id="whitelist-cidr"
                    required
                    placeholder="10.0.0.0/8"
                    value={newCidr}
                    onChange={(event) => setNewCidr(event.target.value)}
                    className="h-9 rounded-lg bg-card"
                  />
                </Field>
                <Field label={t.security_ip_desc} htmlFor="whitelist-desc">
                  <Input
                    id="whitelist-desc"
                    value={newDesc}
                    onChange={(event) => setNewDesc(event.target.value)}
                    className="h-9 rounded-lg bg-card"
                  />
                </Field>
              </section>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
