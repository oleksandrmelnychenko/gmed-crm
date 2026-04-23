import { lazy, Suspense } from "react";

import { useAuth } from "@/lib/auth";
import { DashboardRouteLoading } from "./ui/shared/dashboard-route-loading";

const PatientDashboardPage = lazy(() =>
  import("../patient-dashboard").then((module) => ({
    default: module.PatientDashboardPage,
  })),
);

const StaffDashboardPageNew = lazy(() =>
  import("./staff-page").then((module) => ({
    default: module.StaffDashboardPageNew,
  })),
);

export function DashboardPage() {
  const { user } = useAuth();

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
