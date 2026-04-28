import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Activity,
  RefreshCcw,
  Search,
  Settings2,
  ShieldAlert,
  UsersRound,
  X,
} from "lucide-react";

import { AdminGuideButton } from "@/components/admin-guide";
import {
  AdminInlineMetric,
  AdminSheetScaffold,
  SheetActionsFooter,
  AdminToolbar,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatAdminDateTime } from "@/pages/admin-pages.helpers";
import { fetchAdminActivity } from "@/pages/admin/data/admin-api";
import {
  Banner,
  EmptyCell,
  PageHeader,
  StatusBadge,
  TabLoader,
  tokens,
} from "@/components/ui-shell";

interface ActivityRow {
  user_name: string;
  user_email: string;
  action: string;
  entity_type: string | null;
  entity_id: unknown;
  context: Record<string, unknown> | null;
  created_at: string;
}

function actionTone(action: string) {
  switch (action) {
    case "login":
    case "create_lead":
    case "create_patient":
    case "convert_lead":
      return "success" as const;
    case "revoke_all_sessions":
    case "admin_force_logout_user":
    case "revoke_all_users_sessions":
    case "token_theft_detected":
      return "error" as const;
    case "qualify_lead":
      return "warning" as const;
    case "update_setting":
      return "brand" as const;
    default:
      return "neutral" as const;
  }
}

function actionLabel(action: string): string {
  return action.replaceAll("_", " ");
}

function contextSummary(context: Record<string, unknown> | null): string {
  if (!context || typeof context !== "object") return "\u2014";
  const entries = Object.entries(context).slice(0, 3);
  if (entries.length === 0) return "\u2014";
  return entries
    .map(([key, value]) => {
      const normalized =
        typeof value === "string"
          ? value
          : value === null
            ? "null"
            : JSON.stringify(value);
      return `${key}: ${normalized}`;
    })
    .join(", ");
}

function entityDisplay(entityType: string | null, entityId: unknown): string {
  const entity = entityType ?? "";
  let idStr = "";
  if (typeof entityId === "string") {
    idStr = entityId.slice(0, 8);
  } else if (entityId != null) {
    idStr = String(entityId).slice(0, 8);
  }
  if (!idStr) return entity || "\u2014";
  return entity ? `${entity} ${idStr}\u2026` : idStr;
}

function activityInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function prettyContext(context: Record<string, unknown> | null) {
  return context ? JSON.stringify(context, null, 2) : "-";
}

