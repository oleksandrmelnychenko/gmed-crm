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
        title={tr.dash_sec_ops ?? "Operations"}
        hint={tr.dash_sec_ops_hint ?? "Appointments, orders and provider network"}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={tr.dash_appointments_by_status ?? "Appointments by status"}>
          <MiniDonut
            loading={sectionsLoading}
            data={apptStatusToChart(operations?.appointments_by_status, tr)}
            emptyLabel={tr.dash_no_data ?? "No data"}
          />
        </ChartCard>

        <ChartCard
          title={`${tr.orders_title ?? "Orders"} · ${tr.dash_pipeline_value ?? "pipeline value"}`}
          hint={tr.dash_pipeline_hint ?? "Count and € value per phase"}
        >
          <OrdersValuedBars
            loading={sectionsLoading}
            data={operations?.orders_by_phase_valued ?? []}
            emptyLabel={tr.dash_no_data ?? "No data"}
          />
        </ChartCard>
      </div>

      <ChartCard
        title={tr.dash_heatmap ?? "Appointments heatmap"}
        hint={tr.dash_heatmap_hint ?? "Day of week × hour"}
      >
        <AppointmentsHeatmap
          loading={sectionsLoading}
          data={operations?.appointments_heatmap ?? []}
          tr={tr}
        />
      </ChartCard>

      <ChartCard
        title={tr.dash_top_providers ?? "Top providers"}
        hint={tr.dash_top_providers_hint ?? "By appointment volume"}
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
