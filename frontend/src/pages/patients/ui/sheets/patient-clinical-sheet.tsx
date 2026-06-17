import { lazy, Suspense, useState } from "react";
import { Stethoscope } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/i18n";

import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

const LazyPatientClinicalTab = lazy(async () => {
  const mod = await import("../sections/patient-clinical-tab");
  return { default: mod.PatientClinicalTab };
});

/**
 * Trigger button + right-side sheet that hosts the full clinical editor
 * (diagnoses, medication, examinations, procedures, narrative). Self-contained:
 * owns its own open state, so it can be dropped next to the patient overview card
 * without threading sheet state through the workspace.
 */
export function PatientClinicalSheet({
  patientId,
  canManage,
}: {
  patientId: string;
  canManage: boolean;
}) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 rounded-lg"
        onClick={() => setOpen(true)}
      >
        <Stethoscope className="size-3.5" />
        {tx("Диагнозы и медикаменты", "Diagnosen & Medikation")}
      </Button>
      <PatientSheetScaffold
        open={open}
        onOpenChange={setOpen}
        title={tx("Диагнозы, медикаменты и обследования", "Diagnosen, Medikation & Befunde")}
        maxWidthClassName="sm:max-w-[1080px]"
      >
        {open ? (
          <Suspense
            fallback={
              <p className="py-10 text-center text-sm text-muted-foreground">
                {tx("Загрузка…", "Laden…")}
              </p>
            }
          >
            <LazyPatientClinicalTab patientId={patientId} canManage={canManage} embedded />
          </Suspense>
        ) : null}
      </PatientSheetScaffold>
    </>
  );
}
