import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { NavStateProvider } from "@/lib/nav-state";
import { canAccessPatientPortalRoute, canAccessStaffRoute } from "@/lib/staff-route-access";

import { AppShellFrame } from "./app-shell-frame";
import { resolveWorkspaceRailKind } from "./workspace-rail-resolver";
import { ChatDeviceSetup } from "@/components/chat-device-setup";
import { TwoFactorReminder } from "@/components/two-factor-reminder";

export function AuthenticatedAppShell() {
  const { user, loading } = useAuth();
  const { t } = useLang();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center overflow-hidden text-muted-foreground">
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

  // A forced password change confines the session to the gate page; every
  // other API call would answer 403 `password_change_required` anyway.
  if (user.password_change_required) {
    return <Navigate to="/account/password-required" replace />;
  }

  if (user.role === "patient" && !canAccessPatientPortalRoute(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return (
    <NavStateProvider>
      <ChatDeviceSetup />
      <AuthenticatedAppShellContent />
    </NavStateProvider>
  );
}

function AuthenticatedAppShellContent() {
  const { user } = useAuth();
  const location = useLocation();

  if (
    user &&
    user.role !== "patient" &&
    !canAccessStaffRoute(user.role, location.pathname, user.capabilities)
  ) {
    return <Navigate to="/" replace />;
  }

  const workspaceRailKind = resolveWorkspaceRailKind({
    pathname: location.pathname,
    search: location.search,
    userRole: user?.role,
  });

  return (
    <AppShellFrame workspaceRailKind={workspaceRailKind}>
      <TwoFactorReminder />
      <Outlet />
    </AppShellFrame>
  );
}
