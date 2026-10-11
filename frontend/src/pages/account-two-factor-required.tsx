import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { TwoFactorSection } from "@/pages/two-factor";

/**
 * Gate shown when the role must use a second factor (CEO, IT Admin, Patient
 * Manager) and none is enrolled: the server answers every other call with
 * 403 `totp_enrolment_required` (owner decision 2026-10-11, QA E-17). Rendered
 * outside the app shell: only the setup and the sign-out.
 */
export function AccountTwoFactorRequiredPage() {
  const { user, loading, logout } = useAuth();
  const { t } = useLang();
  const { staffGo } = useStaffNavigate();

  // Nothing to gate (enrolled, other role, signed out): back to the shell,
  // which sends anonymous visitors to /login and open gates to their page.
  const gateOpen =
    !loading && (!user || user.password_change_required || !user.totp_enrolment_required);
  useEffect(() => {
    if (gateOpen) staffGo("/", { replace: true });
  }, [gateOpen, staffGo]);

  if (loading || gateOpen || !user) {
    return (
      <div className="flex h-dvh items-center justify-center text-muted-foreground">
        {t.common_loading}
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-start justify-center bg-background px-4 py-10 sm:items-center">
      <div
        className="w-full max-w-2xl space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm"
        data-testid="two-factor-required-page"
      >
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-foreground">{t.twofactor_gate_title}</h1>
          <p className="text-sm leading-6 text-muted-foreground">{t.twofactor_gate_body}</p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </div>
        <TwoFactorSection onEnrolled={() => staffGo("/", { replace: true })} />
        <div className="border-t border-border pt-4">
          <Button type="button" variant="ghost" className="h-9 rounded-lg" onClick={() => void logout()}>
            {t.nav_logout}
          </Button>
        </div>
      </div>
    </div>
  );
}
