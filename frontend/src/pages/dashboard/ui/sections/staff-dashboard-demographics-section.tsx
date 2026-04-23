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
        title={tr.dash_sec_demographics ?? "Demographics"}
        hint={tr.dash_sec_demographics_hint ?? "Who our patients are"}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title={tr.dash_by_country ?? "Patients by country"}
          hint={`${demographics?.total ?? 0} ${tr.patients_title?.toLowerCase() ?? "patients"}`}
        >
          <HorizontalBars
            loading={sectionsLoading}
            data={(demographics?.by_country ?? []).map((country) => ({
              label: country.country,
              value: country.count,
            }))}
            emptyLabel={tr.dash_no_data ?? "No data"}
          />
        </ChartCard>

        <ChartCard
          title={tr.dash_by_age ?? "Age distribution"}
          hint={tr.dash_by_age_hint ?? "Patients grouped by age"}
        >
          <HorizontalBars
            loading={sectionsLoading}
            data={(demographics?.by_age_group ?? []).map((group) => ({
              label: group.group,
              value: group.count,
            }))}
            emptyLabel={tr.dash_no_data ?? "No data"}
            labelWidth={50}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <ChartCard title={tr.dash_by_gender ?? "Gender"} compact>
          <MiniDonut
            loading={sectionsLoading}
            data={genderToChart(demographics?.by_gender, tr)}
            emptyLabel={tr.dash_no_data ?? "No data"}
          />
        </ChartCard>

        <ChartCard title={tr.dash_insurance_mix ?? "Insurance mix"} compact>
          <MiniDonut
            loading={sectionsLoading}
            data={insuranceToChart(demographics?.by_insurance, tr)}
            emptyLabel={tr.dash_no_data ?? "No data"}
          />
        </ChartCard>

        <ChartCard title={tr.dash_top_languages ?? "Top languages"} compact>
          <HorizontalBars
            loading={sectionsLoading}
            data={(demographics?.top_languages ?? []).map((language) => ({
              label: language.language.toUpperCase(),
              value: language.count,
            }))}
            emptyLabel={tr.dash_no_data ?? "No data"}
            labelWidth={40}
            height={160}
          />
        </ChartCard>
      </div>
    </>
  );
}
