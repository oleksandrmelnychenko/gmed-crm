import { CasesPage } from "@/pages/cases";
import { useLang } from "@/lib/i18n";

export function CaseWorkspaceModal({
  open,
  caseId,
  patientId,
  onOpenChange,
}: {
  open: boolean;
  caseId: string | null;
  patientId?: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLang();

  if (!open) return null;

  if (!caseId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 text-sm text-white">
        {t.common_failed_load}
      </div>
    );
  }

  return (
    <CasesPage
      embedded
      embeddedPatientId={patientId}
      embeddedCaseId={caseId}
      embeddedSheetModal={false}
      embeddedSheetShowOverlay={false}
      embeddedSheetSide="right"
      onCloseCaseSheet={() => onOpenChange(false)}
    />
  );
}
