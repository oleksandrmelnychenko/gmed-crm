import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

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
    (href: string) => {
      navigate(staffHrefIfAllowed(staffRole, href));
    },
    [navigate, staffRole],
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
