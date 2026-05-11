import { lazy, Suspense, useMemo } from "react";

import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import {
  formatEnumLabelFromKeys,
  getLang,
  t as translateCatalog,
  type TranslationKey,
} from "@/lib/i18n";

import {
  ChartSkeleton,
  EmptyChart,
  type DashboardTranslations,
} from "./staff-dashboard-surface-primitives";

const PALETTE = ["#f97316", "#fb923c", "#fdba74", "#fed7aa", "#fff4ed", "#a3a3a3"];

const HorizontalBarsChart = lazy(async () => {
  const {
    Bar,
    BarChart,
    ResponsiveContainer,
    Tooltip: ChartTooltip,
    XAxis,
    YAxis,
  } = await import("recharts");

  return {
    default: function HorizontalBarsChart({
      data,
      height,
      labelWidth,
    }: {
      data: Array<{ label: string; value: number }>;
      height: number;
      labelWidth: number;
    }) {
      return (
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={height}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
          >
            <XAxis
              type="number"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              stroke="#9ca3af"
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              stroke="#6b7280"
              width={labelWidth}
            />
            <ChartTooltip
              contentStyle={{
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                fontSize: 12,
              }}
              cursor={{ fill: "#fafafa" }}
            />
            <Bar dataKey="value" fill="#f97316" radius={[0, 4, 4, 0]} barSize={12} />
          </BarChart>
        </ResponsiveContainer>
      );
    },
  };
});

