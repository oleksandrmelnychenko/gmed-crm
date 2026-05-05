import { apptStatusToChart } from "../../model/staff-dashboard-formatters";
import type { OperationsPayload } from "../../model/staff-dashboard-types";
import {
  ChartCard,
  SectionHeader,
  type DashboardTranslations,
} from "../shared/staff-dashboard-surface-primitives";
import {
  AppointmentsHeatmap,
  MiniDonut,
  OrdersValuedBars,
  TopProvidersTable,
} from "../shared/staff-dashboard-chart-primitives";

export function StaffDashboardOperationsSection({
  onOpenProvider,
  operations,
  sectionsLoading,
  tr,
}: {
  onOpenProvider: (id: string) => void;
  operations: OperationsPayload | null;
  sectionsLoading: boolean;
  tr: DashboardTranslations;
}) {
  return (
    <>
      <SectionHeader
        title={tr.dash_sec_ops ?? tr.common_unknown}
        hint={tr.dash_sec_ops_hint ?? tr.common_unknown}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={tr.dash_appointments_by_status ?? tr.common_unknown}>
          <MiniDonut
            loading={sectionsLoading}
            data={apptStatusToChart(operations?.appointments_by_status, tr)}
            emptyLabel={tr.dash_no_data ?? tr.common_unknown}
          />
        </ChartCard>

        <ChartCard
          title={`${tr.orders_title ?? tr.common_unknown} - ${tr.dash_pipeline_value ?? tr.common_unknown}`}
          hint={tr.dash_pipeline_hint ?? tr.common_unknown}
        >
          <OrdersValuedBars
            loading={sectionsLoading}
            data={operations?.orders_by_phase_valued ?? []}
            emptyLabel={tr.dash_no_data ?? tr.common_unknown}
          />
        </ChartCard>
      </div>

      <ChartCard
        title={tr.dash_heatmap ?? tr.common_unknown}
        hint={tr.dash_heatmap_hint ?? tr.common_unknown}
      >
        <AppointmentsHeatmap
          loading={sectionsLoading}
          data={operations?.appointments_heatmap ?? []}
          tr={tr}
        />
      </ChartCard>

      <ChartCard
        title={tr.dash_top_providers ?? tr.common_unknown}
        hint={tr.dash_top_providers_hint ?? tr.common_unknown}
      >
        <TopProvidersTable
          loading={sectionsLoading}
          rows={operations?.top_providers ?? []}
          tr={tr}
          onOpen={onOpenProvider}
        />
      </ChartCard>
    </>
  );
}
