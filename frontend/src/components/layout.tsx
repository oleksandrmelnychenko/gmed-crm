import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { NavStateProvider, useNavState } from "@/lib/nav-state";
import { NavPanel } from "./nav-panel";
import { Topbar } from "./topbar";
import { cn } from "@/lib/utils";

function isPatientPortalPath(pathname: string) {
  return pathname === "/" || pathname === "/documents" || pathname === "/privacy" || pathname === "/invoices" || pathname === "/appointments";
}

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

  if (user.role === "patient" && !isPatientPortalPath(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return (
    <NavStateProvider>
      <AppLayoutInner />
    </NavStateProvider>
  );
}

function AppLayoutInner() {
  const { collapsed } = useNavState();

  return (
    <div className="min-h-screen bg-white">
      <NavPanel />
      <div
        className={cn(
          "flex flex-col min-h-screen transition-[padding-left] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          collapsed ? "pl-[5.5rem]" : "pl-[17rem]"
        )}
      >
        <Topbar />
        <div className="flex-1 overflow-hidden rounded-tl-[20px] bg-neutral-100">
          <main className="px-6 py-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
