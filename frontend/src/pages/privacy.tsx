import { Suspense, lazy } from "react";

import { StaffLink } from "@/components/staff-link";
import { PageHeader } from "@/components/ui-shell";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";

const PatientPrivacyPage = lazy(() =>
  import("@/pages/patients/portal-privacy-page").then((module) => ({
    default: module.PatientPrivacyPage,
  })),
);

export function PrivacyPage() {
  const { user } = useAuth();
  const { t } = useLang();

  if (user?.role === "patient") {
    return (
      <Suspense fallback={<div className="min-h-[40vh]" />}>
        <PatientPrivacyPage />
      </Suspense>
    );
  }

  // Staff keep the DSGVO requests of all people in the compliance register;
  // this page was a dead end for them (QA 2026-11-12 S3-6): it now has a
  // title and leads there. The register checks its own rights.
  return (
    <div className="space-y-3">
      <PageHeader title={t.nav_my_privacy} />
      <div className="space-y-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <p>{t.portal_privacy_area_patient_only}</p>
        <StaffLink to="/admin/compliance" className="font-medium text-primary underline-offset-4 hover:underline">
          {t.nav_compliance}
        </StaffLink>
      </div>
    </div>
  );
}
