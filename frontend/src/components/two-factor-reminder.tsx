import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { StaffLink } from "@/components/staff-link";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { fetchTotpStatus } from "@/pages/two-factor";

/**
 * Shown on every staff page until a role that must use a second factor has
 * enrolled one. It nags rather than locks: locking would leave nobody able to
 * reach the enrolment page.
 */
export function TwoFactorReminder() {
  const { user } = useAuth();
  const { t } = useLang();
  const location = useLocation();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!user || user.role === "patient") {
      setMissing(false);
      return;
    }
    let cancelled = false;
    fetchTotpStatus()
      .then((status) => {
        if (!cancelled) setMissing(status.required && !status.enrolled);
      })
      .catch(() => {
        if (!cancelled) setMissing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, location.pathname]);

  if (!missing || location.pathname === "/security/two-factor") return null;

  return (
    <div
      role="alert"
      data-testid="two-factor-reminder"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <span>{t.uiText.twofactor_required_banner}</span>
      <StaffLink to="/security/two-factor" className="font-medium underline">
        {t.uiText.twofactor_required_link}
      </StaffLink>
    </div>
  );
}
