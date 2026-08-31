import { useCallback } from "react";
import { useNavigate, type NavigateOptions } from "react-router-dom";

import { useAuth } from "@/lib/auth";
import {
  canAccessPatientPortalRoute,
  canAccessStaffRoute,
  staffHrefIfAllowed,
} from "@/lib/staff-route-access";

/**
 * App-shell-safe in-app navigation:
 * staff uses {@link canAccessStaffRoute}, patient uses the shared portal whitelist;
 * denied → `/`.
 */
export function useStaffNavigate() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const staffRole = user?.role ?? "";

  const staffGo = useCallback(
    (href: string, options?: NavigateOptions) => {
      const state =
        options?.state && typeof options.state === "object"
          ? { ...options.state, __gmedNavigationUserId: user?.id ?? null }
          : options?.state;
      navigate(staffHrefIfAllowed(staffRole, href), { ...options, state });
    },
    [navigate, staffRole, user?.id],
  );

  const staffTo = useCallback(
    (href: string) => staffHrefIfAllowed(staffRole, href),
    [staffRole],
  );

  const canStaffPath = useCallback(
    (pathname: string) =>
      staffRole === "patient"
        ? canAccessPatientPortalRoute(pathname)
        : canAccessStaffRoute(staffRole, pathname),
    [staffRole],
  );

  return { staffGo, staffTo, staffRole, canStaffPath };
}
