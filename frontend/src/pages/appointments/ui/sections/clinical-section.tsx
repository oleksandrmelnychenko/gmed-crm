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
  const clinicalEmpty = appointmentText(
    "Für diesen Termin sind keine klinischen Blöcke verfügbar.",
    "Для этого приёма нет клинических блоков.",
    "No clinical surfaces are available for this appointment.",
  );
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
        title={appointmentText(
          "Klinische Oberfläche",
          "Клинический блок",
          "Clinical surface",
        )}
        description={appointmentText(
          "Eingehende medizinische Daten, Befunde und Dolmetscherbericht direkt im Termin-Kontext.",
          "Входящие медицинские данные, заключения и отчёт переводчика прямо в контексте приёма.",
          "Incoming medical data, findings and interpreter reporting in the appointment context.",
        )}
        accessory={<CountBadge>{clinicalSurfaceItemCount}</CountBadge>}
      />

      {hasClinicalContent ? (
        <>
          <Section
            title={appointmentText(
              "Klinische Übersicht",
              "Клиническая сводка",
              "Clinical summary",
            )}
            accessory={<CountBadge>{clinicalOpenCount}</CountBadge>}
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={appointmentText(
                  "Intake offen",
                  "Открытый intake",
                  "Open intake",
                )}
                value={incomingDataOpenCount}
                description={appointmentText(
                  "Checklistenpunkte für Eingangsdaten.",
                  "Пункты чек-листа по входящим данным.",
                  "Checklist items for incoming data.",
                )}
              />
              <StatCard
                label={appointmentText(
                  "Befunde offen",
                  "Открытые заключения",
                  "Open findings",
                )}
                value={findingsOpenCount}
                description={appointmentText(
                  "Punkte rund um Arztbrief und Befunde.",
                  "Пункты по Arztbrief и заключениям.",
                  "Items related to Arztbrief and findings.",
                )}
              />
              <StatCard
                label={appointmentText(
                  "Follow-up-Last",
                  "Нагрузка follow-up",
                  "Follow-up load",
                )}
                value={clinicalFollowUpCount}
                description={appointmentText(
                  "Reminder und Aufgaben im klinischen Flow.",
                  "Напоминания и задачи в клиническом flow.",
                  "Reminders and tasks in the clinical flow.",
                )}
              />
              <StatCard
                label={appointmentText(
                  "Bericht",
                  "Отчёт",
                  "Report",
                )}
                value={
                  detailReport
                    ? reportApprovalLabel(detailReport.approval_status)
                    : appointmentText(
                        "Offen",
                        "Ожидается",
                        "Pending",
                      )
                }
                description={
                  detailReport
                    ? `${detailReport.hours} h`
                    : appointmentText(
                        "Noch nicht eingereicht.",
                        "Пока не отправлен.",
                        "Not submitted yet.",
                      )
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
              canSubmitInterpreterReport={canSubmitInterpreterReport}
              canResubmitRejectedReport={canResubmitRejectedReport}
              showReportReviewActions={showReportReviewActions}
              canApproveReport={permissions.canApproveReport}
              canRejectReport={permissions.canRejectReport}
              onRefresh={onRefresh}
              onError={onError}
            />
          ) : null}
        </>
      ) : (
        <Section
          title={appointmentText(
            "Klinische Oberfläche",
            "Клинический блок",
            "Clinical surface",
          )}
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
