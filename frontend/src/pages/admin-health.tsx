import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Database,
  FileStack,
  RefreshCcw,
  UsersRound,
} from "lucide-react";

import {
  AdminInlineMetric,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { formatAdminDateTime } from "@/pages/admin-pages.helpers";
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

export function AdminHealthPage() {
  const { t, lang } = useLang();
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiFetch<HealthData>("/admin/health");
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
    </div>
  );
}
