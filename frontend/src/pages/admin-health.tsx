import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Database,
  FileStack,
  RefreshCcw,
  UsersRound,
} from "lucide-react";

import {
  AdminSheetScaffold,
  AdminInlineMetric,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useLang } from "@/lib/i18n";
import { formatAdminDateTime } from "@/pages/admin-pages.helpers";
import { fetchAdminHealth } from "@/pages/admin/data/admin-api";
import {
  Banner,
  EmptyCell,
  PageHeader,
  Section,
  StatCard,
  TabLoader,
} from "@/components/ui-shell";

interface HealthData {
  database: {
    size: string;
    active_connections: number;
    tables: { table: string; size: string }[];
  };
  users: {
    total: number;
    active: number;
    locked: number;
  };
  sessions: {
    active: number;
    pending_mfa: number;
  };
  data: {
    patients: number;
    leads: number;
    orders: number;
    audit_entries: number;
  };
}

type HealthDetailPanel = "database" | "access" | "data";

export function AdminHealthPage() {
  const { t, lang } = useLang();
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [detailPanel, setDetailPanel] = useState<HealthDetailPanel | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchAdminHealth<HealthData>();
      setData(payload);
      setRefreshedAt(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.common_error);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [t.common_error]);

  useEffect(() => {
    void load();
  }, [load]);

  const operationalAttention = useMemo(() => {
    if (!data) return [];
    const attention: string[] = [];
    if (data.users.locked > 0) {
      attention.push(`${t.health_users_locked}: ${data.users.locked}`);
    }
    if (data.sessions.pending_mfa > 0) {
      attention.push(`${t.health_mfa_pending}: ${data.sessions.pending_mfa}`);
    }
    return attention;
  }, [data, t.health_mfa_pending, t.health_users_locked]);

  const datasetVolume = data
    ? data.data.patients + data.data.leads + data.data.orders
    : 0;

  const detailMeta = useMemo(() => {
    if (!data || !detailPanel) {
      return null;
    }

    if (detailPanel === "database") {
      return {
        title: t.health_section_database,
        description: `${t.health_db_size}: ${data.database.size}`,
      };
    }

    if (detailPanel === "access") {
      return {
        title: t.health_section_access,
        description: `${t.health_sessions_active}: ${data.sessions.active}`,
      };
    }

    return {
      title: t.health_section_data,
      description: `${t.health_data}: ${datasetVolume}`,
    };
  }, [
    data,
    datasetVolume,
    detailPanel,
    t.health_data,
    t.health_db_size,
    t.health_section_access,
    t.health_section_data,
    t.health_section_database,
    t.health_sessions_active,
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.health_title}
        description={
          refreshedAt
            ? `${t.health_subtitle} - ${t.common_last_updated}: ${formatAdminDateTime(refreshedAt, lang)}`
            : t.health_subtitle
        }
        actions={(
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
        )}
      />

      {loading ? <TabLoader /> : null}
      {!loading && error ? <Banner tone="error">{error}</Banner> : null}

      {!loading && data ? (
        <>
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            <AdminInlineMetric
              icon={Database}
              tone="sky"
              label={t.health_db_size}
              value={data.database.size}
              description={`${data.database.active_connections} ${t.health_connections}`}
            />
            <AdminInlineMetric
              icon={UsersRound}
              tone="emerald"
              label={t.health_users_active}
              value={data.users.active}
              description={`${data.users.total} ${t.health_users_total}`}
            />
            <AdminInlineMetric
              icon={Activity}
              tone="amber"
              label={t.health_sessions_active}
              value={data.sessions.active}
              description={`${data.sessions.pending_mfa} ${t.health_mfa_pending}`}
            />
            <AdminInlineMetric
              icon={FileStack}
              tone="slate"
              label={t.health_data}
              value={datasetVolume}
              description={`${data.data.audit_entries} ${t.health_audit_suffix}`}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-lg bg-card px-3 text-[12px]"
              onClick={() => setDetailPanel("database")}
            >
              {t.health_section_database}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-lg bg-card px-3 text-[12px]"
              onClick={() => setDetailPanel("access")}
            >
              {t.health_section_access}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-lg bg-card px-3 text-[12px]"
              onClick={() => setDetailPanel("data")}
            >
              {t.health_section_data}
            </Button>
          </div>

          {operationalAttention.length > 0 ? (
            <Banner tone="warning" withIcon>
              <div className="space-y-1">
                <div className="font-medium">{t.health_attention}</div>
                {operationalAttention.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </Banner>
          ) : null}

          <Section title={t.health_section_database}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <StatCard
                label={t.health_db_size}
                value={data.database.size}
                description={`${data.database.active_connections} ${t.health_connections}`}
              />
              <StatCard
                label={t.health_tables}
                value={data.database.tables.length}
                description={t.common_monitoring}
              />
              <StatCard
                label={t.common_last_updated}
                value={refreshedAt ? formatAdminDateTime(refreshedAt, lang) : "-"}
                description={t.health_title}
              />
            </div>

            <AdminTableCard
              title={t.health_tables}
              description={t.health_subtitle}
              count={data.database.tables.length}
            >
              {data.database.tables.length === 0 ? (
                <div className="p-4">
                  <EmptyCell>{t.health_tables}</EmptyCell>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="bg-muted/40">
                      <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-2.5 font-medium">{t.health_col_table}</th>
                        <th className="w-[180px] px-4 py-2.5 font-medium">{t.health_col_size}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.database.tables.map((table) => (
                        <tr key={table.table} className="border-t border-border">
                          <td className="px-4 py-3 font-medium text-foreground">
                            {table.table}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            {table.size}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </AdminTableCard>
          </Section>

          <Section title={t.health_section_access}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={t.health_users_total}
                value={data.users.total}
                description={t.health_title}
              />
              <StatCard
                label={t.health_users_active}
                value={data.users.active}
                description={t.users_status}
              />
              <StatCard
                label={t.health_users_locked}
                value={data.users.locked}
                description={t.security_title}
              />
              <StatCard
                label={t.health_mfa_pending}
                value={data.sessions.pending_mfa}
                description={t.settings_active_sessions}
              />
            </div>
          </Section>

          <Section title={t.health_section_data}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={t.patients_title}
                value={data.data.patients}
                description={t.health_data}
              />
              <StatCard
                label={t.nav_crm}
                value={data.data.leads}
                description={t.health_data}
              />
              <StatCard
                label={t.orders_title}
                value={data.data.orders}
                description={t.health_data}
              />
              <StatCard
                label={t.activity_title}
                value={data.data.audit_entries}
                description={t.health_audit_suffix}
              />
            </div>
          </Section>
        </>
      ) : null}

      {!loading && !error && !data ? (
        <Section title={t.health_title}>
          <EmptyCell>{t.health_subtitle}</EmptyCell>
        </Section>
      ) : null}

      <Sheet open={Boolean(detailPanel && data)} onOpenChange={(open) => !open && setDetailPanel(null)}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
          {data && detailPanel && detailMeta ? (
            <AdminSheetScaffold title={detailMeta.title} description={detailMeta.description}>
              {detailPanel === "database" ? (
                <section className="space-y-4 rounded-xl border border-border/60 bg-card p-3.5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                      <div className="text-xs text-muted-foreground">{t.health_db_size}</div>
                      <div className="mt-1 text-base font-semibold">{data.database.size}</div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                      <div className="text-xs text-muted-foreground">{t.health_connections}</div>
                      <div className="mt-1 text-base font-semibold">{data.database.active_connections}</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {data.database.tables.map((table) => (
                      <div key={table.table} className="flex items-center justify-between rounded-lg border border-border/50 bg-background px-3 py-2">
                        <span className="text-sm font-medium text-foreground">{table.table}</span>
                        <span className="font-mono text-xs text-muted-foreground">{table.size}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {detailPanel === "access" ? (
                <section className="space-y-4 rounded-xl border border-border/60 bg-card p-3.5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                      <div className="text-xs text-muted-foreground">{t.health_users_total}</div>
                      <div className="mt-1 text-base font-semibold">{data.users.total}</div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                      <div className="text-xs text-muted-foreground">{t.health_users_active}</div>
                      <div className="mt-1 text-base font-semibold">{data.users.active}</div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                      <div className="text-xs text-muted-foreground">{t.health_users_locked}</div>
                      <div className="mt-1 text-base font-semibold">{data.users.locked}</div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                      <div className="text-xs text-muted-foreground">{t.health_sessions_active}</div>
                      <div className="mt-1 text-base font-semibold">{data.sessions.active}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge className="bg-amber-500/15 text-amber-700">
                      {t.health_mfa_pending}: {data.sessions.pending_mfa}
                    </Badge>
                    <Badge className="bg-rose-500/15 text-rose-700">
                      {t.health_users_locked}: {data.users.locked}
                    </Badge>
                  </div>
                </section>
              ) : null}

              {detailPanel === "data" ? (
                <section className="space-y-4 rounded-xl border border-border/60 bg-card p-3.5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                      <div className="text-xs text-muted-foreground">{t.patients_title}</div>
                      <div className="mt-1 text-base font-semibold">{data.data.patients}</div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                      <div className="text-xs text-muted-foreground">{t.nav_crm}</div>
                      <div className="mt-1 text-base font-semibold">{data.data.leads}</div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                      <div className="text-xs text-muted-foreground">{t.orders_title}</div>
                      <div className="mt-1 text-base font-semibold">{data.data.orders}</div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                      <div className="text-xs text-muted-foreground">{t.activity_title}</div>
                      <div className="mt-1 text-base font-semibold">{data.data.audit_entries}</div>
                    </div>
                  </div>
                </section>
              ) : null}
            </AdminSheetScaffold>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