const MiniDonutChart = lazy(async () => {
  const {
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip: ChartTooltip,
  } = await import("recharts");

  return {
    default: function MiniDonutChart({
      data,
      height,
      palette,
    }: {
      data: Array<{ name: string; value: number }>;
      height: number;
      palette: string[];
    }) {
      return (
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={height}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={45}
              outerRadius={75}
              paddingAngle={2}
              stroke="none"
            >
              {data.map((item, index) => (
                <Cell key={item.name} fill={palette[index % palette.length]} />
              ))}
            </Pie>
            <ChartTooltip
              contentStyle={{
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      );
    },
  };
});

const ORDER_PHASE_LABEL_KEYS = {
  closure: "dash_order_phase_closure",
  execution: "dash_order_phase_execution",
  intake: "dash_order_phase_intake",
  planning: "dash_order_phase_planning",
} as const satisfies Partial<Record<string, TranslationKey>>;

const SERVICE_TYPE_LABEL_KEYS = {
  medical: "providers_type_medical",
  non_medical: "providers_type_non_medical",
  cost_passthrough: "orders_cost_pass_through_badge",
} as const satisfies Partial<Record<string, TranslationKey>>;

function orderPhaseLabel(phase: string) {
  return formatEnumLabelFromKeys(phase, ORDER_PHASE_LABEL_KEYS, translateCatalog(getLang()));
}

type TopProviderRow = {
  id: string;
  name: string;
  patient_count: number;
  appointment_count: number;
};

type RankedTopProviderRow = TopProviderRow & {
  rank: number;
};

export function HorizontalBars({
  data,
  loading,
  emptyLabel,
  height = 220,
  labelWidth = 110,
  truncate,
}: {
  data: Array<{ label: string; value: number }>;
  loading: boolean;
  emptyLabel: string;
  height?: number;
  labelWidth?: number;
  truncate?: number;
}) {
  if (loading) return <div style={{ height }}><ChartSkeleton /></div>;
  if (data.length === 0) return <div style={{ height }}><EmptyChart label={emptyLabel} /></div>;

  const displayData = truncate
    ? data.map((item) => ({
        ...item,
        label:
          item.label.length > truncate ? `${item.label.slice(0, truncate - 3)}...` : item.label,
      }))
    : data;

  return (
    <div className="min-w-0" style={{ width: "100%", height }}>
      <Suspense fallback={<ChartSkeleton />}>
        <HorizontalBarsChart data={displayData} height={height} labelWidth={labelWidth} />
      </Suspense>
    </div>
  );
}

export function MiniDonut({
  data,
  loading,
  emptyLabel,
  height = 180,
}: {
  data: Array<{ name: string; value: number }>;
  loading: boolean;
  emptyLabel: string;
  height?: number;
}) {
  if (loading) return <div style={{ height }}><ChartSkeleton /></div>;
  const visible = data.filter((item) => item.value > 0);
  if (visible.length === 0) return <div style={{ height }}><EmptyChart label={emptyLabel} /></div>;

  return (
    <div className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-3">
      <div className="min-w-0" style={{ width: "100%", height }}>
        <Suspense fallback={<ChartSkeleton />}>
          <MiniDonutChart data={visible} height={height} palette={PALETTE} />
        </Suspense>
      </div>
      <div className="flex flex-col gap-1 text-[11.5px]">
        {visible.map((entry, index) => (
          <div key={entry.name} className="flex items-center gap-2">
            <span
              className="inline-block size-2 shrink-0 rounded-sm"
              style={{ background: PALETTE[index % PALETTE.length] }}
            />
            <span className="max-w-[110px] truncate text-muted-foreground">{entry.name}</span>
            <span className="ml-auto tabular-nums font-medium text-foreground">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ServiceMixTable({
  rows,
  loading,
  tr,
}: {
  rows: Array<{ service_type: string; item_count: number; gross_total: string }>;
  loading: boolean;
  tr: DashboardTranslations;
}) {
  if (loading) return <div className="py-8"><ChartSkeleton /></div>;
  if (rows.length === 0) return <EmptyChart label={tr.dash_no_data ?? tr.common_unknown} />;

  const max = Math.max(1, ...rows.map((row) => row.item_count));

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const percent = (row.item_count / max) * 100;
        return (
          <div key={row.service_type} className="flex items-center gap-3">
            <div className="w-[140px] shrink-0 text-[13px] text-foreground">
              {formatEnumLabelFromKeys(
                row.service_type,
                SERVICE_TYPE_LABEL_KEYS,
                translateCatalog(getLang()),
              )}
            </div>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted/60">
              <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${percent}%` }} />
            </div>
            <div className="w-[80px] shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
              {row.item_count}
            </div>
            <div className="w-[120px] shrink-0 text-right text-[12px] font-medium tabular-nums text-foreground">
              EUR {row.gross_total}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function OrdersValuedBars({
  data,
  loading,
  emptyLabel,
}: {
  data: Array<{ phase: string; count: number; value_eur: string }>;
  loading: boolean;
  emptyLabel: string;
}) {
  if (loading) return <div style={{ height: 220 }}><ChartSkeleton /></div>;
  if (data.length === 0) return <div style={{ height: 220 }}><EmptyChart label={emptyLabel} /></div>;

  const max = Math.max(1, ...data.map((item) => Number(item.value_eur) || 0));

  return (
    <div className="space-y-2.5">
      {data.map((item) => {
        const value = Number(item.value_eur) || 0;
        const percent = (value / max) * 100;
        return (
          <div key={item.phase} className="flex items-center gap-3">
            <div className="w-[100px] shrink-0 capitalize text-[13px] text-foreground">
              {orderPhaseLabel(item.phase)}
            </div>
            <div className="flex-1">
              <div className="relative h-5 overflow-hidden rounded-md bg-muted/50">
                <div
                  className="h-full rounded-md transition-all"
                  style={{
                    width: `${percent}%`,
                    background: "linear-gradient(90deg,#f97316,#fb923c)",
                  }}
                />
              </div>
            </div>
            <div className="w-[60px] shrink-0 text-right text-[11.5px] tabular-nums text-muted-foreground">
              {item.count} {translateCatalog(getLang()).dash_order_count_suffix}
            </div>
            <div className="w-[110px] shrink-0 text-right text-[12.5px] font-medium tabular-nums text-foreground">
              EUR {value.toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AppointmentsHeatmap({
  data,
  loading,
  tr,
}: {
  data: Array<{ dow: number; hour: number; count: number }>;
  loading: boolean;
  tr: DashboardTranslations;
}) {
  if (loading) return <div className="h-[200px]"><ChartSkeleton /></div>;
  if (data.length === 0) return <EmptyChart label={tr.dash_no_data ?? tr.common_unknown} />;

  const lookup = new Map<string, number>();
  let max = 0;
  for (const item of data) {
    lookup.set(`${item.dow}-${item.hour}`, item.count);
    if (item.count > max) max = item.count;
  }

  const days = [
    tr.day_mon ?? tr.common_unknown,
    tr.day_tue ?? tr.common_unknown,
    tr.day_wed ?? tr.common_unknown,
    tr.day_thu ?? tr.common_unknown,
    tr.day_fri ?? tr.common_unknown,
    tr.day_sat ?? tr.common_unknown,
    tr.day_sun ?? tr.common_unknown,
  ];
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const hours = Array.from({ length: 13 }, (_, index) => index + 8);

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="flex">
          <div className="w-[40px]" />
          {hours.map((hour) => (
            <div
              key={hour}
              className="min-w-[24px] flex-1 text-center text-[10px] tabular-nums text-muted-foreground"
            >
              {hour}
            </div>
          ))}
        </div>
        {dayOrder.map((dow, rowIndex) => (
          <div key={dow} className="mt-1 flex items-center">
            <div className="w-[40px] pr-2 text-right text-[11px] text-muted-foreground">
              {days[rowIndex]}
            </div>
            {hours.map((hour) => {
              const value = lookup.get(`${dow}-${hour}`) ?? 0;
              const intensity = max > 0 ? value / max : 0;
              const background =
                intensity === 0 ? "transparent" : `rgba(249,115,22,${0.08 + intensity * 0.72})`;

              return (
                <div
                  key={hour}
                  title={value > 0 ? `${days[rowIndex]} ${hour}:00 - ${value}` : undefined}
                  className="mx-0.5 flex aspect-square min-h-[22px] min-w-[22px] flex-1 items-center justify-center rounded-sm text-[10px] text-foreground/60"
                  style={{
                    background,
                    border: intensity === 0 ? "1px solid var(--color-border)" : "none",
                  }}
                >
                  {value > 0 && intensity > 0.4 ? value : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TopProvidersTable({
  rows,
  loading,
  tr,
  onOpen,
}: {
  rows: TopProviderRow[];
  loading: boolean;
  tr: DashboardTranslations;
  onOpen: (id: string) => void;
}) {
  const rankedRows = useMemo<RankedTopProviderRow[]>(
    () => rows.map((row, index) => ({ ...row, rank: index + 1 })),
    [rows],
  );

  const columns = useMemo<ColumnDef<RankedTopProviderRow>[]>(() => [
    {
      id: "rank",
      label: "#",
      accessor: (row) => row.rank,
      width: 48,
      render: (row) => (
        <span className="font-mono text-[12px] text-muted-foreground">
          {row.rank}
        </span>
      ),
    },
    {
      id: "provider",
      label: tr.providers_title ?? tr.common_provider,
      accessor: (row) => row.name,
      required: true,
      pinned: "left",
      width: 220,
      render: (row) => (
        <span className="truncate font-medium text-foreground">{row.name}</span>
      ),
    },
    {
      id: "patients",
      label: tr.patients_title ?? tr.common_unknown,
      accessor: (row) => row.patient_count,
      width: 112,
      render: (row) => (
        <span className="block text-right tabular-nums">{row.patient_count}</span>
      ),
    },
    {
      id: "appointments",
      label: tr.appointments_title ?? tr.common_unknown,
      accessor: (row) => row.appointment_count,
      width: 132,
      render: (row) => (
        <span className="block text-right tabular-nums">{row.appointment_count}</span>
      ),
    },
  ], [
    tr.appointments_title,
    tr.common_provider,
    tr.common_unknown,
    tr.patients_title,
    tr.providers_title,
  ]);

  if (loading) return <div className="py-6"><ChartSkeleton /></div>;
  if (rows.length === 0) return <EmptyChart label={tr.dash_no_data ?? tr.common_unknown} />;

  return (
    <DataTableSurface
      rows={rankedRows}
      columns={columns}
      defaultDensity="comfortable"
      dictionary={tr as Record<string, string>}
      rowId={(row) => row.id}
      onRowClick={(row) => onOpen(row.id)}
      tableClassName="min-h-[220px] bg-transparent"
    />
  );
}