export function AdminActivityPage() {
  const { t, lang } = useLang();

  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filterAction, setFilterAction] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const loadData = useCallback(async (action: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchAdminActivity<ActivityRow>(action);
      startTransition(() => setActivities(data));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.common_error);
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [t.common_error]);

  useEffect(() => {
    void loadData(filterAction);
  }, [filterAction, loadData]);

  const actionOptions = useMemo(() => {
    const values = new Set(activities.map((item) => item.action));
    return Array.from(values).sort();
  }, [activities]);

  const filtered = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase();
    if (!needle) return activities;
    return activities.filter((item) =>
      [
        item.user_name,
        item.user_email,
        item.action,
        item.entity_type ?? "",
        contextSummary(item.context),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [activities, deferredSearch]);

  const metrics = useMemo(() => {
    const uniqueUsers = new Set(filtered.map((item) => item.user_email)).size;
    const loginCount = filtered.filter((item) => item.action === "login").length;
    const settingsUpdates = filtered.filter(
      (item) => item.action === "update_setting",
    ).length;
    const securityEvents = filtered.filter((item) =>
      [
        "revoke_all_sessions",
        "admin_force_logout_user",
        "revoke_all_users_sessions",
        "token_theft_detected",
      ].includes(item.action),
    ).length;

    return {
      total: filtered.length,
      uniqueUsers,
      loginCount,
      settingsUpdates,
      securityEvents,
    };
  }, [filtered]);

  const selectedActivity =
    selectedIndex !== null ? filtered[selectedIndex] ?? null : null;
  const selectedActivityId = selectedActivity
    ? `${selectedActivity.user_email}-${selectedActivity.created_at}-${selectedActivity.action}`
    : null;

  const columns = useMemo<ColumnDef<ActivityRow>[]>(() => [
    {
      id: "created_at",
      label: t.activity_time,
      accessor: (activity) => activity.created_at,
      width: 170,
      render: (activity) => (
        <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
          {formatAdminDateTime(activity.created_at, lang)}
        </span>
      ),
    },
    {
      id: "user",
      label: t.activity_user,
      accessor: (activity) => `${activity.user_name} ${activity.user_email}`,
      width: 260,
      render: (activity) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-foreground">
            {activityInitials(activity.user_name)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-foreground">
              {activity.user_name}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {activity.user_email}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "action",
      label: t.activity_action,
      accessor: (activity) => activity.action,
      width: 180,
      render: (activity) => (
        <StatusBadge tone={actionTone(activity.action)}>
          {actionLabel(activity.action)}
        </StatusBadge>
      ),
    },
    {
      id: "entity",
      label: t.activity_entity,
      accessor: (activity) => entityDisplay(activity.entity_type, activity.entity_id),
      width: 180,
      render: (activity) => (
        <span className="font-mono text-xs text-muted-foreground">
          {entityDisplay(activity.entity_type, activity.entity_id)}
        </span>
      ),
    },
    {
      id: "details",
      label: t.activity_details,
      accessor: (activity) => contextSummary(activity.context),
      width: 360,
      render: (activity) => {
        const details = contextSummary(activity.context);
        return (
          <span className="truncate text-xs text-muted-foreground" title={details}>
            {details}
          </span>
        );
      },
    },
  ], [lang, t.activity_action, t.activity_details, t.activity_entity, t.activity_time, t.activity_user]);

  const anyFilterActive = search.trim() !== "" || filterAction !== "";

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={t.activity_title}
          description={t.activity_subtitle}
          actions={(
            <>
              <AdminGuideButton
                title={t.activity_title}
                description={t.activity_subtitle}
              />
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
                disabled={loading}
                onClick={() => void loadData(filterAction)}
              >
                <RefreshCcw className="size-3.5" />
                {t.common_refresh}
              </Button>
            </>
          )}
        />

        <AdminToolbar className="rounded-none border-0 bg-transparent p-0 shadow-none">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t.search_placeholder}
              className="h-8 w-[240px] rounded-lg bg-card pl-8 text-[13px]"
            />
          </div>

          <NativeComboboxSelect
            value={filterAction}


            onChange={(event) => setFilterAction(event.target.value && event.target.value !== "__all__" ? event.target.value : "")} className="h-8 w-[240px] rounded-lg bg-card text-[13px]">
              <option value="__all__">{t.providers_all}</option>
              {actionOptions.map((value) => (
                <option key={value} value={value}>
                  {actionLabel(value)}
                </option>
              ))}
            </NativeComboboxSelect>

          {anyFilterActive ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg gap-1 text-[12.5px] text-muted-foreground"
              onClick={() => {
                setSearch("");
                setFilterAction("");
              }}
            >
              <X className="size-3.5" />
              {t.common_reset}
            </Button>
          ) : null}
        </AdminToolbar>

        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <AdminInlineMetric
            icon={Activity}
            tone="sky"
            label={t.activity_title}
            value={metrics.total}
            description={t.common_registry}
          />
          <AdminInlineMetric
            icon={UsersRound}
            tone="emerald"
            label={t.activity_user}
            value={metrics.uniqueUsers}
            description={t.common_monitoring}
          />
          <AdminInlineMetric
            icon={ShieldAlert}
            tone="amber"
            label={t.security_title}
            value={metrics.securityEvents}
            description={t.activity_action}
          />
          <AdminInlineMetric
            icon={Settings2}
            tone="slate"
            label={t.settings_title}
            value={metrics.settingsUpdates}
            description={`${metrics.loginCount} ${actionLabel("login")}`}
          />
        </div>

        {loading ? <TabLoader /> : null}
        {!loading && error ? <Banner tone="error">{error}</Banner> : null}

        {!loading && !error ? (
          <AdminTableCard
            title={t.activity_title}
            description={t.activity_subtitle}
            count={filtered.length}
          >
            {filtered.length === 0 ? (
              <div className="p-4">
                <EmptyCell>{t.activity_subtitle}</EmptyCell>
              </div>
            ) : (
              <DataTableSurface
                rows={filtered}
                columns={columns}
                defaultDensity="comfortable"
                defaultSort={[{ field: "created_at", dir: "desc" }]}
                dictionary={t as unknown as Record<string, string>}
                rowId={(activity) => `${activity.user_email}-${activity.created_at}-${activity.action}`}
                activeRowId={selectedActivityId}
                onRowClick={(activity) => {
                  setSelectedIndex(filtered.indexOf(activity));
                  setDetailOpen(true);
                }}
                tableClassName="min-h-[360px]"
              />
            )}
          </AdminTableCard>
        ) : null}
      </div>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
          <AdminSheetScaffold
            title={selectedActivity ? actionLabel(selectedActivity.action) : t.activity_details}
            description={
              selectedActivity
                ? `${selectedActivity.user_name} - ${formatAdminDateTime(selectedActivity.created_at, lang)}`
                : t.activity_subtitle
            }
            footer={(
              <SheetActionsFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg"
                  onClick={() => setDetailOpen(false)}
                >
                  {t.common_cancel}
                </Button>
              </SheetActionsFooter>
            )}
          >
            {selectedActivity ? (
              <>
                <section className={`space-y-3 rounded-xl p-3.5 ${tokens.surface.softCard}`}>
                  <h3 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                    <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
                    <span>{t.activity_details}</span>
                  </h3>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
                      <p className="text-[11.5px] text-muted-foreground">Actor</p>
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {selectedActivity.user_name || "-"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedActivity.user_email || "-"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
                      <p className="text-[11.5px] text-muted-foreground">Action</p>
                      <div className="mt-1">
                        <StatusBadge tone={actionTone(selectedActivity.action)}>
                          {actionLabel(selectedActivity.action)}
                        </StatusBadge>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
                      <p className="text-[11.5px] text-muted-foreground">Entity</p>
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {entityDisplay(selectedActivity.entity_type, selectedActivity.entity_id) || "-"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
                      <p className="text-[11.5px] text-muted-foreground">Timestamp</p>
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {formatAdminDateTime(selectedActivity.created_at, lang) || "-"}
                      </p>
                    </div>
                  </div>
                </section>

                <section className={`space-y-3 rounded-xl p-3.5 ${tokens.surface.softCard}`}>
                  <h3 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                    <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
                    <span>Payload</span>
                  </h3>
                  <pre className="overflow-x-auto rounded-lg border border-border/50 bg-card/60 p-3 text-xs leading-6 text-muted-foreground">
                    {prettyContext(selectedActivity.context)}
                  </pre>
                </section>
              </>
            ) : (
              <EmptyCell>{t.activity_subtitle}</EmptyCell>
            )}
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>
    </>
  );
}
