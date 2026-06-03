import { lazy, startTransition, Suspense, useState } from "react";

import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { useStaffDashboardData } from "./data/use-staff-dashboard-data";
import { dashboardProviderHref, greetingFor } from "./model/staff-dashboard-formatters";
import type { Period } from "./model/staff-dashboard-types";
import { StaffDashboardOverviewSection } from "./ui/sections/staff-dashboard-overview-section";
import { DashboardSectionLoading } from "./ui/shared/dashboard-route-loading";

const StaffDashboardDemographicsSection = lazy(() =>
  import("./ui/sections/staff-dashboard-demographics-section").then((module) => ({
    default: module.StaffDashboardDemographicsSection,
  })),
);

const StaffDashboardClinicalSection = lazy(() =>
  import("./ui/sections/staff-dashboard-clinical-section").then((module) => ({
    default: module.StaffDashboardClinicalSection,
  })),
);

const StaffDashboardOperationsSection = lazy(() =>
  import("./ui/sections/staff-dashboard-operations-section").then((module) => ({
    default: module.StaffDashboardOperationsSection,
  })),
);

const StaffDashboardActivitySection = lazy(() =>
  import("./ui/sections/staff-dashboard-activity-section").then((module) => ({
    default: module.StaffDashboardActivitySection,
  })),
);

export function StaffDashboardPageNew() {
  const { user } = useAuth();
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();

  const [period, setPeriod] = useState<Period>("30d");
  const {
    clinical,
    demographics,
    loading,
    monthly,
    newPatientsThisMonth,
    openTasksCount,
    operations,
    overview,
    patients,
    sectionsLoading,
    setSectionsLoading,
    tasks,
    upcoming,
  } = useStaffDashboardData(period);

  function handlePeriodChange(nextPeriod: Period) {
    if (nextPeriod === period) return;
    setSectionsLoading(true);
    startTransition(() => {
      setPeriod(nextPeriod);
    });
  }

  const greeting = greetingFor(user?.name ?? "", tr);
  const activePatientCount = patients.filter((patient) => patient.is_active).length;

  return (
    <div className="space-y-4">
      <StaffDashboardOverviewSection
        activePatientCount={activePatientCount}
        greeting={greeting}
        loading={loading}
        monthly={monthly}
        newPatientsThisMonth={newPatientsThisMonth}
        openTasksCount={openTasksCount}
        overview={overview}
        onOpenCases={() => staffGo("/cases")}
        onOpenLeads={() => staffGo("/leads")}
        onOpenOrders={() => staffGo("/orders")}
        onOpenPatients={() => staffGo("/patients")}
        onPeriodChange={handlePeriodChange}
        period={period}
        tr={tr}
      />

      <Suspense fallback={<DashboardSectionLoading />}>
        <StaffDashboardDemographicsSection
          demographics={demographics}
          sectionsLoading={sectionsLoading}
          tr={tr}
        />
      </Suspense>

      <Suspense fallback={<DashboardSectionLoading />}>
        <StaffDashboardClinicalSection
          clinical={clinical}
          sectionsLoading={sectionsLoading}
          tr={tr}
        />
      </Suspense>

      <Suspense fallback={<DashboardSectionLoading />}>
        <StaffDashboardOperationsSection
          onOpenProvider={(id) => staffGo(dashboardProviderHref(id))}
          operations={operations}
          sectionsLoading={sectionsLoading}
          tr={tr}
        />
      </Suspense>

      <Suspense fallback={<DashboardSectionLoading />}>
        <StaffDashboardActivitySection
          loading={loading}
          onOpenAppointment={(id) => staffGo(`/appointments?appointment=${id}`)}
          onOpenAppointments={() => staffGo("/appointments")}
          onOpenLeads={() => staffGo("/leads")}
          onOpenOrders={() => staffGo("/orders")}
          onOpenPatients={() => staffGo("/patients")}
          openTasksCount={openTasksCount}
          tasks={tasks}
          tr={tr}
          upcoming={upcoming}
        />
      </Suspense>
    </div>
  );
}
