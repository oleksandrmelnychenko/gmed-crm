import { memo, useCallback, useState } from "react";

import {
  CasesRosterSection,
  type CaseRosterItem,
} from "@/components/cases-roster-section";
import { CaseWorkspaceModal } from "@/components/case-workspace-modal";
import { Banner, EmptyCell } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { appointmentText } from "@/pages/appointments/model/labels";
import { AppointmentPreviewSheet } from "@/pages/appointments/ui/shared/workspace-primitives";

export type LinkedCasesSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string;
  items: CaseRosterItem[];
  patientId: string | null;
  formatDateTimeLabel: (value?: string | null) => string;
};

function LinkedCasesSheet({
  open,
  onOpenChange,
  loading,
  error,
  items,
  patientId,
  formatDateTimeLabel,
}: LinkedCasesSheetProps) {
  const { t } = useLang();
  const [previewCaseId, setPreviewCaseId] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  const handlePreviewOpenChange = useCallback((nextOpen: boolean) => {
    setPreviewOpen(nextOpen);
    if (!nextOpen) {
      setPreviewCaseId("");
    }
  }, []);

  return (
    <>
      <AppointmentPreviewSheet
        open={open}
        onOpenChange={onOpenChange}
        title={t.cases_roster}
        description={
          loading
            ? `${t.cases_subtitle} · ${t.patients_syncing}`
            : `${t.cases_subtitle} · ${items.length} ${t.patients_records}`
        }
        maxWidthClassName="sm:max-w-[980px]"
      >
        <CasesRosterSection
          title={t.cases_roster}
          subtitle={t.cases_subtitle}
          counterLabel={
            loading ? t.patients_syncing : `${items.length} ${t.patients_records}`
          }
          loading={loading}
          loadingLabel={appointmentText(
            "Falle werden geladen",
            "Загрузка кейсов",
            "Loading cases",
          )}
          error={error}
          renderError={(message) => <Banner tone="error" withIcon>{message}</Banner>}
          items={items}
          onCaseClick={(item) => {
            if (!item.id) return;
            setPreviewCaseId(item.id);
            setPreviewOpen(true);
          }}
          emptyState={
            <EmptyCell>
              {appointmentText(
                "Keine Falle fur diesen Patienten.",
                "Для этого пациента нет кейсов.",
                "No cases for this patient.",
              )}
            </EmptyCell>
          }
          caseStatusLabel={(status) => status.replaceAll("_", " ")}
          reasonLabel={t.cases_reason}
          createdLabel={t.users_created}
          notSetLabel={t.common_not_set}
          formatDateTimeLabel={formatDateTimeLabel}
          showHeader={false}
        />
      </AppointmentPreviewSheet>

      <CaseWorkspaceModal
        caseId={previewCaseId || null}
        patientId={patientId}
        open={previewOpen}
        onOpenChange={handlePreviewOpenChange}
      />
    </>
  );
}

export const MemoizedLinkedCasesSheet = memo(LinkedCasesSheet);
