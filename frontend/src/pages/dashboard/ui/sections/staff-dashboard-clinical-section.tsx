import { casesStatusToChart } from "../../model/staff-dashboard-formatters";
import type { ClinicalPayload } from "../../model/staff-dashboard-types";
import {
  ChartCard,
  SectionHeader,
  type DashboardTranslations,
} from "../shared/staff-dashboard-surface-primitives";
import {
  HorizontalBars,
  MiniDonut,
  ServiceMixTable,
} from "../shared/staff-dashboard-chart-primitives";

export function StaffDashboardClinicalSection({
  clinical,
  sectionsLoading,
  tr,
}: {
  clinical: ClinicalPayload | null;
  sectionsLoading: boolean;
  tr: DashboardTranslations;
}) {
  return (
    <>
      <SectionHeader
        title={tr.dash_sec_clinical ?? tr.common_unknown}
        hint={tr.dash_sec_clinical_hint ?? tr.common_unknown}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]">
        <ChartCard
          title={tr.dash_top_reasons ?? tr.common_unknown}
          hint={tr.dash_top_reasons_hint ?? tr.common_unknown}
        >
          <HorizontalBars
            loading={sectionsLoading}
            data={(clinical?.top_case_reasons ?? []).map((reason) => ({
              label: reason.reason,
              value: reason.count,
            }))}
            emptyLabel={tr.dash_no_data ?? tr.common_unknown}
            height={240}
            labelWidth={140}
            truncate={28}
          />
        </ChartCard>

        <ChartCard
          title={tr.dash_cases_by_status ?? tr.common_unknown}
          hint={tr.dash_cases_status_hint ?? tr.common_unknown}
        >
          <MiniDonut
            loading={sectionsLoading}
            data={casesStatusToChart(clinical?.cases_by_status, tr)}
            emptyLabel={tr.dash_no_data ?? tr.common_unknown}
            height={200}
          />
        </ChartCard>

        <div className="relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-card p-4">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at top right, rgba(249,115,22,0.10), transparent 55%)",
            }}
          />
          <div className="relative">
            <span className="text-[12px] text-muted-foreground">
              {tr.dash_avg_duration ?? tr.common_unknown}
            </span>
            <p className="mt-2 text-[30px] font-semibold leading-none tracking-tight text-foreground">
              {clinical && Number.isFinite(clinical.avg_case_duration_days)
                ? Math.round(clinical.avg_case_duration_days)
                : "-"}
            </p>
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              {tr.dash_days ?? tr.common_unknown}
            </p>
            <p className="mt-3 text-[11px] text-muted-foreground">
              {tr.dash_avg_duration_hint ?? tr.common_unknown}
            </p>
          </div>
        </div>
      </div>

      <ChartCard
        title={tr.dash_service_mix ?? tr.common_unknown}
        hint={tr.dash_service_mix_hint ?? tr.common_unknown}
      >
        <ServiceMixTable loading={sectionsLoading} rows={clinical?.service_mix ?? []} tr={tr} />
      </ChartCard>
    </>
  );
}
