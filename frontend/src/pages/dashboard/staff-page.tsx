import { useLocation } from "react-router-dom";

import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { ALL_STAFF_ROLES } from "@/lib/staff-route-access";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { useStaffDashboardData } from "./data/use-staff-dashboard-data";
import { greetingFor } from "./model/staff-dashboard-formatters";
import { ExecutiveBusinessMap } from "./ui/executive-business-map";
import { RoleDashboardPage } from "./role-dashboard-page";

export function StaffDashboardPageNew() {
  const { user } = useAuth();
  const location = useLocation();

  const previewRole = import.meta.env.DEV
    ? new URLSearchParams(location.search).get("dashboardRole")
    : null;
  const effectiveRole =
    previewRole && (ALL_STAFF_ROLES as readonly string[]).includes(previewRole)
      ? previewRole
      : user?.role ?? "ceo";

  if (effectiveRole !== "ceo") {
    return <RoleDashboardPage preview={effectiveRole !== user?.role} role={effectiveRole} />;
  }

  return <ExecutiveStaffDashboard />;
}

function ExecutiveStaffDashboard() {
  const { user } = useAuth();
  const { t } = useLang();
  const tr = { ...t.uiText, ...t } as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();

  const {
    finance,
    loading,
    monthly,
    newPatientsThisMonth,
    openTasksCount,
    operations,
    overview,
    patients,
    tasks,
    upcoming,
  } = useStaffDashboardData("30d");

  const greeting = greetingFor(user?.name ?? "", tr);
  const activePatientCount = patients.filter((patient) => patient.is_active).length;

  return (
    <ExecutiveBusinessMap
      activePatientCount={activePatientCount}
      finance={finance}
      greeting={greeting}
      loading={loading}
      monthly={monthly}
      newPatientsThisMonth={newPatientsThisMonth}
      openTasksCount={openTasksCount}
      operations={operations}
      overview={overview}
      tasks={tasks}
      upcoming={upcoming}
      go={staffGo}
    />
  );
}
