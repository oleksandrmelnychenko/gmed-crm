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
  const { lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;

  if (user?.role === "patient") {
    return (
      <Suspense fallback={<div className="min-h-[40vh]" />}>
        <PatientPrivacyPage />
      </Suspense>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
      {l(
        "Der Datenschutzbereich hier ist nur fuer Patientenkonten.",
        "Этот раздел приватности доступен только пациентским аккаунтам.",
        "This privacy area is only available for patient accounts.",
      )}
    </div>
  );
}
