import { useEffect, useMemo } from "react";
import { LoaderCircle } from "lucide-react";
import { useLocation, useParams } from "react-router-dom";

import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";

type LegacyCaseDetail = {
  patient_id?: string | null;
};

export type LegacyCasesResolution =
  | { kind: "redirect"; href: string }
  | { kind: "lookup"; caseId: string };

export function patientClinicalHref(patientId: string) {
  return `/patients/${encodeURIComponent(patientId)}?tab=clinical`;
}

export function resolveLegacyCasesLocation(
  routeCaseId: string | undefined,
  search: string,
): LegacyCasesResolution {
  const params = new URLSearchParams(search);
  const explicitPatientId = params.get("patient") ?? params.get("patient_id");
  if (explicitPatientId?.trim()) {
    return { kind: "redirect", href: patientClinicalHref(explicitPatientId.trim()) };
  }

  const caseId = routeCaseId?.trim() || params.get("case")?.trim();
  if (caseId) return { kind: "lookup", caseId };

  return { kind: "redirect", href: "/patients" };
}

/** Compatibility bridge while backend case_id attribution is still present. */
export function LegacyCasesRedirect() {
  const { caseId } = useParams<{ caseId: string }>();
  const { search } = useLocation();
  const { staffGo } = useStaffNavigate();
  const { t } = useLang();
  const resolution = useMemo(
    () => resolveLegacyCasesLocation(caseId, search),
    [caseId, search],
  );

  useEffect(() => {
    if (resolution.kind === "redirect") {
      staffGo(resolution.href);
      return;
    }

    const controller = new AbortController();
    apiFetch<LegacyCaseDetail>(`/cases/${encodeURIComponent(resolution.caseId)}`, {
      signal: controller.signal,
    })
      .then((detail) => {
        if (controller.signal.aborted) return;
        staffGo(
          detail.patient_id
            ? patientClinicalHref(detail.patient_id)
            : "/patients",
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) staffGo("/patients");
      });

    return () => controller.abort();
  }, [resolution, staffGo]);

  return (
    <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">
      <LoaderCircle className="mr-2 size-4 animate-spin" />
      {t.common_loading}
    </div>
  );
}
