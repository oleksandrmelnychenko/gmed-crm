import { useCallback, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { ChangePasswordForm } from "@/pages/account";

/**
 * Minimal gate shown after sign-in when the server flags
 * `password_change_required` (admin-forced reset or expired password).
 * Rendered outside the app shell: no navigation, only the form and logout.
 */
export function AccountPasswordRequiredPage() {
  const { user, loading, logout, refreshUser } = useAuth();
  const { t } = useLang();
  const { staffGo } = useStaffNavigate();
  const l = useCallback((key: string) => t.uiText[key] ?? key, [t]);

  // Nothing to gate: back to the shell, which itself sends anonymous
  // visitors to /login.
  const gateOpen = !loading && (!user || !user.password_change_required);
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

  const onChanged = async () => {
    const me = await refreshUser().catch(() => null);
    if (me && !me.password_change_required) {
      staffGo("/", { replace: true });
    }
  };

  return (
    <div className="flex min-h-dvh items-start justify-center bg-background px-4 py-10 sm:items-center">
      <div className="w-full max-w-2xl space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm" data-testid="password-required-page">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-foreground">{l("account_password_required_title")}</h1>
          <p className="text-sm leading-6 text-muted-foreground">{l("account_password_required_body")}</p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </div>
        <ChangePasswordForm onChanged={onChanged} />
        <div className="border-t border-border pt-4">
          <Button type="button" variant="ghost" className="h-9 rounded-lg" onClick={() => void logout()}>
            {t.nav_logout}
          </Button>
        </div>
      </div>
    </div>
  );
}
