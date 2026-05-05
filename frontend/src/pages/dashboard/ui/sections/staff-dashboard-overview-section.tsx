import { ArrowRight, ClipboardList, Stethoscope, UserPlus, Users as UsersIcon } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { numberOrDash } from "../../model/staff-dashboard-formatters";
import type {
  MonthlyEntry,
  OverviewStats,
  Period,
} from "../../model/staff-dashboard-types";
import {
  DashKpi,
  EmptyChart,
  PeriodSwitcher,
  ChartSkeleton,
  type DashboardTranslations,
} from "../shared/staff-dashboard-surface-primitives";

export function StaffDashboardOverviewSection({
  activePatientCount,
  greeting,
  loading,
  monthly,
  newPatientsThisMonth,
  openTasksCount,
  overview,
  onOpenCases,
  onOpenLeads,
  onOpenOrders,
  onOpenPatients,
  onPeriodChange,
  period,
  tr,
}: {
  activePatientCount: number;
  greeting: string;
  loading: boolean;
  monthly: MonthlyEntry[];
  newPatientsThisMonth: number;
  openTasksCount: number;
  overview: OverviewStats | null;
  onOpenCases: () => void;
  onOpenLeads: () => void;
  onOpenOrders: () => void;
  onOpenPatients: () => void;
  onPeriodChange: (period: Period) => void;
  period: Period;
  tr: DashboardTranslations;
}) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-foreground">
            {greeting}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {tr.dash_subtitle ?? tr.common_unknown}
          </p>
        </div>
        <PeriodSwitcher value={period} onChange={onPeriodChange} tr={tr} />
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <DashKpi
          label={tr.patients_title ?? tr.common_unknown}
          value={numberOrDash(overview?.patients)}
          hint={`${activePatientCount} ${tr.common_active?.toLowerCase() ?? tr.common_unknown}`}
          icon={UsersIcon}
          onClick={onOpenPatients}
        />
        <DashKpi
          label={tr.dash_new_patients ?? tr.common_unknown}
          value={numberOrDash(newPatientsThisMonth)}
          hint={tr.dash_this_month ?? tr.common_unknown}
          icon={UserPlus}
          onClick={onOpenPatients}
        />
        <DashKpi
          label={tr.cases_title ?? tr.common_unknown}
          value={numberOrDash(overview?.cases)}
          hint={tr.common_active?.toLowerCase() ?? tr.common_unknown}
          icon={Stethoscope}
          onClick={onOpenCases}
        />
        <DashKpi
          label={tr.orders_title ?? tr.common_unknown}
          value={numberOrDash(overview?.orders)}
          hint={`${openTasksCount} ${(tr.dash_open_tasks ?? tr.common_unknown).toLowerCase()}`}
          icon={ClipboardList}
          onClick={onOpenOrders}
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-[14px] font-semibold text-foreground">
              {tr.leads_title ?? tr.common_unknown} - {tr.dash_this_year ?? tr.common_unknown}
            </h3>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {tr.dash_leads_monthly_hint ?? tr.common_unknown}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={onOpenLeads}
          >
            {tr.dash_view_all ?? tr.common_unknown}
            <ArrowRight className="size-3" />
          </button>
        </div>
        <div className="min-w-0" style={{ width: "100%", height: 240 }}>
          {loading ? (
            <ChartSkeleton />
          ) : monthly.length === 0 ? (
            <EmptyChart label={tr.dash_no_data ?? tr.common_unknown} />
          ) : (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
              <AreaChart data={monthly} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashLeadsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis
                  dataKey="month"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  stroke="#9ca3af"
                />
                <YAxis
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  stroke="#9ca3af"
                  allowDecimals={false}
                />
                <ChartTooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid var(--color-border)",
                    fontSize: 12,
                  }}
                  labelStyle={{ fontSize: 11, color: "#9ca3af" }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#f97316"
                  strokeWidth={2}
                  fill="url(#dashLeadsGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </>
  );
}
