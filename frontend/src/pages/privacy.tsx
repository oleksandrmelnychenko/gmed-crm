import { Suspense, lazy } from "react";

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

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
      {t.portal_privacy_area_patient_only}
    </div>
  );
}
