import { memo } from "react";

import { EmptyCell, Section } from "@/components/ui-shell";
import {
  appointmentText,
} from "@/pages/appointments/model/labels";
import type {
  AppointmentDetail,
  AppointmentPermissions,
  ChecklistItem,
  ReminderEntry,
  ReportSummary,
  StaffOption,
  TaskEntry,
} from "@/pages/appointments/model/types";
import {
  MemoizedAppointmentFindingsSection,
  MemoizedAppointmentIncomingDataSection,
} from "@/pages/appointments/ui/sections/clinical-follow-up-sections";
import { MemoizedAppointmentReportSection } from "@/pages/appointments/ui/sections/report-section";

type AppointmentClinicalSectionProps = {
  detail: AppointmentDetail;
  permissions: AppointmentPermissions;
  detailDefaultAssigneeId: string;
  doctorFollowUpAssignees: StaffOption[];
  incomingDataChecklist: ChecklistItem[];
  incomingDataReminders: ReminderEntry[];
  incomingDataTasks: TaskEntry[];
  findingsChecklist: ChecklistItem[];
  findingsReminders: ReminderEntry[];
  findingsTasks: TaskEntry[];
  detailReport: ReportSummary | null;
  reportReviewMeta: string;
  canSubmitInterpreterReport: boolean;
  canResubmitRejectedReport: boolean;
  showReportReviewActions: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
};

function AppointmentClinicalSection({
  detail,
  permissions,
  detailDefaultAssigneeId,
  doctorFollowUpAssignees,
  incomingDataChecklist,
  incomingDataReminders,
  incomingDataTasks,
  findingsChecklist,
  findingsReminders,
  findingsTasks,
  detailReport,
  reportReviewMeta,
  canSubmitInterpreterReport,
  canResubmitRejectedReport,
  showReportReviewActions,
  onRefresh,
  onError,
}: AppointmentClinicalSectionProps) {
  const clinicalEmpty = appointmentText("appointments_no_clinical_surfaces_are_available_for_this_appointment");
  const showClinicalIncomingSection =
    !detail.is_blocked &&
    permissions.canManageChecklist &&
    permissions.canViewReminders;
  const showClinicalFindingsSection =
    showClinicalIncomingSection &&
    Boolean(detail.provider_id || detail.doctor_id);
  const showClinicalReportSection = permissions.canViewReport;
  const hasClinicalContent =
    showClinicalIncomingSection ||
    showClinicalFindingsSection ||
    showClinicalReportSection;

  return (
    <>
      {hasClinicalContent ? (
        <>
          {showClinicalIncomingSection ? (
            <MemoizedAppointmentIncomingDataSection
              detail={detail}
              checklist={incomingDataChecklist}
              reminders={incomingDataReminders}
              tasks={incomingDataTasks}
              assignees={doctorFollowUpAssignees}
              defaultAssigneeId={detailDefaultAssigneeId}
              canCreateTasks={permissions.canCreateTasks}
              onRefresh={onRefresh}
              onError={onError}
            />
          ) : null}
          {showClinicalFindingsSection ? (
            <MemoizedAppointmentFindingsSection
              detail={detail}
              checklist={findingsChecklist}
              reminders={findingsReminders}
              tasks={findingsTasks}
              assignees={doctorFollowUpAssignees}
              defaultAssigneeId={detailDefaultAssigneeId}
              canCreateTasks={permissions.canCreateTasks}
              onRefresh={onRefresh}
              onError={onError}
            />
          ) : null}
          {showClinicalReportSection ? (
            <MemoizedAppointmentReportSection
              detail={detail}
              detailReport={detailReport}
              reportReviewMeta={reportReviewMeta}
              reportActions={{
                canSubmitInterpreterReport,
                canResubmitRejectedReport,
                showReportReviewActions,
                canApproveReport: permissions.canApproveReport,
                canRejectReport: permissions.canRejectReport,
              }}
              onRefresh={onRefresh}
              onError={onError}
            />
          ) : null}
        </>
      ) : (
        <Section
          title={appointmentText("appointments_clinical_surface")}
        >
          <EmptyCell>{clinicalEmpty}</EmptyCell>
        </Section>
      )}
    </>
  );
}

export const MemoizedAppointmentClinicalSection = memo(
  AppointmentClinicalSection,
);
