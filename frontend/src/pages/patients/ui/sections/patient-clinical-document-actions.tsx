import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClinicalReportPdfAction } from "./clinical-report-pdf-action";
import { LabResultsPdfAction } from "./lab-results-pdf-action";
import { MedicationPlanPdfAction } from "./medication-plan-pdf-action";

const actionClassName = "h-auto min-h-9 max-w-full gap-1.5 rounded-lg whitespace-normal px-3 py-2 text-left sm:h-9 sm:py-0";

export function PatientClinicalDocumentActions({
  patientId, lang, canViewClinical, canManageDocuments, importAttentionCount, onScan,
}: {
  patientId: string;
  lang: "ru" | "de";
  canViewClinical: boolean;
  canManageDocuments: boolean;
  importAttentionCount: number;
  onScan: () => void;
}) {
  if (!patientId || (!canViewClinical && !canManageDocuments)) return null;

  return <div
    role="group"
    aria-label={lang === "de" ? "Medizinische Dokumente" : "Медицинские документы"}
    className="flex w-fit max-w-full flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-muted/30 p-2"
  >
    {canViewClinical ? <>
      <ClinicalReportPdfAction patientId={patientId} className={actionClassName} />
      <LabResultsPdfAction patientId={patientId} className={actionClassName} />
      <MedicationPlanPdfAction patientId={patientId} lang={lang} className={actionClassName} />
    </> : null}
    {canManageDocuments ? <Button type="button" size="sm" variant="outline" className={actionClassName} onClick={onScan}>
      <FileUp className="size-3.5" aria-hidden />
      {lang === "de" ? "Scannen und erkennen" : "Сканировать и распознать"}
      {importAttentionCount > 0 ? <span className="flex min-w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold leading-5 text-amber-800">
        {importAttentionCount}
      </span> : null}
    </Button> : null}
  </div>;
}
