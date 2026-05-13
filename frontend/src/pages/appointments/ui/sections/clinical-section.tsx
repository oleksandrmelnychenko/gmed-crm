import { memo } from "react";

import { CountBadge, EmptyCell, Section, StatCard } from "@/components/ui-shell";
import {
  appointmentText,
  reportApprovalLabel,
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
import { AppointmentWorkspaceSectionIntro } from "@/pages/appointments/ui/shared/workspace-primitives";

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
  const clinicalSurfaceItemCount =
    Number(showClinicalIncomingSection) +
    Number(showClinicalFindingsSection) +
    Number(showClinicalReportSection);
  const incomingDataOpenCount = incomingDataChecklist.filter(
    (item) => !item.is_completed,
  ).length;
  const findingsOpenCount = findingsChecklist.filter(
    (item) => !item.is_completed,
  ).length;
  const clinicalOpenCount = incomingDataOpenCount + findingsOpenCount;
  const clinicalFollowUpCount =
    incomingDataReminders.length +
    incomingDataTasks.length +
    findingsReminders.length +
    findingsTasks.length;

  return (
    <>
      <AppointmentWorkspaceSectionIntro
        title={appointmentText("appointments_clinical_surface")}
        description={appointmentText("appointments_incoming_medical_data_findings_and_interpreter_reporting")}
        accessory={<CountBadge>{clinicalSurfaceItemCount}</CountBadge>}
      />

      {hasClinicalContent ? (
        <>
          <Section
            title={appointmentText("appointments_clinical_summary")}
            accessory={<CountBadge>{clinicalOpenCount}</CountBadge>}
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={appointmentText("appointments_open_intake")}
                value={incomingDataOpenCount}
                description={appointmentText("appointments_checklist_items_for_incoming_data")}
              />
              <StatCard
                label={appointmentText("appointments_open_findings")}
                value={findingsOpenCount}
                description={appointmentText("appointments_items_related_to_arztbrief_and_findings")}
              />
              <StatCard
                label={appointmentText("appointments_follow_up_load")}
                value={clinicalFollowUpCount}
                description={appointmentText("appointments_reminders_and_tasks_in_the_clinical_flow")}
              />
              <StatCard
                label={appointmentText("appointments_report")}
                value={
                  detailReport
                    ? reportApprovalLabel(detailReport.approval_status)
                    : appointmentText("appointments_pending")
                }
                description={
                  detailReport
                    ? `${detailReport.hours} h`
                    : appointmentText("appointments_not_submitted_yet")
                }
              />
            </div>
          </Section>

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
