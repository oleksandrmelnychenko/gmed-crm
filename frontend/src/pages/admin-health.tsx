import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type SetStateAction,
} from "react";
import {
  Activity,
  Database,
  FileStack,
  RefreshCcw,
  UsersRound,
} from "lucide-react";

import { AdminGuideButton } from "@/components/admin-guide";
import {
  AdminSectionTitle,
  AdminSheetScaffold,
  AdminInlineMetric,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
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

type AdminHealthState = {
  data: HealthData | null;
  loading: boolean;
  error: string;
  refreshedAt: Date | null;
  detailPanel: HealthDetailPanel | null;
};

type AdminHealthPatch =
  | Partial<AdminHealthState>
  | ((current: AdminHealthState) => Partial<AdminHealthState>);

function adminHealthReducer(
  current: AdminHealthState,
  patch: AdminHealthPatch,
): AdminHealthState {
  return {
    ...current,
    ...(typeof patch === "function" ? patch(current) : patch),
  };
}

function resolveAdminHealthStateAction<T>(
  action: SetStateAction<T>,
  current: T,
): T {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action;
}

function createAdminHealthFieldPatch<K extends keyof AdminHealthState>(
  field: K,
  nextValue: SetStateAction<AdminHealthState[K]>,
): AdminHealthPatch {
  return (current) => ({
    [field]: resolveAdminHealthStateAction(nextValue, current[field]),
  } as Partial<AdminHealthState>);
}

type AdminHealthDetailMeta = {
  title: string;
  description: string;
};

type AdminHealthDetailSheetProps = {
  data: HealthData | null;
  detailMeta: AdminHealthDetailMeta | null;
  detailPanel: HealthDetailPanel | null;
  t: Record<string, string>;
  onDetailPanelChange: (value: HealthDetailPanel | null) => void;
};

function AdminHealthDetailSheet({
  data,
  detailMeta,
  detailPanel,
  t,
  onDetailPanelChange,
}: AdminHealthDetailSheetProps) {
  return (
    <Sheet open={Boolean(detailPanel && data)} onOpenChange={(open) => !open && onDetailPanelChange(null)}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
        {data && detailPanel && detailMeta ? (
          <AdminSheetScaffold title={detailMeta.title} description={detailMeta.description}>
            {detailPanel === "database" ? (
              <section className="space-y-4 rounded-xl border border-border/60 bg-card p-3.5">
                <AdminSectionTitle>{t.health_section_database}</AdminSectionTitle>
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
                <AdminSectionTitle>{t.health_section_access}</AdminSectionTitle>
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
                <AdminSectionTitle>{t.health_section_data}</AdminSectionTitle>
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
  );
}

type AdminHealthMetricsProps = {
  data: HealthData;
  datasetVolume: number;
  t: Record<string, string>;
};

function AdminHealthMetrics({
  data,
  datasetVolume,
  t,
}: AdminHealthMetricsProps) {
  return (
    <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
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
  );
}

type AdminHealthHeaderActionsProps = {
  loading: boolean;
  t: Record<string, string>;
  onRefresh: () => void;
};

function AdminHealthHeaderActions({
  loading,
  t,
  onRefresh,
}: AdminHealthHeaderActionsProps) {
  return (
    <>
      <AdminGuideButton title={t.health_title} description={t.health_subtitle} />
      <Button
        type="button"
        variant="outline"
        className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
        disabled={loading}
        onClick={onRefresh}
      >
        <RefreshCcw className="size-3.5" />
        {t.common_refresh}
      </Button>
    </>
  );
}

export function AdminHealthPage() {
  const { t, lang } = useLang();
  const [adminHealthState, dispatchAdminHealthState] = useReducer(
    adminHealthReducer,
    undefined,
    (): AdminHealthState => ({
      data: null,
      loading: true,
      error: "",
      refreshedAt: null,
      detailPanel: null,
    }),
  );
  const { data, loading, error, refreshedAt, detailPanel } = adminHealthState;
  const setAdminHealthField = <K extends keyof AdminHealthState>(
    field: K,
    nextValue: SetStateAction<AdminHealthState[K]>,
  ) =>
    dispatchAdminHealthState(createAdminHealthFieldPatch(field, nextValue));
  const setData = (nextValue: SetStateAction<HealthData | null>) =>
    setAdminHealthField("data", nextValue);
  const setLoading = (nextValue: SetStateAction<boolean>) =>
    setAdminHealthField("loading", nextValue);
  const setError = (nextValue: SetStateAction<string>) =>
    setAdminHealthField("error", nextValue);
  const setRefreshedAt = (nextValue: SetStateAction<Date | null>) =>
    setAdminHealthField("refreshedAt", nextValue);
  const setDetailPanel = (
    nextValue: SetStateAction<HealthDetailPanel | null>,
  ) => setAdminHealthField("detailPanel", nextValue);

  const databaseTableColumns = useMemo<ColumnDef<{ table: string; size: string }>[]>(() => [
    {
      id: "table",
      label: t.health_col_table,
      accessor: (table) => table.table,
      sortable: true,
      width: 260,
      render: (table) => (
        <span className="font-medium text-foreground">{table.table}</span>
      ),
    },
    {
      id: "size",
      label: t.health_col_size,
      accessor: (table) => table.size,
      sortable: true,
      width: 180,
      render: (table) => (
        <span className="font-mono text-xs text-muted-foreground">{table.size}</span>
      ),
    },
  ], [t.health_col_size, t.health_col_table]);

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
          <AdminHealthHeaderActions
            loading={loading}
            t={t as unknown as Record<string, string>}
            onRefresh={() => void load()}
          />
        )}
      />

      {loading ? <TabLoader /> : null}
      {!loading && error ? <Banner tone="error">{error}</Banner> : null}

      {!loading && data ? (
        <>
          <AdminHealthMetrics
            data={data}
            datasetVolume={datasetVolume}
            t={t as unknown as Record<string, string>}
          />

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
                <DataTableSurface
                  rows={data.database.tables}
                  columns={databaseTableColumns}
                  defaultDensity="compact"
                  dictionary={t as unknown as Record<string, string>}
                  rowId={(table) => table.table}
                  tableClassName="min-h-[280px]"
                />
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

      <AdminHealthDetailSheet
        data={data}
        detailMeta={detailMeta}
        detailPanel={detailPanel}
        t={t as unknown as Record<string, string>}
        onDetailPanelChange={setDetailPanel}
      />
    </div>
  );
}
