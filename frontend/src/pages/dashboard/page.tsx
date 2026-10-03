import { lazy, Suspense } from "react";

import { useAuth } from "@/lib/auth";
import { isLeadPortalUser } from "@/lib/staff-route-access";
import { DashboardRouteLoading } from "./ui/shared/dashboard-route-loading";

const PatientDashboardPage = lazy(() =>
  import("../patients/portal-dashboard-page").then((module) => ({
    default: module.PatientDashboardPage,
  })),
);

const LeadRequestPage = lazy(() =>
  import("../patient-lead/lead-request-page").then((module) => ({
    default: module.LeadRequestPage,
  })),
);

const StaffDashboardPageNew = lazy(() =>
  import("./staff-page").then((module) => ({
    default: module.StaffDashboardPageNew,
  })),
);

export function DashboardPage() {
  const { user } = useAuth();

  // Lead cabinet: a login that reaches only requests sees the request page.
  if (isLeadPortalUser(user)) {
    return (
      <Suspense fallback={<DashboardRouteLoading />}>
        <LeadRequestPage />
      </Suspense>
    );
  }

  if (user?.role === "patient") {
    return (
      <Suspense fallback={<DashboardRouteLoading />}>
        <PatientDashboardPage />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<DashboardRouteLoading />}>
      <StaffDashboardPageNew />
    </Suspense>
  );
}
