import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { canAccessPatientPortalRoute, canAccessStaffRoute } from "@/lib/staff-route-access";
import { NavStateProvider, useNavState } from "@/lib/nav-state";
import { NavPanel } from "./nav-panel";
import { Topbar } from "./topbar";
import { cn } from "@/lib/utils";

export function AppLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        Loading...
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
  const { collapsed } = useNavState();

  if (
    user &&
    user.role !== "patient" &&
    !canAccessStaffRoute(user.role, location.pathname)
  ) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-white">
      <div
        className={cn(
          "fixed left-0 top-0 bottom-0 z-40 border-r border-border/70 transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          collapsed ? "w-[5.5rem]" : "w-[17rem]",
        )}
      >
        <NavPanel />
      </div>
      <div
        className={cn(
          "flex h-screen flex-col overflow-hidden transition-[padding-left] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          collapsed ? "pl-[5.5rem]" : "pl-[17rem]"
        )}
      >
        <Topbar />
        <div className="flex-1 overflow-y-auto bg-neutral-100 bg-none">
          <main className="min-h-full bg-[#f2f2f2] px-6 py-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
