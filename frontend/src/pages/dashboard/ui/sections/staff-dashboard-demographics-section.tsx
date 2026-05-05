import {
  genderToChart,
  insuranceToChart,
} from "../../model/staff-dashboard-formatters";
import type { DemographicsPayload } from "../../model/staff-dashboard-types";
import {
  ChartCard,
  SectionHeader,
  type DashboardTranslations,
} from "../shared/staff-dashboard-surface-primitives";
import {
  HorizontalBars,
  MiniDonut,
} from "../shared/staff-dashboard-chart-primitives";

export function StaffDashboardDemographicsSection({
  demographics,
  sectionsLoading,
  tr,
}: {
  demographics: DemographicsPayload | null;
  sectionsLoading: boolean;
  tr: DashboardTranslations;
}) {
  return (
    <>
      <SectionHeader
        title={tr.dash_sec_demographics ?? tr.common_unknown}
        hint={tr.dash_sec_demographics_hint ?? tr.common_unknown}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title={tr.dash_by_country ?? tr.common_unknown}
          hint={`${demographics?.total ?? 0} ${(tr.patients_title ?? tr.common_unknown).toLowerCase()}`}
        >
          <HorizontalBars
            loading={sectionsLoading}
            data={(demographics?.by_country ?? []).map((country) => ({
              label: country.country,
              value: country.count,
            }))}
            emptyLabel={tr.dash_no_data ?? tr.common_unknown}
          />
        </ChartCard>

        <ChartCard
          title={tr.dash_by_age ?? tr.common_unknown}
          hint={tr.dash_by_age_hint ?? tr.common_unknown}
        >
          <HorizontalBars
            loading={sectionsLoading}
            data={(demographics?.by_age_group ?? []).map((group) => ({
              label: group.group,
              value: group.count,
            }))}
            emptyLabel={tr.dash_no_data ?? tr.common_unknown}
            labelWidth={50}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <ChartCard title={tr.dash_by_gender ?? tr.common_unknown} compact>
          <MiniDonut
            loading={sectionsLoading}
            data={genderToChart(demographics?.by_gender, tr)}
            emptyLabel={tr.dash_no_data ?? tr.common_unknown}
          />
        </ChartCard>

        <ChartCard title={tr.dash_insurance_mix ?? tr.common_unknown} compact>
          <MiniDonut
            loading={sectionsLoading}
            data={insuranceToChart(demographics?.by_insurance, tr)}
            emptyLabel={tr.dash_no_data ?? tr.common_unknown}
          />
        </ChartCard>

        <ChartCard title={tr.dash_top_languages ?? tr.common_unknown} compact>
          <HorizontalBars
            loading={sectionsLoading}
            data={(demographics?.top_languages ?? []).map((language) => ({
              label: language.language.toUpperCase(),
              value: language.count,
            }))}
            emptyLabel={tr.dash_no_data ?? tr.common_unknown}
            labelWidth={40}
            height={160}
          />
        </ChartCard>
      </div>
    </>
  );
}
