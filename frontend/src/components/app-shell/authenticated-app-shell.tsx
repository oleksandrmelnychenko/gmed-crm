import { AppearanceProvider } from "@/lib/use-appearance-theme";
import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "@/lib/auth";
import { loginRedirectState } from "@/lib/login-redirect";
import { useLang } from "@/lib/i18n";
import { NavStateProvider } from "@/lib/nav-state";
import {
  canAccessLeadPortalRoute,
  canAccessPatientPortalRoute,
  canAccessStaffRoute,
  isLeadPortalUser,
} from "@/lib/staff-route-access";

import { AppShellFrame } from "./app-shell-frame";
import { resolveWorkspaceRailKind } from "./workspace-rail-resolver";
import { TwoFactorReminder } from "@/components/two-factor-reminder";
import { clearApiCache } from "@/lib/api";
import { selectPortalPatient, usePortalPatientId } from "@/lib/portal-patient-context";
import { hasPortalSubscription, isBasicPortalRoute } from "@/lib/portal-subscription";
import { PortalSubscriptionLock } from "@/components/portal-subscription-lock";

export function AuthenticatedAppShell() {
  const { user, loading, signOut } = useAuth();
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
    return <Navigate to="/login" replace state={loginRedirectState(signOut, location)} />;
  }

  // A forced password change confines the session to the gate page; every
  // other API call would answer 403 `password_change_required` anyway.
  if (user.password_change_required) {
    return <Navigate to="/account/password-required" replace />;
  }

  // A role that must use a second factor reaches only its setup until one is
  // enrolled; the server answers 403 `totp_enrolment_required` otherwise.
  if (user.totp_enrolment_required) {
    return <Navigate to="/account/two-factor-required" replace />;
  }

  const leadCabinet = isLeadPortalUser(user);
  if (leadCabinet && !canAccessLeadPortalRoute(location.pathname)) {
    return <Navigate to="/" replace />;
  }
  if (user.role === "patient" && !canAccessPatientPortalRoute(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return (
    <NavStateProvider>
      <AppearanceProvider key={user.id} userId={user.id}>
        <AuthenticatedAppShellContent />
      </AppearanceProvider>
    </NavStateProvider>
  );
}

function AuthenticatedAppShellContent() {
  const { user, refreshUser } = useAuth();
  const { lang } = useLang();
  const location = useLocation();
  const patientId = usePortalPatientId(user?.id);
  const [refreshingPick, setRefreshingPick] = useState(false);
  const patients = user?.role === "patient" ? user.patients ?? [] : [];
  const accountPage = ["/account", "/request", "/trusted-persons", "/legal", "/security"].some(
    (path) => location.pathname === path || location.pathname.startsWith(`${path}/`),
  );
  const needsPatient = !accountPage && patients.length > 1 && !patients.some((patient) => patient.id === patientId);
  const subscriptionLocked = user?.role === "patient" && !isLeadPortalUser(user)
    && !hasPortalSubscription(user, patientId) && !isBasicPortalRoute(location.pathname);

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
    <AppShellFrame key={accountPage ? "account" : patientId ?? "account"} workspaceRailKind={workspaceRailKind}>
      <TwoFactorReminder />
      {!accountPage && patients.length > 1 && (
        <div className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-3">
          <label htmlFor="portal-patient" className="text-sm font-medium">
            {lang === "de" ? "Patient / Patientin" : "Пациент"}
          </label>
          <select
            id="portal-patient"
            className="max-w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={patientId ?? ""}
            onChange={(event) => {
              if (!user || !patients.some((patient) => patient.id === event.target.value)) return;
              clearApiCache();
              selectPortalPatient(user.id, event.target.value);
              // The login's data may be older than the child's subscription: a hidden
              // tab reads /me not at all, and the lock showed until a reload (QA 2026-11-01).
              setRefreshingPick(true);
              void refreshUser().catch(() => null).finally(() => setRefreshingPick(false));
            }}
          >
            <option value="" disabled>{lang === "de" ? "Bitte auswählen" : "Выберите пациента"}</option>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>{patient.name} · {patient.patient_number}</option>
            ))}
          </select>
        </div>
      )}
      {needsPatient ? (
        <p className="p-6 text-muted-foreground">
          {lang === "de" ? "Wählen Sie, für wen Sie das Portal öffnen möchten." : "Выберите, для кого открыть кабинет."}
        </p>
      ) : subscriptionLocked ? (refreshingPick ? null : <PortalSubscriptionLock />) : <Outlet />}
    </AppShellFrame>
  );
}
