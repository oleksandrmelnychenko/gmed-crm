import { Navigate, Outlet, matchPath, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { canAccessPatientPortalRoute, canAccessStaffRoute } from "@/lib/staff-route-access";
import { NavStateProvider } from "@/lib/nav-state";
import { AppointmentWorkspaceNav } from "./appointment-workspace-nav";
import { CaseWorkspaceNav } from "./case-workspace-nav";
import { NavPanel } from "./nav-panel";
import { PatientWorkspaceNav } from "./patient-workspace-nav";
import { Topbar } from "./topbar";
import { Toaster } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export function AppLayout() {
  const { user, loading } = useAuth();
  const { t } = useLang();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        {t.common_loading}
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  if (user.role === "patient" && !canAccessPatientPortalRoute(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return (
    <NavStateProvider>
      <AppLayoutInner />
    </NavStateProvider>
  );
}

function AppLayoutInner() {
  const { user } = useAuth();
  const location = useLocation();
  const isPatientDetailRoute = Boolean(matchPath("/patients/:id", location.pathname));
  const isCaseWorkspaceRoute = Boolean(matchPath("/cases/:caseId", location.pathname));
  const routeSearchParams = new URLSearchParams(location.search);
  const hasPatientContextOnCase =
    isCaseWorkspaceRoute && Boolean(routeSearchParams.get("patient"));
  const showPatientWorkspaceNav = isPatientDetailRoute || hasPatientContextOnCase;
  const showCaseWorkspaceNav = isCaseWorkspaceRoute;
  const showAppointmentWorkspaceNav =
    user?.role !== "patient" &&
    location.pathname === "/appointments" &&
    Boolean(routeSearchParams.get("appointment"));

  if (
    user &&
    user.role !== "patient" &&
    !canAccessStaffRoute(user.role, location.pathname)
  ) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="h-screen bg-background p-2 overflow-hidden">
      <div className="h-full rounded-2xl border border-border bg-card overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex flex-col">
        <Topbar />
        <div className="flex-1 flex overflow-hidden gap-[6px] p-[6px] bg-muted/50">
          <NavPanel />
          {showPatientWorkspaceNav ? <PatientWorkspaceNav /> : null}
          {showCaseWorkspaceNav ? <CaseWorkspaceNav /> : null}
          {!showPatientWorkspaceNav &&
          !showCaseWorkspaceNav &&
          showAppointmentWorkspaceNav ? (
            <AppointmentWorkspaceNav />
          ) : null}
          <main
            className={cn(
              "flex-1 overflow-auto rounded-xl px-7 py-6 transition-[padding] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
              showAppointmentWorkspaceNav ? "bg-white" : "bg-card",
            )}
          >
            <Outlet />
          </main>
        </div>
      </div>
      <Toaster />
    </div>
  );
}
