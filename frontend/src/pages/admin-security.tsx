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

import {
  AdminInlineMetric,
  AdminSheetScaffold,
  SheetActionsFooter,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
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
import { cn } from "@/lib/utils";

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
      const [ipList, geoList, analyticsPayload, settings] = await Promise.all([
        apiFetch<IpEntry[]>("/admin/ip-whitelist"),
        apiFetch<GeoLogin[]>("/admin/login-geo"),
        apiFetch<AuditAnalyticsPayload>("/admin/audit-analytics").catch(() => null),
        apiFetch<{ key: string; value: string }[]>("/admin/settings"),
      ]);

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
      await apiFetch("/admin/maintenance", {
        method: "POST",
        body: JSON.stringify({
          enabled,
          message: maintDraftMsg.trim() || null,
        }),
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
      await apiFetch("/admin/ip-whitelist", {
        method: "POST",
        body: JSON.stringify({
          cidr: newCidr.trim(),
          description: newDesc.trim() || null,
        }),
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

  async function deleteIp(id: string) {
    setDeleteBusyId(id);
    setFlash(null);
    try {
      await apiFetch(`/admin/ip-whitelist/${id}/delete`, { method: "POST" });
      await load();
    } catch (deleteError) {
      setFlash({
        tone: "error",
        text: deleteError instanceof Error ? deleteError.message : t.common_error,
      });
    } finally {
      setDeleteBusyId("");
    }
  }

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={t.security_title}
          description={t.security_subtitle}
          actions={(
            <>
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
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px]">
                        <thead className="bg-muted/40">
                          <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                            <th className="px-4 py-2.5 font-medium">{t.activity_time}</th>
                            <th className="px-4 py-2.5 font-medium">{t.activity_user}</th>
                            <th className="px-4 py-2.5 font-medium">{t.security_col_reason}</th>
                            <th className="px-4 py-2.5 font-medium">{t.security_col_route}</th>
                            <th className="w-[140px] px-4 py-2.5 font-medium">{t.common_ip}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {auditAnalytics.recent_suspicious_events.map((event) => (
                            <tr key={event.id} className="border-t border-border">
                              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                {formatAdminDateTime(event.created_at, lang)}
                              </td>
                              <td className="px-4 py-3">
                                <div className="text-sm font-medium text-foreground">
                                  {event.user_name ?? t.security_anonymous}
                                </div>
                                <div className="text-[11.5px] text-muted-foreground">
                                  {event.user_role ?? event.action}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="text-sm text-foreground">{event.reason}</div>
                                <div className="text-[11.5px] text-muted-foreground">
                                  {event.entity_type} - {event.action}
                                </div>
                              </td>
                              <td className="max-w-[240px] px-4 py-3 text-xs text-muted-foreground truncate">
                                {event.route ?? "-"}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                {event.ip_hash ?? "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px]">
                        <thead className="bg-muted/40">
                          <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                            <th className="px-4 py-2.5 font-medium">{t.activity_user}</th>
                            <th className="w-[120px] px-4 py-2.5 font-medium">{t.security_col_events}</th>
                            <th className="w-[160px] px-4 py-2.5 font-medium">
                              {t.security_col_distinct_entities}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {auditAnalytics.top_sensitive_readers.map((reader) => (
                            <tr key={reader.user_id} className="border-t border-border">
                              <td className="px-4 py-3">
                                <div className="text-sm font-medium text-foreground">
                                  {reader.user_name}
                                </div>
                                <div className="text-[11.5px] text-muted-foreground">
                                  {reader.user_role}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-foreground">
                                {reader.event_count}
                              </td>
                              <td className="px-4 py-3 text-foreground">
                                {reader.distinct_entities}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead className="bg-muted/40">
                        <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-4 py-2.5 font-medium">{t.security_col_cidr}</th>
                          <th className="px-4 py-2.5 font-medium">{t.security_ip_desc}</th>
                          <th className="w-[140px] px-4 py-2.5 font-medium">{t.users_status}</th>
                          <th className="w-[160px] px-4 py-2.5 font-medium">{t.users_actions}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ips.map((ip) => {
                          const busy = deleteBusyId === ip.id;
                          return (
                            <tr key={ip.id} className="border-t border-border">
                              <td className="px-4 py-3 font-mono text-xs text-foreground">
                                {ip.cidr}
                              </td>
                              <td className="px-4 py-3 text-muted-foreground">
                                {ip.description || "-"}
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge tone={ip.is_active ? "success" : "neutral"}>
                                  {ip.is_active ? t.common_active : t.common_inactive}
                                </StatusBadge>
                              </td>
                              <td className="px-4 py-3">
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  className="h-8 rounded-lg"
                                  disabled={busy}
                                  onClick={() => void deleteIp(ip.id)}
                                >
                                  {busy ? (
                                    <LoaderCircle className="size-3.5 animate-spin" />
                                  ) : null}
                                  {t.common_delete}
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
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
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead className="bg-muted/40">
                        <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-4 py-2.5 font-medium">{t.activity_time}</th>
                          <th className="px-4 py-2.5 font-medium">{t.activity_user}</th>
                          <th className="w-[140px] px-4 py-2.5 font-medium">{t.common_ip}</th>
                          <th className="px-4 py-2.5 font-medium">{t.common_device}</th>
                          <th className="w-[140px] px-4 py-2.5 font-medium">{t.users_status}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {geo.map((entry, index) => (
                          <tr
                            key={`${entry.user_email}-${entry.created_at}-${index}`}
                            className="border-t border-border"
                          >
                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                {formatAdminDateTime(entry.created_at, lang)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-sm font-medium text-foreground">
                                {entry.user_name}
                              </div>
                              <div className="text-[11.5px] text-muted-foreground">
                                {entry.user_email}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                              {entry.ip_address ?? "-"}
                            </td>
                            <td
                              className="max-w-[260px] px-4 py-3 text-xs text-muted-foreground truncate"
                              title={entry.user_agent ?? ""}
                            >
                              {shortAdminUserAgent(entry.user_agent)}
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge tone={entry.is_revoked ? "error" : "success"}>
                                {entry.is_revoked ? t.compliance_revoked : t.common_active}
                              </StatusBadge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </AdminTableCard>
            </Section>
          </>
        ) : null}
      </div>

      <Sheet open={maintOpen} onOpenChange={closeMaintenanceSheet}>
        <SheetContent side="right" className="w-full sm:max-w-[720px]">
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
        <SheetContent side="right" className="w-full sm:max-w-[720px]">
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

